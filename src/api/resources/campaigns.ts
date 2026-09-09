import type { SkrybeClient } from '../client.js'
import { ApiError, Exit, excerpt } from '../errors.js'

export interface CampaignInput {
  fromName: string
  fromEmail: string
  replyTo: string
  title: string
  subject: string
  htmlText: string
  plainText?: string
  /** Encrypted list ids. At least one list or segment is required. */
  listIds?: string[]
  segmentIds?: string[]
  excludeListIds?: string[]
  excludeSegmentIds?: string[]
  queryString?: string
  /** 0 off, 1 on, 2 anonymous. */
  trackOpens?: number
  trackClicks?: number
  /** Send immediately once created. */
  send?: boolean
  /** e.g. "June 15, 2021 6:05pm" — minutes must be a multiple of 5. */
  scheduleDateTime?: string
  /** e.g. "America/New_York". Falls back to the brand's timezone. */
  scheduleTimezone?: string
}

export type CampaignOutcome = 'created' | 'sending' | 'scheduled'

export interface CampaignResult {
  outcome: CampaignOutcome
  /**
   * Only ever present for a plain create. create.php honours `json=1` on that
   * path alone — the sending and scheduling branches answer with bare prose
   * and no id, so there is nothing to return for them.
   */
  campaignId?: string
}

/**
 * `api/campaigns/create.php` creates a draft, and optionally sends or schedules
 * it in the same call. There is no separate send endpoint, which is why
 * `campaigns send <id>` for an existing draft still does not exist.
 */
export async function createCampaign(
  client: SkrybeClient,
  input: CampaignInput,
): Promise<CampaignResult> {
  const body: Record<string, string | number | undefined> = {
    from_name: input.fromName,
    from_email: input.fromEmail,
    reply_to: input.replyTo,
    title: input.title,
    subject: input.subject,
    html_text: input.htmlText,
    plain_text: input.plainText,
    list_ids: input.listIds?.join(','),
    segment_ids: input.segmentIds?.join(','),
    exclude_list_ids: input.excludeListIds?.join(','),
    exclude_segments_ids: input.excludeSegmentIds?.join(','),
    query_string: input.queryString,
    track_opens: input.trackOpens,
    track_clicks: input.trackClicks,
    schedule_date_time: input.scheduleDateTime,
    schedule_timezone: input.scheduleTimezone,
    // Asks for `{"status": ..., "campaign_id": ...}` instead of bare prose.
    json: 1,
  }
  if (input.send) body.send_campaign = 1

  const text = await client.requestText({ path: 'api/campaigns/create.php', body })
  const trimmed = text.trim()

  if (trimmed === 'Campaign scheduled') return { outcome: 'scheduled' }
  if (trimmed === 'Campaign created and now sending') return { outcome: 'sending' }
  if (trimmed === 'Campaign created') return { outcome: 'created' }

  // The json=1 shape. Parsed leniently: the id is what matters, and the
  // wrapper is built by hand server-side.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { status?: string; campaign_id?: string }
      if (typeof parsed.status === 'string' && parsed.status.startsWith('Campaign created')) {
        return { outcome: 'created', campaignId: parsed.campaign_id }
      }
    } catch {
      // Fall through to the error below with the body intact.
    }
  }

  throw new ApiError(
    'unexpected_response',
    `Unexpected response from campaigns/create: ${excerpt(trimmed)}`,
    Exit.API_ERROR,
    { raw: text },
  )
}
