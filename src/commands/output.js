// @flow

import {Command, flags} from 'cli-engine-heroku'

export default class BuildsOutput extends Command {
  static topic = 'builds'
  static command = 'output'
  static description = 'show previous build output'
  static flags = {
    app: flags.app({required: true}),
    remote: flags.remote()
  }

  async run () {
    let builds = await this.heroku.get(`/apps/${this._app}/builds`, {
      partial: true,
      headers: {range: 'id ..; max=1'}
    })
    if (!builds.length) throw new Error('no builds')
    let build = builds[0]
    let output = await this.http.get(build.output_stream_url)
    this.out.stdout.write(output)
  }

  get _app (): string {
    if (!this.app) throw new Error('no app specified')
    return this.app
  }
}
