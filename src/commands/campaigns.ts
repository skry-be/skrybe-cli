import { Command, Option } from 'commander'

import { UsageError } from '../api/errors.js'
import {
  ACTIVITY_TYPES,
  CAMPAIGN_STATUSES,
  MAX_ACTIVITY_PAGE,
  MAX_PAGE_SIZE,
  allCampaignActivity,
  campaignActivity,
  campaignStats,
  createCampaign,
  getCampaign,
  listAllCampaigns,
  listCampaigns,
  type ActivityType,
  type Campaign,
  type CampaignActivity,
  type CampaignStatus,
} from '../api/resources/campaigns.js'
import { resolveArg, resolveOptionalArg } from '../input.js'
import { info, printTable, renderAction, renderCollection, renderRecord, resolveFormat } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

interface CreateOptions {
  fromName: string
  fromEmail: string
  replyTo: string
  title: string
  subject: string
  htmlText: string
  plainText?: string
  list?: string[]
  segment?: string[]
  excludeList?: string[]
  excludeSegment?: string[]
  queryString?: string
  trackOpens?: string
  trackClicks?: string
  send?: boolean
  schedule?: string
  timezone?: string
}

const collect = (value: string, previous: string[]): string[] => [...previous, value]

interface ListOptions {
  status?: CampaignStatus
  page?: string
  limit?: string
  all?: boolean
}

/** Campaign ids are the plain integers the dashboard shows, unlike list ids. */
function campaignId(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw new UsageError(`"${value}" is not a campaign ID.`, 'Run `skrybe campaigns` to see the IDs.')
  }
  return Number(value)
}

function positive(value: string | undefined, flag: string, max?: number): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || (max !== undefined && n > max)) {
    throw new UsageError(`${flag} must be a whole number from 1${max ? ` to ${max}` : ' up'}.`)
  }
  return n
}

/** Unix seconds -> "2026-08-31 10:18" in the local timezone. */
function when(seconds: number | null): string {
  if (seconds === null) return '-'
  const d = new Date(seconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const count = (n: number): string => n.toLocaleString('en-US')

function listOptions(command: Command): Command {
  return command
    .addOption(new Option('--status <status>', 'Only campaigns in this state').choices(CAMPAIGN_STATUSES))
    .option('--page <n>', 'Page to show, newest first (default 1)')
    .option('--limit <n>', `Campaigns per page, up to ${MAX_PAGE_SIZE} (default 10)`)
    .option('--all', 'Fetch every page')
}

async function showCampaigns(getGlobals: () => GlobalOptions, options: ListOptions): Promise<void> {
  const globals = getGlobals()
  const format = resolveFormat(globals)
  const client = clientFrom(globals)

  if (options.all && (options.page !== undefined || options.limit !== undefined)) {
    throw new UsageError('--all fetches every page, so it cannot be combined with --page or --limit.')
  }
  const rows = options.all
    ? await listAllCampaigns(client, { status: options.status })
    : await listCampaigns(client, {
        status: options.status,
        page: positive(options.page, '--page'),
        limit: positive(options.limit, '--limit', MAX_PAGE_SIZE),
      })

  renderCollection<Campaign>(
    rows,
    [
      { header: 'ID', value: (c) => String(c.id), align: 'right' },
      { header: 'STATUS', value: (c) => c.status },
      { header: 'DATE', value: (c) => when(c.status === 'scheduled' ? c.scheduled_at : c.sent_at) },
      { header: 'RECIPIENTS', value: (c) => count(c.recipients), align: 'right' },
      { header: 'TITLE', value: (c) => c.title },
    ],
    format,
    options.status ? `No ${options.status} campaigns.` : 'No campaigns on this page.',
  )
}

/** `--track-opens 2` etc. Commander hands options over as strings. */
const tracking = (value: string | undefined): number | undefined =>
  value === undefined ? undefined : Number(value)

export function campaignsCommand(getGlobals: () => GlobalOptions): Command {
  // `skrybe campaigns` shows them, like `skrybe lists`; sub-verbs still dispatch.
  const campaigns = listOptions(
    new Command('campaigns')
      .description('Campaigns — run bare to show them, newest first')
      // Without this, `skrybe campaigns bogus` would list instead of erroring.
      .allowExcessArguments(false),
  ).action((options: ListOptions) => showCampaigns(getGlobals, options))

  // The parent declares the same options and Commander hands them to it, so
  // `campaigns ls --status sent` reads them through optsWithGlobals().
  listOptions(
    campaigns.command('ls').alias('list').description('Show campaigns for the current brand, newest first'),
  ).action((_options: ListOptions, command: Command) =>
    showCampaigns(getGlobals, command.optsWithGlobals<ListOptions>()),
  )

  campaigns
    .command('get <campaign-id>')
    .description('Show one campaign')
    .option('--content', 'Print the HTML body instead (with --json, include both bodies)')
    .action(async (id: string, options: { content?: boolean }) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const c = await getCampaign(clientFrom(globals), campaignId(id), { includeContent: options.content })

      // Raw, so `skrybe campaigns get 42 --content > email.html` saves the email.
      if (options.content && format !== 'json') {
        process.stdout.write(`${c.html_text || c.plain_text || ''}\n`)
        return
      }

      const lists = (ids: (string | number)[]) => (ids.length ? ids.join(', ') : '-')
      renderRecord(
        c,
        [
          ['ID', String(c.id)],
          ['Title', c.title],
          ['Subject', c.subject],
          ['Status', c.status],
          ['From', `${c.from_name} <${c.from_email}>`],
          ['Reply to', c.reply_to],
          ['Recipients', `${count(c.recipients)} of ${count(c.to_send)}`],
          ['Sent', when(c.sent_at)],
          ...(c.scheduled_at !== null
            ? [['Scheduled', `${when(c.scheduled_at)}${c.timezone ? ` (${c.timezone})` : ''}`] as [string, string]]
            : []),
          ['Lists', lists(c.list_ids)],
          ['Excluded lists', lists(c.exclude_list_ids)],
          ['Segments', lists(c.segment_ids)],
          ['Excluded segments', lists(c.exclude_segment_ids)],
          ['Web version', c.web_version],
        ],
        format,
      )
    })

  campaigns
    .command('stats <campaign-id>')
    .description('Opens, clicks, bounces, complaints and unsubscribes for a campaign')
    .action(async (id: string) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const s = await campaignStats(clientFrom(globals), campaignId(id))

      renderRecord(
        s,
        [
          ['Status', s.status],
          ['Recipients', count(s.recipients)],
          ['Opens', `${count(s.opens.unique)} unique (${s.opens.rate}%), ${count(s.opens.total)} total`],
          ['Clicks', `${count(s.clicks.unique)} unique (${s.clicks.rate}%), ${count(s.clicks.total)} total`],
          ['Bounces', `${count(s.bounces.hard)} hard, ${count(s.bounces.soft)} soft`],
          ['Complaints', count(s.complaints)],
          ['Unsubscribes', count(s.unsubscribes)],
        ],
        format,
      )
      if (format === 'table' && s.links.length > 0) {
        process.stdout.write('\n')
        printTable(s.links, [
          { header: 'CLICKS', value: (l) => count(l.clicks), align: 'right' },
          { header: 'UNIQUE', value: (l) => count(l.unique_clicks), align: 'right' },
          { header: 'LINK', value: (l) => l.url },
        ])
      }
    })

  campaigns
    .command('activity <campaign-id>')
    .description('Who opened, clicked, bounced, complained or unsubscribed')
    .addOption(new Option('--type <type>', 'What to show (default opens)').choices(ACTIVITY_TYPES))
    .option('--page <n>', 'Page to show (default 1)')
    .option('--limit <n>', `Subscribers per page, up to ${MAX_ACTIVITY_PAGE} (default 100)`)
    .option('--all', 'Fetch every page')
    .addHelpText(
      'after',
      '\nBounces, complaints and unsubscribes are attributed to a subscriber\'s latest campaign, as the report does.',
    )
    .action(async (id: string, _options: unknown, command: Command) => {
      // --page, --limit and --all are also declared on `campaigns` itself (for
      // listing campaigns), and Commander hands them to the parent wherever they
      // appear, so read them back through optsWithGlobals(), as `ls` does.
      const options = command.optsWithGlobals<{ type?: ActivityType; page?: string; limit?: string; all?: boolean }>()
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const client = clientFrom(globals)
      const campaign = campaignId(id)
      const type = options.type ?? 'opens'

      if (options.all && (options.page !== undefined || options.limit !== undefined)) {
        throw new UsageError('--all fetches every page, so it cannot be combined with --page or --limit.')
      }
      let rows: CampaignActivity[]
      if (options.all) rows = await allCampaignActivity(client, campaign, type)
      else {
        const page = await campaignActivity(client, campaign, {
          type,
          page: positive(options.page, '--page'),
          limit: positive(options.limit, '--limit', MAX_ACTIVITY_PAGE),
        })
        rows = page.activity
        if (format === 'table' && page.total > rows.length) {
          const first = (page.page - 1) * page.limit
          info(`Showing ${first + 1}-${first + rows.length} of ${count(page.total)}. Use --page, or --all.`)
        }
      }

      const detail =
        type === 'opens'
          ? [
              { header: 'OPENS', value: (a: CampaignActivity) => count(a.opens ?? 0), align: 'right' as const },
              { header: 'COUNTRY', value: (a: CampaignActivity) => a.country ?? '-' },
            ]
          : type === 'clicks'
            ? [
                { header: 'CLICKS', value: (a: CampaignActivity) => count(a.clicks ?? 0), align: 'right' as const },
                { header: 'LINKS', value: (a: CampaignActivity) => (a.links ?? []).join(' ') },
              ]
            : []
      renderCollection<CampaignActivity>(
        rows,
        [{ header: 'EMAIL', value: (a) => a.email }, { header: 'NAME', value: (a) => a.name }, ...detail],
        format,
        `No ${type} for this campaign${options.page ? ' on this page' : ''}.`,
      )
    })

  campaigns
    .command('create')
    .description('Create a campaign, optionally sending or scheduling it')
    .requiredOption('--title <title>', 'Campaign title, shown in the dashboard')
    .requiredOption('--subject <subject>', 'Subject line')
    .requiredOption('--from-name <name>', "The 'From' name")
    .requiredOption('--from-email <email>', "The 'From' address")
    .requiredOption('--reply-to <email>', "The 'Reply to' address")
    .requiredOption('--html-text <html|file://path>', 'HTML body, or file:// a path to it')
    .option('--plain-text <text|file://path>', 'Plain text body, or file:// a path to it')
    .option('--list <list-id>', 'List to send to. Repeatable.', collect, [])
    .option('--segment <segment-id>', 'Segment to send to. Repeatable.', collect, [])
    .option('--exclude-list <list-id>', 'List to exclude. Repeatable.', collect, [])
    .option('--exclude-segment <segment-id>', 'Segment to exclude. Repeatable.', collect, [])
    .option('--query-string <query>', 'Appended to links, e.g. Google Analytics tags')
    .option('--track-opens <0|1|2>', '0 off, 1 on, 2 anonymous')
    .option('--track-clicks <0|1|2>', '0 off, 1 on, 2 anonymous')
    .option('--send', 'Send immediately instead of leaving a draft')
    .option('--schedule <date-time>', 'e.g. "June 15, 2027 6:05pm" — minutes in steps of 5')
    .option('--timezone <tz>', 'e.g. America/New_York. Defaults to the brand timezone')
    .action(async (options: CreateOptions) => {
      const globals = getGlobals()
      const result = await createCampaign(clientFrom(globals), {
        fromName: options.fromName,
        fromEmail: options.fromEmail,
        replyTo: options.replyTo,
        title: options.title,
        subject: options.subject,
        htmlText: resolveArg(options.htmlText, '--html-text'),
        plainText: resolveOptionalArg(options.plainText, '--plain-text'),
        listIds: options.list,
        segmentIds: options.segment,
        excludeListIds: options.excludeList,
        excludeSegmentIds: options.excludeSegment,
        queryString: options.queryString,
        trackOpens: tracking(options.trackOpens),
        trackClicks: tracking(options.trackClicks),
        send: options.send,
        scheduleDateTime: options.schedule,
        scheduleTimezone: options.timezone,
      })

      const what =
        result.outcome === 'sending'
          ? 'Campaign created and now sending'
          : result.outcome === 'scheduled'
            ? 'Campaign scheduled'
            : 'Campaign created'
      renderAction(
        { outcome: result.outcome, campaign_id: result.campaignId ?? null },
        result.campaignId ? `${what} (id ${result.campaignId}).` : `${what}.`,
        resolveFormat(globals),
      )
    })

  return campaigns
}
