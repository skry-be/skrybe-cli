import type { SkrybeClient } from '../client.js'
import { parseJsonObject } from '../parse.js'

/**
 * `drip` sends each email a set time after someone joins; `annually` and
 * `on_date` send on a date custom field, every year or once.
 */
export type AutoresponderType = 'drip' | 'annually' | 'on_date' | 'unknown'

export interface Autoresponder {
  id: number
  name: string
  type: AutoresponderType
  /** Encrypted, like the ids `skrybe lists` prints. */
  list_id: string
  /** The date field an `annually` or `on_date` autoresponder sends on. */
  custom_field: string | null
  emails: number
  enabled_emails: number
}

export interface AutoresponderEmail {
  id: number
  autoresponder_id: number
  subject: string
  from_name: string
  from_email: string
  /** As stored: "immediately", "+3 days", "+2 hours"... */
  when: string
  enabled: boolean
  recipients: number
  /** Unix seconds. */
  created_at: number | null
}

export interface AutoresponderWithEmails extends Autoresponder {
  email_list: AutoresponderEmail[]
}

/** Same shape as `CampaignStats`, less the status. */
export interface AutoresponderEmailStats {
  id: number
  autoresponder_id: number
  recipients: number
  opens: { total: number; unique: number; rate: number }
  clicks: { total: number; unique: number; rate: number }
  bounces: { hard: number; soft: number }
  complaints: number
  unsubscribes: number
  links: { url: string; clicks: number; unique_clicks: number }[]
}

/** The brand's autoresponders, or one list's. */
export async function listAutoresponders(
  client: SkrybeClient,
  opts: { listId?: string } = {},
): Promise<Autoresponder[]> {
  const body = await client.requestText({
    path: 'api/autoresponders/get-autoresponders.php',
    body: { list_id: opts.listId },
    retryable: true,
  })
  return parseJsonObject<{ autoresponders: Autoresponder[] }>(body, 'autoresponders').autoresponders
}

export async function getAutoresponder(client: SkrybeClient, autoresponderId: number): Promise<AutoresponderWithEmails> {
  const body = await client.requestText({
    path: 'api/autoresponders/get-autoresponder-emails.php',
    body: { autoresponder_id: autoresponderId },
    retryable: true,
  })
  return parseJsonObject<AutoresponderWithEmails>(body, 'autoresponder')
}

export async function autoresponderEmailStats(client: SkrybeClient, emailId: number): Promise<AutoresponderEmailStats> {
  const body = await client.requestText({
    path: 'api/autoresponders/autoresponder-stats.php',
    body: { email_id: emailId },
    retryable: true,
  })
  return parseJsonObject<AutoresponderEmailStats>(body, 'autoresponder email stats')
}

/** `customField` is the list's Date field an `annually` or `on_date` one sends on. */
export interface NewAutoresponder {
  name: string
  listId: string
  type: Exclude<AutoresponderType, 'unknown'>
  customField?: string
}

/** Starts with no emails. Not retried: a repeat would create a second one. */
export async function createAutoresponder(client: SkrybeClient, input: NewAutoresponder): Promise<Autoresponder> {
  const text = await client.requestText({
    path: 'api/autoresponders/create-autoresponder.php',
    body: { name: input.name, list_id: input.listId, type: input.type, custom_field: input.customField },
  })
  return parseJsonObject<Autoresponder>(text, 'autoresponder')
}

/**
 * `when`: "immediately" or "+3 days" for a drip; "on", "+9 hours" or "-1 days"
 * for a dated one. The sender defaults to the brand's. Created off unless `enabled`.
 */
export interface NewAutoresponderEmail {
  subject: string
  htmlText: string
  plainText?: string
  preheader?: string
  when?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  enabled?: boolean
}

/** Not retried: a repeat would add the email twice. */
export async function createAutoresponderEmail(
  client: SkrybeClient,
  autoresponderId: number,
  input: NewAutoresponderEmail,
): Promise<AutoresponderEmail> {
  const text = await client.requestText({
    path: 'api/autoresponders/create-autoresponder-email.php',
    body: {
      autoresponder_id: autoresponderId,
      subject: input.subject,
      html_text: input.htmlText,
      plain_text: input.plainText,
      preheader: input.preheader,
      when: input.when,
      from_name: input.fromName,
      from_email: input.fromEmail,
      reply_to: input.replyTo,
      enabled: input.enabled ? 1 : undefined,
    },
  })
  return parseJsonObject<AutoresponderEmail>(text, 'autoresponder email')
}
