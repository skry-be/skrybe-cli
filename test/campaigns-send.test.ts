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
import { sendCampaign } from '../src/api/resources/campaigns.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

const sending = (recipients = 2) => JSON.stringify({ status: 'sending', campaign_id: 42, recipients })
const dryRun = (recipients = 2) => JSON.stringify({ status: 'dry_run', campaign_id: 42, recipients })

describe('sendCampaign', () => {
  it('posts the recipients comma-joined and returns the result', async () => {
    const stub = await startStub([{ body: sending(1204) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const result = await sendCampaign(client, 42, { listIds: ['a', 'b'], excludeListIds: ['c'] })

    assert.deepEqual(result, { status: 'sending', campaign_id: 42, recipients: 1204 })
    assert.equal(stub.received[0]?.path, '/api/campaigns/send.php')
    assert.deepEqual(stub.received[0]?.fields, {
      campaign_id: '42',
      list_ids: 'a,b',
      exclude_list_ids: 'c',
      api_key: KEY,
    })
  })

  it('sends dry_run only when asked', async () => {
    const stub = await startStub([{ body: dryRun() }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await sendCampaign(client, 42, { segmentIds: ['7'], dryRun: true })

    assert.equal(stub.received[0]?.fields.dry_run, '1')
    assert.equal(stub.received[0]?.fields.segment_ids, '7')
  })

  it('does not retry, since a retried send is refused rather than repeated', async () => {
    const stub = await startStub([{ body: '', status: 503 }, { body: sending() }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(sendCampaign(client, 42, { listIds: ['a'] }))
    assert.equal(stub.received.length, 1)
  })

  const cases: [string, string, number][] = [
    ['Campaign has already been sent', 'campaign_not_draft', Exit.API_ERROR],
    ['Campaign is scheduled', 'campaign_scheduled', Exit.API_ERROR],
    ['No active subscribers to send to', 'no_recipients', Exit.API_ERROR],
    ['One or more list IDs are invalid', 'list_not_found', Exit.API_ERROR],
    ['One or more segment IDs are invalid', 'segment_not_found', Exit.API_ERROR],
    ['List or segment ID(s) not passed', 'recipients_missing', Exit.USAGE],
    [
      'Error: This campaign would exceed your sending quota. Reduce the recipients or increase your quota, then try again.',
      'quota_exceeded',
      Exit.QUOTA_OR_RATE_LIMIT,
    ],
    ['Account under review: bounce rate 6%. Sending is disabled.', 'account_under_review', Exit.API_ERROR],
    [
      'Domain "acme.test" is not verified in SES. Full domain verification is required to send emails.',
      'domain_not_verified',
      Exit.API_ERROR,
    ],
    ['Unable to send campaign', 'operation_failed', Exit.API_ERROR],
  ]
  for (const [body, code, exitCode] of cases) {
    it(`maps "${body.slice(0, 40)}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(sendCampaign(client, 42, { listIds: ['a'] }), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        assert.equal(err.exitCode, exitCode)
        return true
      })
    })
  }
})

describe('skrybe campaigns send (CLI)', () => {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
  // execFile gives the child a pipe for stdin, so it runs as a script would.
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

  it('refuses to send from a script without --yes, before any request', async () => {
    const stub = await startStub([{ body: sending() }])

    await assert.rejects(run(stub.url, 'campaigns', 'send', '42', '--list', 'a'), (err: { code?: number; stderr?: string }) => {
      assert.equal(err.code, Exit.USAGE)
      assert.match(err.stderr ?? '', /--yes/)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('needs a list or segment', async () => {
    const stub = await startStub([{ body: sending() }])

    await assert.rejects(run(stub.url, 'campaigns', 'send', '42', '--yes'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('sends once with --yes', async () => {
    const stub = await startStub([{ body: sending(3) }])

    const { stdout } = await run(stub.url, 'campaigns', 'send', '42', '--list', 'a', '--list', 'b', '--yes', '--json')

    assert.equal(stub.received.length, 1)
    assert.equal(stub.received[0]?.fields.list_ids, 'a,b')
    assert.equal(stub.received[0]?.fields.dry_run, undefined)
    assert.deepEqual(JSON.parse(stdout), { outcome: 'sending', campaign_id: 42, recipients: 3 })
  })

  it('--dry-run needs no confirmation and sends nothing', async () => {
    const stub = await startStub([{ body: dryRun(5) }])

    const { stdout, stderr } = await run(stub.url, 'campaigns', 'send', '42', '--list', 'a', '--dry-run')

    assert.equal(stub.received.length, 1)
    assert.equal(stub.received[0]?.fields.dry_run, '1')
    assert.equal(stdout, '')
    assert.match(stderr, /would go to 5 recipients\. Nothing was sent\./)
  })
})
