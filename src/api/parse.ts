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

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, resolve } from 'node:path'

import XLSX from 'xlsx'

import { ApiError, Exit, UsageError, excerpt } from './errors.js'

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

export interface ParsedSubscriberRow {
  email: string
  name?: string
  fields?: Record<string, string>
}

export const IMPORT_FORMAT_EXAMPLE = `Expected Table Format:
┌─────────────────────────┬──────────────┬───────────┐
│ Email                   │ Name         │ Country   │
├─────────────────────────┼──────────────┼───────────┤
│ ada@example.com         │ Ada Lovelace │ GB        │
│ grace@example.com       │ Grace Hopper │ US        │
└─────────────────────────┴──────────────┴───────────┘
Supported files: Excel (.xlsx, .xls), CSV (.csv), TSV (.tsv), Plain Text (.txt)`

export function resolveFilePath(rawPath: string): string {
  if (rawPath.startsWith('~/')) {
    return resolve(homedir(), rawPath.slice(2))
  }
  return resolve(rawPath)
}

export function parseSubscriberFile(rawPath: string): ParsedSubscriberRow[] {
  const filePath = resolveFilePath(rawPath)
  if (!existsSync(filePath)) {
    throw new UsageError(`File not found: ${filePath}`)
  }

  const ext = extname(filePath).toLowerCase()
  const rows: ParsedSubscriberRow[] = []

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(filePath)
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) {
      throw new UsageError(`Excel workbook has no sheets: ${filePath}`)
    }
    const sheet = workbook.Sheets[firstSheetName]
    if (!sheet) {
      throw new UsageError(`Sheet "${firstSheetName}" not found in workbook: ${filePath}`)
    }
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    for (const record of data) {
      const keys = Object.keys(record)
      let email = ''
      let name = ''
      const customFields: Record<string, string> = {}

      for (const k of keys) {
        const lower = k.trim().toLowerCase()
        const val = String(record[k] ?? '').trim()
        if (!val) continue

        if (lower === 'email' || lower === 'e-mail' || lower === 'email_address' || lower === 'mail') {
          email = val
        } else if (lower === 'name' || lower === 'full_name' || lower === 'fullname' || lower === 'first_name') {
          name = val
        } else {
          customFields[k.trim()] = val
        }
      }

      if (email && email.includes('@')) {
        rows.push({
          email,
          ...(name ? { name } : {}),
          ...(Object.keys(customFields).length > 0 ? { fields: customFields } : {}),
        })
      }
    }
  } else {
    // Delimited or plain text
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

    const firstLine = lines[0]
    if (!firstLine) {
      throw new UsageError(`File is empty: ${filePath}`)
    }

    const isTsv = ext === '.tsv' || (!firstLine.includes(',') && firstLine.includes('\t'))
    const delimiter = isTsv ? '\t' : ','
    const firstCols = firstLine.split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim())
    const emailIndex = firstCols.findIndex((c) => {
      const low = c.toLowerCase()
      return low === 'email' || low === 'e-mail' || low === 'mail'
    })

    if (emailIndex !== -1) {
      const nameIndex = firstCols.findIndex((c) => {
        const low = c.toLowerCase()
        return low === 'name' || low === 'full_name' || low === 'fullname' || low === 'first_name'
      })

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        if (!line) continue
        const cols = line.split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim())
        const email = cols[emailIndex] ?? ''
        const name = nameIndex !== -1 ? (cols[nameIndex] ?? '') : ''
        const customFields: Record<string, string> = {}

        firstCols.forEach((colName, idx) => {
          if (idx !== emailIndex && idx !== nameIndex && cols[idx]) {
            customFields[colName] = cols[idx]
          }
        })

        if (email && email.includes('@')) {
          rows.push({
            email,
            ...(name ? { name } : {}),
            ...(Object.keys(customFields).length > 0 ? { fields: customFields } : {}),
          })
        }
      }
    } else {
      for (const line of lines) {
        const parts = line.split(/[,\t]/).map((p) => p.replace(/^["']|["']$/g, '').trim())
        const foundEmail = parts.find((p) => p.includes('@'))
        if (foundEmail) {
          const name = parts.find((p) => p !== foundEmail && p.length > 0)
          rows.push({
            email: foundEmail,
            ...(name ? { name } : {}),
          })
        }
      }
    }
  }

  if (rows.length === 0) {
    throw new UsageError(
      `No valid subscriber rows found in ${filePath}.\n\n${IMPORT_FORMAT_EXAMPLE}`,
    )
  }

  return rows
}
