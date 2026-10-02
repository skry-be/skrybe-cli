import { Command } from 'commander'

import { UsageError } from '../api/errors.js'
import {
  autoresponderEmailStats,
  getAutoresponder,
  listAutoresponders,
  type Autoresponder,
  type AutoresponderEmail,
} from '../api/resources/autoresponders.js'
import { info, printTable, renderCollection, renderRecord, resolveFormat } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

const count = (n: number): string => n.toLocaleString('en-US')

/** Autoresponder and email ids are the plain integers the dashboard shows. */
function numericId(value: string, what: string, hint: string): number {
  if (!/^\d+$/.test(value) || Number(value) === 0) throw new UsageError(`"${value}" is not ${what}.`, hint)
  return Number(value)
}

const TYPE_LABEL: Record<string, string> = { drip: 'drip', annually: 'annually', on_date: 'on date', unknown: '?' }

/** When a drip email goes, or the date field an annual/dated one goes on. */
function schedule(a: Autoresponder): string {
  return a.custom_field ? `${TYPE_LABEL[a.type]} (${a.custom_field})` : TYPE_LABEL[a.type] ?? a.type
}

async function showAutoresponders(getGlobals: () => GlobalOptions, options: { list?: string }): Promise<void> {
  const globals = getGlobals()
  renderCollection<Autoresponder>(
    await listAutoresponders(clientFrom(globals), { listId: options.list }),
    [
      { header: 'ID', value: (a) => String(a.id), align: 'right' },
      { header: 'NAME', value: (a) => a.name },
      { header: 'TYPE', value: (a) => schedule(a) },
      { header: 'EMAILS', value: (a) => `${a.enabled_emails}/${a.emails} on`, align: 'right' },
      { header: 'LIST', value: (a) => a.list_id },
    ],
    resolveFormat(globals),
    options.list ? 'No autoresponders on this list.' : 'No autoresponders yet. Create them in the Skrybe UI.',
  )
}

export function autorespondersCommand(getGlobals: () => GlobalOptions): Command {
  // `skrybe autoresponders` shows them, like `skrybe lists`; sub-verbs still dispatch.
  // Read-only: creating and editing autoresponders stays in the Skrybe UI.
  const autoresponders = new Command('autoresponders')
    .alias('ares')
    .description('Autoresponders — run bare to show them (read-only)')
    .allowExcessArguments(false)
    .option('--list <list-id>', "Only this list's autoresponders")
    .action((options: { list?: string }) => showAutoresponders(getGlobals, options))

  // The parent declares --list too, and Commander hands it to the parent, so
  // `ls` reads it back through optsWithGlobals(), as `campaigns ls` does.
  autoresponders
    .command('ls')
    .alias('list')
    .description("Show the brand's autoresponders")
    .option('--list <list-id>', "Only this list's autoresponders")
    .action((_options: { list?: string }, command: Command) =>
      showAutoresponders(getGlobals, command.optsWithGlobals<{ list?: string }>()),
    )

  autoresponders
    .command('emails <autoresponder-id>')
    .description("An autoresponder's emails, in the order they go out")
    .action(async (id: string) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const a = await getAutoresponder(
        clientFrom(globals),
        numericId(id, 'an autoresponder ID', 'Run `skrybe autoresponders` to see the IDs.'),
      )

      if (format === 'json') {
        process.stdout.write(`${JSON.stringify(a, null, 2)}\n`)
        return
      }
      if (format === 'table') info(`${a.name}: ${schedule(a)}, ${a.enabled_emails} of ${a.emails} emails on.`)
      renderCollection<AutoresponderEmail>(
        a.email_list,
        [
          { header: 'ID', value: (e) => String(e.id), align: 'right' },
          { header: 'WHEN', value: (e) => e.when || '-' },
          { header: 'ON', value: (e) => (e.enabled ? 'yes' : 'no') },
          { header: 'SENT', value: (e) => count(e.recipients), align: 'right' },
          { header: 'SUBJECT', value: (e) => e.subject },
        ],
        format,
        'This autoresponder has no emails yet.',
      )
    })

  autoresponders
    .command('stats <email-id>')
    .description('Opens, clicks, bounces, complaints and unsubscribes for one autoresponder email')
    .action(async (id: string) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const s = await autoresponderEmailStats(
        clientFrom(globals),
        numericId(id, 'an autoresponder email ID', 'Run `skrybe autoresponders emails <autoresponder-id>` to see them.'),
      )

      renderRecord(
        s,
        [
          ['Recipients', count(s.recipients)],
          ['Opens', `${count(s.opens.unique)} unique (${s.opens.rate}%), ${count(s.opens.total)} total`],
          ['Clicks', `${count(s.clicks.unique)} unique (${s.clicks.rate}%), ${count(s.clicks.total)} total`],
          ['Bounces', `${count(s.bounces.hard)} hard, ${count(s.bounces.soft)} soft`],
          ['Complaints', count(s.complaints)],
          ['Unsubscribes', count(s.unsubscribes)],
        ],
        format,
      )
      if (format === 'table' && s.links.length > 0) {
        process.stdout.write('\n')
        printTable(s.links, [
          { header: 'CLICKS', value: (l) => count(l.clicks), align: 'right' },
          { header: 'UNIQUE', value: (l) => count(l.unique_clicks), align: 'right' },
          { header: 'LINK', value: (l) => l.url },
        ])
      }
    })

  return autoresponders
}
