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
  MAX_SUBSCRIBERS_PAGE,
  listAllSubscribers,
  listSubscribers,
  type Subscriber,
  type SubscribersPage,
} from '../src/api/resources/subscribers.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

const sub = (n: number, overrides: Partial<Subscriber> = {}): Subscriber => ({
  email: `s${n}@example.com`,
  name: `S ${n}`,
  status: 'active',
  joined_at: 1700000000 + n,
  custom_fields: { City: 'Lagos', Birthday: null },
  ...overrides,
})

const page = (subscribers: Subscriber[], overrides: Partial<SubscribersPage> = {}): string =>
  JSON.stringify({ list_id: 'L', status: null, page: 1, limit: 100, total: subscribers.length, subscribers, ...overrides })

describe('listSubscribers', () => {
  it('passes the list, status and paging', async () => {
    const stub = await startStub([{ body: page([sub(1)]) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const r = await listSubscribers(client, 'L', { status: 'bounced', page: 3, limit: 50 })

    assert.equal(r.subscribers[0]?.email, 's1@example.com')
    assert.equal(stub.received[0]?.path, '/api/subscribers/get-subscribers.php')
    assert.deepEqual(stub.received[0]?.fields, { list_id: 'L', status: 'bounced', page: '3', limit: '50', api_key: KEY })
  })

  it('listAllSubscribers pages at the maximum size until a short page', async () => {
    const full = Array.from({ length: MAX_SUBSCRIBERS_PAGE }, (_, i) => sub(i))
    const stub = await startStub([{ body: page(full) }, { body: page([sub(5000)]) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const all = await listAllSubscribers(client, 'L', { status: 'active' })

    assert.equal(all.length, MAX_SUBSCRIBERS_PAGE + 1)
    assert.deepEqual(stub.received.map((r) => [r.fields.page, r.fields.limit, r.fields.status]), [
      ['1', String(MAX_SUBSCRIBERS_PAGE), 'active'],
      ['2', String(MAX_SUBSCRIBERS_PAGE), 'active'],
    ])
  })

  for (const [body, code] of [
    ['Invalid page', 'invalid_page'],
    ['Invalid limit', 'invalid_limit'],
    ['Invalid status', 'invalid_status'],
    ['List does not exist', 'list_not_found'],
  ] as const) {
    it(`maps "${body}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(listSubscribers(client, 'L'), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        return true
      })
    })
  }
})

describe('skrybe subscribers ls (CLI)', () => {
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

  it('prints tab-separated rows for --output text, and says where the page sits on stderr', async () => {
    const stub = await startStub([{ body: page([sub(1), sub(2, { status: 'bounced' })], { total: 40 }) }])

    const { stdout } = await run(stub.url, 'subscribers', 'ls', '--list', 'L', '--output', 'text')

    const rows = stdout.trim().split('\n').map((line) => line.split('\t'))
    assert.deepEqual(rows.map((r) => [r[0], r[2]]), [
      ['s1@example.com', 'active'],
      ['s2@example.com', 'bounced'],
    ])
  })

  it('--json prints the subscribers with their custom fields', async () => {
    const stub = await startStub([{ body: page([sub(1)]) }])

    const { stdout } = await run(stub.url, 'subs', 'ls', '--list', 'L', '--json')

    assert.deepEqual((JSON.parse(stdout) as Subscriber[])[0]?.custom_fields, { City: 'Lagos', Birthday: null })
  })

  it('refuses --all with --page before any request', async () => {
    const stub = await startStub([{ body: page([]) }])

    await assert.rejects(run(stub.url, 'subscribers', 'ls', '--list', 'L', '--all', '--page', '2'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  // A --list declared on `subscribers` itself would be claimed by it wherever
  // it appears, and `status` would then fail for want of its own --list.
  it('leaves --list to the sub-verb it follows', async () => {
    const stub = await startStub([{ body: 'Subscribed' }])

    const { stdout } = await run(stub.url, 'subscribers', 'status', 'a@example.com', '--list', 'L')

    assert.equal(stub.received[0]?.fields.list_id, 'L')
    assert.match(stdout, /Subscribed/)
  })
})
