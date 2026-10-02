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
import { testSendCampaign, type TestSendResult } from '../src/api/resources/campaigns.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

const reply = (...results: TestSendResult['results']): string =>
  JSON.stringify({ campaign_id: 42, results })
const ok = (email: string) => ({ email, ok: true, error: null })

describe('testSendCampaign', () => {
  it('posts the addresses comma-joined and returns the per-address results', async () => {
    const stub = await startStub([{ body: reply(ok('a@x.test'), ok('b@x.test')) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const result = await testSendCampaign(client, 42, ['a@x.test', 'b@x.test'])

    assert.equal(result.results.length, 2)
    assert.equal(stub.received[0]?.path, '/api/campaigns/test-send.php')
    assert.deepEqual(stub.received[0]?.fields, { campaign_id: '42', emails: 'a@x.test,b@x.test', api_key: KEY })
  })

  it('does not retry, since every request uses up the rate limit', async () => {
    const stub = await startStub([{ body: '', status: 503 }, { body: reply(ok('a@x.test')) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(testSendCampaign(client, 42, ['a@x.test']))
    assert.equal(stub.received.length, 1)
  })

  const cases: [string, string, number][] = [
    ['Email addresses not passed', 'emails_missing', Exit.USAGE],
    ['Too many email addresses', 'too_many_emails', Exit.USAGE],
    ['Invalid email address.', 'invalid_email', Exit.USAGE],
    ['Quota exceeded. Please upgrade your plan.', 'quota_exceeded', Exit.QUOTA_OR_RATE_LIMIT],
    [
      'Test send rate limit reached. Please wait about 12 minute(s) and try again.',
      'rate_limited',
      Exit.QUOTA_OR_RATE_LIMIT,
    ],
    ['Brand is under review due to high bounce rate. Sending is disabled.', 'account_under_review', Exit.API_ERROR],
    ['Domain not verified in SES. Please verify your domain before sending.', 'domain_not_verified', Exit.API_ERROR],
    ['Campaign does not exist', 'campaign_not_found', Exit.API_ERROR],
    ['Unauthorised From email domain', 'unauthorised_from_domain', Exit.API_ERROR],
  ]
  for (const [body, code, exitCode] of cases) {
    it(`maps "${body.slice(0, 40)}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(testSendCampaign(client, 42, ['a@x.test']), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        assert.equal(err.exitCode, exitCode)
        return true
      })
    })
  }
})

describe('skrybe campaigns test (CLI)', () => {
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

  it('accepts repeated and comma-separated --to, deduplicated', async () => {
    const stub = await startStub([{ body: reply(ok('a@x.test'), ok('b@x.test')) }])

    const { stderr } = await run(stub.url, 'campaigns', 'test', '42', '--to', 'a@x.test,b@x.test', '--to', 'a@x.test')

    assert.equal(stub.received[0]?.fields.emails, 'a@x.test,b@x.test')
    assert.match(stderr, /sent to a@x\.test/)
  })

  it('refuses more than 5 addresses before any request', async () => {
    const stub = await startStub([{ body: reply() }])

    await assert.rejects(
      run(stub.url, 'campaigns', 'test', '42', '--to', 'a@x.io,b@x.io,c@x.io,d@x.io,e@x.io,f@x.io'),
      (err: { code?: number }) => {
        assert.equal(err.code, Exit.USAGE)
        return true
      },
    )
    assert.equal(stub.received.length, 0)
  })

  it('exits 1 when any address failed, and --json still prints every result', async () => {
    const stub = await startStub([
      { body: reply(ok('a@x.test'), { email: 'b@x.test', ok: false, error: 'Address blacklisted.' }) },
    ])

    await assert.rejects(
      run(stub.url, 'campaigns', 'test', '42', '--to', 'a@x.test,b@x.test', '--json'),
      (err: { code?: number; stdout?: string }) => {
        assert.equal(err.code, Exit.API_ERROR)
        const out = JSON.parse(err.stdout ?? '') as TestSendResult
        assert.equal(out.results[1]?.error, 'Address blacklisted.')
        return true
      },
    )
  })
})
