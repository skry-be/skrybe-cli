import pc from 'picocolors'

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
