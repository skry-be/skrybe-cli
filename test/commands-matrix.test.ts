import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { Exit } from '../src/api/errors.js'
import { startStub, type Received } from './helpers.js'

const KEY = 'test-key'
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))

function makeRunner(url: string = 'http://127.0.0.1:9999') {
  const tmpDir = mkdtempSync(join(tmpdir(), 'skrybe-test-'))
  const configPath = join(tmpDir, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      currentProfile: 'default',
      profiles: {
        default: {
          url,
          apiKey: KEY,
        },
      },
    }),
  )

  const run = async (...args: string[]) =>
    promisify(execFile)(process.execPath, ['--import', 'tsx', entry, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SKRYBE_CONFIG: configPath,
        SKRYBE_API_URL: url,
        SKRYBE_API_KEY: KEY,
      },
    })

  return { run, tmpDir }
}

describe('CLI Commands & Options Matrix', () => {
  describe('Global & Information Commands', () => {
    it('--help outputs usage and all top-level command groups', async () => {
      const { run } = makeRunner()
      const { stdout } = await run('--help')
      assert.match(stdout, /Usage: skrybe/)
      assert.match(stdout, /auth/)
      assert.match(stdout, /brands/)
      assert.match(stdout, /campaigns/)
      assert.match(stdout, /completion/)
      assert.match(stdout, /emails/)
      assert.match(stdout, /lists/)
      assert.match(stdout, /stats/)
      assert.match(stdout, /subscribers/)
    })

    it('--version outputs current package version', async () => {
      const { run } = makeRunner()
      const { stdout } = await run('--version')
      assert.match(stdout, /0\.1\.0/)
    })

    it('completion bash/zsh/fish output shell scripts', async () => {
      const { run } = makeRunner()
      const bash = await run('completion', 'bash')
      assert.match(bash.stdout, /_skrybe/)

      const zsh = await run('completion', 'zsh')
      assert.match(zsh.stdout, /compdef _skrybe skrybe/)

      const fish = await run('completion', 'fish')
      assert.match(fish.stdout, /complete -c skrybe/)
    })

    it('completion rejects unknown shell with usage error', async () => {
      const { run } = makeRunner()
      await assert.rejects(run('completion', 'powershell'), (err: { code?: number }) => {
        assert.equal(err.code, Exit.USAGE)
        return true
      })
    })
  })

  describe('Auth Commands', () => {
    it('auth whoami shows active profile and brand', async () => {
      const stub = await startStub([{ body: '{"brand1":{"id":"1","name":"Main Brand"}}' }])
      const { run } = makeRunner(stub.url)

      const res = await run('auth', 'whoami')
      assert.match(res.stderr + res.stdout, /Profile\s+default/)
      assert.match(res.stderr + res.stdout, /Main Brand/)
    })

    it('auth whoami --json returns structured JSON', async () => {
      const stub = await startStub([{ body: '{"brand1":{"id":"1","name":"Main Brand"}}' }])
      const { run } = makeRunner(stub.url)

      const { stdout } = await run('auth', 'whoami', '--json')
      const parsed = JSON.parse(stdout)
      assert.equal(parsed.profile, 'default')
      assert.equal(parsed.brands[0].name, 'Main Brand')
    })

    it('auth whoami --output text outputs tab-separated row', async () => {
      const stub = await startStub([{ body: '{"brand1":{"id":"1","name":"Main Brand"}}' }])
      const { run } = makeRunner(stub.url)

      const { stdout } = await run('auth', 'whoami', '--output', 'text')
      assert.match(stdout, /default\thttp:\/\/127\.0\.0\.1:\d+\t1\tMain Brand/)
    })

    it('auth ls lists saved profiles', async () => {
      const { run } = makeRunner()
      const { stdout } = await run('auth', 'ls')
      assert.match(stdout, /PROFILE/)
      assert.match(stdout, /default/)
    })

    it('auth login --no-verify saves profile', async () => {
      const { run, tmpDir } = makeRunner('http://localhost:8080')
      const configPath = join(tmpDir, 'new-config.json')
      const child = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', entry, '--url', 'http://localhost:8080', 'auth', 'login', '--no-verify'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            SKRYBE_CONFIG: configPath,
            SKRYBE_API_KEY: 'my-custom-key',
          },
        },
      )
      assert.match(child.stderr, /Saved profile/)
    })

    it('auth logout removes a saved profile', async () => {
      const { run } = makeRunner()
      const { stderr } = await run('auth', 'logout')
      assert.match(stderr, /Removed profile/)
    })
  })

  describe('Brands Commands', () => {
    it('brands bare command renders brands in table format', async () => {
      const stub = await startStub([{ body: '{"brand1":{"id":"1","name":"Acme Corp"}}' }])
      const { run } = makeRunner(stub.url)

      const { stdout } = await run('brands')
      assert.match(stdout, /ID\s+NAME/)
      assert.match(stdout, /1\s+Acme Corp/)
    })

    it('brands ls --json renders json format', async () => {
      const stub = await startStub([{ body: '{"brand1":{"id":"1","name":"Acme Corp"}}' }])
      const { run } = makeRunner(stub.url)

      const { stdout } = await run('brands', 'ls', '--json')
      const parsed = JSON.parse(stdout)
      assert.deepEqual(parsed, [{ id: '1', name: 'Acme Corp' }])
    })

    it('brands ls --output text renders tab-separated rows', async () => {
      const stub = await startStub([{ body: '{"brand1":{"id":"1","name":"Acme Corp"}}' }])
      const { run } = makeRunner(stub.url)

      const { stdout } = await run('brands', 'ls', '--output', 'text')
      assert.equal(stdout.trim(), '1\tAcme Corp')
    })
  })

  describe('Lists Commands & Options', () => {
    it('lists ls bare / with options: --include-hidden, --counts, --output', async () => {
      const stub = await startStub((req: Received) => {
        if (req.path === '/api/lists/get-lists.php') {
          return { body: '{"list1":{"id":"L1","name":"Newsletter"}}' }
        }
        if (req.path === '/api/subscribers/active-subscriber-count.php') {
          return { body: '150' }
        }
        return { body: '' }
      })
      const { run } = makeRunner(stub.url)

      const bare = await run('lists')
      assert.match(bare.stdout, /L1\s+Newsletter/)

      const counted = await run('lists', 'ls', '--counts')
      assert.match(counted.stdout, /ACTIVE/)
      assert.match(counted.stdout, /150/)

      const json = await run('lists', 'ls', '--json')
      const parsed = JSON.parse(json.stdout)
      assert.equal(parsed[0].id, 'L1')
      assert.equal(parsed[0].name, 'Newsletter')

      const hidden = await run('lists', 'ls', '--include-hidden')
      assert.equal(stub.received.some((r) => r.fields.include_hidden === 'yes'), true)

      const text = await run('lists', 'ls', '--output', 'text')
      assert.equal(text.stdout.trim(), 'L1\tNewsletter')
    })

    it('lists count <list-id> and --json option', async () => {
      const stub = await startStub([{ body: '42' }])
      const { run } = makeRunner(stub.url)

      const scalar = await run('lists', 'count', 'L1')
      assert.equal(scalar.stdout.trim(), '42')

      const json = await run('lists', 'count', 'L1', '--json')
      assert.deepEqual(JSON.parse(json.stdout), { list_id: 'L1', active_subscribers: 42 })
    })

    it('lists get <list-id> shows list detail and breakdown', async () => {
      const detail = {
        id: 'L1',
        name: 'Newsletter',
        opt_in: 'single',
        subscribers: { active: 10, unconfirmed: 0, unsubscribed: 2, bounced: 1, complained: 0 },
      }
      const stub = await startStub([{ body: JSON.stringify(detail) }])
      const { run } = makeRunner(stub.url)

      const { stdout } = await run('lists', 'get', 'L1')
      assert.match(stdout, /Name\s+Newsletter/)
      assert.match(stdout, /Opt-in\s+single/)
      assert.match(stdout, /Active\s+10/)

      const json = await run('lists', 'get', 'L1', '--json')
      assert.deepEqual(JSON.parse(json.stdout), detail)
    })

    it('lists create <name> with --opt-in single|double', async () => {
      const stub = await startStub((req: Received) => ({
        body: JSON.stringify({
          id: 'NEW_ID',
          name: req.fields.name,
          opt_in: req.fields.opt_in,
          subscribers: { active: 0, unconfirmed: 0, unsubscribed: 0, bounced: 0, complained: 0 },
        }),
      }))
      const { run } = makeRunner(stub.url)

      const res = await run('lists', 'create', 'VIP Members', '--opt-in', 'double')
      assert.match(res.stderr, /Created list "VIP Members" \(double opt-in\)/)
      assert.equal(res.stdout.trim(), 'NEW_ID')
    })

    it('lists update <list-id> with --name and --opt-in', async () => {
      const stub = await startStub((req: Received) => ({
        body: JSON.stringify({
          id: req.fields.list_id,
          name: req.fields.name,
          opt_in: req.fields.opt_in,
          subscribers: { active: 10, unconfirmed: 0, unsubscribed: 0, bounced: 0, complained: 0 },
        }),
      }))
      const { run } = makeRunner(stub.url)

      const res = await run('lists', 'update', 'L1', '--name', 'Renamed VIP', '--opt-in', 'single')
      assert.match(res.stderr, /Updated list "Renamed VIP" \(single opt-in\)/)
    })

    it('lists delete <list-id> with --yes', async () => {
      const stub = await startStub([{ body: '{"id":"L1"}' }])
      const { run } = makeRunner(stub.url)

      const res = await run('lists', 'delete', 'L1', '--yes')
      assert.match(res.stderr, /Deleted list L1\./)
    })

    it('lists import <list-id> <path> with --silent and --gdpr', async () => {
      const stub = await startStub([{ body: '1' }])
      const { run, tmpDir } = makeRunner(stub.url)
      const csvPath = join(tmpDir, 'contacts.csv')
      writeFileSync(csvPath, 'email,name\nalice@example.com,Alice\n')

      const res = await run('lists', 'import', 'L1', csvPath, '--silent', '--gdpr')
      assert.match(res.stderr, /Import completed for list/)
      assert.match(res.stderr, /Added:\s+1/)
      assert.equal(stub.received[0]?.fields.silent, 'true')
      assert.equal(stub.received[0]?.fields.gdpr, 'true')
    })

    it('lists add-to-campaign <list-id> <campaign-id> with --allow-empty', async () => {
      const stub = await startStub((req: Received) => {
        if (req.path === '/api/campaigns/get.php') {
          return {
            body: JSON.stringify({
              id: 10,
              title: 'Promo',
              subject: 'Sale',
              status: 'draft',
              lists: 'L1',
              to_send: 50,
              recipients: 50,
            }),
          }
        }
        return {
          body: JSON.stringify({
            status: true,
            message: 'Campaign updated',
            campaign: { id: 10, to_send: 100, recipients: 100, lists: 'L1,L2' },
          }),
        }
      })
      const { run } = makeRunner(stub.url)

      const res = await run('lists', 'add-to-campaign', 'L2', '10', '--allow-empty')
      assert.match(res.stderr, /Attached list\(s\) to campaign 10/)
      assert.match(res.stderr, /100 total recipients/)
    })
  })

  describe('Subscribers Commands & Options', () => {
    it('subscribers ls with --status, --page, --limit, --all, --output', async () => {
      const stub = await startStub((req: Received) => ({
        body: JSON.stringify({
          list_id: req.fields.list_id,
          status: req.fields.status ?? null,
          page: Number(req.fields.page ?? 1),
          limit: Number(req.fields.limit ?? 100),
          total: 1,
          subscribers: [
            {
              email: 'john@example.com',
              name: 'John Doe',
              status: 'active',
              joined_at: 1700000000,
              custom_fields: {},
            },
          ],
        }),
      }))
      const { run } = makeRunner(stub.url)

      const table = await run('subscribers', 'ls', '--list', 'L1', '--status', 'active', '--page', '1', '--limit', '20')
      assert.match(table.stdout, /john@example\.com\s+John Doe\s+active/)

      const json = await run('subscribers', 'ls', '--list', 'L1', '--json')
      const parsed = JSON.parse(json.stdout)
      assert.equal(parsed[0].email, 'john@example.com')

      const text = await run('subscribers', 'ls', '--list', 'L1', '--output', 'text')
      assert.match(text.stdout, /john@example\.com\tJohn Doe\tactive/)
    })

    it('subscribers add with --name, --country, --ip-address, --referrer, --gdpr, --silent, --field', async () => {
      const stub = await startStub([{ body: '1' }])
      const { run } = makeRunner(stub.url)

      const res = await run(
        'subscribers',
        'add',
        'ada@example.com',
        '--list',
        'L1',
        '--name',
        'Ada Lovelace',
        '--country',
        'GB',
        '--ip-address',
        '127.0.0.1',
        '--referrer',
        'https://example.com',
        '--gdpr',
        '--silent',
        '--field',
        'Role=Engineer',
      )
      assert.match(res.stderr, /ada@example\.com subscribed\./)
      const sent = stub.received[0]?.fields
      assert.equal(sent?.email, 'ada@example.com')
      assert.equal(sent?.name, 'Ada Lovelace')
      assert.equal(sent?.country, 'GB')
      assert.equal(sent?.ipaddress, '127.0.0.1')
      assert.equal(sent?.referrer, 'https://example.com')
      assert.equal(sent?.gdpr, 'true')
      assert.equal(sent?.silent, 'true')
      assert.equal(sent?.Role, 'Engineer')
    })

    it('subscribers unsubscribe and delete', async () => {
      const stub = await startStub([{ body: '1' }, { body: '1' }])
      const { run } = makeRunner(stub.url)

      const unsub = await run('subscribers', 'unsubscribe', 'ada@example.com', '--list', 'L1')
      assert.match(unsub.stderr, /ada@example\.com unsubscribed\./)

      const del = await run('subscribers', 'delete', 'ada@example.com', '--list', 'L1')
      assert.match(del.stderr, /ada@example\.com deleted\./)
    })

    it('subscribers status with scalar and --json', async () => {
      const stub = await startStub([{ body: 'Subscribed' }, { body: 'Subscribed' }])
      const { run } = makeRunner(stub.url)

      const status = await run('subscribers', 'status', 'ada@example.com', '--list', 'L1')
      assert.equal(status.stdout.trim(), 'Subscribed')

      const json = await run('subscribers', 'status', 'ada@example.com', '--list', 'L1', '--json')
      assert.deepEqual(JSON.parse(json.stdout), { email: 'ada@example.com', list_id: 'L1', status: 'Subscribed' })
    })

    it('subscribers import from xlsx/csv with --json', async () => {
      const stub = await startStub([{ body: '1' }])
      const { run, tmpDir } = makeRunner(stub.url)
      const csvPath = join(tmpDir, 'users.csv')
      writeFileSync(csvPath, 'email,name\nbob@example.com,Bob\n')

      const res = await run('subscribers', 'import', csvPath, '--list', 'L1', '--json')
      const parsed = JSON.parse(res.stdout)
      assert.equal(parsed.added, 1)
      assert.equal(parsed.total_processed, 1)
      assert.equal(parsed.failed, 0)
    })
  })

  describe('Campaigns Commands & Options', () => {
    it('campaigns ls with --status, --page, --limit, --all, --output', async () => {
      const stub = await startStub((req: Received) => ({
        body: JSON.stringify({
          campaign1: {
            id: 101,
            title: 'Spring Promo',
            subject: 'Spring Deals',
            status: 'draft',
            from_name: 'Shop',
            from_email: 'shop@example.com',
            reply_to: 'shop@example.com',
            recipients: 200,
            to_send: 200,
            sent_at: 1700000000,
            scheduled_at: null,
            timezone: null,
            source: 'ui',
          },
        }),
      }))
      const { run } = makeRunner(stub.url)

      const table = await run('campaigns', 'ls', '--status', 'draft', '--page', '1', '--limit', '10')
      assert.match(table.stdout, /Spring Promo/)

      const json = await run('campaigns', 'ls', '--json')
      const parsed = JSON.parse(json.stdout)
      assert.equal(parsed[0].id, 101)

      const text = await run('campaigns', 'ls', '--output', 'text')
      assert.match(text.stdout, /101\tdraft/)
    })

    it('campaigns get <id> with --content and --json', async () => {
      const campaign = {
        id: 101,
        title: 'Spring Promo',
        subject: 'Spring Deals',
        status: 'draft',
        from_name: 'Shop',
        from_email: 'shop@example.com',
        reply_to: 'shop@example.com',
        recipients: 200,
        to_send: 200,
        sent_at: 1700000000,
        scheduled_at: null,
        timezone: null,
        source: 'ui',
        preheader: '',
        query_string: '',
        track_opens: 1,
        track_clicks: 1,
        list_ids: ['L1'],
        exclude_list_ids: [],
        segment_ids: [],
        exclude_segment_ids: [],
        web_version: 'https://example.com/w/101',
        html_text: '<p>Spring discounts</p>',
        plain_text: 'Spring discounts',
      }
      const stub = await startStub([{ body: JSON.stringify(campaign) }, { body: JSON.stringify(campaign) }])
      const { run } = makeRunner(stub.url)

      const normal = await run('campaigns', 'get', '101', '--content')
      assert.match(normal.stdout, /Spring discounts/)

      const json = await run('campaigns', 'get', '101', '--json')
      assert.deepEqual(JSON.parse(json.stdout), campaign)
    })

    it('campaigns stats <id> and --json', async () => {
      const stats = {
        id: 101,
        status: 'sent',
        recipients: 200,
        opens: { total: 80, unique: 75, rate: 40 },
        clicks: { total: 30, unique: 28, rate: 15 },
        bounces: { hard: 2, soft: 1 },
        unsubscribes: 2,
        complaints: 0,
        links: [{ url: 'https://example.com', clicks: 30, unique_clicks: 28 }],
      }
      const stub = await startStub([{ body: JSON.stringify(stats) }, { body: JSON.stringify(stats) }])
      const { run } = makeRunner(stub.url)

      const table = await run('campaigns', 'stats', '101')
      assert.match(table.stdout, /Recipients\s+200/)
      assert.match(table.stdout, /Opens\s+75 unique \(40%\), 80 total/)

      const json = await run('campaigns', 'stats', '101', '--json')
      assert.deepEqual(JSON.parse(json.stdout), stats)
    })

    it('campaigns create with all optional and tracking flags', async () => {
      const stub = await startStub((req: Received) => {
        assert.equal(req.fields.title, 'Spring Launch')
        assert.equal(req.fields.subject, 'Now Live')
        assert.equal(req.fields.from_name, 'Founder')
        assert.equal(req.fields.from_email, 'founder@example.com')
        assert.equal(req.fields.reply_to, 'reply@example.com')
        assert.equal(req.fields.html_text, '<h1>Live!</h1>')
        assert.equal(req.fields.plain_text, 'Live!')
        assert.equal(req.fields.list_ids, 'L1')
        assert.equal(req.fields.track_opens, '1')
        assert.equal(req.fields.track_clicks, '1')
        assert.equal(req.fields.query_string, 'utm_source=skrybe')
        return { body: '{"status":"Campaign created", "campaign_id":"202"}' }
      })
      const { run } = makeRunner(stub.url)

      const res = await run(
        'campaigns',
        'create',
        '--title',
        'Spring Launch',
        '--subject',
        'Now Live',
        '--from-name',
        'Founder',
        '--from-email',
        'founder@example.com',
        '--reply-to',
        'reply@example.com',
        '--html-text',
        '<h1>Live!</h1>',
        '--plain-text',
        'Live!',
        '--list',
        'L1',
        '--track-opens',
        '1',
        '--track-clicks',
        '1',
        '--query-string',
        'utm_source=skrybe',
      )
      assert.match(res.stderr, /Campaign created \(id 202\)/)
    })

    it('campaigns edit <id> with --lists and --allow-empty', async () => {
      const stub = await startStub((req: Received) => {
        assert.equal(req.fields.campaign_id, '101')
        assert.equal(req.fields.list_ids, 'L2,L3')
        assert.equal(req.fields.allow_empty, '1')
        return {
          body: JSON.stringify({
            status: true,
            message: 'Campaign updated',
            campaign: { id: 101, to_send: 300, recipients: 300, lists: 'L2,L3' },
          }),
        }
      })
      const { run } = makeRunner(stub.url)

      const res = await run('campaigns', 'edit', '101', '--lists', 'L2,L3', '--allow-empty')
      assert.match(res.stderr, /Campaign 101 updated: target lists set to \[L2,L3\]/)
      assert.match(res.stderr, /300 total recipients/)
    })

    it('campaigns add-list <id> <lists>', async () => {
      const stub = await startStub((req: Received) => {
        if (req.path === '/api/campaigns/get.php') {
          return {
            body: JSON.stringify({
              id: 101,
              title: 'Spring Promo',
              subject: 'Spring Deals',
              status: 'draft',
              lists: 'L1',
              to_send: 100,
              recipients: 100,
            }),
          }
        }
        return {
          body: JSON.stringify({
            status: true,
            message: 'Campaign updated',
            campaign: { id: 101, to_send: 250, recipients: 250, lists: 'L1,L2' },
          }),
        }
      })
      const { run } = makeRunner(stub.url)

      const res = await run('campaigns', 'add-list', '101', 'L2')
      assert.match(res.stderr, /Attached list\(s\) to campaign 101: target lists now \[L1,L2\]/)
      assert.match(res.stderr, /250 total recipients/)
    })

    it('campaigns test <id> --to <email>', async () => {
      const stub = await startStub((req: Received) => {
        assert.equal(req.fields.campaign_id, '101')
        assert.equal(req.fields.emails, 'qa@example.com')
        return {
          body: JSON.stringify({
            campaign_id: 101,
            results: [{ email: 'qa@example.com', ok: true, error: null }],
          }),
        }
      })
      const { run } = makeRunner(stub.url)

      const res = await run('campaigns', 'test', '101', '--to', 'qa@example.com')
      assert.match(res.stderr, /Test of campaign 101 sent to qa@example\.com\./)
    })

    it('campaigns send <id> with --dry-run and --yes', async () => {
      const stub = await startStub((req: Received) => {
        if (req.fields.dry_run === '1') {
          return { body: JSON.stringify({ status: 'dry_run', campaign_id: 101, recipients: 50 }) }
        }
        return { body: JSON.stringify({ status: 'sending', campaign_id: 101, recipients: 50 }) }
      })
      const { run } = makeRunner(stub.url)

      const dry = await run('campaigns', 'send', '101', '--list', 'L1', '--dry-run')
      assert.match(dry.stderr, /Campaign 101 would go to 50 recipients\. Nothing was sent\./)

      const live = await run('campaigns', 'send', '101', '--list', 'L1', '--yes')
      assert.match(live.stderr, /Campaign 101 is sending to 50 recipients\./)
    })

    it('campaigns schedule <id> --at ... --dry-run and unschedule', async () => {
      const stub = await startStub((req: Received) => {
        if (req.path === '/api/campaigns/schedule.php') {
          return {
            body: JSON.stringify({
              status: 'dry_run',
              campaign_id: 101,
              recipients: 50,
              scheduled_at: 1813000000,
              timezone: 'UTC',
            }),
          }
        }
        return { body: JSON.stringify({ status: 'draft', campaign_id: 101 }) }
      })
      const { run } = makeRunner(stub.url)

      const sched = await run('campaigns', 'schedule', '101', '--at', 'June 15, 2027 6:05pm', '--list', 'L1', '--dry-run')
      assert.match(sched.stderr, /Campaign 101 would be scheduled for/)

      const unsched = await run('campaigns', 'unschedule', '101')
      assert.match(unsched.stderr, /Campaign 101 is a draft again\./)
    })

    it('campaigns stop and resume stubs explain blocked operation and exit with USAGE code', async () => {
      const { run } = makeRunner()
      await assert.rejects(run('campaigns', 'stop', '101'), (err: { code?: number; stderr?: string }) => {
        assert.equal(err.code, Exit.USAGE)
        assert.match(err.stderr ?? '', /`skrybe campaigns stop` is not available yet/)
        return true
      })

      await assert.rejects(run('campaigns', 'resume', '101'), (err: { code?: number; stderr?: string }) => {
        assert.equal(err.code, Exit.USAGE)
        assert.match(err.stderr ?? '', /`skrybe campaigns resume` is not available yet/)
        return true
      })
    })
  })

  describe('Emails Commands & Options', () => {
    it('emails send with all required options', async () => {
      const stub = await startStub((req: Received) => {
        assert.equal(req.path, '/api/emails/send.php')
        assert.equal(req.fields.from_name, 'Support')
        assert.equal(req.fields.from_email, 'support@example.com')
        assert.equal(req.fields.reply_to, 'support@example.com')
        assert.equal(req.fields.subject, 'Urgent Notice')
        assert.equal(req.fields.html_text, '<p>Important</p>')
        assert.equal(req.fields.to, JSON.stringify(['client@example.com']))
        return {
          body: JSON.stringify({ ok: true, message: 'Email sent.', data: { campaign_id: '555' } }),
        }
      })
      const { run } = makeRunner(stub.url)

      const res = await run(
        'emails',
        'send',
        '--from-name',
        'Support',
        '--from-email',
        'support@example.com',
        '--reply-to',
        'support@example.com',
        '--to',
        'client@example.com',
        '--subject',
        'Urgent Notice',
        '--html-text',
        '<p>Important</p>',
      )
      assert.match(res.stderr, /Email sent\./)
    })

    it('emails send-transactional with options', async () => {
      const stub = await startStub((req: Received) => {
        assert.equal(req.path, '/api/emails/send-transactional.php')
        assert.equal(req.fields.to_email, 'client@example.com')
        assert.equal(req.fields.subject, 'Invoice 1234')
        assert.equal(req.fields.html_body, '<p>Receipt</p>')
        return {
          body: JSON.stringify({ status: 'sent', message: 'Delivered', message_id: 'msg-999' }),
        }
      })
      const { run } = makeRunner(stub.url)

      const res = await run(
        'emails',
        'send-transactional',
        '--to',
        'client@example.com',
        '--subject',
        'Invoice 1234',
        '--html-body',
        '<p>Receipt</p>',
      )
      assert.match(res.stderr, /Delivered/)
    })
  })

  describe('Stats Commands & Options', () => {
    it('stats emails-sent renders total emails sent', async () => {
      const stub = await startStub([{ body: JSON.stringify({ total_emails_sent: 125000 }) }])
      const { run } = makeRunner(stub.url)

      const scalar = await run('stats', 'emails-sent')
      assert.equal(scalar.stdout.trim(), '125,000')

      const json = await run('stats', 'emails-sent', '--json')
      assert.deepEqual(JSON.parse(json.stdout), { total_emails_sent: 125000 })
    })
  })
})
