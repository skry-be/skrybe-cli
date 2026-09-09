import { userAgent } from '../version.js'
import { ApiError, AuthError, Exit, classifyProse, exitCodeForStatus } from './errors.js'

export interface ClientOptions {
  url: string
  apiKey: string
  timeoutMs?: number
}

export interface RequestOptions {
  /** Path relative to the install root, e.g. `api/lists/get-lists.php`. */
  path: string
  /** Form fields. `api_key` is injected automatically unless `anonymous`. */
  body?: Record<string, string | number | undefined>
  /**
   * `form` posts application/x-www-form-urlencoded, which is what every
   * endpoint wants except api/emails/send-transactional.php, which reads
   * php://input and needs a raw JSON body.
   */
  encoding?: 'form' | 'json'
  method?: 'GET' | 'POST'
  /** Skip api_key injection — only api/stats/emails-sent.php is public. */
  anonymous?: boolean
  /**
   * Opt in to retrying this request. Off by default because most endpoints
   * here create or send something, and none of them take an idempotency key:
   * a 504 from a send that actually landed becomes a second campaign on
   * retry. A dropped connection cannot be distinguished from a response we
   * never saw, so only reads set this.
   */
  retryable?: boolean
}

const DEFAULT_TIMEOUT_MS = 30_000
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
const MAX_ATTEMPTS = 3

export class SkrybeClient {
  private readonly url: string
  private readonly apiKey: string
  private readonly timeoutMs: number

  constructor(opts: ClientOptions) {
    this.url = opts.url.replace(/\/+$/, '')
    this.apiKey = opts.apiKey
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Perform a request and return the body as text.
   *
   * Legacy endpoints answer HTTP 200 with a prose error, so a 2xx here is not
   * proof of success — callers get the raw body and either hand it to
   * `parseNumberedObject` or compare it against a known-good string.
   * Recognised prose errors are thrown before the caller ever sees them.
   */
  async requestText(opts: RequestOptions): Promise<string> {
    const response = await this.send(opts)
    const text = await response.text()

    // The three JSON endpoints use real status codes; honour them first.
    if (!response.ok) {
      throw await this.errorFromResponse(response, text)
    }

    const prose = classifyProse(text, response.status)
    if (prose) {
      if (prose.exitCode === Exit.AUTH) {
        throw new AuthError(prose.message, prose.hint)
      }
      throw prose
    }

    return text
  }

  /** Perform a request against one of the endpoints that returns real JSON. */
  async requestJson<T>(opts: RequestOptions): Promise<T> {
    const response = await this.send(opts)
    const text = await response.text()

    if (!response.ok) {
      throw await this.errorFromResponse(response, text)
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw new ApiError(
        'malformed_response',
        'The API returned a response that was not valid JSON.',
        Exit.API_ERROR,
        { raw: text, status: response.status },
      )
    }
  }

  private async send(opts: RequestOptions): Promise<Response> {
    const method = opts.method ?? 'POST'
    const encoding = opts.encoding ?? 'form'
    const target = `${this.url}/${opts.path.replace(/^\/+/, '')}`

    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(opts.body ?? {})) {
      if (value !== undefined) fields[key] = String(value)
    }
    if (!opts.anonymous) fields.api_key = this.apiKey

    const maxAttempts = opts.retryable ? MAX_ATTEMPTS : 1

    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const headers: Record<string, string> = { 'User-Agent': userAgent() }
        const init: RequestInit = { method, signal: controller.signal, headers }

        if (method === 'POST') {
          if (encoding === 'json') {
            headers['Content-Type'] = 'application/json'
            init.body = JSON.stringify(fields)
          } else {
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
            init.body = new URLSearchParams(fields).toString()
          }
        }

        const response = await fetch(method === 'GET' ? withQuery(target, fields) : target, init)

        if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
          await delay(backoffMs(attempt, response.headers.get('retry-after')))
          continue
        }
        return response
      } catch (err) {
        lastError = err
        if (isAbort(err)) {
          throw new ApiError(
            'timeout',
            `Request to ${target} timed out after ${this.timeoutMs}ms.`,
            Exit.API_ERROR,
          )
        }
        if (attempt < maxAttempts) {
          await delay(backoffMs(attempt, null))
          continue
        }
      } finally {
        clearTimeout(timer)
      }
    }

    throw new ApiError(
      'network_error',
      `Could not reach ${this.url}: ${(lastError as Error)?.message ?? 'unknown error'}`,
      Exit.API_ERROR,
      { hint: 'Check the URL with `skrybe auth whoami` and that the host is reachable.' },
    )
  }

  /**
   * Build an error from a non-2xx response. The JSON endpoints use
   * `{ok:false,error:...}` (api/emails/send.php) or
   * `{status:"error",message:...}` (api/emails/send-transactional.php).
   */
  private async errorFromResponse(response: Response, text: string): Promise<ApiError> {
    const exitCode = exitCodeForStatus(response.status)
    let message = text.trim()

    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown }
      const extracted = parsed.error ?? parsed.message
      if (typeof extracted === 'string' && extracted !== '') message = extracted
    } catch {
      // Not JSON — the prose body is already the best message we have.
    }

    if (message === '') message = `HTTP ${response.status} from the Skrybe API.`

    const code = codeForStatus(response.status)
    if (exitCode === Exit.AUTH) {
      throw new AuthError(message)
    }
    return new ApiError(code, message, exitCode, { raw: text, status: response.status })
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_request'
    case 401:
      return 'unauthenticated'
    case 402:
      return 'quota_exceeded'
    case 403:
      return 'forbidden'
    case 404:
      return 'not_found'
    case 405:
      return 'method_not_allowed'
    case 429:
      return 'rate_limited'
    default:
      return status >= 500 ? 'server_error' : 'api_error'
  }
}

function withQuery(target: string, fields: Record<string, string>): string {
  const query = new URLSearchParams(fields).toString()
  if (query === '') return target
  return `${target}${target.includes('?') ? '&' : '?'}${query}`
}

/** Honour Retry-After when present, else exponential backoff with jitter. */
function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10)
    if (!Number.isNaN(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000)
  }
  return 2 ** (attempt - 1) * 500 + Math.floor(Math.random() * 250)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
