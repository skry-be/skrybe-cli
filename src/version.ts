import { createRequire } from 'node:module'

/**
 * Read from package.json rather than a constant, so a release never ships a
 * version string that disagrees with the manifest npm published.
 */
export function version(): string {
  try {
    const require = createRequire(import.meta.url)
    return (require('../package.json') as { version: string }).version
  } catch {
    return '0.0.0'
  }
}

/** Sent on every request so the API can tell CLI traffic from a hand-rolled curl. */
export function userAgent(): string {
  return `skrybe-cli/${version()} node/${process.versions.node}`
}
