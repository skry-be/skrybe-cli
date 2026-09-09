import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SkrybeClient } from '../src/api/client.js'
import { ApiError, AuthError, Exit } from '../src/api/errors.js'

import { startStub } from './helpers.js'

const KEY = 'test-api-key'

describe('SkrybeClient.requestText', () => {
  it('posts a form body with the api key injected', async () => {
    const stub = await startStub([{ body: '4211' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const body = await client.requestText({
      path: 'api/subscribers/active-subscriber-count.php',
      body: { list_id: 'AbC892763xy' },
    })

    assert.equal(body, '4211')
    assert.deepEqual(stub.received, [
      {
        method: 'POST',
        path: '/api/subscribers/active-subscriber-count.php',
        contentType: 'application/x-www-form-urlencoded',
        fields: { list_id: 'AbC892763xy', api_key: KEY },
        rawBody: 'list_id=AbC892763xy&api_key=test-api-key',
      },
    ])
  })

  it('tolerates a leading slash on the path and a trailing slash on the URL', async () => {
    const stub = await startStub([{ body: 'ok' }])
    const client = new SkrybeClient({ url: `${stub.url}///`, apiKey: KEY })

    await client.requestText({ path: '/api/lists/get-lists.php' })
    assert.equal(stub.received[0]?.path, '/api/lists/get-lists.php')
  })

  it('drops undefined fields rather than sending the string "undefined"', async () => {
    const stub = await startStub([{ body: 'ok' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await client.requestText({ path: 'x.php', body: { kept: 'yes', dropped: undefined } })
    assert.deepEqual(stub.received[0]?.fields, { kept: 'yes', api_key: KEY })
  })

  it('throws AuthError on a prose failure carried by HTTP 200', async () => {
    // The legacy API's defining quirk: the transport says success, the body
    // says otherwise.
    const stub = await startStub([{ body: 'Invalid API key' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: 'wrong' })

    await assert.rejects(
      client.requestText({ path: 'api/lists/get-lists.php' }),
      (err: unknown) => {
        assert.ok(err instanceof AuthError)
        assert.equal(err.exitCode, Exit.AUTH)
        return true
      },
    )
  })

  it('passes an unrecognised 200 body through as data', async () => {
    const stub = await startStub([{ body: 'No lists found' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal(await client.requestText({ path: 'api/lists/get-lists.php' }), 'No lists found')
  })

  it('sends a JSON body when asked, for the one endpoint that reads php://input', async () => {
    const stub = await startStub([{ body: 'ok' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await client.requestText({
      path: 'api/emails/send-transactional.php',
      encoding: 'json',
      body: { to: 'a@example.com' },
    })

    assert.equal(stub.received[0]?.contentType, 'application/json')
    assert.deepEqual(JSON.parse(stub.received[0]?.rawBody ?? ''), {
      to: 'a@example.com',
      api_key: KEY,
    })
  })

  it('omits the api key for an anonymous GET and puts fields in the query', async () => {
    const stub = await startStub([{ body: '{}' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await client.requestText({
      path: 'api/stats/emails-sent.php',
      method: 'GET',
      anonymous: true,
    })

    assert.equal(stub.received[0]?.method, 'GET')
    assert.deepEqual(stub.received[0]?.fields, {})
    assert.equal(stub.received[0]?.rawBody, '')
  })
})

describe('SkrybeClient.requestJson', () => {
  it('parses a JSON body', async () => {
    const stub = await startStub([{ body: JSON.stringify({ total_emails_sent: 12345 }) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.deepEqual(
      await client.requestJson({ path: 'api/stats/emails-sent.php', method: 'GET' }),
      { total_emails_sent: 12345 },
    )
  })

  it('reports a non-JSON body rather than throwing a SyntaxError', async () => {
    const stub = await startStub([{ body: '<b>Warning</b>: something' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(
      client.requestJson({ path: 'api/stats/emails-sent.php', method: 'GET' }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, 'malformed_response')
        assert.equal(err.raw, '<b>Warning</b>: something')
        return true
      },
    )
  })

  it('lifts the message out of an error envelope', async () => {
    const stub = await startStub([
      { status: 400, body: JSON.stringify({ ok: false, error: 'Unauthorised From email domain' }) },
    ])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(
      client.requestJson({ path: 'api/emails/send.php' }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.message, 'Unauthorised From email domain')
        assert.equal(err.code, 'invalid_request')
        assert.equal(err.exitCode, Exit.USAGE)
        return true
      },
    )
  })

  it('maps a quota response to the quota exit code', async () => {
    const stub = await startStub([{ status: 402, body: JSON.stringify({ message: 'Quota spent' }) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(client.requestJson({ path: 'api/emails/send.php' }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.exitCode, Exit.QUOTA_OR_RATE_LIMIT)
      return true
    })
  })

  it('falls back to a message when the body is empty', async () => {
    const stub = await startStub([{ status: 500, body: '' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(client.requestJson({ path: 'x.php' }), /HTTP 500/)
  })
})

describe('SkrybeClient retries', () => {
  it('retries a 503 and returns the eventual success', async () => {
    const stub = await startStub([{ status: 503, body: 'down' }, { body: 'ok' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal(await client.requestText({ path: 'x.php', retryable: true }), 'ok')
    assert.equal(stub.received.length, 2)
  })

  it('gives up after three attempts and surfaces the last response', async () => {
    const stub = await startStub([{ status: 503, body: 'still down' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(client.requestText({ path: 'x.php', retryable: true }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 503)
      return true
    })
    assert.equal(stub.received.length, 3)
  })

  it('does not retry a write, even on a 503', async () => {
    // The point of the opt-in. None of the send endpoints take an idempotency
    // key, so a 503 from a request that actually landed would become a second
    // campaign. Requests are single-attempt unless they say otherwise.
    const stub = await startStub([{ status: 503, body: 'down' }, { body: 'ok' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(client.requestText({ path: 'api/emails/send.php' }))
    assert.equal(stub.received.length, 1)
  })

  it('does not retry a network failure on a write', async () => {
    const client = new SkrybeClient({ url: 'http://127.0.0.1:1', apiKey: KEY })
    const started = Date.now()

    await assert.rejects(client.requestText({ path: 'api/emails/send.php' }))
    // Three attempts would have spent at least 500ms + 1000ms backing off.
    assert.ok(Date.now() - started < 400, 'should not have backed off and retried')
  })

  it('does not retry a 4xx', async () => {
    const stub = await startStub([{ status: 400, body: 'bad' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(client.requestText({ path: 'x.php' }))
    assert.equal(stub.received.length, 1)
  })

  it('honours Retry-After when it is shorter than the backoff', async () => {
    const stub = await startStub([
      { status: 429, body: 'slow down', headers: { 'retry-after': '0' } },
      { body: 'ok' },
    ])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const started = Date.now()
    assert.equal(await client.requestText({ path: 'x.php', retryable: true }), 'ok')
    assert.ok(Date.now() - started < 400, 'should not have waited out the default backoff')
  })

  it('times out rather than hanging', async () => {
    const stub = await startStub([{ body: 'too late', delayMs: 2000 }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY, timeoutMs: 60 })

    await assert.rejects(client.requestText({ path: 'x.php' }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'timeout')
      return true
    })
  })

  it('reports an unreachable host without leaking a bare fetch error', async () => {
    // Port 1 on loopback refuses immediately, so this exercises the connect
    // failure path without waiting on a real timeout.
    const client = new SkrybeClient({ url: 'http://127.0.0.1:1', apiKey: KEY })

    await assert.rejects(client.requestText({ path: 'x.php' }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'network_error')
      assert.match(err.message, /Could not reach/)
      return true
    })
  })
})
