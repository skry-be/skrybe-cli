/**
 * The legacy Skrybe API answers most failures with HTTP 200 and a prose
 * sentence. Only api/emails/send.php, api/emails/send-transactional.php and
 * api/stats/emails-sent.php use real status codes.
 *
 * Everything here exists to turn that into something a script can branch on.
 * When api/v1 lands with a real error envelope, this file shrinks to a
 * `code -> ExitCode` lookup and the prose table goes away.
 */

/** Exit codes. Stable contract — scripts depend on these. */
export const Exit = {
  OK: 0,
  API_ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  QUOTA_OR_RATE_LIMIT: 4,
} as const

export type ExitCode = (typeof Exit)[keyof typeof Exit]

export class CliError extends Error {
  readonly exitCode: ExitCode
  /** Stable machine-readable slug, e.g. `invalid_api_key`. */
  readonly code: string
  /** What the user should do about it, when we know. */
  readonly hint?: string

  constructor(code: string, message: string, exitCode: ExitCode, hint?: string) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.exitCode = exitCode
    this.hint = hint
  }
}

export class UsageError extends CliError {
  constructor(message: string, hint?: string) {
    super('usage', message, Exit.USAGE, hint)
    this.name = 'UsageError'
  }
}

export class AuthError extends CliError {
  constructor(message: string, hint?: string) {
    super('invalid_api_key', message, Exit.AUTH, hint)
    this.name = 'AuthError'
  }
}

export class ApiError extends CliError {
  /** Raw response body, kept for `--json` and for debugging odd endpoints. */
  readonly raw?: string
  readonly status?: number

  constructor(
    code: string,
    message: string,
    exitCode: ExitCode = Exit.API_ERROR,
    opts: { raw?: string; status?: number; hint?: string } = {},
  ) {
    super(code, message, exitCode, opts.hint)
    this.name = 'ApiError'
    this.raw = opts.raw
    this.status = opts.status
  }
}

/**
 * Render an unexpected response body for an error message: whitespace collapsed
 * so a multi-line PHP warning stays on one line, and truncated so a stray HTML
 * page does not fill the terminal. The untruncated body stays on `ApiError.raw`.
 */
export function excerpt(body: string, limit = 200): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat === '') return '(an empty response)'
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

interface ProseRule {
  code: string
  exitCode: ExitCode
  hint?: string
}

/**
 * Prose returned by the legacy endpoints, mapped to a stable code.
 * Matched case-insensitively against the trimmed body, exact match first.
 *
 * Sources: api/_connect.php callers, api/lists/get-lists.php,
 * api/brands/get-brands.php, api/subscribers/*.php, api/campaigns/create.php,
 * subscribe.php, unsubscribe.php.
 */
const PROSE_ERRORS: Record<string, ProseRule> = {
  // Authentication
  'api key not passed': { code: 'api_key_missing', exitCode: Exit.AUTH },
  'invalid api key': {
    code: 'invalid_api_key',
    exitCode: Exit.AUTH,
    hint: 'Generate a key in the Skrybe UI under Settings, then run `skrybe auth login`.\nNote that keys are cleared for every login of a brand placed under review.',
  },

  // Request shape
  'no data passed': { code: 'no_data_passed', exitCode: Exit.USAGE },
  'some fields are missing.': { code: 'missing_fields', exitCode: Exit.USAGE },

  // Brands and lists
  'brand id not passed': { code: 'brand_id_missing', exitCode: Exit.USAGE },
  'brand does not exist': { code: 'brand_not_found', exitCode: Exit.API_ERROR },
  'list does not exist': {
    code: 'list_not_found',
    exitCode: Exit.API_ERROR,
    hint: 'Run `skrybe lists` to see the IDs available to this API key.',
  },
  'invalid list id.': {
    code: 'list_not_found',
    exitCode: Exit.API_ERROR,
    hint: 'Run `skrybe lists` to see the IDs available to this API key.',
  },
  // Also what decrypt_int() produces from an id it cannot decrypt, so this is
  // the answer to a malformed id as much as to a missing one.
  'list id not passed': {
    code: 'list_id_invalid',
    exitCode: Exit.USAGE,
    hint: 'A list ID is the encrypted value `skrybe lists` prints, not the integer in the UI URL.',
  },

  // Subscribers
  'subscriber does not exist': { code: 'subscriber_not_found', exitCode: Exit.API_ERROR },
  'email does not exist in list': { code: 'subscriber_not_found', exitCode: Exit.API_ERROR },
  'email not passed': { code: 'email_missing', exitCode: Exit.USAGE },
  'email address not passed': { code: 'email_missing', exitCode: Exit.USAGE },
  'invalid email address.': { code: 'invalid_email', exitCode: Exit.USAGE },
  'bounced email address.': { code: 'bounced_email', exitCode: Exit.API_ERROR },
  'email is suppressed.': { code: 'suppressed_email', exitCode: Exit.API_ERROR },

  // Sending
  'unauthorised from email domain': {
    code: 'unauthorised_from_domain',
    exitCode: Exit.API_ERROR,
    hint: 'The From domain must be verified for this brand, or listed in its allowed domains.',
  },
}

/**
 * Bodies that mean "nothing to return" rather than a failure. get-lists.php
 * and get-brands.php answer with prose instead of an empty object when the
 * brand has no rows, and an empty collection is not an error.
 */
const PROSE_EMPTY = new Set(['no lists found', 'no brands found'])

export function isProseEmpty(body: string): boolean {
  return PROSE_EMPTY.has(body.trim().toLowerCase())
}

/** Bodies that mean success even though they are bare prose. */
const PROSE_OK = new Set([
  '1',
  'true',
  'already subscribed.',
  'campaign created',
  'campaign created and now sending',
  'campaign scheduled',
])

export function isProseSuccess(body: string): boolean {
  return PROSE_OK.has(body.trim().toLowerCase())
}

/**
 * Classify a legacy plain-text body. Returns null when the body is not a
 * recognised error, which callers should treat as data.
 */
export function classifyProse(body: string, status?: number): ApiError | null {
  const trimmed = body.trim()
  const key = trimmed.toLowerCase()

  const rule = PROSE_ERRORS[key]
  if (rule) {
    return new ApiError(rule.code, trimmed, rule.exitCode, { raw: body, status, hint: rule.hint })
  }

  // `api/campaigns/create.php` emits a family of "Unable to ..." failures that
  // are not worth enumerating; treat the whole prefix as one code.
  if (key.startsWith('unable to')) {
    return new ApiError('operation_failed', trimmed, Exit.API_ERROR, { raw: body, status })
  }

  return null
}

/** Map an HTTP status from one of the three JSON endpoints to an exit code. */
export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401 || status === 403) return Exit.AUTH
  if (status === 402 || status === 429) return Exit.QUOTA_OR_RATE_LIMIT
  if (status === 400 || status === 405 || status === 422) return Exit.USAGE
  return Exit.API_ERROR
}
