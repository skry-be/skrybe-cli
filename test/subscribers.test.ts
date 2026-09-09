import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SkrybeClient } from '../src/api/client.js'
import { ApiError, AuthError, CliError, Exit } from '../src/api/errors.js'
import {
  deleteSubscriber,
  subscribe,
  subscriptionStatus,
  unsubscribe,
} from '../src/api/resources/subscribers.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'
const LIST = 'l7763ur5sm4w7nzbnX3FCp9w'
const EMAIL = 'someone@example.com'

describe('subscribe', () => {
  it('posts to the root endpoint in plain-text mode', async () => {
    // `echo true` in PHP prints 1, not "true" — the published docs say "true".
    const stub = await startStub([{ body: '1' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal(await subscribe(client, { listId: LIST, email: EMAIL }), 'subscribed')

    const sent = stub.received[0]
    assert.equal(sent?.path, '/subscribe', 'lives at the install root, not under api/')
    assert.equal(sent?.fields.list, LIST, 'the field is `list`, not `list_id`')
    assert.equal(sent?.fields.boolean, 'true', 'without this it renders an HTML page')
    assert.equal(sent?.fields.api_key, KEY)
  })

  it('reports an existing subscriber as already_subscribed rather than failing', async () => {
    const stub = await startStub([{ body: 'Already subscribed.' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal(await subscribe(client, { listId: LIST, email: EMAIL }), 'already_subscribed')
  })

  it('sends custom fields by their personalization tag name', async () => {
    const stub = await startStub([{ body: '1' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await subscribe(client, {
      listId: LIST,
      email: EMAIL,
      name: 'Ada',
      fields: { Birthday: '1990-01-01', City: 'Lagos' },
    })

    const sent = stub.received[0]
    assert.equal(sent?.fields.Birthday, '1990-01-01')
    assert.equal(sent?.fields.City, 'Lagos')
    assert.equal(sent?.fields.name, 'Ada')
  })

  it('does not let a custom field overwrite a documented one', async () => {
    const stub = await startStub([{ body: '1' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await subscribe(client, {
      listId: LIST,
      email: EMAIL,
      fields: { email: 'attacker@example.com', list: 'other-list' },
    })

    assert.equal(stub.received[0]?.fields.email, EMAIL)
    assert.equal(stub.received[0]?.fields.list, LIST)
  })

  it('omits the optional flags unless asked for', async () => {
    const stub = await startStub([{ body: '1' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await subscribe(client, { listId: LIST, email: EMAIL })

    assert.equal(stub.received[0]?.fields.gdpr, undefined)
    assert.equal(stub.received[0]?.fields.silent, undefined)
  })

  it('classifies a suppressed address as an API error, not a usage error', async () => {
    const stub = await startStub([{ body: 'Email is suppressed.' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(subscribe(client, { listId: LIST, email: EMAIL }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'suppressed_email')
      assert.equal(err.exitCode, Exit.API_ERROR)
      return true
    })
  })

  it('points at --gdpr when the list demands consent', async () => {
    const stub = await startStub([{ body: 'Consent not given.' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(subscribe(client, { listId: LIST, email: EMAIL }), (err: unknown) => {
      assert.ok(err instanceof CliError)
      assert.equal(err.code, 'consent_not_given')
      assert.match(err.hint ?? '', /--gdpr/)
      return true
    })
  })

  it('surfaces a bad API key as an auth failure', async () => {
    const stub = await startStub([{ body: 'Invalid API key' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(subscribe(client, { listId: LIST, email: EMAIL }), (err: unknown) => {
      assert.ok(err instanceof AuthError)
      assert.equal(err.exitCode, Exit.AUTH)
      return true
    })
  })

  it('does not report an unrecognised body as success', async () => {
    const stub = await startStub([{ body: '<b>Warning</b>: mysqli_query(): ...' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(subscribe(client, { listId: LIST, email: EMAIL }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'unexpected_response')
      return true
    })
  })

  it('is not retried, so a flaky network cannot double-write', async () => {
    const stub = await startStub([{ status: 503, body: 'down' }, { body: '1' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(subscribe(client, { listId: LIST, email: EMAIL }))
    assert.equal(stub.received.length, 1)
  })
})

describe('unsubscribe', () => {
  it('posts email and list to the root endpoint', async () => {
    const stub = await startStub([{ body: '1' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await unsubscribe(client, { listId: LIST, email: EMAIL })

    assert.equal(stub.received[0]?.path, '/unsubscribe')
    assert.equal(stub.received[0]?.fields.list, LIST)
    assert.equal(stub.received[0]?.fields.boolean, 'true')
  })

  it('maps its own wording for a missing address', async () => {
    // unsubscribe.php says "Email does not exist."; subscription-status.php
    // says "Email does not exist in list". Both mean the same thing.
    const stub = await startStub([{ body: 'Email does not exist.' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(unsubscribe(client, { listId: LIST, email: EMAIL }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'subscriber_not_found')
      return true
    })
  })
})

describe('deleteSubscriber', () => {
  it('uses list_id, not list', async () => {
    const stub = await startStub([{ body: '1' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await deleteSubscriber(client, { listId: LIST, email: EMAIL })

    assert.equal(stub.received[0]?.path, '/api/subscribers/delete.php')
    assert.equal(stub.received[0]?.fields.list_id, LIST)
  })
})

describe('subscriptionStatus', () => {
  it('returns the status verbatim', async () => {
    const stub = await startStub([{ body: 'Soft bounced' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal(await subscriptionStatus(client, { listId: LIST, email: EMAIL }), 'Soft bounced')
  })

  it('passes through a status the client has never heard of', async () => {
    const stub = await startStub([{ body: 'Quarantined' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal(await subscriptionStatus(client, { listId: LIST, email: EMAIL }), 'Quarantined')
  })

  it('rejects an empty body rather than reporting an empty status', async () => {
    const stub = await startStub([{ body: '   ' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(subscriptionStatus(client, { listId: LIST, email: EMAIL }))
  })
})
