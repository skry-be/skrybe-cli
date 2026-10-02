import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { SkrybeClient } from '../src/api/client.js'
import { ApiError, Exit } from '../src/api/errors.js'
import {
  autoresponderEmailStats,
  getAutoresponder,
  listAutoresponders,
  type Autoresponder,
  type AutoresponderWithEmails,
} from '../src/api/resources/autoresponders.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

const ares = (overrides: Partial<Autoresponder> = {}): Autoresponder => ({
  id: 11,
  name: 'Onboarding',
  type: 'drip',
  list_id: 'L',
  custom_field: null,
  emails: 2,
  enabled_emails: 1,
  ...overrides,
})

const withEmails: AutoresponderWithEmails = {
  ...ares(),
  email_list: [
    { id: 15, autoresponder_id: 11, subject: 'Welcome', from_name: 'A', from_email: 'a@x.test', when: 'immediately', enabled: true, recipients: 355, created_at: 1 },
    { id: 21, autoresponder_id: 11, subject: 'Day 8', from_name: 'A', from_email: 'a@x.test', when: '+8 days', enabled: false, recipients: 0, created_at: 2 },
  ],
}

const stats = {
  id: 15,
  autoresponder_id: 11,
  recipients: 553,
  opens: { total: 422, unique: 196, rate: 35.64 },
  clicks: { total: 472, unique: 128, rate: 23.15 },
  bounces: { hard: 3, soft: 0 },
  complaints: 0,
  unsubscribes: 40,
  links: [{ url: 'https://x.test', clicks: 10, unique_clicks: 8 }],
}

describe('autoresponders', () => {
  it('listAutoresponders passes the list filter and unwraps the array', async () => {
    const stub = await startStub([{ body: JSON.stringify({ autoresponders: [ares()] }) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal((await listAutoresponders(client, { listId: 'L' }))[0]?.name, 'Onboarding')
    assert.equal(stub.received[0]?.path, '/api/autoresponders/get-autoresponders.php')
    assert.equal(stub.received[0]?.fields.list_id, 'L')
  })

  it('getAutoresponder and autoresponderEmailStats post their ids', async () => {
    const stub = await startStub([{ body: JSON.stringify(withEmails) }, { body: JSON.stringify(stats) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal((await getAutoresponder(client, 11)).email_list.length, 2)
    assert.equal((await autoresponderEmailStats(client, 15)).opens.unique, 196)
    assert.equal(stub.received[0]?.fields.autoresponder_id, '11')
    assert.equal(stub.received[1]?.fields.email_id, '15')
  })

  for (const [body, code] of [
    ['Autoresponder does not exist', 'autoresponder_not_found'],
    ['Autoresponder email does not exist', 'autoresponder_email_not_found'],
    ['Autoresponder ID not passed', 'autoresponder_id_missing'],
  ] as const) {
    it(`maps "${body}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(getAutoresponder(client, 1), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        return true
      })
    })
  }
})

describe('skrybe autoresponders (CLI)', () => {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
  const run = async (url: string, ...args: string[]) =>
    promisify(execFile)(process.execPath, ['--import', 'tsx', entry, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SKRYBE_API_URL: url,
        SKRYBE_API_KEY: KEY,
        SKRYBE_CONFIG: join(mkdtempSync(join(tmpdir(), 'skrybe-')), 'config.json'),
      },
    })

  it('`ls --list` reaches the request', async () => {
    const stub = await startStub([{ body: JSON.stringify({ autoresponders: [ares({ type: 'annually', custom_field: 'Birthday' })] }) }])

    const { stdout } = await run(stub.url, 'autoresponders', 'ls', '--list', 'L', '--output', 'text')

    assert.equal(stub.received[0]?.fields.list_id, 'L')
    assert.match(stdout, /annually \(Birthday\)/)
  })

  it('emails lists them in order, tab-separated for --output text', async () => {
    const stub = await startStub([{ body: JSON.stringify(withEmails) }])

    const { stdout } = await run(stub.url, 'ares', 'emails', '11', '--output', 'text')

    assert.deepEqual(stdout.trim().split('\n').map((l) => l.split('\t').slice(0, 3)), [
      ['15', 'immediately', 'yes'],
      ['21', '+8 days', 'no'],
    ])
  })

  it('stats --json prints the full record', async () => {
    const stub = await startStub([{ body: JSON.stringify(stats) }])

    const { stdout } = await run(stub.url, 'autoresponders', 'stats', '15', '--json')

    assert.deepEqual(JSON.parse(stdout), stats)
  })

  it('rejects a non-numeric id before any request', async () => {
    const stub = await startStub([{ body: '{}' }])

    await assert.rejects(run(stub.url, 'autoresponders', 'stats', 'abc'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })
})
