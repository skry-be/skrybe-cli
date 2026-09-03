import type { SkrybeClient } from '../client.js'
import { isProseEmpty } from '../errors.js'
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
  const body = await client.requestText({ path: 'api/brands/get-brands.php' })
  if (isProseEmpty(body)) return []
  return parseNumberedObject(body, 'brand')
}
