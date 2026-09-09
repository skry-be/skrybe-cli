import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { UsageError } from './api/errors.js'

/**
 * Resolve an argument that may name a file instead of carrying a value.
 *
 * An HTML email body cannot be typed at a shell prompt, so `--html-text` and
 * friends accept AWS's `file://` convention:
 *
 *   --html-text file://campaign.html
 *
 * The path is taken literally after the prefix and resolved against the working
 * directory, so both `file://body.html` and `file:///abs/path.html` work.
 * Anything without the prefix is returned untouched, which keeps short values
 * inline and means a value that merely contains "://" is never misread.
 */
export function resolveArg(value: string, label: string): string {
  if (!value.startsWith('file://')) return value

  const path = resolve(value.slice('file://'.length))
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'No such file' : (err as Error).message
    throw new UsageError(
      `Could not read ${label} from ${path}: ${reason}.`,
      'Drop the file:// prefix to pass the value inline.',
    )
  }
}

/** Same, for an argument that is optional. */
export function resolveOptionalArg(
  value: string | undefined,
  label: string,
): string | undefined {
  return value === undefined ? undefined : resolveArg(value, label)
}

/**
 * Parse repeatable `--field Name=value` pairs.
 *
 * subscribe.php takes a custom field by its personalization tag name, so the
 * keys are arbitrary and cannot be validated against a known set here. Only the
 * shape is checked. Splitting on the first `=` keeps values containing `=`.
 */
export function parseFields(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of pairs) {
    const at = pair.indexOf('=')
    if (at < 1) {
      throw new UsageError(
        `"${pair}" is not a valid field.`,
        'Use --field Name=value, e.g. --field Birthday=1990-01-01',
      )
    }
    out[pair.slice(0, at)] = pair.slice(at + 1)
  }
  return out
}
