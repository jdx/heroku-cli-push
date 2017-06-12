// @flow

import {Command, flags} from 'cli-engine-heroku'

export default class BuildsIndex extends Command {
  static topic = 'builds'
  static description = 'list previous builds'
  static flags = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    json: flags.boolean({description: 'output in json format'})
  }

  async run () {
    let builds = await this.heroku.get(`/apps/${this._app}/builds`)
    if (this.flags.json) {
      this.out.styledJSON(builds)
    } else {
      this.out.table(builds, {
        columns: [
          {key: 'created_at', label: 'date'},
          {key: 'user.email', label: 'user'}
        ]
      })
    }
  }

  get _app (): string {
    if (!this.app) throw new Error('no app specified')
    return this.app
  }
}
