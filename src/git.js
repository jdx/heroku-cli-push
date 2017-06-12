// @flow

import execa from 'execa'
import fs from 'fs-extra'
import {spawnSync} from 'child_process'
const debug = require('debug')('heroku:builds:git')

export default class Git {
  static debug = require('debug')('heroku-cli:builds:push:git')

  static get hasGit (): boolean {
    return fs.existsSync('.git')
  }

  static async exec (...args: string[]): Promise<string> {
    if (!this.hasGit) throw new Error('not a git repository')
    debug(args.join(' '))
    try {
      return await execa.stdout('git', args)
    } catch (err) {
      if (err.message.includes('fatal: no upstream configured for branch')) {
        let [, branch] = err.message.match(/fatal: no upstream configured for branch '(.*)'/)
        throw new Error(`${err.message}\nIf you wish to set tracking information for this branch to origin/${branch} you can do so with:

    git branch --set-upstream-to=origin/${branch} ${branch}
`)
      } else throw err
    }
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

  static branch (): string {
    let cmd = this.execSync('symbolic-ref', '--short', 'HEAD')
    return (cmd.stdout: any).trim()
  }

  static async sha (): Promise<?string> {
    if (await this.dirty()) return
    return this.exec('rev-parse', 'HEAD')
  }

  static async description (): Promise<string> {
    if (await this.dirty()) return 'dirty'
    let log = await this.exec('log', '-1', '--pretty=  * %an: %B')
    return log.trimRight()
  }

  static checkIgnore (f: string): boolean {
    let cmd = this.execSync('check-ignore', f)
    if (cmd.status === 0) return true
    else if (cmd.status === 1) return false
    else throw new Error(cmd.output[2])
  }
}
