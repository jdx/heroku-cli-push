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

  validate () {
    if (this.flags.verbose && this.flags.silent) throw new Error('may not have --verbose and --silent')
  }

  run () {
    this.validate()
    process.chdir(this.root)
    const tasks = new Listr([
      this.gitChecks(),
      this.tests(),
      this.publish()
    ], {
      renderer: this.renderer
    })

    return tasks.run()
  }

  get renderer (): ?string {
    if (this.flags.silent) return 'silent'
    if (this.flags.verbose) return 'verbose'
  }

  get root (): string {
    return path.resolve(this.args.root || '.')
  }

  gitChecks () {
    return {
      title: 'Git prerequisite checks',
      skip: () => this.flags.yolo,
      task: () => new Listr([
        this.gitRemoteHistory(),
        this.gitDirty(),
        this.gitCurrentBranch()
      ], {})
    }
  }

  gitCurrentBranch () {
    return {
      title: 'Check current branch',
      skip: () => this.flags['any-branch'],
      task: () => execa.stdout('git', ['symbolic-ref', '--short', 'HEAD']).then(branch => {
        if (branch !== 'master') {
          throw new Error('Not on `master` branch. Use --any-branch to publish anyway.')
        }
      })
    }
  }

  gitDirty () {
    return {
      title: 'Check local working tree',
      skip: () => this.flags.dirty,
      task: () => execa.stdout('git', ['status', '--porcelain']).then(status => {
        if (status !== '') {
          throw new Error('Unclean working tree. Commit or stash changes first.')
        }
      })
    }
  }

  gitRemoteHistory () {
    return {
      title: 'Check remote history',
      task: () => execa.stdout('git', ['rev-list', '--count', '--left-only', '@{u}...HEAD']).then(result => {
        if (result !== '0') {
          throw new Error('Remote history differs. Please pull changes.')
        }
      })
    }
  }

  tests () {
    return {
      title: 'Run tests',
      task: () => wait(1000)
    }
  }

  publish () {
    return {
      title: 'Publish package',
      task: () => wait(1000)
    }
  }
}
