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
  MAX_ACTIVITY_PAGE,
  allCampaignActivity,
  campaignActivity,
  type CampaignActivity,
  type CampaignActivityPage,
} from '../src/api/resources/campaigns.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

const page = (activity: CampaignActivity[], overrides: Partial<CampaignActivityPage> = {}): string =>
  JSON.stringify({ campaign_id: 42, type: 'opens', page: 1, limit: 100, total: activity.length, activity, ...overrides })

const opener = (n: number): CampaignActivity => ({ email: `s${n}@x.test`, name: '', list_id: 'L', opens: 2, country: 'NG' })

describe('campaignActivity', () => {
  it('posts the type and paging', async () => {
    const stub = await startStub([{ body: page([opener(1)]) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const r = await campaignActivity(client, 42, { type: 'clicks', page: 2, limit: 50 })

    assert.equal(r.activity[0]?.email, 's1@x.test')
    assert.equal(stub.received[0]?.path, '/api/campaigns/get-activity.php')
    assert.deepEqual(stub.received[0]?.fields, { campaign_id: '42', type: 'clicks', page: '2', limit: '50', api_key: KEY })
  })

  it('allCampaignActivity pages until the total is reached', async () => {
    const full = Array.from({ length: MAX_ACTIVITY_PAGE }, (_, i) => opener(i))
    const total = MAX_ACTIVITY_PAGE + 1
    const stub = await startStub([{ body: page(full, { total }) }, { body: page([opener(9999)], { page: 2, total }) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal((await allCampaignActivity(client, 42, 'opens')).length, total)
    assert.equal(stub.received.length, 2)
  })

  // A full last page must not cost an extra, empty request.
  it('stops on a full last page without another request', async () => {
    const full = Array.from({ length: MAX_ACTIVITY_PAGE }, (_, i) => opener(i))
    const stub = await startStub([{ body: page(full, { total: MAX_ACTIVITY_PAGE }) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await allCampaignActivity(client, 42, 'opens')
    assert.equal(stub.received.length, 1)
  })

  for (const [body, code] of [
    ['Invalid type', 'invalid_type'],
    ['Invalid page', 'invalid_page'],
    ['Invalid limit', 'invalid_limit'],
    ['Campaign does not exist', 'campaign_not_found'],
  ] as const) {
    it(`maps "${body}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(campaignActivity(client, 42), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        return true
      })
    })
  }
})

describe('skrybe campaigns activity (CLI)', () => {
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

  it('defaults to opens and prints tab-separated rows for --output text', async () => {
    const stub = await startStub([{ body: page([opener(1)]) }])

    const { stdout } = await run(stub.url, 'campaigns', 'activity', '42', '--output', 'text')

    assert.equal(stub.received[0]?.fields.type, 'opens')
    assert.equal(stdout, 's1@x.test\t\t2\tNG\n')
  })

  // `campaigns` itself declares --page and --limit (for listing campaigns), and
  // Commander gives them to the parent; they must still reach this request.
  it('passes --page and --limit through to the request', async () => {
    const stub = await startStub([{ body: page([opener(1)], { total: 40 }) }])

    await run(stub.url, 'campaigns', 'activity', '42', '--limit', '3', '--page', '2')

    assert.equal(stub.received[0]?.fields.limit, '3')
    assert.equal(stub.received[0]?.fields.page, '2')
  })

  it('shows the links clicked for --type clicks', async () => {
    const clicker = { email: 'c@x.test', name: 'C', list_id: 'L', clicks: 3, links: ['https://a.test', 'https://b.test'] }
    const stub = await startStub([{ body: page([clicker], { type: 'clicks' }) }])

    const { stdout } = await run(stub.url, 'campaigns', 'activity', '42', '--type', 'clicks', '--output', 'text')

    assert.equal(stdout, 'c@x.test\tC\t3\thttps://a.test https://b.test\n')
  })

  it('rejects an unknown --type, and --all with --page, before any request', async () => {
    const stub = await startStub([{ body: page([]) }])

    await assert.rejects(run(stub.url, 'campaigns', 'activity', '42', '--type', 'unopened'))
    await assert.rejects(run(stub.url, 'campaigns', 'activity', '42', '--all', '--page', '2'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })
})
