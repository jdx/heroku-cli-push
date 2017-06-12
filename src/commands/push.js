// @flow

import Listr from 'listr'
import {Command, flags} from 'cli-engine-heroku'
import path from 'path'
import execa from 'execa'
import fs from 'fs-extra'
import tar from 'tar-fs'
import zlib from 'zlib'
import tmp from 'tmp'
import {Observable} from 'rxjs/Observable'
import Git from '../git'
import AppJson from '../app_json'
import EventEmitter from 'events'

const debug = require('debug')('heroku-cli:builds:push')
const wait = ms => new Promise(resolve => (setTimeout(resolve, ms): any).unref())

type Source = {
  source_blob: {
    get_url: string,
    put_url: string
  }
}

type Build = {
  id: string,
  output_stream_url: string
}

function lastLine (s: string): string {
  return s.split('\n').map(s => s.trim()).filter(s => s).reverse()[0]
}

export default class Status extends Command {
  static topic = 'builds'
  static command = 'push'
  static aliases = ['push']
  static description = 'push code to heroku'
  static flags = {
    // app: flags.app({required: true}),
    app: flags.app(),
    remote: flags.remote(),
    verbose: flags.boolean({char: 'v', description: 'display all progress output'}),
    silent: flags.boolean({char: 's', description: 'display no progress output'}),
    force: flags.boolean({description: 'disable all git checks'}),
    dirty: flags.boolean({description: 'disable git dirty check'}),
    'any-branch': flags.boolean({description: 'allow pushing from branch other than master'})
  }
  static args = [
    {
      name: 'root',
      optional: true,
      description: 'path to project root [default=.]'
    }
  ]

  source: Source
  build: Build
  tarballHash: {md5: string, sha256: string}
  buildOutput: string
  listr: Listr

  async run () {
    const {color} = this.out
    this.validate()
    try {
      process.chdir(this.root)
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error(`${this.root} does not exist`)
      else throw err
    }
    if (this.root === process.cwd()) {
      this.out.log(`Pushing to ${color.app(this._app)}...`)
    } else {
      this.out.log(`Pushing ${color.blue(process.cwd())} to ${color.app(this._app)}...`)
    }
    const tasks = this.tasks()
    const options = {
      renderer: this.renderer
    }
    this.listr = new Listr(tasks, options)
    await this.listr.run()
    this.out.log(lastLine(this.buildOutput))
  }

  __app: ?string
  get _app (): string {
    if (this.__app) return this.__app
    this.__app = this.flags.app
    let env = this.appJson.currentEnvironment
    if (!this.__app && env && env.app) this.__app = env.app
    if (!this.__app) throw new Error('no app specified')
    return this.__app
  }

  _appJson: AppJson
  get appJson (): AppJson {
    if (this._appJson) return this._appJson
    this._appJson = new AppJson()
    return this._appJson
  }

  _tarballFile: ?string
  get tarballFile (): string {
    if (this._tarballFile) return this._tarballFile
    this._tarballFile = tmp.tmpNameSync({postfix: '.tar.gz'})
    return this._tarballFile
  }

  validate () {
    if (this.flags.verbose && this.flags.silent) throw new Error('may not have --verbose and --silent')
  }

  get renderer (): ?string {
    if (this.flags.silent) return 'silent'
    if (this.flags.verbose) return 'verbose'
  }

  get root (): string {
    return path.resolve(this.args.root || '.')
  }

  tasks () {
    return [
      {
        title: 'Git prerequisite checks',
        enabled: () => Git.hasGit,
        skip: () => this.flags.force,
        task: () => new Listr([
          this.gitFetch(),
          this.gitCurrentBranch(),
          this.gitDirty(),
          this.gitRemoteHistory()
        ])
      },
      {
        title: 'Uploading source',
        task: () => new Listr([
          {
            title: 'Creating source',
            task: () => new Listr([
              this.createSource(),
              this.createTarball()
            ], {concurrent: true})
          },
          this.uploadSource(),
          this.createBuild()
        ])
      },
      this.streamBuild()
    ]
  }

  gitFetch () {
    return {
      title: 'Running git fetch',
      task: async () => {
        await Git.exec('fetch')
      }
    }
  }

  gitRemoteHistory () {
    return {
      title: 'Check remote history',
      task: async () => {
        let changes = await Git.exec('rev-list', '--count', '--left-only', '@{u}...HEAD')
        if (changes !== '0') throw new Error(`Remote history differs. Please pull ${changes} changes. Run with --force to push a build to Heroku anyway.`)

        let lastBuild = await this.lastHerokuBuild()
        if (lastBuild && lastBuild.source_blob && lastBuild.source_blob.version) {
          let {version, version_description: description} = lastBuild.source_blob
          description = description ? description = `\nVersion description: ${description}` : ''
          try {
            await execa.stdout('git', ['rev-list', '--count', '--left-only', `${version}...HEAD`])
          } catch (err) {
            if (!err.message.includes('Invalid symmetric difference expression')) throw err
            throw new Error(`Git SHA: ${version} exists on Heroku but not locally.${description}\nUse --force to push anyway.`)
          }
        }
      }
    }
  }

  async lastHerokuBuild (startedAt: ?string) {
    let builds = await this.heroku.get(`/apps/${this._app}/builds`, {
      partial: true,
      headers: {range: `started_at ${startedAt || ''}..; max=100, order=desc`}
    })
    if (!builds.length) return
    let build = builds.find(b => b.status === 'succeeded')
    if (build) return build
    return this.lastHerokuBuild(builds[builds.length - 1].created_at)
  }

  gitDirty () {
    return {
      title: 'Check local working tree',
      skip: () => this.flags.dirty,
      task: async () => {
        let dirty = await Git.dirty()
        if (dirty) throw new Error('Unclean working tree. Commit or stash changes first. Use --dirty or --force to push anyway.')
        let changes = await Git.exec('rev-list', '--count', '--right-only', '@{u}...HEAD')
        if (changes !== '0') throw new Error(`${changes} unpushed commits. Please push changes to origin. Run with --dirty or --force to push a build to Heroku anyway.`)
      }
    }
  }

  gitCurrentBranch () {
    return {
      title: 'Check current branch',
      skip: () => this.flags['any-branch'],
      task: async () => {
        let env = this.appJson.currentEnvironment
        const expected = (env && env.branch) ? env.branch : 'master'
        const current = await Git.branch()
        if (current !== expected) throw new Error(`On ${current} not ${expected} branch. Use --any-branch to push anyway.`)
      }
    }
  }

  createSource () {
    return {
      title: 'Creating source to upload to',
      task: async () => {
        this.source = await this.heroku.post(`/apps/${this._app}/sources`)
      }
    }
  }

  createTarball () {
    return {
      title: 'Creating tarball',
      task: () => {
        let crypto = require('crypto')
        let hashers = {
          md5: crypto.createHash('md5'),
          sha256: crypto.createHash('sha256')
        }
        debug(`tarball: ${this.tarballFile}`)
        let pack = tar.pack('.', {
          ignore: (f) => {
            if (!Git.hasGit) return false
            if (['.git'].includes(f)) return true
            return Git.checkIgnore(f)
          }
        })
        .pipe(zlib.createGzip())
        .on('data', d => {
          hashers.md5.update(d)
          hashers.sha256.update(d)
        })
        .pipe(fs.createWriteStream(this.tarballFile))
        return new Promise((resolve, reject) => {
          pack.on('error', reject)
          pack.on('close', () => {
            this.tarballHash = {
              sha256: hashers.sha256.digest('hex'),
              md5: hashers.md5.digest('hex')
            }
            debug(`md5 hash of tarball: ${this.tarballHash.md5}`)
            debug(`sha256 hash of tarball: ${this.tarballHash.sha256}`)
            resolve()
          })
        })
      }
    }
  }

  uploadSource () {
    return {
      title: 'Uploading source',
      task: async () => {
        await this.http.put(this.source.source_blob.put_url, {
          body: fs.createReadStream(this.tarballFile),
          headers: {
            // 'Content-MD5': this.tarballHash.md5,
            'Content-Length': fs.statSync(this.tarballFile).size
          }
        })
      }
    }
  }

  createBuild () {
    return {
      title: 'Creating build',
      task: async () => {
        this.build = await this.heroku.post(`/apps/${this._app}/builds`, {
          body: {
            source_blob: {
              checksum: `SHA256:${this.tarballHash.sha256}`,
              version: await Git.sha(),
              version_description: await Git.description(),
              url: this.source.source_blob.get_url
            }
          }
        })
      }
    }
  }

  stream () {
    let e = new EventEmitter()
    let streamBuild = (async () => {
      let stream = await this.heroku.stream(this.build.output_stream_url)
      return new Promise((resolve, reject) => {
        stream.setEncoding('utf8')
        stream.on('data', data => {
          this.buildOutput += data
          data.trimRight().split('\n').forEach(l => e.emit('data', l))
        })
        stream.on('error', reject)
        stream.on('end', resolve)
      })
    })()
    let buildCheck = async () => {
      let build = await this.heroku.get(`/apps/${this._app}/builds/${this.build.id}`)
      switch (build.status) {
        case 'pending':
          await Promise.race([streamBuild, wait(30000)])
          return buildCheck()
        case 'failed':
          let result = await this.heroku.get(`/apps/${this._app}/builds/${this.build.id}/result`)
          throw new Error(result.lines.map(l => l.line).join(''))
        case 'succeeded':
          return
        default:
          throw new Error(`unexpected status: ${build.status}`)
      }
    }
    Promise.all([streamBuild, buildCheck()])
      .then(() => e.emit('complete'))
      .catch(err => e.emit('error', err))
    e.setMaxListeners(0)
    return e
  }

  streamBuild (title: string = 'Start build', e: EventEmitter) {
    return {
      title,
      task: () => {
        return new Observable(o => {
          if (!e) e = this.stream()
          e.on('error', err => o.error(err))
          e.on('complete', () => o.complete())
          e.on('data', d => {
            if (!this.renderer && d.startsWith('-----> ')) {
              e.removeAllListeners('data')
              this.listr.add(this.streamBuild(d.substr(7), e))
              o.complete()
            } else {
              o.next(d)
            }
          })
        })
      }
    }
  }
}
