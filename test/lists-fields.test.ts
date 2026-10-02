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
  addCustomField,
  deleteCustomField,
  renameCustomField,
  type CustomField,
  type ListDetail,
} from '../src/api/resources/lists.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

const list = (fields: CustomField[]): string =>
  JSON.stringify({
    id: 'L',
    name: 'Newsletter',
    opt_in: 'single',
    subscribers: { active: 10, unconfirmed: 0, unsubscribed: 2, bounced: 0, complained: 0 },
    custom_fields: fields,
  } satisfies ListDetail)

describe('custom fields', () => {
  it('addCustomField sends the name and type', async () => {
    const stub = await startStub([{ body: list([{ name: 'City', type: 'Text' }, { name: 'Birthday', type: 'Date' }]) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    const r = await addCustomField(client, 'L', 'Birthday', 'date')

    assert.equal(r.custom_fields[1]?.type, 'Date')
    assert.equal(stub.received[0]?.path, '/api/lists/add-custom-field.php')
    assert.deepEqual(stub.received[0]?.fields, { list_id: 'L', name: 'Birthday', type: 'date', api_key: KEY })
  })

  it('renameCustomField sends the old and new names', async () => {
    const stub = await startStub([{ body: list([{ name: 'Town', type: 'Text' }]) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await renameCustomField(client, 'L', 'City', 'Town')
    assert.deepEqual(stub.received[0]?.fields, { list_id: 'L', name: 'City', new_name: 'Town', api_key: KEY })
  })

  it('deleteCustomField is not retried', async () => {
    const stub = await startStub([{ body: '', status: 503 }, { body: list([]) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(deleteCustomField(client, 'L', 'City'))
    assert.equal(stub.received.length, 1)
  })

  const cases: [string, string, number][] = [
    ['Field name not passed', 'field_name_missing', Exit.USAGE],
    ['Invalid field name', 'invalid_field_name', Exit.USAGE],
    ['Name and Email are built-in fields', 'reserved_field_name', Exit.USAGE],
    ['type must be text or date', 'invalid_field_type', Exit.USAGE],
    ['Field already exists', 'field_exists', Exit.API_ERROR],
    ['Field does not exist', 'field_not_found', Exit.API_ERROR],
    ['Field is used by an autoresponder', 'field_in_use', Exit.API_ERROR],
    ['Field is used by a segment', 'field_in_use', Exit.API_ERROR],
    ['List was changed by another request. Try again.', 'conflict', Exit.API_ERROR],
    ['Unable to change custom fields', 'operation_failed', Exit.API_ERROR],
  ]
  for (const [body, code, exitCode] of cases) {
    it(`maps "${body}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(addCustomField(client, 'L', 'X'), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        assert.equal(err.exitCode, exitCode)
        return true
      })
    })
  }
})

describe('skrybe lists fields (CLI)', () => {
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

  it('shows the fields with their personalization tags', async () => {
    const stub = await startStub([{ body: list([{ name: 'City', type: 'Text' }]) }])

    const { stdout } = await run(stub.url, 'lists', 'fields', 'L', '--output', 'text')

    assert.equal(stub.received[0]?.path, '/api/lists/get-list.php')
    assert.equal(stdout, 'City\ttext\t[City,fallback=]\n')
  })

  // `fields` takes a list id and has sub-verbs; `add` must dispatch, not be read as an id.
  it('dispatches `fields add` rather than reading "add" as a list id', async () => {
    const stub = await startStub([{ body: list([{ name: 'City', type: 'Text' }]) }])

    await run(stub.url, 'lists', 'fields', 'add', 'L', 'City')

    assert.equal(stub.received[0]?.path, '/api/lists/add-custom-field.php')
  })

  it('rejects an unknown --type before any request', async () => {
    const stub = await startStub([{ body: list([]) }])

    await assert.rejects(run(stub.url, 'lists', 'fields', 'add', 'L', 'Age', '--type', 'number'))
    assert.equal(stub.received.length, 0)
  })

  it('delete refuses from a script without --yes, before any request', async () => {
    const stub = await startStub([{ body: list([]) }])

    await assert.rejects(run(stub.url, 'lists', 'fields', 'rm', 'L', 'City'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('delete --yes deletes with one request', async () => {
    const stub = await startStub([{ body: list([]) }])

    await run(stub.url, 'lists', 'fields', 'delete', 'L', 'City', '--yes')

    assert.equal(stub.received.length, 1)
    assert.equal(stub.received[0]?.path, '/api/lists/delete-custom-field.php')
  })
})

describe('subscribers add --field with a space in the name', () => {
  it('posts the name without spaces, as subscribe.php matches it', async () => {
    const { subscribe } = await import('../src/api/resources/subscribers.js')
    const stub = await startStub([{ body: '1' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await subscribe(client, { listId: 'L', email: 'a@example.com', fields: { 'Favourite colour': 'Blue' } })

    assert.equal(stub.received[0]?.fields.Favouritecolour, 'Blue')
    assert.equal(stub.received[0]?.fields['Favourite colour'], undefined)
  })
})
