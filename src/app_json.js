// @flow

import path from 'path'
import fs from 'fs-extra'
import Git from './git'

export type AppEnvironment = {
  app?: string,
  branch?: string,
  scripts?: {[name: string]: string}
}

export type App = {
  environments?: {[env: string]: AppEnvironment}
}

export default class AppJson {
  _path: string
  _app: App

  constructor (root: string = process.cwd()) {
    this._path = path.join(root, 'app.json')
    if (fs.existsSync(this._path)) {
      this._app = fs.readJSONSync(this._path)
    } else {
      this._app = {}
    }
  }

  get currentEnvironment (): ?AppEnvironment {
    const environments = this._app.environments
    if (!environments) return
    const branch = Git.branch()
    return Object.keys(environments).map(e => environments[e]).find(e => e.branch === branch)
  }

  get environments (): {[env: string]: AppEnvironment} {
    if (!this._app.environments) this._app.environments = {}
    return this._app.environments
  }
}
