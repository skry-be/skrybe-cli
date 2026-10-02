import { Command, Option } from 'commander'

import { ApiError, Exit, UsageError } from '../api/errors.js'
import {
  ACTIVITY_TYPES,
  CAMPAIGN_STATUSES,
  MAX_ACTIVITY_PAGE,
  MAX_PAGE_SIZE,
  MAX_TEST_EMAILS,
  allCampaignActivity,
  campaignActivity,
  campaignStats,
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  getCampaign,
  listAllCampaigns,
  listCampaigns,
  scheduleCampaign,
  sendCampaign,
  testSendCampaign,
  unscheduleCampaign,
  updateCampaign,
  type ActivityType,
  type Campaign,
  type CampaignActivity,
  type CampaignDetail,
  type ScheduleCampaignResult,
  type CampaignStatus,
} from '../api/resources/campaigns.js'
import { getTemplate } from '../api/resources/templates.js'
import { confirm, resolveArg, resolveOptionalArg } from '../input.js'
import {
  info,
  printJson,
  printTable,
  renderAction,
  renderCollection,
  renderRecord,
  resolveFormat,
  success,
  warn,
  when,
} from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'
import { templateId } from './templates.js'

interface CreateOptions {
  fromName?: string
  fromEmail?: string
  replyTo?: string
  title: string
  subject: string
  htmlText?: string
  template?: string
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

interface SendOptions {
  list: string[]
  segment: string[]
  excludeList: string[]
  excludeSegment: string[]
  dryRun?: boolean
  yes?: boolean
}

interface ScheduleOptions extends SendOptions {
  at: string
  timezone?: string
}

/** The recipient flags, --dry-run and --yes that `send` and `schedule` share. */
function recipientOptions(command: Command, verb: string): Command {
  return command
    .option('--list <list-id>', 'List to send to. Repeatable.', collect, [])
    .option('--segment <segment-id>', 'Segment to send to. Repeatable.', collect, [])
    .option('--exclude-list <list-id>', 'List to exclude. Repeatable.', collect, [])
    .option('--exclude-segment <segment-id>', 'Segment to exclude. Repeatable.', collect, [])
    .option('--dry-run', 'Check everything and count the recipients, but change nothing')
    .option('-y, --yes', `${verb} without asking for confirmation (required when not run interactively)`)
}

function recipientsFrom(options: SendOptions) {
  if (options.list.length === 0 && options.segment.length === 0) {
    throw new UsageError('Nothing to send to.', 'Pass at least one --list or --segment.')
  }
  return {
    listIds: options.list,
    segmentIds: options.segment,
    excludeListIds: options.excludeList,
    excludeSegmentIds: options.excludeSegment,
  }
}

/**
 * Ask before committing to a send. `question` runs a dry run first, so a bad
 * list or an unverified domain fails before anyone is asked. Without a
 * terminal there is no one to ask, so --yes is required instead.
 */
async function confirmed(options: SendOptions, verb: string, question: () => Promise<string>): Promise<boolean> {
  if (options.yes) return true
  if (!process.stdin.isTTY) {
    throw new UsageError(
      `Refusing to ${verb} without confirmation.`,
      `Pass --yes to ${verb} from a script, or --dry-run to check it first.`,
    )
  }
  return confirm(await question())
}

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


const count = (n: number): string => n.toLocaleString('en-US')

/** Unix seconds -> "2027-06-15 18:05 Africa/Lagos", in the campaign's own timezone. */
function whenIn(seconds: number, timeZone: string): string {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(seconds * 1000))
        .map((p) => [p.type, p.value]),
    )
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${timeZone}`
  } catch {
    // A timezone this Node build doesn't know: fall back to local time.
    return when(seconds)
  }
}

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

/** `campaigns get`'s view of a campaign, shared with `update` and `duplicate`. */
function showCampaign(c: CampaignDetail, format: ReturnType<typeof resolveFormat>): void {
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
        ? [['Scheduled', c.timezone ? whenIn(c.scheduled_at, c.timezone) : when(c.scheduled_at)] as [string, string]]
        : []),
      ['Lists', lists(c.list_ids)],
      ['Excluded lists', lists(c.exclude_list_ids)],
      ['Segments', lists(c.segment_ids)],
      ['Excluded segments', lists(c.exclude_segment_ids)],
      ['Web version', c.web_version],
    ],
    format,
  )
}

interface UpdateOptions {
  title?: string
  subject?: string
  preheader?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  htmlText?: string
  plainText?: string
  queryString?: string
  trackOpens?: string
  trackClicks?: string
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

      showCampaign(c, format)
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

  recipientOptions(
    campaigns.command('send <campaign-id>').description('Send a draft campaign now'),
    'Send',
  ).action(async (id: string, options: SendOptions) => {
    const globals = getGlobals()
    const format = resolveFormat(globals)
    const client = clientFrom(globals)
    const campaign = campaignId(id)
    const recipients = recipientsFrom(options)

    if (options.dryRun) {
      const r = await sendCampaign(client, campaign, { ...recipients, dryRun: true })
      renderAction(
        { outcome: r.status, campaign_id: r.campaign_id, recipients: r.recipients },
        `Campaign ${r.campaign_id} would go to ${count(r.recipients)} recipients. Nothing was sent.`,
        format,
      )
      return
    }

    const go = await confirmed(options, 'send', async () => {
      const preview = await sendCampaign(client, campaign, { ...recipients, dryRun: true })
      return `Send campaign ${campaign} to ${count(preview.recipients)} recipients?`
    })
    if (!go) return info('Not sent.')

    const r = await sendCampaign(client, campaign, recipients)
    renderAction(
      { outcome: r.status, campaign_id: r.campaign_id, recipients: r.recipients },
      `Campaign ${r.campaign_id} is sending to ${count(r.recipients)} recipients.`,
      format,
    )
  })

  recipientOptions(
    campaigns
      .command('schedule <campaign-id>')
      .description('Schedule a draft campaign, or move a scheduled one')
      .requiredOption('--at <date-time>', 'When to send, e.g. "2027-06-15 18:05" or "June 15, 2027 6:05pm"')
      .option('--timezone <tz>', 'e.g. Africa/Lagos. Defaults to the account timezone'),
    'Schedule',
  ).action(async (id: string, options: ScheduleOptions) => {
    const globals = getGlobals()
    const format = resolveFormat(globals)
    const client = clientFrom(globals)
    const campaign = campaignId(id)
    const input = { ...recipientsFrom(options), at: options.at, timezone: options.timezone }

    const record = (r: ScheduleCampaignResult) => ({
      outcome: r.status,
      campaign_id: r.campaign_id,
      recipients: r.recipients,
      scheduled_at: r.scheduled_at,
      timezone: r.timezone,
    })

    if (options.dryRun) {
      const r = await scheduleCampaign(client, campaign, { ...input, dryRun: true })
      renderAction(
        record(r),
        `Campaign ${r.campaign_id} would be scheduled for ${whenIn(r.scheduled_at, r.timezone)} to ${count(r.recipients)} recipients. Nothing was changed.`,
        format,
      )
      return
    }

    const go = await confirmed(options, 'schedule', async () => {
      const preview = await scheduleCampaign(client, campaign, { ...input, dryRun: true })
      return `Schedule campaign ${campaign} for ${whenIn(preview.scheduled_at, preview.timezone)} to ${count(preview.recipients)} recipients?`
    })
    if (!go) return info('Not scheduled.')

    const r = await scheduleCampaign(client, campaign, input)
    renderAction(
      record(r),
      `Campaign ${r.campaign_id} is scheduled for ${whenIn(r.scheduled_at, r.timezone)} to ${count(r.recipients)} recipients.`,
      format,
    )
  })

  campaigns
    .command('unschedule <campaign-id>')
    .description('Turn a scheduled campaign back into a draft')
    .action(async (id: string) => {
      const globals = getGlobals()
      const r = await unscheduleCampaign(clientFrom(globals), campaignId(id))
      renderAction(
        { outcome: r.status, campaign_id: r.campaign_id },
        `Campaign ${r.campaign_id} is a draft again.`,
        resolveFormat(globals),
      )
    })

  campaigns
    .command('test <campaign-id>')
    .description(`Send a campaign as a test to up to ${MAX_TEST_EMAILS} addresses`)
    .option('--to <email>', 'Address to send to. Repeatable, or comma-separated.', collect, [])
    .action(async (id: string, options: { to: string[] }) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const campaign = campaignId(id)

      const emails = [...new Set(options.to.flatMap((to) => to.split(',')).map((e) => e.trim()).filter(Boolean))]
      if (emails.length === 0) {
        throw new UsageError('Nothing to send to.', 'Pass at least one --to address.')
      }
      if (emails.length > MAX_TEST_EMAILS) {
        throw new UsageError(`A test send goes to at most ${MAX_TEST_EMAILS} addresses; got ${emails.length}.`)
      }

      const r = await testSendCampaign(clientFrom(globals), campaign, emails)
      const failed = r.results.filter((result) => !result.ok)

      if (format === 'json') printJson(r)
      else if (format === 'text') {
        renderCollection(
          r.results,
          [
            { header: 'EMAIL', value: (x) => x.email },
            { header: 'RESULT', value: (x) => (x.ok ? 'sent' : 'failed') },
            { header: 'ERROR', value: (x) => x.error ?? '' },
          ],
          format,
          '',
        )
      } else {
        for (const result of r.results) {
          if (result.ok) success(`Test of campaign ${r.campaign_id} sent to ${result.email}.`)
          else warn(`Test to ${result.email} failed: ${result.error ?? 'unknown error'}`)
        }
      }

      if (failed.length > 0) {
        throw new ApiError(
          'test_send_failed',
          `${failed.length} of ${r.results.length} test ${r.results.length === 1 ? 'email' : 'emails'} failed.`,
          Exit.API_ERROR,
        )
      }
    })

  campaigns
    .command('update <campaign-id>')
    .description('Edit a draft or scheduled campaign; only the fields given change')
    .option('--title <title>', 'Campaign title, shown in the dashboard')
    .option('--subject <subject>', 'Subject line')
    .option('--preheader <text>', 'Preview text shown after the subject in the inbox')
    .option('--from-name <name>', "The 'From' name")
    .option('--from-email <email>', "The 'From' address")
    .option('--reply-to <email>', "The 'Reply to' address")
    .option('--html-text <html|file://path>', 'HTML body, or file:// a path to it')
    .option('--plain-text <text|file://path>', 'Plain text body, or file:// a path to it')
    .option('--query-string <query>', 'Appended to links, e.g. Google Analytics tags')
    .addOption(new Option('--track-opens <mode>', '0 off, 1 on, 2 anonymous').choices(['0', '1', '2']))
    .addOption(new Option('--track-clicks <mode>', '0 off, 1 on, 2 anonymous').choices(['0', '1', '2']))
    .action(async (id: string, options: UpdateOptions) => {
      const changes = {
        title: options.title,
        subject: options.subject,
        preheader: options.preheader,
        fromName: options.fromName,
        fromEmail: options.fromEmail,
        replyTo: options.replyTo,
        htmlText: resolveOptionalArg(options.htmlText, '--html-text'),
        plainText: resolveOptionalArg(options.plainText, '--plain-text'),
        queryString: options.queryString,
        trackOpens: tracking(options.trackOpens),
        trackClicks: tracking(options.trackClicks),
      }
      if (Object.values(changes).every((v) => v === undefined)) {
        throw new UsageError('Nothing to update.', 'Pass at least one field to change, e.g. --subject.')
      }
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const c = await updateCampaign(clientFrom(globals), campaignId(id), changes)
      if (format === 'table') info(`Updated campaign ${c.id}.`)
      showCampaign(c, format)
    })

  campaigns
    .command('duplicate <campaign-id>')
    .alias('dup')
    .description('Copy a campaign into a new draft')
    .option('--title <title>', "The copy's title. Defaults to the original's")
    .action(async (id: string, options: { title?: string }) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const c = await duplicateCampaign(clientFrom(globals), campaignId(id), options.title)
      // The id is what a script needs next, so it goes to stdout even in table mode.
      if (format === 'table') {
        info(`Copied campaign ${id} to a new draft, "${c.title}".`)
        process.stdout.write(`${c.id}\n`)
      } else showCampaign(c, format)
    })

  campaigns
    .command('delete <campaign-id>')
    .alias('rm')
    .description('Delete a campaign. A sent campaign loses its report')
    .option('-y, --yes', 'Delete without asking for confirmation (required when not run interactively)')
    .action(async (id: string, options: { yes?: boolean }) => {
      const globals = getGlobals()
      const client = clientFrom(globals)
      const campaign = campaignId(id)

      if (!options.yes) {
        if (!process.stdin.isTTY) {
          throw new UsageError('Refusing to delete without confirmation.', 'Pass --yes to delete from a script.')
        }
        // Fetching it first also fails fast on a wrong or foreign id.
        const c = await getCampaign(client, campaign)
        const loses = c.status === 'sent' || c.status === 'paused' ? ' and its report' : ''
        if (!(await confirm(`Delete ${c.status} campaign ${c.id} "${c.title}"${loses}? This cannot be undone.`))) {
          info('Not deleted.')
          return
        }
      }

      const r = await deleteCampaign(client, campaign)
      renderAction({ outcome: 'deleted', campaign_id: r.campaign_id }, `Deleted campaign ${r.campaign_id}.`, resolveFormat(globals))
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
    .option('--template <template-id>', 'Start from a template: its body, and its sender unless given below')
    .option('--from-name <name>', "The 'From' name")
    .option('--from-email <email>', "The 'From' address")
    .option('--reply-to <email>', "The 'Reply to' address")
    .option('--html-text <html|file://path>', 'HTML body, or file:// a path to it')
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
      const client = clientFrom(globals)

      // A template supplies the body, and the sender where the flags don't.
      // Flags always win, so a template can be reused with a different sender.
      const t = options.template
        ? await getTemplate(client, templateId(options.template), { includeContent: true })
        : undefined
      const pick = (flag: string | undefined, fromTemplate: string | undefined) =>
        flag !== undefined ? flag : fromTemplate || undefined
      const sender = {
        fromName: pick(options.fromName, t?.from_name),
        fromEmail: pick(options.fromEmail, t?.from_email),
        replyTo: pick(options.replyTo, t?.reply_to || t?.from_email),
      }
      const htmlText = options.htmlText !== undefined ? resolveArg(options.htmlText, '--html-text') : t?.html_text
      const plainText =
        options.plainText !== undefined ? resolveOptionalArg(options.plainText, '--plain-text') : t?.plain_text || undefined

      const missing = [
        ['--from-name', sender.fromName],
        ['--from-email', sender.fromEmail],
        ['--reply-to', sender.replyTo],
        ['--html-text', htmlText],
      ].filter(([, value]) => !value).map(([flag]) => flag)
      if (missing.length > 0) {
        throw new UsageError(
          `Missing ${missing.join(', ')}.`,
          t ? `Template ${t.id} doesn't set ${missing.length === 1 ? 'it' : 'them'}, so pass it on the command line.` : 'Pass them, or --template to start from a template.',
        )
      }

      const result = await createCampaign(client, {
        fromName: sender.fromName as string,
        fromEmail: sender.fromEmail as string,
        replyTo: sender.replyTo as string,
        title: options.title,
        subject: options.subject,
        htmlText: htmlText as string,
        plainText,
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
