// @flow

import Listr from 'listr'
import {Command, flags} from 'cli-engine-heroku'

const wait = ms => new Promise(resolve => (setTimeout(resolve, ms): any).unref())

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

  async run () {
    const {color} = this.out
    this.validate()
    this.out.log(`Pushing ${color.blue(process.cwd())} to ${color.app(this._app)}...`)
    const tasks = this.tasks()
    const options = {
      renderer: this.renderer
    }
    const listr = new Listr(tasks, options)
    await listr.run()
  }

  __app: ?string
  get _app (): string {
    return this.flags.app
  }

  validate () {
    if (this.flags.verbose && this.flags.silent) throw new Error('may not have --verbose and --silent')
  }

  get renderer (): ?string {
    if (this.flags.silent) return 'silent'
    if (this.flags.verbose) return 'verbose'
  }

  tasks () {
    return [
      {
        title: 'Git prerequisite checks',
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
        await wait(1000)
      }
    }
  }

  gitRemoteHistory () {
    return {
      title: 'Check remote history',
      task: async () => {
        await wait(1000)
      }
    }
  }

  gitDirty () {
    return {
      title: 'Check local working tree',
      skip: () => this.flags.dirty,
      task: async () => {
        await wait(1000)
      }
    }
  }

  gitCurrentBranch () {
    return {
      title: 'Check current branch',
      skip: () => this.flags['any-branch'],
      task: async () => {
        await wait(1000)
      }
    }
  }

  createSource () {
    return {
      title: 'Creating source to upload to',
      task: async () => {
        await wait(1000)
      }
    }
  }

  createTarball () {
    return {
      title: 'Creating tarball',
      task: async () => {
        await wait(1000)
      }
    }
  }

  uploadSource () {
    return {
      title: 'Uploading source',
      task: async () => {
        await wait(1000)
      }
    }
  }

  createBuild () {
    return {
      title: 'Creating build',
      task: async () => {
        await wait(1000)
      }
    }
  }

  streamBuild () {
    return {
      title: 'Building',
      task: async () => {
        await wait(1000)
      }
    }
  }
}
