import pc from 'picocolors'

import { UsageError } from './api/errors.js'

/** Colour is off for pipes, dumb terminals and NO_COLOR. */
export const useColor = (): boolean =>
  process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb'

const paint = (fn: (s: string) => string, s: string): string => (useColor() ? fn(s) : s)

export const dim = (s: string) => paint(pc.dim, s)
export const bold = (s: string) => paint(pc.bold, s)
export const red = (s: string) => paint(pc.red, s)
export const yellow = (s: string) => paint(pc.yellow, s)
export const green = (s: string) => paint(pc.green, s)

export interface Column<T> {
  header: string
  value: (row: T) => string
  align?: 'left' | 'right'
}

/**
 * Data goes to stdout, diagnostics to stderr, so `skrybe lists list --json | jq`
 * and `skrybe lists list > out.txt` both behave.
 */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function printTable<T>(rows: T[], columns: Column<T>[]): void {
  if (rows.length === 0) return

  const cells = rows.map((row) => columns.map((col) => col.value(row)))
  const widths = columns.map((col, i) =>
    Math.max(col.header.length, ...cells.map((row) => (row[i] ?? '').length)),
  )

  const line = (values: string[], transform: (s: string) => string = (s) => s): string =>
    values
      .map((value, i) => {
        const width = widths[i] ?? value.length
        const padded =
          columns[i]?.align === 'right' ? value.padStart(width) : value.padEnd(width)
        return transform(padded)
      })
      .join('  ')
      .trimEnd()

  process.stdout.write(`${line(columns.map((c) => c.header), bold)}\n`)
  for (const row of cells) process.stdout.write(`${line(row)}\n`)
}

export function info(message: string): void {
  process.stderr.write(`${message}\n`)
}

export function success(message: string): void {
  process.stderr.write(`${green('✓')} ${message}\n`)
}

export function warn(message: string): void {
  process.stderr.write(`${yellow('!')} ${message}\n`)
}

/**
 * `table` is the human format; `json` and `text` are the machine ones.
 *
 * That distinction is what decides how a command that performs an action
 * rather than returning data behaves: under `table` it prints a sentence to
 * stderr and nothing to stdout, and under `json`/`text` it emits the result
 * record to stdout so it can be piped.
 */
export type OutputFormat = 'table' | 'json' | 'text'

const FORMATS = new Set<OutputFormat>(['table', 'json', 'text'])

export interface FormatOptions {
  output?: string
  /** `--json`, kept as a shorthand for `--output json`. */
  json?: boolean
}

/**
 * Resolution order: --json, then --output, then SKRYBE_OUTPUT, then table.
 * A bad value is reported rather than silently falling back, since a script
 * asking for json and quietly getting a table would be worse than an error.
 */
export function resolveFormat(opts: FormatOptions): OutputFormat {
  if (opts.json) return 'json'

  const requested = opts.output ?? process.env.SKRYBE_OUTPUT
  if (requested === undefined || requested === '') return 'table'

  const normalised = requested.trim().toLowerCase()
  if (!FORMATS.has(normalised as OutputFormat)) {
    throw new UsageError(
      `"${requested}" is not a supported output format.`,
      `Use one of: ${[...FORMATS].join(', ')}`,
    )
  }
  return normalised as OutputFormat
}

/** Tab-separated, no header, no padding — for `cut -f2` and `while read`. */
function printText(rows: string[][]): void {
  for (const row of rows) process.stdout.write(`${row.join('\t')}\n`)
}

/**
 * Render a collection. `json` emits the rows as given rather than the rendered
 * cells, so numbers stay numbers and nulls stay null.
 */
export function renderCollection<T>(
  rows: T[],
  columns: Column<T>[],
  format: OutputFormat,
  empty?: string,
): void {
  if (format === 'json') {
    printJson(rows)
    return
  }
  if (format === 'text') {
    printText(rows.map((row) => columns.map((col) => col.value(row))))
    return
  }
  if (rows.length === 0) {
    // An empty collection is a success, so the note goes to stderr and stdout
    // stays empty rather than carrying a message a script would have to skip.
    if (empty) info(dim(empty))
    return
  }
  printTable(rows, columns)
}

/**
 * Render a single value, such as a count or a status. Under `table` and `text`
 * this is the bare value, so `$(skrybe lists count <id>)` captures a number.
 */
export function renderScalar(
  value: string | number,
  record: Record<string, unknown>,
  format: OutputFormat,
): void {
  if (format === 'json') printJson(record)
  else process.stdout.write(`${value}\n`)
}

/**
 * Render the result of an action. Under `table` the sentence goes to stderr,
 * leaving stdout empty; the machine formats emit the record instead.
 */
export function renderAction(
  record: Record<string, unknown>,
  human: string,
  format: OutputFormat,
): void {
  if (format === 'json') printJson(record)
  else if (format === 'text') printText([Object.values(record).map((v) => (v == null ? '' : String(v)))])
  else success(human)
}
