/**
 * `api/lists/get-lists.php` and `api/brands/get-brands.php` build their payload
 * by string concatenation:
 *
 *   $output .= '"list'.$i.'": { "id": "'.encrypt_val($id).'", "name": "'.$name.'" },'
 *
 * Consequences we have to live with until those endpoints use json_encode():
 *   - no Content-Type header
 *   - entries are keyed `list1`, `list2`, ... rather than being an array
 *   - the name is NOT escaped, so a list called `Q4 "Big" Push` emits invalid JSON
 *
 * The id is safe to match on: encrypt_val() base64s and then substitutes
 * `/` -> 892 and `+` -> 763 and strips `=`, so it never contains a quote.
 * That gives us a reliable structural anchor for the fallback parser.
 */

import { ApiError, Exit, excerpt } from './errors.js'

export interface NamedEntity {
  id: string
  name: string
}

/**
 * Structural fallback for payloads JSON.parse rejects.
 *
 * The trailing lookahead is what makes an embedded quote survive: the lazy
 * name match can only stop at a `"` that is followed by the closing brace of
 * the entry AND either the next `listN`/`brandN` key or the end of the object.
 */
function extractByStructure(body: string, prefix: string): NamedEntity[] {
  const entry = new RegExp(
    String.raw`"${prefix}\d+"\s*:\s*\{\s*` +
      String.raw`"id"\s*:\s*"([^"]*)"\s*,\s*` +
      String.raw`"name"\s*:\s*"([\s\S]*?)"\s*\}` +
      String.raw`(?=\s*,\s*"${prefix}\d+"\s*:|\s*\}\s*$)`,
    'g',
  )

  const out: NamedEntity[] = []
  for (const match of body.matchAll(entry)) {
    out.push({ id: match[1] ?? '', name: match[2] ?? '' })
  }
  return out
}

/**
 * Parse a `{"list1": {...}, "list2": {...}}` payload into an ordered array.
 *
 * @param prefix the key prefix the endpoint uses — `list` or `brand`
 * @throws if the body is neither valid JSON nor structurally recognisable
 */
export function parseNumberedObject(body: string, prefix: 'list' | 'brand'): NamedEntity[] {
  const trimmed = body.trim()
  if (trimmed === '') return []

  // Happy path, and the path this takes once the endpoints use json_encode().
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: NamedEntity[] = []
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!key.startsWith(prefix)) continue
        if (value === null || typeof value !== 'object') continue
        const row = value as Record<string, unknown>
        out.push({ id: String(row.id ?? ''), name: String(row.name ?? '') })
      }
      return sortByNumericSuffix(out, parsed as Record<string, unknown>, prefix)
    }
  } catch {
    // Fall through — almost certainly an unescaped quote in a name.
  }

  const recovered = extractByStructure(trimmed, prefix)
  if (recovered.length > 0) return recovered

  // The body is the whole diagnosis here — it is usually a PHP warning or an
  // interstitial from something in front of the install — so show it rather
  // than describing it. `raw` keeps the untruncated version for callers.
  throw new ApiError(
    'malformed_response',
    `Could not parse the ${prefix} payload returned by the API.`,
    Exit.API_ERROR,
    { raw: body, hint: `The server sent: ${excerpt(trimmed)}` },
  )
}

/**
 * Object key order in PHP's output is already list1..listN, and V8 preserves
 * insertion order for string keys, so this is belt-and-braces for the case
 * where a future endpoint emits them out of order.
 */
function sortByNumericSuffix(
  rows: NamedEntity[],
  source: Record<string, unknown>,
  prefix: string,
): NamedEntity[] {
  const keys = Object.keys(source).filter((k) => k.startsWith(prefix))
  const order = new Map<number, number>()
  keys.forEach((key, index) => {
    const n = Number.parseInt(key.slice(prefix.length), 10)
    if (!Number.isNaN(n)) order.set(index, n)
  })
  return rows
    .map((row, index) => ({ row, sort: order.get(index) ?? index }))
    .sort((a, b) => a.sort - b.sort)
    .map((x) => x.row)
}

/**
 * Parse a numbered payload from an endpoint that builds it with json_encode()
 * (`api/campaigns/get-campaigns.php`), so the rows are trusted as-is rather
 * than cut down to `{id, name}`.
 *
 * @param prefix the key prefix the endpoint uses, e.g. `campaign`
 * @throws if the body is not a JSON object
 */
export function parseNumberedRecords<T>(body: string, prefix: string): T[] {
  const parsed = parseJsonObject<Record<string, unknown>>(body, `${prefix} payload`)
  const key = new RegExp(`^${prefix}(\\d+)$`)

  return Object.entries(parsed)
    .map(([name, value]) => ({ match: key.exec(name), value }))
    .filter((entry): entry is { match: RegExpExecArray; value: unknown } =>
      entry.match !== null && entry.value !== null && typeof entry.value === 'object',
    )
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map((entry) => entry.value as T)
}

/**
 * Parse a body that must be a JSON object, e.g. `api/campaigns/stats.php`.
 * Anything else is almost always a PHP warning or a proxy page, so the body
 * itself goes in the hint.
 */
export function parseJsonObject<T>(body: string, what: string): T {
  const trimmed = body.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T
  } catch {
    // Reported below with the body intact.
  }
  throw new ApiError(
    'malformed_response',
    `Could not parse the ${what} returned by the API.`,
    Exit.API_ERROR,
    { raw: body, hint: `The server sent: ${excerpt(trimmed)}` },
  )
}
