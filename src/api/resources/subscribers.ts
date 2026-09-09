import type { SkrybeClient } from '../client.js'
import { ApiError, Exit, excerpt, isProseSuccess } from '../errors.js'

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
