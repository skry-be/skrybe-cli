import type { SkrybeClient } from '../client.js'
import { ApiError, Exit, excerpt, isProseEmpty } from '../errors.js'
import { parseJsonObject, parseNumberedRecords } from '../parse.js'

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
 * it in the same call. To send a draft that already exists, see `sendCampaign`.
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

/** As the brand's campaign list labels them (app.php). */
export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'preparing', 'sending', 'sent', 'paused'] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

/**
 * One row of `api/campaigns/get-campaigns.php`. Field names are the API's, so
 * `--json` output matches what the endpoint documents.
 */
export interface Campaign {
  id: number
  title: string
  subject: string
  status: CampaignStatus
  from_name: string
  from_email: string
  reply_to: string
  recipients: number
  to_send: number
  /** Unix seconds. */
  sent_at: number | null
  /** Unix seconds, only while scheduled. */
  scheduled_at: number | null
  timezone: string | null
  /** `ui`, or `api` for campaigns created by `emails send`. */
  source: string
}

export interface CampaignDetail extends Campaign {
  preheader: string
  query_string: string
  track_opens: number
  track_clicks: number
  /** Encrypted, like the ids `skrybe lists` prints. */
  list_ids: string[]
  exclude_list_ids: string[]
  segment_ids: number[]
  exclude_segment_ids: number[]
  web_version: string
  /** Only with `includeContent`. */
  html_text?: string
  plain_text?: string
}

export interface CampaignStats {
  id: number
  status: CampaignStatus
  recipients: number
  /** `rate` is a percentage of delivered (recipients less hard bounces). */
  opens: { total: number; unique: number; rate: number }
  /** `rate` is a percentage of recipients. */
  clicks: { total: number; unique: number; rate: number }
  bounces: { hard: number; soft: number }
  complaints: number
  unsubscribes: number
  links: { url: string; clicks: number; unique_clicks: number }[]
}

export interface ListCampaignsOptions {
  /** 1-based. */
  page?: number
  /** The server caps this at 100. */
  limit?: number
  status?: CampaignStatus
}

export const MAX_PAGE_SIZE = 100

/** Newest first. An empty page is an empty array, not an error. */
export async function listCampaigns(
  client: SkrybeClient,
  opts: ListCampaignsOptions = {},
): Promise<Campaign[]> {
  const body = await client.requestText({
    path: 'api/campaigns/get-campaigns.php',
    body: { page: opts.page, limit: opts.limit, status: opts.status },
    retryable: true,
  })
  if (isProseEmpty(body)) return []
  return parseNumberedRecords<Campaign>(body, 'campaign')
}

/** Every page, fetched in order at the largest page size. */
export async function listAllCampaigns(
  client: SkrybeClient,
  opts: Omit<ListCampaignsOptions, 'page' | 'limit'> = {},
): Promise<Campaign[]> {
  const all: Campaign[] = []
  for (let page = 1; ; page++) {
    const rows = await listCampaigns(client, { ...opts, page, limit: MAX_PAGE_SIZE })
    all.push(...rows)
    if (rows.length < MAX_PAGE_SIZE) return all
  }
}

export async function getCampaign(
  client: SkrybeClient,
  campaignId: number,
  opts: { includeContent?: boolean } = {},
): Promise<CampaignDetail> {
  const body = await client.requestText({
    path: 'api/campaigns/get-campaign.php',
    body: { campaign_id: campaignId, include_content: opts.includeContent ? 'yes' : undefined },
    retryable: true,
  })
  return parseJsonObject<CampaignDetail>(body, 'campaign')
}

export async function campaignStats(client: SkrybeClient, campaignId: number): Promise<CampaignStats> {
  const body = await client.requestText({
    path: 'api/campaigns/stats.php',
    body: { campaign_id: campaignId },
    retryable: true,
  })
  return parseJsonObject<CampaignStats>(body, 'campaign stats')
}

export interface SendCampaignInput {
  /** Encrypted list ids. At least one list or segment is required. */
  listIds?: string[]
  segmentIds?: string[]
  excludeListIds?: string[]
  excludeSegmentIds?: string[]
  /** Run every check and count the recipients, but send nothing. */
  dryRun?: boolean
}

export interface SendCampaignResult {
  status: 'sending' | 'dry_run'
  campaign_id: number
  /** Unique active subscribers the campaign goes (or would go) to. */
  recipients: number
}

/**
 * `api/campaigns/send.php` sends an existing draft. It only ever claims a
 * draft, so a retry after a lost response answers "Campaign has already been
 * sent" rather than sending twice. It is still not marked `retryable`: that
 * answer would turn a success into a reported failure.
 */
export async function sendCampaign(
  client: SkrybeClient,
  campaignId: number,
  input: SendCampaignInput,
): Promise<SendCampaignResult> {
  const join = (ids?: string[]) => (ids && ids.length > 0 ? ids.join(',') : undefined)
  const body = await client.requestText({
    path: 'api/campaigns/send.php',
    body: {
      campaign_id: campaignId,
      list_ids: join(input.listIds),
      segment_ids: join(input.segmentIds),
      exclude_list_ids: join(input.excludeListIds),
      exclude_segment_ids: join(input.excludeSegmentIds),
      dry_run: input.dryRun ? 1 : undefined,
    },
  })
  return parseJsonObject<SendCampaignResult>(body, 'send result')
}
