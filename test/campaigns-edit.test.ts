import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { SkrybeClient } from '../src/api/client.js'
import { ApiError, Exit } from '../src/api/errors.js'
import {
  deleteCampaign,
  duplicateCampaign,
  updateCampaign,
  type CampaignDetail,
} from '../src/api/resources/campaigns.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

const detail = (overrides: Partial<CampaignDetail> = {}): CampaignDetail => ({
  id: 42,
  title: 'Q4 newsletter',
  subject: 'Your Q4 update',
  status: 'draft',
  from_name: 'Acme',
  from_email: 'hello@acme.test',
  reply_to: 'hello@acme.test',
  recipients: 0,
  to_send: 0,
  sent_at: null,
  scheduled_at: null,
  timezone: null,
  source: 'api',
  preheader: '',
  query_string: '',
  track_opens: 1,
  track_clicks: 1,
  list_ids: [],
  exclude_list_ids: [],
  segment_ids: [],
  exclude_segment_ids: [],
  web_version: 'https://x.test/w/abc',
  ...overrides,
})

describe('campaign editing', () => {
  it('updateCampaign sends only the fields given, by their API names', async () => {
    const stub = await startStub([{ body: JSON.stringify(detail({ subject: 'New' })) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const c = await updateCampaign(client, 42, { subject: 'New', fromName: 'Ada', trackClicks: 0 })

    assert.equal(c.subject, 'New')
    assert.equal(stub.received[0]?.path, '/api/campaigns/update-campaign.php')
    assert.deepEqual(stub.received[0]?.fields, {
      campaign_id: '42',
      subject: 'New',
      from_name: 'Ada',
      track_clicks: '0',
      api_key: KEY,
    })
  })

  it('duplicateCampaign is not retried, since a repeat would copy twice', async () => {
    const stub = await startStub([{ body: '', status: 503 }, { body: JSON.stringify(detail({ id: 43 })) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(duplicateCampaign(client, 42, 'Copy'))
    assert.equal(stub.received.length, 1)
    assert.equal(stub.received[0]?.fields.title, 'Copy')
  })

  it('deleteCampaign returns the deleted id', async () => {
    const stub = await startStub([{ body: '{"campaign_id":42,"deleted":true}' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.deepEqual(await deleteCampaign(client, 42), { campaign_id: 42, deleted: true })
    assert.equal(stub.received[0]?.path, '/api/campaigns/delete-campaign.php')
  })

  const cases: [string, string, number][] = [
    ['Campaign is sending', 'campaign_sending', Exit.API_ERROR],
    ['Campaign has already been sent', 'campaign_not_draft', Exit.API_ERROR],
    ['Nothing to update', 'nothing_to_update', Exit.USAGE],
    ['Subject cannot be empty', 'subject_empty', Exit.USAGE],
    ['HTML cannot be empty', 'html_empty', Exit.USAGE],
    ['Invalid from_email', 'invalid_from_email', Exit.USAGE],
    ['Invalid reply_to', 'invalid_reply_to', Exit.USAGE],
    ['track_opens and track_clicks must be 0, 1 or 2', 'invalid_tracking', Exit.USAGE],
    ['A field is too long: from_name (at most 100 characters)', 'field_too_long', Exit.USAGE],
    ['Unauthorised From email domain', 'unauthorised_from_domain', Exit.API_ERROR],
  ]
  for (const [body, code, exitCode] of cases) {
    it(`maps "${body.slice(0, 40)}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(updateCampaign(client, 42, { subject: 'x' }), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        assert.equal(err.exitCode, exitCode)
        return true
      })
    })
  }
})

describe('skrybe campaigns update / duplicate / delete (CLI)', () => {
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

  it('update reads --html-text from a file:// path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skrybe-'))
    writeFileSync(join(dir, 'email.html'), '<p>from a file</p>')
    const stub = await startStub([{ body: JSON.stringify(detail()) }])

    await run(stub.url, 'campaigns', 'update', '42', '--html-text', `file://${join(dir, 'email.html')}`, '--json')

    assert.equal(stub.received[0]?.fields.html_text, '<p>from a file</p>')
  })

  it('update with nothing to change fails before any request', async () => {
    const stub = await startStub([{ body: JSON.stringify(detail()) }])

    await assert.rejects(run(stub.url, 'campaigns', 'update', '42'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('duplicate prints only the new id on stdout', async () => {
    const stub = await startStub([{ body: JSON.stringify(detail({ id: 43 })) }])

    const { stdout } = await run(stub.url, 'campaigns', 'duplicate', '42')

    assert.equal(stdout, '43\n')
  })

  it('delete refuses from a script without --yes, before any request', async () => {
    const stub = await startStub([{ body: '{"campaign_id":42,"deleted":true}' }])

    await assert.rejects(run(stub.url, 'campaigns', 'delete', '42'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('rm --yes deletes with one request', async () => {
    const stub = await startStub([{ body: '{"campaign_id":42,"deleted":true}' }])

    const { stdout } = await run(stub.url, 'campaigns', 'rm', '42', '--yes', '--json')

    assert.equal(stub.received.length, 1)
    assert.deepEqual(JSON.parse(stdout), { outcome: 'deleted', campaign_id: 42 })
  })
})
