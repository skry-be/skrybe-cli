import type { SkrybeClient } from '../client.js'
import { ApiError, AuthError, isProseEmpty } from '../errors.js'
import { parseNumberedObject, type NamedEntity } from '../parse.js'

export interface Brand extends NamedEntity {}

/**
 * `api/brands/get-brands.php` is scoped to the key's own brand — the brand is
 * derived from `login.app`, and the documented `brand_id` POST field is ignored.
 * A customer key therefore returns exactly one row.
 *
 * Returns `[]` when the endpoint answers "No brands found", which is not an error.
 */
export async function listBrands(client: SkrybeClient): Promise<Brand[]> {
  const body = await client.requestText({ path: 'api/brands/get-brands.php', retryable: true })
  if (isProseEmpty(body)) return []
  return parseNumberedObject(body, 'brand')
}

export type QuotaMode = 'unlimited' | 'custom' | 'no-expiry'

export interface CreateBrandInput {
  name: string
  fromEmail: string
  fromName?: string
  replyTo?: string
  loginEmail?: string
  /** Gives the brand a client login. Never log it. */
  password?: string
  currency?: string
  language?: string
  quota?: QuotaMode
  monthlyLimit?: number
  resetDay?: number
  smtpHost?: string
  smtpPort?: string
  smtpSsl?: string
  smtpUsername?: string
  smtpPassword?: string
}

/** `api/admin/brands/create-brand.php` answers 201 with this. */
export interface CreatedBrand {
  status: 'success'
  message: string
  brand_id: number
  app_name: string
  from_name: string
  from_email: string
  reply_to: string
  /** The brand's API key. Nothing reads it back, so this is the only time it is shown. */
  app_key: string
}

const ADMIN_HINT =
  'This needs the install admin\'s API key; the current profile\'s key is brand-scoped or invalid.\n' +
  'Check with `skrybe whoami`, or log in again with the admin key.'

/**
 * Admin only. Not retried: a repeat after a lost response would create a
 * second brand.
 *
 * The server answers 401 for a bad key and for a non-admin key alike, so the
 * hint covers both.
 */
export async function createBrand(client: SkrybeClient, input: CreateBrandInput): Promise<CreatedBrand> {
  let created: CreatedBrand
  try {
    created = await client.requestJson<CreatedBrand>({
      path: 'api/admin/brands/create-brand.php',
      body: {
        app_name: input.name,
        from_email: input.fromEmail,
        from_name: input.fromName,
        reply_to: input.replyTo,
        login_email: input.loginEmail,
        pass: input.password,
        currency: input.currency,
        language: input.language,
        choose_limit: input.quota === undefined ? undefined : input.quota.replace('-', '_'),
        monthly_limit: input.monthlyLimit,
        'reset-on-day': input.resetDay, // the server reads only the hyphenated spelling
        smtp_host: input.smtpHost,
        smtp_port: input.smtpPort,
        smtp_ssl: input.smtpSsl,
        smtp_username: input.smtpUsername,
        smtp_password: input.smtpPassword,
      },
    })
  } catch (err) {
    if (err instanceof AuthError) throw new AuthError(err.message, ADMIN_HINT)
    throw err
  }
  if (!created || created.status !== 'success' || !created.app_key) {
    throw new ApiError('malformed_response', 'The API did not return the new brand.', undefined, {
      raw: JSON.stringify(created),
    })
  }
  return created
}
