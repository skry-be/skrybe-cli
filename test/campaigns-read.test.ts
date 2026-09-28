import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { SkrybeClient } from '../src/api/client.js'
import { ApiError, AuthError, Exit } from '../src/api/errors.js'
import { parseJsonObject, parseNumberedRecords } from '../src/api/parse.js'
import {
  MAX_PAGE_SIZE,
  campaignStats,
  getCampaign,
  listAllCampaigns,
  listCampaigns,
  type Campaign,
} from '../src/api/resources/campaigns.js'
import { flattenRecord } from '../src/output.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

function campaign(id: number, overrides: Partial<Campaign> = {}): Campaign {
  return {
    id,
    title: `Campaign ${id}`,
    subject: `Subject ${id}`,
    status: 'sent',
    from_name: 'Ada',
    from_email: 'ada@example.com',
    reply_to: 'ada@example.com',
    recipients: 10,
    to_send: 10,
    sent_at: 1788178681,
    scheduled_at: null,
    timezone: null,
    source: 'ui',
    ...overrides,
  }
}

/** The payload get-campaigns.php emits: json_encode of campaign1..campaignN. */
function page(rows: Campaign[]): string {
  return JSON.stringify(Object.fromEntries(rows.map((row, i) => [`campaign${i + 1}`, row])))
}

describe('listCampaigns', () => {
  it('passes paging and status, and returns rows in key order', async () => {
    const stub = await startStub([{ body: page([campaign(9), campaign(8, { title: 'Q4 "Big" Push' })]) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const rows = await listCampaigns(client, { page: 2, limit: 5, status: 'sent' })

    assert.deepEqual(rows.map((r) => r.id), [9, 8])
    assert.equal(rows[1]?.title, 'Q4 "Big" Push')
    assert.equal(stub.received[0]?.path, '/api/campaigns/get-campaigns.php')
    assert.deepEqual(
      { page: stub.received[0]?.fields.page, limit: stub.received[0]?.fields.limit, status: stub.received[0]?.fields.status },
      { page: '2', limit: '5', status: 'sent' },
    )
  })

  it('leaves unset options off the request', async () => {
    const stub = await startStub([{ body: page([]) }])
    await listCampaigns(new SkrybeClient({ url: stub.url, apiKey: KEY }))

    assert.deepEqual(Object.keys(stub.received[0]?.fields ?? {}), ['api_key'])
  })

  it('treats "No campaigns found" as an empty page, not an error', async () => {
    const stub = await startStub([{ body: 'No campaigns found' }])
    assert.deepEqual(await listCampaigns(new SkrybeClient({ url: stub.url, apiKey: KEY })), [])
  })

  it('maps an invalid key to an auth error', async () => {
    const stub = await startStub([{ body: 'Invalid API key' }])
    await assert.rejects(listCampaigns(new SkrybeClient({ url: stub.url, apiKey: KEY })), AuthError)
  })

  it('is retried, since it only reads', async () => {
    const stub = await startStub([{ status: 503, body: 'down' }, { body: page([campaign(1)]) }])
    const rows = await listCampaigns(new SkrybeClient({ url: stub.url, apiKey: KEY }))

    assert.equal(rows.length, 1)
    assert.equal(stub.received.length, 2)
  })
})

describe('listAllCampaigns', () => {
  it('walks pages at the largest size until a short page', async () => {
    const full = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => campaign(1000 - i))
    const stub = await startStub([{ body: page(full) }, { body: page([campaign(1)]) }])

    const rows = await listAllCampaigns(new SkrybeClient({ url: stub.url, apiKey: KEY }), { status: 'sent' })

    assert.equal(rows.length, MAX_PAGE_SIZE + 1)
    assert.deepEqual(stub.received.map((r) => [r.fields.page, r.fields.limit, r.fields.status]), [
      ['1', String(MAX_PAGE_SIZE), 'sent'],
      ['2', String(MAX_PAGE_SIZE), 'sent'],
    ])
  })

  it('stops on an empty page when the last full page ends exactly', async () => {
    const full = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => campaign(i + 1))
    const stub = await startStub([{ body: page(full) }, { body: 'No campaigns found' }])

    assert.equal((await listAllCampaigns(new SkrybeClient({ url: stub.url, apiKey: KEY }))).length, MAX_PAGE_SIZE)
    assert.equal(stub.received.length, 2)
  })
})

describe('getCampaign', () => {
  it('asks for the bodies only when told to', async () => {
    const stub = await startStub([{ body: JSON.stringify({ ...campaign(42), list_ids: ['abc'] }) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const c = await getCampaign(client, 42)
    assert.deepEqual(c.list_ids, ['abc'])
    assert.equal(stub.received[0]?.fields.campaign_id, '42')
    assert.equal(stub.received[0]?.fields.include_content, undefined)

    await getCampaign(client, 42, { includeContent: true })
    assert.equal(stub.received[1]?.fields.include_content, 'yes')
  })

  it('reports another brand’s campaign as not found', async () => {
    const stub = await startStub([{ body: 'Campaign does not exist' }])

    await assert.rejects(getCampaign(new SkrybeClient({ url: stub.url, apiKey: KEY }), 1), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'campaign_not_found')
      assert.equal(err.exitCode, Exit.API_ERROR)
      return true
    })
  })

  it('explains a main account key, which has no brand', async () => {
    const stub = await startStub([{ body: 'Brand does not exist' }])

    await assert.rejects(getCampaign(new SkrybeClient({ url: stub.url, apiKey: KEY }), 1), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'brand_not_found')
      assert.match(err.hint ?? '', /main account key/)
      return true
    })
  })
})

describe('campaignStats', () => {
  it('returns the stats object as sent', async () => {
    const stats = {
      id: 42,
      status: 'sent',
      recipients: 100,
      opens: { total: 50, unique: 40, rate: 41.67 },
      clicks: { total: 5, unique: 4, rate: 4 },
      bounces: { hard: 4, soft: 1 },
      complaints: 0,
      unsubscribes: 2,
      links: [{ url: 'https://example.com', clicks: 5, unique_clicks: 4 }],
    }
    const stub = await startStub([{ body: JSON.stringify(stats) }])

    assert.deepEqual(await campaignStats(new SkrybeClient({ url: stub.url, apiKey: KEY }), 42), stats)
    assert.equal(stub.received[0]?.path, '/api/campaigns/stats.php')
  })

  it('refuses a body that is not JSON rather than returning junk', async () => {
    const stub = await startStub([{ body: '<b>Warning</b>: something in /var/www' }])

    await assert.rejects(campaignStats(new SkrybeClient({ url: stub.url, apiKey: KEY }), 42), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'malformed_response')
      return true
    })
  })
})

describe('parseNumberedRecords', () => {
  it('orders by the numeric suffix and ignores other keys', () => {
    const body = JSON.stringify({ campaign10: { id: 10 }, campaign2: { id: 2 }, total: 3, campaign1: { id: 1 } })
    assert.deepEqual(parseNumberedRecords<{ id: number }>(body, 'campaign'), [{ id: 1 }, { id: 2 }, { id: 10 }])
  })

  it('rejects an array or non-JSON body', () => {
    assert.throws(() => parseNumberedRecords('[1,2]', 'campaign'), ApiError)
    assert.throws(() => parseJsonObject('nope', 'campaign'), ApiError)
  })
})

describe('flattenRecord', () => {
  it('dots nested keys, joins scalar arrays and indexes object arrays', () => {
    assert.deepEqual(
      flattenRecord({ id: 1, opens: { unique: 2 }, list_ids: ['a', 'b'], links: [{ url: 'u' }], tz: null }),
      [
        ['id', '1'],
        ['opens.unique', '2'],
        ['list_ids', 'a,b'],
        ['links.0.url', 'u'],
        ['tz', ''],
      ],
    )
  })
})

describe('skrybe campaigns (CLI)', () => {
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

  // The parent `campaigns` declares the same options, and Commander hands them
  // to the parent; `ls` has to read them back or the filter is silently lost.
  it('passes `ls` options through to the request', async () => {
    const stub = await startStub([{ body: page([campaign(7, { status: 'paused' })]) }])

    const { stdout } = await run(stub.url, 'campaigns', 'ls', '--status', 'paused', '--limit', '3', '--json')

    assert.equal(stub.received[0]?.fields.status, 'paused')
    assert.equal(stub.received[0]?.fields.limit, '3')
    assert.equal((JSON.parse(stdout) as Campaign[])[0]?.id, 7)
  })

  it('rejects a non-numeric campaign id before any request', async () => {
    const stub = await startStub([{ body: '{}' }])

    await assert.rejects(run(stub.url, 'campaigns', 'get', 'abc'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })
})
