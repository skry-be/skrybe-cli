import type { SkrybeClient } from '../client.js'
import { UsageError } from '../errors.js'

/** send.php refuses more than this, and says so with a 400. */
export const MAX_RECIPIENTS = 250

export interface SendInput {
  fromName: string
  fromEmail: string
  replyTo: string
  subject: string
  htmlText: string
  plainText?: string
  /** Addresses to send to. Without listIds these are added to a new list. */
  to?: string[]
  /** Per-recipient values, referenced in the body as [recipient.first]. */
  recipientVariables?: Record<string, Record<string, unknown>>
  listIds?: string[]
  queryString?: string
  trackOpens?: number
  trackClicks?: number
  scheduleDateTime?: string
  scheduleTimezone?: string
}

interface SendEnvelope {
  ok?: boolean
  message?: string
  data?: { campaign_id?: string } | null
}

export interface SendResult {
  message: string
  campaignId?: string
}

/**
 * `api/emails/send.php` is one of the three endpoints with a real error
 * envelope and real status codes, so the client's JSON path handles failures
 * and only the success shape needs unpacking here.
 *
 * It creates a campaign behind the scenes; the subject doubles as the campaign
 * title in the dashboard.
 */
export async function sendEmail(client: SkrybeClient, input: SendInput): Promise<SendResult> {
  const to = input.to ?? []
  if (to.length === 0 && (input.listIds ?? []).length === 0) {
    throw new UsageError(
      'Nothing to send to.',
      'Pass --to <email> (repeatable), or --list <list-id>.',
    )
  }
  // Checked here so a 251-address send fails before it is half-transmitted,
  // rather than coming back as a 400 the caller has to interpret.
  if (to.length > MAX_RECIPIENTS) {
    throw new UsageError(
      `${to.length} recipients is more than the ${MAX_RECIPIENTS} this endpoint accepts.`,
      'Split the send, or put the addresses on a list and use --list.',
    )
  }

  const data = await client.requestJson<SendEnvelope>({
    path: 'api/emails/send.php',
    body: {
      from_name: input.fromName,
      from_email: input.fromEmail,
      reply_to: input.replyTo,
      subject: input.subject,
      html_text: input.htmlText,
      plain_text: input.plainText,
      // Both go over the wire as JSON strings inside a form body.
      to: to.length > 0 ? JSON.stringify(to) : undefined,
      'recipient-variables': input.recipientVariables
        ? JSON.stringify(input.recipientVariables)
        : undefined,
      list_ids: input.listIds?.join(','),
      query_string: input.queryString,
      track_opens: input.trackOpens,
      track_clicks: input.trackClicks,
      schedule_date_time: input.scheduleDateTime,
      schedule_timezone: input.scheduleTimezone,
    },
  })

  return {
    message: data.message ?? 'Sent.',
    campaignId: data.data?.campaign_id,
  }
}

export interface TransactionalInput {
  toEmail: string
  subject: string
  htmlBody?: string
  plainBody?: string
  /** Each falls back to the brand's configured value when omitted. */
  fromName?: string
  fromEmail?: string
  replyTo?: string
}

interface TransactionalEnvelope {
  status?: string
  message?: string
  message_id?: string
}

export interface TransactionalResult {
  message: string
  messageId?: string
}

/**
 * `api/emails/send-transactional.php` delivers immediately — nothing is queued
 * or scheduled. It is the one endpoint that reads php://input, so this is the
 * only caller that asks for a JSON body; a form-encoded post gets "Invalid JSON
 * payload." because it overwrites $_POST with the decoded body regardless.
 */
export async function sendTransactional(
  client: SkrybeClient,
  input: TransactionalInput,
): Promise<TransactionalResult> {
  if (!input.htmlBody && !input.plainBody) {
    throw new UsageError(
      'A message body is required.',
      'Pass --html-body, --plain-body, or both.',
    )
  }

  const data = await client.requestJson<TransactionalEnvelope>({
    path: 'api/emails/send-transactional.php',
    encoding: 'json',
    body: {
      to_email: input.toEmail,
      subject: input.subject,
      html_body: input.htmlBody,
      plain_body: input.plainBody,
      from_name: input.fromName,
      from_email: input.fromEmail,
      reply_to: input.replyTo,
    },
  })

  return {
    message: data.message ?? 'Email sent successfully.',
    messageId: data.message_id,
  }
}
