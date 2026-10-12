import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { SkrybeClient } from '../src/api/client.js'
import { ApiError, CliError, Exit } from '../src/api/errors.js'
import { brandTransport, type BrandTransport } from '../src/api/resources/brands.js'
import { startStub } from './helpers.js'

const KEY = 'main-key'

const state = (overrides: Partial<BrandTransport> = {}): BrandTransport => ({
  brand_id: 86,
  name: 'Cafe One',
  transport: 'relay',
  smtp_host: 'mta1.skry.be',
  smtp_port: '587',
  smtp_ssl: 'tls',
  smtp_username: 'brand86',
  smtp_password_set: true,
  ...overrides,
})

describe('brandTransport', () => {
  it('reads with only the brand id, and retries a read', async () => {
    const stub = await startStub([{ body: '', status: 503 }, { body: JSON.stringify(state({ transport: 'ses' })) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    assert.equal((await brandTransport(client, 86)).transport, 'ses')
    assert.equal(stub.received.length, 2)
    assert.equal(stub.received[1]?.path, '/api/admin/brands/set-transport.php')
    assert.deepEqual(stub.received[1]?.fields, { brand_id: '86', api_key: KEY })
  })

  it('switches without retrying', async () => {
    const stub = await startStub([{ body: '', status: 503 }, { body: JSON.stringify(state()) }])
    const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

    await assert.rejects(brandTransport(client, 86, { transport: 'relay', password: 'pw' }))
    assert.equal(stub.received.length, 1)
    assert.deepEqual(stub.received[0]?.fields, { brand_id: '86', transport: 'relay', smtp_password: 'pw', api_key: KEY })
  })

  const cases: [string, number, string?][] = [
    ['No brand with that ID in this account', Exit.API_ERROR, 'brand_not_found'],
    ['transport must be relay or ses', Exit.USAGE, 'invalid_transport'],
    ['smtp_password not passed, and the brand has none stored for this username', Exit.USAGE, 'smtp_password_missing'],
    ['Invalid smtp_username', Exit.USAGE, 'invalid_smtp_username'],
    ['Invalid smtp_host', Exit.USAGE, 'invalid_smtp_host'],
    ['Unable to update brand', Exit.API_ERROR, 'operation_failed'],
    ['A campaign of this brand is sending. Wait for it to finish, or pass force=1', Exit.API_ERROR, 'campaign_sending'],
    [
      'The relay refused the login brand86: 535 5.7.8 Error: authentication failed for brand86',
      Exit.API_ERROR,
      'relay_login_refused',
    ],
    [
      'The relay refused news@acme.com for brand86: 553 <news@acme.com>: Sender address rejected: not owned by user brand86@mta1.skry.be',
      Exit.API_ERROR,
      'relay_sender_refused',
    ],
    ['Could not connect to mta1.skry.be:587: Connection refused 111', Exit.API_ERROR, 'relay_unreachable'],
    ['TLS failed with mta1.skry.be: certificate verify failed', Exit.API_ERROR, 'relay_tls_failed'],
    [
      "RELAY_ENVIRONMENT is not set on this server, so the relay login can't be chosen. Set it to production, staging, ...",
      Exit.API_ERROR,
      'relay_environment_unset',
    ],
    [
      'smtp_username does not match this environment: the relay login for this brand here is brand86-staging',
      Exit.USAGE,
      'relay_login_mismatch',
    ],
  ]
  for (const [body, exitCode, code] of cases) {
    it(`maps "${body}"`, async () => {
      const stub = await startStub([{ body }])
      const client = new SkrybeClient({ url: stub.url, apiKey: KEY })

      await assert.rejects(brandTransport(client, 86, { transport: 'ses' }), (err: unknown) => {
        assert.ok(err instanceof CliError)
        assert.equal(err.exitCode, exitCode)
        if (code) {
          assert.ok(err instanceof ApiError)
          assert.equal(err.code, code)
        }
        return true
      })
    })
  }
})

describe('skrybe brands transport (CLI)', () => {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
  const env = (url: string) => ({
    ...process.env,
    SKRYBE_API_URL: url,
    SKRYBE_API_KEY: KEY,
    SKRYBE_CONFIG: join(mkdtempSync(join(tmpdir(), 'skrybe-')), 'config.json'),
  })
  const run = async (url: string, ...args: string[]) =>
    promisify(execFile)(process.execPath, ['--import', 'tsx', entry, ...args], { encoding: 'utf8', env: env(url) })

  // execFile can't write to the child's stdin; spawn can.
  const runWithStdin = (url: string, input: string, ...args: string[]) =>
    new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = spawn(process.execPath, ['--import', 'tsx', entry, ...args], { env: env(url) })
      let stdout = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.on('close', (code) => resolve({ code, stdout }))
      child.stdin.end(input)
    })

  it('shows the current transport without changing it', async () => {
    const stub = await startStub([{ body: JSON.stringify(state()) }])

    const { stdout } = await run(stub.url, 'brands', 'transport', '86', '--json')

    assert.equal(JSON.parse(stdout).transport, 'relay')
    assert.equal(stub.received[0]?.fields.transport, undefined)
  })

  it('takes the relay password from stdin, never argv', async () => {
    const stub = await startStub([{ body: JSON.stringify(state()) }])

    const { code } = await runWithStdin(stub.url, 's3cret+/x\n', 'brands', 'transport', '86', 'relay', '--password-stdin')

    assert.equal(code, 0)
    assert.equal(stub.received[0]?.fields.smtp_password, 's3cret+/x')
    assert.equal(stub.received[0]?.fields.transport, 'relay')
  })

  it('sends verify=0 for --no-verify and force=1 for --force, and nothing by default', async () => {
    const stub = await startStub([{ body: JSON.stringify(state()) }, { body: JSON.stringify(state()) }])

    const { code } = await runWithStdin(stub.url, 'pw', 'brands', 'transport', '86', 'relay', '--password-stdin', '--no-verify', '--force')
    assert.equal(code, 0)
    assert.equal(stub.received[0]?.fields.verify, '0')
    assert.equal(stub.received[0]?.fields.force, '1')

    await run(stub.url, 'brands', 'transport', '86', 'ses')
    assert.equal(stub.received[1]?.fields.verify, undefined)
    assert.equal(stub.received[1]?.fields.force, undefined)
  })

  it("says a brand's key is the wrong kind, not just invalid", async () => {
    const stub = await startStub([{ body: 'Invalid API key' }])

    await assert.rejects(run(stub.url, 'brands', 'transport', '86', '--json'), (err: { stderr?: string; code?: number }) => {
      assert.equal(err.code, Exit.AUTH)
      assert.match(err.stderr ?? '', /main account's API key/)
      return true
    })
  })

  it('switches back to SES', async () => {
    const stub = await startStub([{ body: JSON.stringify(state({ transport: 'ses', smtp_host: '' })) }])

    const { stdout } = await run(stub.url, 'brands', 'transport', '86', 'ses', '--json')

    assert.equal(JSON.parse(stdout).transport, 'ses')
    assert.equal(stub.received[0]?.fields.transport, 'ses')
  })

  const refused: [string, string[]][] = [
    ['an unknown transport', ['brands', 'transport', '86', 'smtp']],
    ['a non-numeric brand id', ['brands', 'transport', 'cafe', 'ses']],
    ['relay options with ses', ['brands', 'transport', '86', 'ses', '--host', 'x.example.com']],
    ['--no-verify with ses', ['brands', 'transport', '86', 'ses', '--no-verify']],
    ['--force without a switch', ['brands', 'transport', '86', '--force']],
  ]
  for (const [what, args] of refused) {
    it(`refuses ${what} before any request`, async () => {
      const stub = await startStub([{ body: JSON.stringify(state()) }])

      await assert.rejects(run(stub.url, ...args))
      assert.equal(stub.received.length, 0)
    })
  }
})
