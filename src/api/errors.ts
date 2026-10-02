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
 * api/brands/get-brands.php, api/subscribers/*.php, api/campaigns/*.php,
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
  // Also the answer to the install's main account key, which no brand is tied to.
  'brand does not exist': {
    code: 'brand_not_found',
    exitCode: Exit.API_ERROR,
    hint: 'Use an API key from a brand login; the main account key is not tied to a brand.',
  },
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

  // List management (lists/create.php, update-list.php, delete.php)
  'list name not passed': { code: 'list_name_missing', exitCode: Exit.USAGE },
  'list name is too long': {
    code: 'list_name_too_long',
    exitCode: Exit.USAGE,
    hint: 'A list name can be at most 100 characters.',
  },
  'opt_in must be single or double': { code: 'invalid_opt_in', exitCode: Exit.USAGE },
  'nothing to update': { code: 'nothing_to_update', exitCode: Exit.USAGE, hint: 'Pass at least one field to change.' },
  'list is used by a scheduled or sending campaign': {
    code: 'list_in_use',
    exitCode: Exit.API_ERROR,
    hint: 'Unschedule the campaign, or wait for it to finish sending, then delete the list.',
  },

  // Custom fields (lists/add-custom-field.php, rename-custom-field.php, delete-custom-field.php)
  'field name not passed': { code: 'field_name_missing', exitCode: Exit.USAGE },
  'invalid field name': {
    code: 'invalid_field_name',
    exitCode: Exit.USAGE,
    hint: 'Up to 100 characters, without : % [ ] , " < or >.',
  },
  'name and email are built-in fields': { code: 'reserved_field_name', exitCode: Exit.USAGE },
  'type must be text or date': { code: 'invalid_field_type', exitCode: Exit.USAGE },
  'field already exists': { code: 'field_exists', exitCode: Exit.API_ERROR, hint: 'Field names are case-insensitive.' },
  'field does not exist': {
    code: 'field_not_found',
    exitCode: Exit.API_ERROR,
    hint: 'Run `skrybe lists fields <list-id>` to see the fields.',
  },
  'field is used by an autoresponder': {
    code: 'field_in_use',
    exitCode: Exit.API_ERROR,
    hint: 'Change the autoresponder in the Skrybe UI first.',
  },
  'field is used by a segment': {
    code: 'field_in_use',
    exitCode: Exit.API_ERROR,
    hint: 'Remove it from the segment in the Skrybe UI first.',
  },
  'list was changed by another request. try again.': { code: 'conflict', exitCode: Exit.API_ERROR },

  // Campaigns (get-campaigns.php, get-campaign.php, stats.php)
  'campaign id not passed': { code: 'campaign_id_missing', exitCode: Exit.USAGE },
  'campaign does not exist': {
    code: 'campaign_not_found',
    exitCode: Exit.API_ERROR,
    hint: 'Run `skrybe campaigns` to see the IDs available to this API key.',
  },
  'invalid status': { code: 'invalid_status', exitCode: Exit.USAGE },
  'invalid page': { code: 'invalid_page', exitCode: Exit.USAGE },
  'invalid limit': { code: 'invalid_limit', exitCode: Exit.USAGE, hint: 'A page holds at most 1000 subscribers.' },

  // Sending a campaign (campaigns/send.php; the list and segment wording is create.php's too)
  'list or segment id(s) not passed': {
    code: 'recipients_missing',
    exitCode: Exit.USAGE,
    hint: 'Pass at least one --list or --segment.',
  },
  'one or more list ids are invalid': {
    code: 'list_not_found',
    exitCode: Exit.API_ERROR,
    hint: 'Run `skrybe lists` to see the IDs available to this API key.',
  },
  'one or more segment ids are invalid': { code: 'segment_not_found', exitCode: Exit.API_ERROR },
  'campaign has already been sent': {
    code: 'campaign_not_draft',
    exitCode: Exit.API_ERROR,
    hint: 'It has already started sending, so it can no longer be sent, scheduled or edited. `skrybe campaigns get <id>` shows its status.',
  },
  'campaign is scheduled': {
    code: 'campaign_scheduled',
    exitCode: Exit.API_ERROR,
    hint: 'Run `skrybe campaigns unschedule <id>` first, or leave it to send at its scheduled time.',
  },
  'campaign is not scheduled': { code: 'campaign_not_scheduled', exitCode: Exit.API_ERROR },

  // Editing and deleting campaigns (campaigns/update-campaign.php, delete-campaign.php)
  'campaign is sending': {
    code: 'campaign_sending',
    exitCode: Exit.API_ERROR,
    hint: 'Stop it in the Skrybe UI first, or wait for it to finish.',
  },
  'subject cannot be empty': { code: 'subject_empty', exitCode: Exit.USAGE },
  'html cannot be empty': { code: 'html_empty', exitCode: Exit.USAGE },
  'invalid from_email': { code: 'invalid_from_email', exitCode: Exit.USAGE },
  'invalid reply_to': { code: 'invalid_reply_to', exitCode: Exit.USAGE },
  'track_opens and track_clicks must be 0, 1 or 2': {
    code: 'invalid_tracking',
    exitCode: Exit.USAGE,
    hint: '0 off, 1 on, 2 anonymous.',
  },
  'campaign was changed by another request. try again.': { code: 'conflict', exitCode: Exit.API_ERROR },

  // Scheduling (campaigns/schedule.php; the invalid-date wording is create.php's too)
  'schedule_date_time not passed': { code: 'schedule_missing', exitCode: Exit.USAGE, hint: 'Pass --at.' },
  'schedule_date_time is invalid': {
    code: 'invalid_schedule',
    exitCode: Exit.USAGE,
    hint: 'Use a date and time such as "2027-06-15 18:05" or "June 15, 2027 6:05pm".',
  },
  'schedule_date_time is in the past': {
    code: 'schedule_in_past',
    exitCode: Exit.USAGE,
    hint: 'The time is read in --timezone, or the account timezone if that is not given.',
  },
  'schedule_timezone is invalid': {
    code: 'invalid_timezone',
    exitCode: Exit.USAGE,
    hint: 'Use an IANA name such as Africa/Lagos or America/New_York.',
  },
  // Test sends (campaigns/test-send.php, sharing its gates with the UI)
  'email addresses not passed': {
    code: 'emails_missing',
    exitCode: Exit.USAGE,
    hint: 'Pass at least one --to address.',
  },
  'too many email addresses': {
    code: 'too_many_emails',
    exitCode: Exit.USAGE,
    hint: 'A test send goes to at most 5 addresses.',
  },
  'quota exceeded. please upgrade your plan.': { code: 'quota_exceeded', exitCode: Exit.QUOTA_OR_RATE_LIMIT },
  'no active subscribers to send to': {
    code: 'no_recipients',
    exitCode: Exit.API_ERROR,
    hint: 'Every subscriber on those lists is unsubscribed, bounced, unconfirmed or excluded.',
  },

  // Subscribers
  'subscriber does not exist': { code: 'subscriber_not_found', exitCode: Exit.API_ERROR },
  'email does not exist in list': { code: 'subscriber_not_found', exitCode: Exit.API_ERROR },
  'email not passed': { code: 'email_missing', exitCode: Exit.USAGE },
  'email address not passed': { code: 'email_missing', exitCode: Exit.USAGE },
  'invalid email address.': { code: 'invalid_email', exitCode: Exit.USAGE },
  'bounced email address.': { code: 'bounced_email', exitCode: Exit.API_ERROR },
  'email is suppressed.': { code: 'suppressed_email', exitCode: Exit.API_ERROR },
  // unsubscribe.php's wording for an address that is not on the list, as
  // distinct from subscription-status.php's "Email does not exist in list".
  'email does not exist.': { code: 'subscriber_not_found', exitCode: Exit.API_ERROR },

  // subscribe.php validates these before it writes anything.
  'ip address is invalid.': { code: 'invalid_ip_address', exitCode: Exit.USAGE },
  'country must be a valid 2 letter country code': {
    code: 'invalid_country',
    exitCode: Exit.USAGE,
    hint: 'Use a two-letter ISO 3166-1 code, e.g. NG.',
  },
  'referrer is not a valid url': { code: 'invalid_referrer', exitCode: Exit.USAGE },
  'consent not given.': {
    code: 'consent_not_given',
    exitCode: Exit.USAGE,
    hint: 'The list requires GDPR consent — pass --gdpr.',
  },
  'failed recaptcha test.': {
    code: 'recaptcha_failed',
    exitCode: Exit.API_ERROR,
    hint: 'The list has reCAPTCHA enabled on its subscribe form, which an API call cannot satisfy.',
  },

  // Sending
  'unauthorised from email domain': {
    code: 'unauthorised_from_domain',
    exitCode: Exit.API_ERROR,
    hint: 'The From domain must be verified for this brand, or listed in its allowed domains.',
  },
}

/**
 * Prose that embeds a variable part — a domain name, a review reason — matched
 * by pattern instead. Checked after the exact table.
 */
const PROSE_PATTERN_ERRORS: [RegExp, ProseRule][] = [
  [/^error: this campaign would exceed/, { code: 'quota_exceeded', exitCode: Exit.QUOTA_OR_RATE_LIMIT }],
  [
    /^account under review:/,
    {
      code: 'account_under_review',
      exitCode: Exit.API_ERROR,
      hint: 'Sending is paused while the brand is reviewed for a high bounce rate. Contact Skrybe support.',
    },
  ],
  [/^a field is too long/, { code: 'field_too_long', exitCode: Exit.USAGE }],
  [
    /^brand is under review/,
    {
      code: 'account_under_review',
      exitCode: Exit.API_ERROR,
      hint: 'Sending is paused while the brand is reviewed for a high bounce rate. Contact Skrybe support.',
    },
  ],
  [
    /^test send rate limit reached/,
    {
      code: 'rate_limited',
      exitCode: Exit.QUOTA_OR_RATE_LIMIT,
      hint: 'Test sends are limited to 20 an hour per brand, shared with the Skrybe UI.',
    },
  ],
  [
    /^domain not verified in ses/,
    {
      code: 'domain_not_verified',
      exitCode: Exit.API_ERROR,
      hint: "Verify the campaign's From domain for this brand in the Skrybe UI.",
    },
  ],
  [
    /^domain ".*" is not verified/,
    {
      code: 'domain_not_verified',
      exitCode: Exit.API_ERROR,
      hint: "Verify the campaign's From domain for this brand in the Skrybe UI.",
    },
  ],
]

/**
 * Bodies that mean "nothing to return" rather than a failure. get-lists.php,
 * get-brands.php and get-campaigns.php answer with prose instead of an empty object when the
 * brand has no rows, and an empty collection is not an error.
 */
const PROSE_EMPTY = new Set(['no lists found', 'no brands found', 'no campaigns found'])

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

  for (const [pattern, patternRule] of PROSE_PATTERN_ERRORS) {
    if (pattern.test(key)) {
      return new ApiError(patternRule.code, trimmed, patternRule.exitCode, { raw: body, status, hint: patternRule.hint })
    }
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
