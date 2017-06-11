// @flow

import {Command, flags} from 'cli-engine-heroku'

export default class Status extends Command {
  static topic = 'push'
  static description = 'push code to heroku'
  static flags = {
    json: flags.boolean({description: 'output in json format'})
  }

  async run () {
    this.out.log('foo')
  }
}
