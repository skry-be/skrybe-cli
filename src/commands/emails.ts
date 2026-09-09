import { Command } from 'commander'

import { UsageError } from '../api/errors.js'
import { sendEmail, sendTransactional } from '../api/resources/emails.js'
import { resolveArg, resolveOptionalArg } from '../input.js'
import { renderAction, resolveFormat } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

interface SendOptions {
  fromName: string
  fromEmail: string
  replyTo: string
  subject: string
  htmlText: string
  plainText?: string
  to: string[]
  list?: string[]
  recipientVariables?: string
  queryString?: string
  trackOpens?: string
  trackClicks?: string
  schedule?: string
  timezone?: string
}

interface TransactionalOptions {
  to: string
  subject: string
  htmlBody?: string
  plainBody?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
}

const collect = (value: string, previous: string[]): string[] => [...previous, value]

const tracking = (value: string | undefined): number | undefined =>
  value === undefined ? undefined : Number(value)

/**
 * Parsed here rather than passed through, so a malformed file is a usage error
 * naming the flag instead of a 400 from the far end.
 */
function parseRecipientVariables(
  raw: string | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (raw === undefined) return undefined
  const text = resolveArg(raw, '--recipient-variables')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new UsageError(
      `--recipient-variables is not valid JSON: ${(err as Error).message}`,
      'Expected {"user@example.com": {"first": "Ada"}}',
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError(
      '--recipient-variables must be a JSON object keyed by email address.',
      'Expected {"user@example.com": {"first": "Ada"}}',
    )
  }
  return parsed as Record<string, Record<string, unknown>>
}

export function emailsCommand(getGlobals: () => GlobalOptions): Command {
  const emails = new Command('emails').description('Send email')

  emails
    .command('send')
    .description('Send or schedule an email to addresses or lists')
    .requiredOption('--subject <subject>', 'Subject, which also becomes the campaign title')
    .requiredOption('--from-name <name>', "The 'From' name")
    .requiredOption('--from-email <email>', "The 'From' address")
    .requiredOption('--reply-to <email>', "The 'Reply to' address")
    .requiredOption('--html-text <html|file://path>', 'HTML body, or file:// a path to it')
    .option('--plain-text <text|file://path>', 'Plain text body, or file:// a path to it')
    .option('--to <email>', 'Recipient. Repeatable, up to 250.', collect, [])
    .option('--list <list-id>', 'Send to a list instead. Repeatable.', collect, [])
    .option(
      '--recipient-variables <json|file://path>',
      'Per-recipient values, used in the body as [recipient.first]',
    )
    .option('--query-string <query>', 'Appended to links, e.g. Google Analytics tags')
    .option('--track-opens <0|1|2>', '0 off, 1 on, 2 anonymous')
    .option('--track-clicks <0|1|2>', '0 off, 1 on, 2 anonymous')
    .option('--schedule <date-time>', 'e.g. "June 15, 2027 6:05pm" — minutes in steps of 5')
    .option('--timezone <tz>', 'e.g. America/New_York. Defaults to the brand timezone')
    .action(async (options: SendOptions) => {
      const globals = getGlobals()
      const result = await sendEmail(clientFrom(globals), {
        fromName: options.fromName,
        fromEmail: options.fromEmail,
        replyTo: options.replyTo,
        subject: options.subject,
        htmlText: resolveArg(options.htmlText, '--html-text'),
        plainText: resolveOptionalArg(options.plainText, '--plain-text'),
        to: options.to,
        listIds: options.list,
        recipientVariables: parseRecipientVariables(options.recipientVariables),
        queryString: options.queryString,
        trackOpens: tracking(options.trackOpens),
        trackClicks: tracking(options.trackClicks),
        scheduleDateTime: options.schedule,
        scheduleTimezone: options.timezone,
      })

      renderAction(
        { message: result.message, campaign_id: result.campaignId ?? null },
        result.campaignId ? `${result.message} (id ${result.campaignId}).` : `${result.message}.`,
        resolveFormat(globals),
      )
    })

  emails
    .command('send-transactional')
    .description('Send one transactional email immediately, bypassing the queue')
    .requiredOption('--to <email>', 'Recipient address')
    .requiredOption('--subject <subject>', 'Subject line')
    .option('--html-body <html|file://path>', 'HTML body, or file:// a path to it')
    .option('--plain-body <text|file://path>', 'Plain text body, or file:// a path to it')
    .option('--from-name <name>', "Override the brand's 'From' name")
    .option('--from-email <email>', "Override the brand's 'From' address")
    .option('--reply-to <email>', "Override the brand's 'Reply to' address")
    .action(async (options: TransactionalOptions) => {
      const globals = getGlobals()
      const result = await sendTransactional(clientFrom(globals), {
        toEmail: options.to,
        subject: options.subject,
        htmlBody: resolveOptionalArg(options.htmlBody, '--html-body'),
        plainBody: resolveOptionalArg(options.plainBody, '--plain-body'),
        fromName: options.fromName,
        fromEmail: options.fromEmail,
        replyTo: options.replyTo,
      })

      renderAction(
        { message: result.message, message_id: result.messageId ?? null },
        result.messageId ? `${result.message} (${result.messageId})` : result.message,
        resolveFormat(globals),
      )
    })

  return emails
}
