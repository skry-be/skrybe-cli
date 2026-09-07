import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SkrybeClient } from '../src/api/client.js'
import { ApiError, Exit } from '../src/api/errors.js'
import { listBrands } from '../src/api/resources/brands.js'
import { activeSubscriberCount, listLists } from '../src/api/resources/lists.js'
import { totalEmailsSent } from '../src/api/resources/stats.js'

import { phpNumberedPayload, startStub, type Reply } from './helpers.js'

/** A client wired to a stub answering every request with the same body. */
async function clientAnswering(reply: Reply) {
  const stub = await startStub([reply])
  return { stub, client: new SkrybeClient({ url: stub.url, apiKey: 'test-api-key' }) }
}

describe('listLists', () => {
  it('returns the brand’s lists', async () => {
    const body = phpNumberedPayload('list', [
      { id: 'AbC892763xy', name: 'Newsletter' },
      { id: 'ZzZ763892qq', name: 'Q4 "Big" Push' },
    ])
    const { client } = await clientAnswering({ body })

    assert.deepEqual(await listLists(client), [
      { id: 'AbC892763xy', name: 'Newsletter' },
      { id: 'ZzZ763892qq', name: 'Q4 "Big" Push' },
    ])
  })

  it('returns an empty array, not an error, when the brand has no lists', async () => {
    const { client } = await clientAnswering({ body: 'No lists found' })
    assert.deepEqual(await listLists(client), [])
  })

  it('asks for hidden lists only when told to', async () => {
    const { stub, client } = await clientAnswering({ body: 'No lists found' })

    await listLists(client)
    assert.equal(stub.received[0]?.fields.include_hidden, 'no')

    await listLists(client, { includeHidden: true })
    assert.equal(stub.received[1]?.fields.include_hidden, 'yes')
  })
})

describe('listBrands', () => {
  it('returns the single brand the key is bound to', async () => {
    const body = phpNumberedPayload('brand', [{ id: '86', name: 'Cafe One' }])
    const { client } = await clientAnswering({ body })

    assert.deepEqual(await listBrands(client), [{ id: '86', name: 'Cafe One' }])
  })

  it('returns an empty array when the key has no brand', async () => {
    const { client } = await clientAnswering({ body: 'No brands found' })
    assert.deepEqual(await listBrands(client), [])
  })
})

describe('activeSubscriberCount', () => {
  it('reads a count', async () => {
    const { stub, client } = await clientAnswering({ body: '4211' })

    assert.equal(await activeSubscriberCount(client, 'AbC892763xy'), 4211)
    assert.equal(stub.received[0]?.fields.list_id, 'AbC892763xy')
  })

  it('reads a genuine zero', async () => {
    const { client } = await clientAnswering({ body: '0' })
    assert.equal(await activeSubscriberCount(client, 'AbC892763xy'), 0)
  })

  it('tolerates the trailing whitespace PHP sometimes leaves', async () => {
    const { client } = await clientAnswering({ body: '17\n' })
    assert.equal(await activeSubscriberCount(client, 'AbC892763xy'), 17)
  })

  // The bug this file exists for. active-subscriber-count.php answers HTTP 200
  // with prose on failure, and every one of these once became 0 — an answer the
  // caller cannot tell apart from an empty list.
  it('throws on an id the server could not decrypt', async () => {
    const { client } = await clientAnswering({ body: 'List ID not passed' })

    await assert.rejects(
      activeSubscriberCount(client, 'TOTALLYBOGUS'),
      (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, 'list_id_invalid')
        assert.equal(err.exitCode, Exit.USAGE)
        return true
      },
    )
  })

  it('throws on a list belonging to another brand', async () => {
    const { client } = await clientAnswering({ body: 'List does not exist' })

    await assert.rejects(activeSubscriberCount(client, 'AbC892763xy'), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'list_not_found')
      return true
    })
  })

  it('throws on a body that is not a number at all', async () => {
    const { client } = await clientAnswering({ body: '<b>Warning</b>: mysqli_query()' })

    await assert.rejects(activeSubscriberCount(client, 'AbC892763xy'), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'malformed_response')
      assert.match(err.message, /mysqli_query/)
      return true
    })
  })

  it('does not read a leading number out of a prose body', async () => {
    // Number.parseInt('0 lists matched') is 0. The count has to be the whole
    // body or it is not a count.
    const { client } = await clientAnswering({ body: '0 lists matched' })

    await assert.rejects(activeSubscriberCount(client, 'AbC892763xy'), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'malformed_response')
      return true
    })
  })

  it('throws on an empty body', async () => {
    const { client } = await clientAnswering({ body: '' })

    await assert.rejects(activeSubscriberCount(client, 'AbC892763xy'), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'malformed_response')
      return true
    })
  })
})

describe('totalEmailsSent', () => {
  it('reads the counter without sending the api key', async () => {
    const { stub, client } = await clientAnswering({
      body: JSON.stringify({ total_emails_sent: 12345 }),
    })

    assert.equal(await totalEmailsSent(client), 12345)
    assert.equal(stub.received[0]?.method, 'GET')
    assert.equal(stub.received[0]?.fields.api_key, undefined)
  })

  it('reports zero when the field is absent rather than NaN', async () => {
    const { client } = await clientAnswering({ body: JSON.stringify({}) })
    assert.equal(await totalEmailsSent(client), 0)
  })
})
