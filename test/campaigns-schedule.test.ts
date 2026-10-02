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
import { scheduleCampaign, unscheduleCampaign } from '../src/api/resources/campaigns.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

// 2035-06-15 18:05 in Africa/Lagos (UTC+1)
const AT = 2065539900
const scheduled = (status: 'scheduled' | 'dry_run' = 'scheduled') =>
  JSON.stringify({ status, campaign_id: 42, recipients: 1204, scheduled_at: AT, timezone: 'Africa/Lagos' })

describe('scheduleCampaign', () => {
  it('posts the time, timezone and recipients', async () => {
    const stub = await startStub([{ body: scheduled() }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const r = await scheduleCampaign(client, 42, { at: '2035-06-15 18:05', timezone: 'Africa/Lagos', listIds: ['a', 'b'] })

    assert.equal(r.scheduled_at, AT)
    assert.equal(stub.received[0]?.path, '/api/campaigns/schedule.php')
    assert.deepEqual(stub.received[0]?.fields, {
      campaign_id: '42',
      list_ids: 'a,b',
      schedule_date_time: '2035-06-15 18:05',
      schedule_timezone: 'Africa/Lagos',
      api_key: KEY,
    })
  })

  const cases: [string, string, number][] = [
    ['schedule_date_time not passed', 'schedule_missing', Exit.USAGE],
    ['schedule_date_time is invalid', 'invalid_schedule', Exit.USAGE],
    ['schedule_date_time is in the past', 'schedule_in_past', Exit.USAGE],
    ['schedule_timezone is invalid', 'invalid_timezone', Exit.USAGE],
    ['Campaign has already been sent', 'campaign_not_draft', Exit.API_ERROR],
    ['Campaign was changed by another request. Try again.', 'conflict', Exit.API_ERROR],
    ['Unable to schedule campaign', 'operation_failed', Exit.API_ERROR],
  ]
  for (const [body, code, exitCode] of cases) {
    it(`maps "${body}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(scheduleCampaign(client, 42, { at: 'x', listIds: ['a'] }), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        assert.equal(err.exitCode, exitCode)
        return true
      })
    })
  }
})

describe('unscheduleCampaign', () => {
  it('returns the campaign as a draft', async () => {
    const stub = await startStub([{ body: '{"status":"draft","campaign_id":42}' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.deepEqual(await unscheduleCampaign(client, 42), { status: 'draft', campaign_id: 42 })
    assert.equal(stub.received[0]?.path, '/api/campaigns/unschedule.php')
  })

  it('maps "Campaign is not scheduled"', async () => {
    const stub = await startStub([{ body: 'Campaign is not scheduled' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(unscheduleCampaign(client, 42), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'campaign_not_scheduled')
      return true
    })
  })
})

describe('skrybe campaigns schedule / unschedule (CLI)', () => {
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

  it('refuses to schedule from a script without --yes, before any request', async () => {
    const stub = await startStub([{ body: scheduled() }])

    await assert.rejects(
      run(stub.url, 'campaigns', 'schedule', '42', '--list', 'a', '--at', '2035-06-15 18:05'),
      (err: { code?: number; stderr?: string }) => {
        assert.equal(err.code, Exit.USAGE)
        assert.match(err.stderr ?? '', /Refusing to schedule/)
        return true
      },
    )
    assert.equal(stub.received.length, 0)
  })

  it('requires --at', async () => {
    const stub = await startStub([{ body: scheduled() }])

    await assert.rejects(run(stub.url, 'campaigns', 'schedule', '42', '--list', 'a', '--yes'))
    assert.equal(stub.received.length, 0)
  })

  it('schedules with --yes and shows the time in the campaign timezone', async () => {
    const stub = await startStub([{ body: scheduled() }])

    const { stderr } = await run(stub.url, 'campaigns', 'schedule', '42', '--list', 'a', '--at', '2035-06-15 18:05', '--yes')

    assert.equal(stub.received.length, 1)
    assert.equal(stub.received[0]?.fields.dry_run, undefined)
    assert.match(stderr, /scheduled for 2035-06-15 18:05 Africa\/Lagos to 1,204 recipients/)
  })

  it('--dry-run needs no confirmation and changes nothing', async () => {
    const stub = await startStub([{ body: scheduled('dry_run') }])

    const { stdout } = await run(stub.url, 'campaigns', 'schedule', '42', '--list', 'a', '--at', 'x', '--dry-run', '--json')

    assert.equal(stub.received[0]?.fields.dry_run, '1')
    assert.deepEqual(JSON.parse(stdout), {
      outcome: 'dry_run',
      campaign_id: 42,
      recipients: 1204,
      scheduled_at: AT,
      timezone: 'Africa/Lagos',
    })
  })

  it('unschedules', async () => {
    const stub = await startStub([{ body: '{"status":"draft","campaign_id":42}' }])

    const { stderr } = await run(stub.url, 'campaigns', 'unschedule', '42')

    assert.match(stderr, /Campaign 42 is a draft again\./)
  })
})
