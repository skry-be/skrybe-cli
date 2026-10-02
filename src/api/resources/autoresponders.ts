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
