import { Command } from 'commander'

import { SkrybeClient } from '../api/client.js'
import { totalEmailsSent } from '../api/resources/stats.js'
import { normaliseUrl, resolveProfile } from '../config.js'
import { printJson } from '../output.js'
import type { GlobalOptions } from './context.js'

export function statsCommand(getGlobals: () => GlobalOptions): Command {
  const stats = new Command('stats').description('Installation statistics')

  stats
    .command('emails-sent')
    .description('Total emails sent across the whole installation')
    .action(async () => {
      const globals = getGlobals()

      // This endpoint takes no api_key, so --url alone is enough. Fall back to
      // the saved profile when --url was not given.
      const url = globals.url
        ? normaliseUrl(globals.url)
        : resolveProfile({ profile: globals.profile }).url
      const client = new SkrybeClient({ url, apiKey: '' })
      const total = await totalEmailsSent(client)

      if (globals.json) printJson({ total_emails_sent: total })
      else process.stdout.write(`${total.toLocaleString('en-US')}\n`)
    })

  return stats
}
