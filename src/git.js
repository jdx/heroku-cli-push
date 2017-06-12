// @flow

import execa from 'execa'
import fs from 'fs-extra'
import {spawnSync} from 'child_process'
const debug = require('debug')('heroku:builds:git')

export class Git {
  static debug = require('debug')('heroku-cli:builds:push:git')

  static get hasGit (): boolean {
    return fs.existsSync('.git')
  }

  static async exec (...args: string[]): Promise<string> {
    if (!this.hasGit) throw new Error('not a git repository')
    debug(args.join(' '))
    return execa.stdout('git', args)
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

  static async branch (): Promise<string> {
    return this.exec('symbolic-ref', '--short', 'HEAD')
  }

  static async sha (): Promise<?string> {
    if (await this.dirty) return
    return this.exec('rev-parse', 'HEAD')
  }

  static checkIgnore (f: string): boolean {
    let cmd = this.execSync('check-ignore', f)
    if (cmd.status === 0) return true
    else if (cmd.status === 1) return false
    else throw new Error(cmd.output[2])
  }
}
