import { Command, Option } from 'commander'

import { UsageError } from '../api/errors.js'
import {
  autoresponderEmailStats,
  createAutoresponder,
  createAutoresponderEmail,
  getAutoresponder,
  listAutoresponders,
  type Autoresponder,
  type AutoresponderEmail,
  type NewAutoresponder,
} from '../api/resources/autoresponders.js'
import { resolveArg, resolveOptionalArg } from '../input.js'
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
    options.list
      ? 'No autoresponders on this list.'
      : 'No autoresponders yet. Create one with `skrybe autoresponders create <name> --list <list-id>`.',
  )
}

export function autorespondersCommand(getGlobals: () => GlobalOptions): Command {
  // `skrybe autoresponders` shows them, like `skrybe lists`; sub-verbs still dispatch.
  // Creating works here; editing autoresponders stays in the Skrybe UI.
  const autoresponders = new Command('autoresponders')
    .alias('ares')
    .description('Autoresponders — run bare to show them')
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

  autoresponders
    .command('create <name>')
    .description('Create an autoresponder on a list; prints its id. Add emails with `add-email`')
    .option('--list <list-id>', 'List it belongs to (required)')
    .addOption(
      new Option('--type <type>', 'drip: after signing up; annually or on_date: on a date field')
        .choices(['drip', 'annually', 'on_date'])
        .default('drip'),
    )
    .option('--field <name>', 'The date field an annually or on_date one sends on, e.g. Birthday')
    .addHelpText(
      'after',
      '\nA list has one drip, and each date field drives one autoresponder.\n' +
        'e.g. skrybe autoresponders create "Birthday wishes" --list <id> --type annually --field Birthday',
    )
    // --list is also the parent's option, so it is read back through optsWithGlobals().
    .action(async (name: string, _options: unknown, command: Command) => {
      const options = command.optsWithGlobals<{ list?: string; type: NewAutoresponder['type']; field?: string }>()
      if (!options.list) throw new UsageError('An autoresponder belongs to a list.', 'Pass --list <list-id>.')
      if (options.type !== 'drip' && !options.field) {
        throw new UsageError(`An ${options.type} autoresponder sends on a date field.`, 'Pass --field, e.g. --field Birthday.')
      }
      if (options.type === 'drip' && options.field) {
        throw new UsageError('A drip goes out after signing up, not on a field.', 'Drop --field, or pass --type annually.')
      }
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const a = await createAutoresponder(clientFrom(globals), {
        name,
        listId: options.list,
        type: options.type,
        customField: options.field,
      })
      // The id is what a script needs next, so it goes to stdout even in table mode.
      if (format === 'table') {
        info(`Created autoresponder "${a.name}": ${schedule(a)}.`)
        process.stdout.write(`${a.id}\n`)
      } else renderRecord(a, [], format)
    })

  autoresponders
    .command('add-email <autoresponder-id>')
    .description('Add an email to an autoresponder; prints its id. It is created off unless --enable')
    .requiredOption('--subject <subject>', 'Subject line; personalization tags work, e.g. [Name,fallback=friend]')
    .requiredOption('--html-text <html|file://path>', 'HTML body, or file:// a path to it')
    .option('--plain-text <text|file://path>', 'Plain text body, or file:// a path to it')
    .option('--preheader <text>', 'Preview text shown after the subject in the inbox')
    .option('--when <when>', 'Drip: immediately or "+3 days". Dated: on, "+9 hours" or "-1 days"')
    .option('--from-name <name>', "The 'From' name. Defaults to the brand's")
    .option('--from-email <email>', "The 'From' address. Defaults to the brand's")
    .option('--reply-to <email>', "The 'Reply to' address. Defaults to the brand's")
    .option('--enable', 'Turn it on now, so it starts sending')
    .action(
      async (
        id: string,
        options: {
          subject: string
          htmlText: string
          plainText?: string
          preheader?: string
          when?: string
          fromName?: string
          fromEmail?: string
          replyTo?: string
          enable?: boolean
        },
      ) => {
        const globals = getGlobals()
        const format = resolveFormat(globals)
        const autoresponderId = numericId(id, 'an autoresponder ID', 'Run `skrybe autoresponders` to see the IDs.')
        const e = await createAutoresponderEmail(clientFrom(globals), autoresponderId, {
          subject: options.subject,
          htmlText: resolveArg(options.htmlText, '--html-text'),
          plainText: resolveOptionalArg(options.plainText, '--plain-text'),
          preheader: options.preheader,
          when: options.when,
          fromName: options.fromName,
          fromEmail: options.fromEmail,
          replyTo: options.replyTo,
          enabled: options.enable,
        })
        if (format === 'table') {
          const when = e.when === '' ? 'on the date' : e.when
          info(
            e.enabled
              ? `Added email ${e.id} (${when}). It is on.`
              : `Added email ${e.id} (${when}). It is off: turn it on in the Skrybe UI, or re-create it with --enable.`,
          )
          process.stdout.write(`${e.id}\n`)
        } else renderRecord(e, [], format)
      },
    )

  return autoresponders
}
