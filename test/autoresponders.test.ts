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
  createAutoresponder,
  createAutoresponderEmail,
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

  it('createAutoresponder posts the list, type and date field', async () => {
    const created = ares({ id: 34, type: 'annually', custom_field: 'Birthday', emails: 0, enabled_emails: 0 })
    const stub = await startStub([{ body: JSON.stringify(created) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const a = await createAutoresponder(client, { name: 'Birthday wishes', listId: 'L', type: 'annually', customField: 'Birthday' })

    assert.equal(a.id, 34)
    assert.equal(stub.received[0]?.path, '/api/autoresponders/create-autoresponder.php')
    assert.deepEqual(
      [stub.received[0]?.fields.name, stub.received[0]?.fields.list_id, stub.received[0]?.fields.type, stub.received[0]?.fields.custom_field],
      ['Birthday wishes', 'L', 'annually', 'Birthday'],
    )
  })

  it('createAutoresponderEmail sends enabled only when asked, and keeps "+" intact', async () => {
    const email = { ...withEmails.email_list[1]!, id: 89, autoresponder_id: 34, when: '+9 hours' }
    const stub = await startStub([{ body: JSON.stringify(email) }, { body: JSON.stringify(email) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await createAutoresponderEmail(client, 34, { subject: 'Happy birthday', htmlText: '<p>Hi</p>', when: '+9 hours' })
    await createAutoresponderEmail(client, 34, { subject: 'Happy birthday', htmlText: '<p>Hi</p>', enabled: true })

    assert.equal(stub.received[0]?.path, '/api/autoresponders/create-autoresponder-email.php')
    assert.equal(stub.received[0]?.fields.autoresponder_id, '34')
    assert.equal(stub.received[0]?.fields.when, '+9 hours')
    assert.equal(stub.received[0]?.fields.enabled, undefined)
    assert.equal(stub.received[1]?.fields.enabled, '1')
  })

  for (const [body, code] of [
    ['Autoresponder does not exist', 'autoresponder_not_found'],
    ['Autoresponder email does not exist', 'autoresponder_email_not_found'],
    ['Autoresponder ID not passed', 'autoresponder_id_missing'],
    ['Field already has an autoresponder', 'autoresponder_exists'],
    ['Field is not a date field', 'field_not_date'],
    ['when must be on, or an offset such as +9 hours or -1 days', 'invalid_when'],
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

  it('create prints the new id, reading --list past the parent option', async () => {
    const stub = await startStub([{ body: JSON.stringify(ares({ id: 34, type: 'annually', custom_field: 'Birthday' })) }])

    const { stdout } = await run(stub.url, 'autoresponders', 'create', 'Birthday wishes', '--list', 'L', '--type', 'annually', '--field', 'Birthday')

    assert.equal(stdout.trim(), '34')
    assert.equal(stub.received[0]?.fields.list_id, 'L')
    assert.equal(stub.received[0]?.fields.custom_field, 'Birthday')
  })

  it('create refuses a dated type without --field, before any request', async () => {
    const stub = await startStub([{ body: '{}' }])

    await assert.rejects(run(stub.url, 'autoresponders', 'create', 'B', '--list', 'L', '--type', 'annually'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('add-email --json prints the email', async () => {
    const email = { ...withEmails.email_list[0]!, id: 89, autoresponder_id: 34, when: '+9 hours', enabled: false }
    const stub = await startStub([{ body: JSON.stringify(email) }])

    const { stdout } = await run(stub.url, 'ares', 'add-email', '34', '--subject', 'Happy birthday', '--html-text', '<p>Hi</p>', '--when', '+9 hours', '--json')

    assert.deepEqual(JSON.parse(stdout), email)
    assert.equal(stub.received[0]?.fields.subject, 'Happy birthday')
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
