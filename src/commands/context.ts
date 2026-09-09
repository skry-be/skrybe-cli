import { SkrybeClient } from '../api/client.js'
import { resolveProfile } from '../config.js'

export interface GlobalOptions {
  profile?: string
  url?: string
  /** `table` (default), `json` or `text`. */
  output?: string
  /** Shorthand for `--output json`. */
  json?: boolean
}

/** Build a client from the resolved profile. Throws UsageError if unconfigured. */
export function clientFrom(opts: GlobalOptions): SkrybeClient {
  const profile = resolveProfile({ profile: opts.profile, url: opts.url })
  return new SkrybeClient({ url: profile.url, apiKey: profile.apiKey })
}
