import { Command } from 'commander'

import { createCampaign } from '../api/resources/campaigns.js'
import { resolveArg, resolveOptionalArg } from '../input.js'
import { printJson, success } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'
import { notImplemented } from './unimplemented.js'

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

/** `--track-opens 2` etc. Commander hands options over as strings. */
const tracking = (value: string | undefined): number | undefined =>
  value === undefined ? undefined : Number(value)

export function campaignsCommand(getGlobals: () => GlobalOptions): Command {
  // A bare `skrybe campaigns` means "show them", which the API still cannot do,
  // so it explains itself rather than printing a help page of stubs.
  const campaigns = new Command('campaigns')
    .description('Campaigns — create and send; listing is not yet in the API')
    .allowExcessArguments(false)
    .action(() => notImplemented('campaigns', '', 'includes/campaigns/list-campaigns-ajax.php'))

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

      if (globals.json) {
        printJson({ outcome: result.outcome, campaign_id: result.campaignId ?? null })
        return
      }

      const what =
        result.outcome === 'sending'
          ? 'Campaign created and now sending'
          : result.outcome === 'scheduled'
            ? 'Campaign scheduled'
            : 'Campaign created'
      success(result.campaignId ? `${what} (id ${result.campaignId}).` : `${what}.`)
    })

  return campaigns
}
