import type { SkrybeClient } from '../client.js'
import { ApiError, Exit, excerpt, isProseSuccess } from '../errors.js'
import { parseJsonObject } from '../parse.js'

export interface SubscriberRef {
  /** The encrypted list id, as printed by `skrybe lists`. */
  listId: string
  email: string
}

export interface SubscribeInput extends SubscriberRef {
  name?: string
  country?: string
  ipAddress?: string
  referrer?: string
  /** Record GDPR consent for an EU signup. */
  gdpr?: boolean
  /** Add to a double opt-in list as single opt-in, skipping confirmation. */
  silent?: boolean
  /**
   * Custom fields, keyed by personalization tag name — `Birthday` for a field
   * whose tag is `[Birthday,fallback=]`. They go in as ordinary POST fields
   * alongside the documented ones, so a field named `email` or `list` would
   * collide; the documented names are written last and win.
   */
  fields?: Record<string, string>
}

export type SubscribeOutcome = 'subscribed' | 'already_subscribed'

/**
 * `subscribe.php` doubles as an update: posting an existing address changes
 * the stored name and custom fields rather than failing.
 *
 * Note the endpoint lives at the install root, not under api/, and that
 * `boolean=true` is what switches it from rendering an HTML page to answering
 * in plain text. Success is `1` — the source is `echo true`, which PHP prints
 * as `1`, though the published docs say `true`. Both are treated as success.
 */
export async function subscribe(
  client: SkrybeClient,
  input: SubscribeInput,
): Promise<SubscribeOutcome> {
  const body: Record<string, string> = { ...(input.fields ?? {}) }

  body.email = input.email
  body.list = input.listId
  body.boolean = 'true'
  if (input.name !== undefined) body.name = input.name
  if (input.country !== undefined) body.country = input.country
  if (input.ipAddress !== undefined) body.ipaddress = input.ipAddress
  if (input.referrer !== undefined) body.referrer = input.referrer
  if (input.gdpr) body.gdpr = 'true'
  if (input.silent) body.silent = 'true'

  const text = await client.requestText({ path: 'subscribe', body })
  const trimmed = text.trim().toLowerCase()

  // Reported rather than thrown: adding an address that is already on the list
  // is the expected outcome of re-running a script, not a failure. The caller
  // still gets to tell the two apart.
  if (trimmed === 'already subscribed.') return 'already_subscribed'
  if (isProseSuccess(text)) return 'subscribed'

  throw unexpected('subscribe', text)
}

/**
 * `unsubscribe.php` does NOT check the api_key — it is never read. Anyone who
 * knows a list id can unsubscribe any address from it. The key is sent anyway,
 * so this keeps working if that is ever fixed.
 */
export async function unsubscribe(client: SkrybeClient, ref: SubscriberRef): Promise<void> {
  const text = await client.requestText({
    path: 'unsubscribe',
    body: { email: ref.email, list: ref.listId, boolean: 'true' },
  })
  if (!isProseSuccess(text)) throw unexpected('unsubscribe', text)
}

/** Removes the subscriber row outright, rather than marking it unsubscribed. */
export async function deleteSubscriber(
  client: SkrybeClient,
  ref: SubscriberRef,
): Promise<void> {
  const text = await client.requestText({
    path: 'api/subscribers/delete.php',
    body: { list_id: ref.listId, email: ref.email },
  })
  if (!isProseSuccess(text)) throw unexpected('delete', text)
}

/**
 * One of Subscribed, Unsubscribed, Unconfirmed, Bounced, Soft bounced or
 * Complained. Returned as given rather than narrowed to a union: a new status
 * added server-side should surface, not be rejected by the client.
 */
export async function subscriptionStatus(
  client: SkrybeClient,
  ref: SubscriberRef,
): Promise<string> {
  const text = await client.requestText({
    path: 'api/subscribers/subscription-status.php',
    body: { email: ref.email, list_id: ref.listId },
    retryable: true,
  })

  const status = text.trim()
  if (status === '') throw unexpected('subscription-status', text)
  return status
}

/**
 * A body that is neither a known success nor a known failure. Recognised prose
 * errors never reach here — the client throws them first — so this is either a
 * PHP warning or something in front of the install answering instead.
 */
function unexpected(operation: string, body: string): ApiError {
  return new ApiError(
    'unexpected_response',
    `Unexpected response from ${operation}: ${excerpt(body)}`,
    Exit.API_ERROR,
    { raw: body },
  )
}

/** Every subscriber is in exactly one of these; `active` is who a campaign sends to. */
export const SUBSCRIBER_STATUSES = ['active', 'unconfirmed', 'unsubscribed', 'bounced', 'complained'] as const
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number]

export interface Subscriber {
  email: string
  name: string
  status: SubscriberStatus
  /** Unix seconds. */
  joined_at: number | null
  /** By field name, in the list's order. Dates are YYYY-MM-DD; empty values are null. */
  custom_fields: Record<string, string | null>
}

export interface SubscribersPage {
  list_id: string
  status: SubscriberStatus | null
  page: number
  limit: number
  /** Subscribers matching the status filter, across all pages. */
  total: number
  subscribers: Subscriber[]
}

/** The server refuses larger pages. */
export const MAX_SUBSCRIBERS_PAGE = 1000

/** One page of `api/subscribers/get-subscribers.php`, oldest first. */
export async function listSubscribers(
  client: SkrybeClient,
  listId: string,
  opts: { status?: SubscriberStatus; page?: number; limit?: number } = {},
): Promise<SubscribersPage> {
  const body = await client.requestText({
    path: 'api/subscribers/get-subscribers.php',
    body: { list_id: listId, status: opts.status, page: opts.page, limit: opts.limit },
    retryable: true,
  })
  return parseJsonObject<SubscribersPage>(body, 'subscribers page')
}

/**
 * Every page, at the largest page size. Oldest first, so someone joining
 * mid-way lands on a later page instead of shifting the ones already read.
 */
export async function listAllSubscribers(
  client: SkrybeClient,
  listId: string,
  opts: { status?: SubscriberStatus } = {},
): Promise<Subscriber[]> {
  const all: Subscriber[] = []
  for (let page = 1; ; page++) {
    const r = await listSubscribers(client, listId, { ...opts, page, limit: MAX_SUBSCRIBERS_PAGE })
    all.push(...r.subscribers)
    if (r.subscribers.length < MAX_SUBSCRIBERS_PAGE) return all
  }
}
