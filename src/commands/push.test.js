// @flow

// import Push from './push'
import nock from 'nock'

let api = nock('https://api.heroku.com:443')

beforeEach(() => nock.cleanAll())
afterEach(() => api.done())

test('pushes code', async () => {
  // let cmd = await Push.mock()
  // expect(cmd.out.stdout.output).toEqual('foo\n')
  // expect(cmd.out.stderr.output).toEqual('')
})
