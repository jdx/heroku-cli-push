// @flow

import Listr from 'listr'
import {Command, flags} from 'cli-engine-heroku'
import path from 'path'
import execa from 'execa'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

export default class Status extends Command {
  static topic = 'push'
  static description = 'push code to heroku'
  static flags = {
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

  async run () {
    this.validate()
    process.chdir(this.root)
    const listr = new Listr(this.tasks(), {
      renderer: this.renderer
    })

    await listr.run()
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
      this.gitChecks(),
      this.tests(),
      this.initializeBuild()
    ]
  }

  gitChecks () {
    return {
      title: 'Git prerequisite checks',
      skip: () => this.flags.yolo,
      task: () => new Listr([
        this.gitRemoteHistory(),
        this.gitDirty(),
        this.gitCurrentBranch()
      ], {concurrent: true})
    }
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
        let status = await execa.stdout('git', ['status', '--porcelain'])
        if (status !== '') throw new Error('Unclean working tree. Commit or stash changes first.')
        await wait(400) // fake wait for demo
      }
    }
  }

  gitCurrentBranch () {
    return {
      title: 'Check current branch',
      skip: () => this.flags['any-branch'],
      task: async () => {
        let branch = await execa.stdout('git', ['symbolic-ref', '--short', 'HEAD'])
        if (branch !== 'master') throw new Error('Not on `master` branch. Use --any-branch to publish anyway.')
        await wait(800) // fake wait for demo
      }
    }
  }

  tests () {
    return {
      title: 'Run tests',
      task: () => wait(300)
    }
  }

  initializeBuild () {
    return {
      title: 'Initializing build',
      task: () => wait(1000)
    }
  }
}
