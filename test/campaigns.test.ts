import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SkrybeClient } from '../src/api/client.js'
import { ApiError, Exit, UsageError } from '../src/api/errors.js'
import { createCampaign } from '../src/api/resources/campaigns.js'
import { MAX_RECIPIENTS, sendEmail, sendTransactional } from '../src/api/resources/emails.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'
const base = {
  fromName: 'Ada',
  fromEmail: 'ada@example.com',
  replyTo: 'ada@example.com',
  subject: 'Q4',
  htmlText: '<p>hi</p>',
}

describe('createCampaign', () => {
  it('asks for json so it can return the campaign id', async () => {
    const stub = await startStub([
      { body: '{"status":"Campaign created", "campaign_id": "9596"}' },
    ])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const result = await createCampaign(client, { ...base, title: 'Q4', listIds: ['abc'] })

    assert.deepEqual(result, { outcome: 'created', campaignId: '9596' })
    assert.equal(stub.received[0]?.fields.json, '1')
    assert.equal(stub.received[0]?.fields.list_ids, 'abc')
  })

  it('joins repeated lists into one comma-separated field', async () => {
    const stub = await startStub([{ body: 'Campaign created' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await createCampaign(client, { ...base, title: 'Q4', listIds: ['a', 'b'], excludeListIds: ['c'] })

    assert.equal(stub.received[0]?.fields.list_ids, 'a,b')
    assert.equal(stub.received[0]?.fields.exclude_list_ids, 'c')
  })

  it('only sends send_campaign when asked to send', async () => {
    const stub = await startStub([{ body: 'Campaign created and now sending' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal(
      (await createCampaign(client, { ...base, title: 'Q4', send: true })).outcome,
      'sending',
    )
    assert.equal(stub.received[0]?.fields.send_campaign, '1')

    const draft = await startStub([{ body: 'Campaign created' }])
    const c2 = new SkrybeClient({ url: draft.url, apiKey: KEY })
    await createCampaign(c2, { ...base, title: 'Q4' })
    assert.equal(draft.received[0]?.fields.send_campaign, undefined)
  })

  it('recognises the scheduled outcome, which carries no id', async () => {
    const stub = await startStub([{ body: 'Campaign scheduled' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.deepEqual(
      await createCampaign(client, { ...base, title: 'Q4', scheduleDateTime: 'June 15, 2027 6:05pm' }),
      { outcome: 'scheduled' },
    )
  })

  it('surfaces an Unable to ... failure rather than reporting success', async () => {
    const stub = await startStub([{ body: 'Unable to create campaign' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(createCampaign(client, { ...base, title: 'Q4' }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'operation_failed')
      return true
    })
  })

  it('is not retried', async () => {
    const stub = await startStub([{ status: 503, body: 'down' }, { body: 'Campaign created' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(createCampaign(client, { ...base, title: 'Q4' }))
    assert.equal(stub.received.length, 1)
  })
})

describe('sendEmail', () => {
  it('encodes recipients and variables as JSON inside a form body', async () => {
    const stub = await startStub([
      { body: JSON.stringify({ ok: true, message: 'Campaign created and now sending', data: { campaign_id: '42' } }) },
    ])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const result = await sendEmail(client, {
      ...base,
      to: ['a@example.com'],
      recipientVariables: { 'a@example.com': { first: 'Ada' } },
    })

    assert.equal(result.campaignId, '42')
    assert.equal(stub.received[0]?.contentType, 'application/x-www-form-urlencoded')
    assert.deepEqual(JSON.parse(stub.received[0]?.fields.to ?? ''), ['a@example.com'])
    assert.deepEqual(JSON.parse(stub.received[0]?.fields['recipient-variables'] ?? ''), {
      'a@example.com': { first: 'Ada' },
    })
  })

  it('refuses to send with neither recipients nor lists, without a request', async () => {
    const stub = await startStub([{ body: '{}' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(sendEmail(client, base), UsageError)
    assert.equal(stub.received.length, 0, 'should fail before reaching the network')
  })

  it('refuses more than the documented recipient cap locally', async () => {
    const stub = await startStub([{ body: '{}' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@example.com`)

    await assert.rejects(sendEmail(client, { ...base, to: many }), (err: unknown) => {
      assert.ok(err instanceof UsageError)
      assert.equal(err.exitCode, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('maps a 402 to the quota exit code', async () => {
    const stub = await startStub([
      { status: 402, body: JSON.stringify({ ok: false, error: 'Subscription expired or monthly quota exceeded' }) },
    ])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(sendEmail(client, { ...base, to: ['a@example.com'] }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.exitCode, Exit.QUOTA_OR_RATE_LIMIT)
      assert.match(err.message, /quota exceeded/)
      return true
    })
  })
})

describe('sendTransactional', () => {
  it('sends a JSON body, which is the only encoding this endpoint reads', async () => {
    const stub = await startStub([
      { body: JSON.stringify({ status: 'success', message: 'Email sent successfully.', message_id: 'ses-1' }) },
    ])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const result = await sendTransactional(client, {
      toEmail: 'a@example.com',
      subject: 'OTP',
      htmlBody: '<p>384092</p>',
    })

    assert.equal(result.messageId, 'ses-1')
    assert.equal(stub.received[0]?.contentType, 'application/json')
    const sent = JSON.parse(stub.received[0]?.rawBody ?? '{}') as Record<string, string>
    assert.equal(sent.to_email, 'a@example.com')
    assert.equal(sent.api_key, KEY)
  })

  it('requires a body before making a request', async () => {
    const stub = await startStub([{ body: '{}' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(
      sendTransactional(client, { toEmail: 'a@example.com', subject: 'OTP' }),
      UsageError,
    )
    assert.equal(stub.received.length, 0)
  })

  it('lifts the message out of the error envelope on a 403', async () => {
    const stub = await startStub([
      { status: 403, body: JSON.stringify({ status: 'error', message: 'This From email domain is not authorized for the specified brand.' }) },
    ])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(
      sendTransactional(client, { toEmail: 'a@example.com', subject: 'OTP', plainBody: 'x' }),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /not authorized/)
        return true
      },
    )
  })
})
