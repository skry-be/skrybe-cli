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
import { createList, deleteList, getList, updateList, type ListDetail } from '../src/api/resources/lists.js'
import { startStub } from './helpers.js'

const KEY = 'test-key'

const list = (overrides: Partial<ListDetail> = {}): ListDetail => ({
  id: 'enc892id',
  name: 'Newsletter',
  opt_in: 'single',
  subscribers: { active: 1204, unconfirmed: 3, unsubscribed: 40, bounced: 2, complained: 1 },
  custom_fields: [],
  ...overrides,
})

describe('list management', () => {
  it('getList posts the id and returns the detail', async () => {
    const stub = await startStub([{ body: JSON.stringify(list()) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal((await getList(client, 'enc892id')).subscribers.active, 1204)
    assert.equal(stub.received[0]?.path, '/api/lists/get-list.php')
    assert.equal(stub.received[0]?.fields.list_id, 'enc892id')
  })

  it('createList sends the name and opt-in, and is not retried', async () => {
    const stub = await startStub([{ body: '', status: 503 }, { body: JSON.stringify(list()) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(createList(client, 'Newsletter', 'double'))
    assert.equal(stub.received.length, 1)
    assert.equal(stub.received[0]?.fields.name, 'Newsletter')
    assert.equal(stub.received[0]?.fields.opt_in, 'double')
  })

  it('updateList only sends what changes', async () => {
    const stub = await startStub([{ body: JSON.stringify(list({ name: 'Renamed' })) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await updateList(client, 'enc892id', { name: 'Renamed' })
    assert.equal(stub.received[0]?.path, '/api/lists/update-list.php')
    assert.deepEqual(stub.received[0]?.fields, { list_id: 'enc892id', name: 'Renamed', api_key: KEY })
  })

  it('deleteList returns the deleted id', async () => {
    const stub = await startStub([{ body: '{"id":"enc892id","deleted":true}' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.deepEqual(await deleteList(client, 'enc892id'), { id: 'enc892id', deleted: true })
  })

  const cases: [string, string, number][] = [
    ['List name not passed', 'list_name_missing', Exit.USAGE],
    ['List name is too long', 'list_name_too_long', Exit.USAGE],
    ['opt_in must be single or double', 'invalid_opt_in', Exit.USAGE],
    ['Nothing to update', 'nothing_to_update', Exit.USAGE],
    ['List is used by a scheduled or sending campaign', 'list_in_use', Exit.API_ERROR],
    ['List does not exist', 'list_not_found', Exit.API_ERROR],
    ['Unable to delete list', 'operation_failed', Exit.API_ERROR],
  ]
  for (const [body, code, exitCode] of cases) {
    it(`maps "${body}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(deleteList(client, 'x'), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        assert.equal(err.exitCode, exitCode)
        return true
      })
    })
  }
})

describe('skrybe lists create / update / delete (CLI)', () => {
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

  it('create prints only the new id on stdout, for $(...)', async () => {
    const stub = await startStub([{ body: JSON.stringify(list()) }])

    const { stdout } = await run(stub.url, 'lists', 'create', 'Newsletter', '--opt-in', 'double')

    assert.equal(stdout, 'enc892id\n')
    assert.equal(stub.received[0]?.fields.opt_in, 'double')
  })

  it('rejects an unknown --opt-in before any request', async () => {
    const stub = await startStub([{ body: JSON.stringify(list()) }])

    await assert.rejects(run(stub.url, 'lists', 'create', 'N', '--opt-in', 'triple'))
    assert.equal(stub.received.length, 0)
  })

  it('update needs something to change', async () => {
    const stub = await startStub([{ body: JSON.stringify(list()) }])

    await assert.rejects(run(stub.url, 'lists', 'update', 'enc892id'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('delete refuses from a script without --yes, before any request', async () => {
    const stub = await startStub([{ body: '{"id":"enc892id","deleted":true}' }])

    await assert.rejects(run(stub.url, 'lists', 'delete', 'enc892id'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('rm --yes deletes with one request', async () => {
    const stub = await startStub([{ body: '{"id":"enc892id","deleted":true}' }])

    const { stdout } = await run(stub.url, 'lists', 'rm', 'enc892id', '--yes', '--json')

    assert.equal(stub.received.length, 1)
    assert.equal(stub.received[0]?.path, '/api/lists/delete.php')
    assert.deepEqual(JSON.parse(stdout), { outcome: 'deleted', list_id: 'enc892id' })
  })

  it('ls --counts passes counts flag through Commander options inheritance', async () => {
    const stub = await startStub((req) => {
      if (req.path === '/api/lists/get-lists.php') {
        return { body: '{"list1":{"id":"L1","name":"Newsletter"}}' }
      }
      if (req.path === '/api/subscribers/active-subscriber-count.php') {
        return { body: '42' }
      }
      return { body: '' }
    })

    const { stdout } = await run(stub.url, 'lists', 'ls', '--counts')

    assert.match(stdout, /ACTIVE/)
    assert.match(stdout, /42/)
  })
})

