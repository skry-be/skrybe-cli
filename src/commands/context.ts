import { SkrybeClient } from '../api/client.js'
import { resolveProfile } from '../config.js'

export interface GlobalOptions {
  profile?: string
  url?: string
  json?: boolean
}

/** Build a client from the resolved profile. Throws UsageError if unconfigured. */
export function clientFrom(opts: GlobalOptions): SkrybeClient {
  const profile = resolveProfile({ profile: opts.profile, url: opts.url })
  return new SkrybeClient({ url: profile.url, apiKey: profile.apiKey })
}
