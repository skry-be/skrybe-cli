import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { SkrybeClient } from '../src/api/client.js'
import { ApiError, AuthError, Exit } from '../src/api/errors.js'
import { createBrand } from '../src/api/resources/brands.js'
import { validateCreate } from '../src/commands/brands.js'

import { startStub, type Reply } from './helpers.js'

const CREATED = {
  status: 'success',
  message: 'Brand created successfully',
  brand_id: 7,
  app_name: 'Acme',
  from_name: 'Acme',
  from_email: 'hi@acme.test',
  reply_to: 'hi@acme.test',
  app_key: 'K'.repeat(30),
}
const created: Reply = { status: 201, body: JSON.stringify(CREATED), headers: { 'Content-Type': 'application/json' } }

async function clientAnswering(reply: Reply) {
  const stub = await startStub([reply])
  return { stub, client: new SkrybeClient({ url: stub.url, apiKey: 'admin-key' }) }
}

describe('createBrand', () => {
  it('posts the required fields to the admin endpoint and returns the record', async () => {
    const { stub, client } = await clientAnswering(created)

    const brand = await createBrand(client, { name: 'Acme', fromEmail: 'hi@acme.test' })

    assert.equal(brand.app_key, CREATED.app_key)
    assert.equal(stub.received.length, 1)
    assert.equal(stub.received[0]?.path, '/api/admin/brands/create-brand.php')
    assert.equal(stub.received[0]?.fields.api_key, 'admin-key')
    assert.equal(stub.received[0]?.fields.app_name, 'Acme')
    assert.equal(stub.received[0]?.fields.from_email, 'hi@acme.test')
    assert.equal('pass' in (stub.received[0]?.fields ?? {}), false)
  })

  it('maps optional fields to the names the server reads', async () => {
    const { stub, client } = await clientAnswering(created)

    await createBrand(client, {
      name: 'Acme',
      fromEmail: 'hi@acme.test',
      password: 'pw',
      quota: 'no-expiry',
      monthlyLimit: 500,
      smtpHost: 'smtp.acme.test',
      smtpPassword: 'smtp-pw',
    })
    await createBrand(client, { name: 'Acme', fromEmail: 'hi@acme.test', quota: 'custom', monthlyLimit: 100, resetDay: 15 })

    const [a, b] = stub.received
    assert.equal(a?.fields.pass, 'pw')
    assert.equal(a?.fields.choose_limit, 'no_expiry')
    assert.equal(a?.fields.monthly_limit, '500')
    assert.equal(a?.fields.smtp_host, 'smtp.acme.test')
    assert.equal(a?.fields.smtp_password, 'smtp-pw')
    assert.equal(b?.fields.choose_limit, 'custom')
    assert.equal(b?.fields['reset-on-day'], '15')
  })

  it('does not retry a 503, since a repeat could create a second brand', async () => {
    const { stub, client } = await clientAnswering({ status: 503, body: '{"error":"busy"}' })
    await assert.rejects(createBrand(client, { name: 'Acme', fromEmail: 'hi@acme.test' }), ApiError)
    assert.equal(stub.received.length, 1)
  })

  it('turns a 401 into an auth error that points at the admin key', async () => {
    const { client } = await clientAnswering({
      status: 401,
      body: JSON.stringify({ status: 'error', error: 'Invalid API key or not an admin account' }),
    })

    await assert.rejects(createBrand(client, { name: 'Acme', fromEmail: 'hi@acme.test' }), (err: unknown) => {
      assert.ok(err instanceof AuthError)
      assert.equal(err.exitCode, Exit.AUTH)
      assert.match(err.message, /not an admin account/)
      assert.match(err.hint ?? '', /admin/)
      return true
    })
  })

  it('passes a 400 validation message through', async () => {
    const { client } = await clientAnswering({ status: 400, body: '{"status":"error","error":"Invalid from email address"}' })
    await assert.rejects(createBrand(client, { name: 'Acme', fromEmail: 'x' }), /Invalid from email address/)
  })

  it('reports a duplicate login email as a conflict', async () => {
    const { client } = await clientAnswering({ status: 409, body: '{"status":"error","error":"A user with that login email already exists"}' })
    await assert.rejects(createBrand(client, { name: 'Acme', fromEmail: 'hi@acme.test', password: 'pw' }), (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'conflict')
      assert.match(err.message, /already exists/)
      return true
    })
  })

  it('rejects a success response that carries no key', async () => {
    const { client } = await clientAnswering({ status: 201, body: '{"status":"success"}' })
    await assert.rejects(createBrand(client, { name: 'Acme', fromEmail: 'hi@acme.test' }), /did not return the new brand/)
  })
})

describe('validateCreate', () => {
  const base = { name: 'Acme', fromEmail: 'hi@acme.test' }

  it('accepts the minimum', () => {
    assert.equal(validateCreate(base).name, 'Acme')
  })
  it('rejects a bad email, naming the flag', () => {
    assert.throws(() => validateCreate({ ...base, replyTo: 'nope' }), /--reply-to/)
    assert.throws(() => validateCreate({ ...base, fromEmail: 'nope' }), /--from-email/)
  })
  it('requires a monthly limit with custom and no-expiry quotas', () => {
    assert.throws(() => validateCreate({ ...base, quota: 'custom' }), /--monthly-limit/)
    assert.throws(() => validateCreate({ ...base, quota: 'no-expiry' }), /--monthly-limit/)
  })
  it('refuses a monthly limit or reset day on the wrong quota', () => {
    assert.throws(() => validateCreate({ ...base, monthlyLimit: '5' }), /--quota/)
    assert.throws(() => validateCreate({ ...base, quota: 'unlimited', monthlyLimit: '5' }), /--quota/)
    assert.throws(() => validateCreate({ ...base, quota: 'no-expiry', monthlyLimit: '5', resetDay: '3' }), /--reset-day/)
  })
  it('bounds the reset day and the limit', () => {
    assert.throws(() => validateCreate({ ...base, quota: 'custom', monthlyLimit: '5', resetDay: '32' }), /1 to 31/)
    assert.throws(() => validateCreate({ ...base, quota: 'custom', monthlyLimit: '-1' }), /--monthly-limit/)
    assert.throws(() => validateCreate({ ...base, quota: 'custom', monthlyLimit: 'x' }), /--monthly-limit/)
  })
})

describe('skrybe brands create (end to end)', () => {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))

  function run(url: string, args: string[], stdin?: string, env: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'skrybe-brands-'))
    const config = join(dir, 'config.json')
    writeFileSync(config, JSON.stringify({ currentProfile: 'default', profiles: { default: { url, apiKey: 'admin-key' } } }))
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = execFile(
        process.execPath,
        ['--import', 'tsx', entry, ...args],
        { encoding: 'utf8', env: { ...process.env, SKRYBE_CONFIG: config, ...env } },
        (err, stdout, stderr) =>
          resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
      )
      child.stdin?.end(stdin ?? '')
    })
  }

  it('reads the password from stdin, never argv, and prints the key once', async () => {
    const stub = await startStub([created])
    const r = await run(stub.url, ['brands', 'create', '--name', 'Acme', '--from-email', 'hi@acme.test', '--password-stdin'], 'hunter2\n', {
      SKRYBE_SMTP_PASSWORD: 'smtp-secret',
    })

    assert.equal(r.code, 0, r.stderr)
    assert.equal(stub.received[0]?.fields.pass, 'hunter2')
    assert.equal(stub.received[0]?.fields.smtp_password, 'smtp-secret')
    assert.match(r.stdout, new RegExp(CREATED.app_key))
    assert.match(r.stderr, /cannot be shown again/)
  })

  it('emits the record as json without the warning noise on stdout', async () => {
    const stub = await startStub([created])
    const r = await run(stub.url, ['brands', 'create', '--name', 'Acme', '--from-email', 'hi@acme.test', '--json'])

    assert.equal(r.code, 0, r.stderr)
    assert.equal(JSON.parse(r.stdout).brand_id, 7)
  })

  it('exits with the usage code before any request on a bad flag combination', async () => {
    const stub = await startStub([created])
    const r = await run(stub.url, ['brands', 'create', '--name', 'Acme', '--from-email', 'hi@acme.test', '--reset-day', '3'])

    assert.equal(r.code, Exit.USAGE)
    assert.equal(stub.received.length, 0)
  })

  it('exits with the auth code when the key is not an admin key', async () => {
    const stub = await startStub([{ status: 401, body: '{"status":"error","error":"Invalid API key or not an admin account"}' }])
    const r = await run(stub.url, ['brands', 'create', '--name', 'Acme', '--from-email', 'hi@acme.test'])

    assert.equal(r.code, Exit.AUTH)
    assert.match(r.stderr, /admin/)
  })

  it('is listed under brands --help as an admin command', async () => {
    const r = await run('http://127.0.0.1:9', ['brands', '--help'])
    assert.match(r.stdout, /Admin commands/)
    assert.match(r.stdout, /create/)
  })
})
