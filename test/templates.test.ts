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
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  type Template,
} from '../src/api/resources/templates.js'
import { startStub, type Received } from './helpers.js'

const KEY = 'test-key'

const tpl = (overrides: Partial<Template> = {}): Template => ({
  id: 7,
  name: 'Newsletter',
  from_name: 'Acme',
  from_email: 'hello@acme.test',
  reply_to: '',
  editor: 'html',
  ...overrides,
})

describe('templates', () => {
  it('listTemplates unwraps the templates array', async () => {
    const stub = await startStub([{ body: JSON.stringify({ templates: [tpl(), tpl({ id: 8 })] }) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.deepEqual((await listTemplates(client)).map((t) => t.id), [7, 8])
    assert.equal(stub.received[0]?.path, '/api/templates/get-templates.php')
  })

  it('getTemplate asks for the content only when wanted', async () => {
    const stub = await startStub([{ body: JSON.stringify(tpl()) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await getTemplate(client, 7)
    await getTemplate(client, 7, { includeContent: true })
    assert.equal(stub.received[0]?.fields.include_content, undefined)
    assert.equal(stub.received[1]?.fields.include_content, 'yes')
  })

  it('createTemplate maps fields to API names and is not retried', async () => {
    const stub = await startStub([{ body: '', status: 503 }, { body: JSON.stringify(tpl()) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(createTemplate(client, { name: 'N', htmlText: '<p>x</p>', fromEmail: 'a@acme.test', editor: 'dragdrop' }))
    assert.equal(stub.received.length, 1)
    assert.deepEqual(stub.received[0]?.fields, {
      name: 'N',
      html_text: '<p>x</p>',
      from_email: 'a@acme.test',
      editor: 'dragdrop',
      api_key: KEY,
    })
  })

  it('updateTemplate and deleteTemplate post the template id', async () => {
    const stub = await startStub([{ body: JSON.stringify(tpl()) }, { body: '{"template_id":7,"deleted":true}' }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await updateTemplate(client, 7, { name: 'Renamed' })
    assert.deepEqual(await deleteTemplate(client, 7), { template_id: 7, deleted: true })
    assert.deepEqual(stub.received[0]?.fields, { template_id: '7', name: 'Renamed', api_key: KEY })
    assert.equal(stub.received[1]?.path, '/api/templates/delete-template.php')
  })

  for (const [body, code, exitCode] of [
    ['Template does not exist', 'template_not_found', Exit.API_ERROR],
    ['Template name not passed', 'template_name_missing', Exit.USAGE],
    ['HTML not passed', 'html_missing', Exit.USAGE],
    ['editor must be html or dragdrop', 'invalid_editor', Exit.USAGE],
  ] as const) {
    it(`maps "${body}" to ${code}`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(getTemplate(client, 7), (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, code)
        assert.equal(err.exitCode, exitCode)
        return true
      })
    })
  }
})

describe('skrybe templates (CLI)', () => {
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

  it('create reads the body from a file and prints only the new id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skrybe-'))
    writeFileSync(join(dir, 'email.html'), '<p>file body</p>')
    const stub = await startStub([{ body: JSON.stringify(tpl({ id: 12 })) }])

    const { stdout } = await run(stub.url, 'templates', 'create', 'Promo', '--html-text', `file://${join(dir, 'email.html')}`)

    assert.equal(stdout, '12\n')
    assert.equal(stub.received[0]?.fields.html_text, '<p>file body</p>')
  })

  it('create without a body fails before any request', async () => {
    const stub = await startStub([{ body: JSON.stringify(tpl()) }])

    await assert.rejects(run(stub.url, 'templates', 'create', 'Promo'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  it('get --content prints the raw HTML', async () => {
    const stub = await startStub([{ body: JSON.stringify(tpl({ html_text: '<p>raw</p>', plain_text: '' })) }])

    const { stdout } = await run(stub.url, 'templates', 'get', '7', '--content')

    assert.equal(stdout, '<p>raw</p>\n')
  })

  it('delete refuses from a script without --yes', async () => {
    const stub = await startStub([{ body: '{"template_id":7,"deleted":true}' }])

    await assert.rejects(run(stub.url, 'templates', 'rm', '7'), (err: { code?: number }) => {
      assert.equal(err.code, Exit.USAGE)
      return true
    })
    assert.equal(stub.received.length, 0)
  })

  describe('campaigns create --template', () => {
    const answer = (r: Received) =>
      r.path.endsWith('get-template.php')
        ? { body: JSON.stringify(tpl({ html_text: '<p>from template</p>', plain_text: 'plain' })) }
        : { body: '{"status":"Campaign created", "campaign_id": "99"}' }

    it('takes the body and sender from the template', async () => {
      const stub = await startStub(answer)

      await run(stub.url, 'campaigns', 'create', '--template', '7', '--title', 'T', '--subject', 'S')

      const create = stub.received[1]?.fields
      assert.equal(create?.html_text, '<p>from template</p>')
      assert.equal(create?.plain_text, 'plain')
      assert.equal(create?.from_name, 'Acme')
      assert.equal(create?.from_email, 'hello@acme.test')
      // The template has no reply-to, so it falls back to the From address.
      assert.equal(create?.reply_to, 'hello@acme.test')
    })

    it('lets flags override the template', async () => {
      const stub = await startStub(answer)

      await run(stub.url, 'campaigns', 'create', '--template', '7', '--title', 'T', '--subject', 'S', '--from-name', 'Other')

      assert.equal(stub.received[1]?.fields.from_name, 'Other')
    })

    it('still needs the sender and body without a template', async () => {
      const stub = await startStub(answer)

      await assert.rejects(run(stub.url, 'campaigns', 'create', '--title', 'T', '--subject', 'S'), (err: { code?: number; stderr?: string }) => {
        assert.equal(err.code, Exit.USAGE)
        assert.match(err.stderr ?? '', /--from-name, --from-email, --reply-to, --html-text/)
        return true
      })
      assert.equal(stub.received.length, 0)
    })
  })
})
