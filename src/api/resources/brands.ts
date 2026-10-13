import type { SkrybeClient } from '../client.js'
import { isProseEmpty } from '../errors.js'
import { parseJsonObject, parseNumberedObject, type NamedEntity } from '../parse.js'

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

export type Transport = 'relay' | 'ses'

export interface BrandTransport {
  brand_id: number
  name: string
  /** `smtp` is an SMTP server other than the relay, set in Edit brand. */
  transport: 'relay' | 'ses' | 'smtp'
  smtp_host: string
  smtp_port: string
  smtp_ssl: string
  smtp_username: string
  /** The password itself is never returned. */
  smtp_password_set: boolean
}

export interface TransportChange {
  transport: Transport
  /** Relay only. May be omitted when the brand already has one for the same username. */
  password?: string
  username?: string
  host?: string
  /** Relay only. false skips the server's login + From check before saving. */
  verify?: boolean
  /** Switch even while one of the brand's campaigns is sending. */
  force?: boolean
}

/**
 * `api/admin/brands/set-transport.php` — shows, or with `change` switches,
 * whether a brand sends through the relay (SMTP) or SES. Main account key only:
 * a brand's own key gets "Invalid API key".
 *
 * Switching is not retried. Reading is.
 */
export async function brandTransport(
  client: SkrybeClient,
  brandId: number,
  change?: TransportChange,
): Promise<BrandTransport> {
  const body = await client.requestText({
    path: 'api/admin/brands/set-transport.php',
    body: {
      brand_id: brandId,
      transport: change?.transport,
      smtp_password: change?.password,
      smtp_username: change?.username,
      smtp_host: change?.host,
      verify: change?.verify === false ? 0 : undefined,
      force: change?.force ? 1 : undefined,
    },
    retryable: change === undefined,
  })
  return parseJsonObject<BrandTransport>(body, 'brand transport')
}
