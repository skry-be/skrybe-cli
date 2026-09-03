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

  throw new Error(
    `Could not parse the ${prefix} payload returned by the API. ` +
      `Re-run with --json to see the raw response.`,
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
