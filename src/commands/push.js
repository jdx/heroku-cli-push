// @flow

import Listr from 'listr'
import {Command, flags} from 'cli-engine-heroku'
import path from 'path'
import execa from 'execa'
import fs from 'fs-extra'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

type Source = {
  source_blob: {
    get_url: string,
    put_url: string
  }
}

type Build = {
  output_stream_url: string
}

class Git {
  static get hasGit (): boolean {
    return fs.existsSync('.git')
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

  static async exec (...args: string[]): Promise<string> {
    if (!this.hasGit) throw new Error('not a git repository')
    return execa.stdout('git', args)
  }
}

export default class Status extends Command {
  static topic = 'push'
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
  }

  get _app (): string {
    if (!this.app) throw new Error('no app specified')
    return this.app
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
      this.tests(),
      {
        title: 'Create build',
        task: () => new Listr([
          this.createSource(),
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

  tests () {
    return {
      title: 'Run tests',
      skip: () => this.flags.yolo,
      task: () => wait(300)
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

  uploadSource () {
    return {
      title: 'Uploading source',
      task: async () => {
        // console.dir(this.source)
      }
    }
  }

  createBuild () {
    return {
      title: 'Uploading source',
      task: async () => {
        this.build = await this.heroku.post(`/apps/${this._app}/builds`, {
          body: {
            source_blob: {
              // TODO: checksum
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
      title: 'Build',
      task: async () => {
        // console.dir(this.source)
      }
    }
  }
}
