// @flow

import Listr from 'listr'
import {Command, flags} from 'cli-engine-heroku'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

export default class Status extends Command {
  static topic = 'push'
  static description = 'push code to heroku'
  static flags = {
    verbose: flags.boolean({char: 'v'}),
    silent: flags.boolean({char: 's'})
  }

  validate () {
    if (this.flags.verbose && this.flags.silent) this.out.error('may not have --verbose and --silent')
  }

  run () {
    this.validate()
    const tasks = new Listr([
      {
        title: 'Git',
        task: () => {
          return new Listr([
            {
              title: 'Checking git status',
              task: () => wait(1000)
            },
            {
              title: 'Checking remote history',
              task: () => wait(1000)
            }
          ], {concurrent: true})
        }
      },
      {
        title: 'Install package dependencies with Yarn',
        task: () => wait(1000)
      },
      {
        title: 'Install package dependencies with npm',
        enabled: ctx => ctx.yarn === false,
        task: () => wait(1000)
      },
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
