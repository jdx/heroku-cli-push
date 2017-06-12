// @flow

import Listr from 'listr'
import {Command, flags} from 'cli-engine-heroku'
import path from 'path'
import execa from 'execa'
import fs from 'fs-extra'
import tar from 'tar-fs'
import zlib from 'zlib'
import tmp from 'tmp'
import {spawnSync} from 'child_process'
import {Observable} from 'rxjs/Observable'

const debug = require('debug')('heroku-cli:builds:push')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

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

class Git {
  static debug = require('debug')('heroku-cli:builds:push:git')

  static get hasGit (): boolean {
    return fs.existsSync('.git')
  }

  static async exec (...args: string[]): Promise<string> {
    if (!this.hasGit) throw new Error('not a git repository')
    debug(args.join(' '))
    return execa.stdout('git', args)
  }

  static execSync (...args: string[]) {
    if (!this.hasGit) throw new Error('not a git repository')
    let cmd = spawnSync('git', args, {encoding: 'utf8'})
    debug(`git ${args.join(' ')} = code: ${cmd.status} stdout: ${(cmd.stdout: any)}`)
    return cmd
  }

  static async dirty (): Promise<boolean> {
    let status = await this.exec('status', '--porcelain')
    return status !== ''
  }

  static async branch (): Promise<string> {
    return this.exec('symbolic-ref', '--short', 'HEAD')
  }

  static async sha (): Promise<?string> {
    if (await this.dirty) return
    return this.exec('rev-parse', 'HEAD')
  }

  static checkIgnore (f: string): boolean {
    let cmd = this.execSync('check-ignore', f)
    if (cmd.status === 0) return true
    else if (cmd.status === 1) return false
    else throw new Error(cmd.output[2])
  }
}

export default class Status extends Command {
  static topic = 'builds'
  static command = 'push'
  static aliases = ['push']
  static description = 'push code to heroku'
  static flags = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    verbose: flags.boolean({char: 'v', description: 'display all progress output'}),
    silent: flags.boolean({char: 's', description: 'display no progress output'}),
    yolo: flags.boolean({description: 'disable all git checks'}),
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

  async run () {
    const {color} = this.out
    this.validate()
    process.chdir(this.root)
    this.out.log(`Pushing ${color.blue(process.cwd())} to ${color.app(this._app)}...`)
    const tasks = this.tasks()
    const options = {
      renderer: this.renderer
    }
    const listr = new Listr(tasks, options)
    await listr.run()
    this.out.log(lastLine(this.buildOutput))
  }

  get _app (): string {
    if (!this.app) throw new Error('no app specified')
    return this.app
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
        skip: () => this.flags.yolo,
        task: () => new Listr([
          this.gitRemoteHistory(),
          this.gitDirty(),
          this.gitCurrentBranch()
        ], {concurrent: true})
      },
      // this.tests(),
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

  gitRemoteHistory () {
    return {
      title: 'Check remote history',
      task: async () => {
        let rev = await execa.stdout('git', ['rev-list', '--count', '--left-only', '@{u}...HEAD'])
        if (rev !== '0') throw new Error('Remote history differs. Please pull changes.')
        await wait(400) // fake wait for demo
      }
    }
  }

  gitDirty () {
    return {
      title: 'Check local working tree',
      skip: () => this.flags.dirty,
      task: async () => {
        let dirty = await Git.dirty()
        if (dirty) throw new Error('Unclean working tree. Commit or stash changes first.')
        await wait(400) // fake wait for demo
      }
    }
  }

  gitCurrentBranch () {
    return {
      title: 'Check current branch',
      skip: () => this.flags['any-branch'],
      task: async () => {
        let branch = await Git.branch()
        if (branch !== 'master') throw new Error('Not on `master` branch. Use --any-branch to publish anyway.')
        await wait(800) // fake wait for demo
      }
    }
  }

  // tests () {
  //   return {
  //     title: 'Run tests',
  //     skip: () => this.flags.yolo,
  //     task: () => wait(300)
  //   }
  // }

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
              url: this.source.source_blob.get_url
            }
          }
        })
      }
    }
  }

  streamBuild () {
    return {
      title: 'Building',
      task: async () => {
        return new Observable(o => {
          let streamBuild = async () => {
            let stream = await this.heroku.stream(this.build.output_stream_url)
            return new Promise((resolve, reject) => {
              stream.setEncoding('utf8')
              stream.on('data', data => {
                this.buildOutput += data
                data.trim().split('\n').forEach(l => o.next(l))
              })
              stream.on('error', reject)
              stream.on('end', resolve)
            })
          }
          let buildCheck = async () => {
            let build = await this.heroku.get(`/apps/${this._app}/builds/${this.build.id}`)
            switch (build.status) {
              case 'pending':
                await wait(500)
                return buildCheck()
              case 'failed':
                let result = await this.heroku.get(`/apps/${this._app}/builds/${this.build.id}/result`)
                throw new Error(result.lines.map(l => l.line).join('\n'))
              case 'succeeded':
                return
              default:
                throw new Error(`unexpected status: ${build.status}`)
            }
          }
          Promise.all([streamBuild(), buildCheck()]).then(() => o.complete()).catch(err => o.error(err))
        })
      }
    }
  }
}
