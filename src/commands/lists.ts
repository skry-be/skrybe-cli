import { Command, Option } from 'commander'

import { UsageError } from '../api/errors.js'
import {
  activeSubscriberCount,
  createList,
  deleteList,
  getList,
  listLists,
  updateList,
  type ListDetail,
  type OptIn,
} from '../api/resources/lists.js'
import { confirm } from '../input.js'
import { info, renderAction, renderCollection, renderRecord, renderScalar, resolveFormat, warn } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

const count = (n: number): string => n.toLocaleString('en-US')

const optInOption = () =>
  new Option('--opt-in <mode>', 'single, or double to email a confirmation link first').choices(['single', 'double'])

function showList(list: ListDetail, format: ReturnType<typeof resolveFormat>): void {
  const s = list.subscribers
  renderRecord(
    list,
    [
      ['ID', list.id],
      ['Name', list.name],
      ['Opt-in', list.opt_in],
      ['Active', count(s.active)],
      ['Unconfirmed', count(s.unconfirmed)],
      ['Unsubscribed', count(s.unsubscribed)],
      ['Bounced', count(s.bounced)],
      ['Complained', count(s.complained)],
    ],
    format,
  )
}

interface ListOptions {
  includeHidden?: boolean
  counts?: boolean
}

async function showLists(getGlobals: () => GlobalOptions, options: ListOptions): Promise<void> {
  const globals = getGlobals()
  const format = resolveFormat(globals)
  const client = clientFrom(globals)
  const rows = await listLists(client, { includeHidden: options.includeHidden })

  if (rows.length === 0) {
    // An empty collection is not a failure — exit 0, and say so on stderr so
    // the machine formats still emit a valid empty result on stdout.
    renderCollection([], [], format, 'No lists yet. Create one with `skrybe lists create <name>`.')
    return
  }

  // There is no bulk count endpoint, so this is one request per list.
  // A single failing list must not take down the listing — it shows as `-`,
  // never as 0, and stderr says how many were lost so an unreadable count is
  // not mistaken for an empty list.
  const counts = options.counts
    ? await Promise.all(rows.map((row) => activeSubscriberCount(client, row.id).catch(() => null)))
    : null

  const failed = counts?.filter((count) => count === null).length ?? 0
  if (failed > 0) {
    warn(`Could not read a count for ${failed} of ${rows.length} lists.`)
  }

  const enriched = rows.map((row, i) => ({
    ...row,
    ...(counts ? { active_subscribers: counts[i] ?? null } : {}),
  }))

  renderCollection(enriched, [
    { header: 'ID', value: (r) => r.id },
    { header: 'NAME', value: (r) => r.name },
    ...(counts
      ? [
          {
            header: 'ACTIVE',
            value: (r: (typeof enriched)[number]) =>
              r.active_subscribers == null ? '-' : r.active_subscribers.toLocaleString('en-US'),
            align: 'right' as const,
          },
        ]
      : []),
  ], format)
}

export function listsCommand(getGlobals: () => GlobalOptions): Command {
  // `skrybe lists` shows the lists. The bare noun is the common case, so it
  // needs no verb; `ls` stays as an explicit alias, and sub-verbs still
  // dispatch normally.
  const lists = new Command('lists')
    .description('Subscriber lists — run bare to show them')
    // A default action makes an unknown subcommand look like an operand;
    // without this, `skrybe lists bogus` would silently list instead of erroring.
    .allowExcessArguments(false)
    .option('--include-hidden', 'Include lists hidden in the UI')
    .option('--counts', 'Also fetch active subscriber counts (one request per list)')
    .action((options: ListOptions) => showLists(getGlobals, options))

  lists
    .command('ls')
    .alias('list')
    .description('Show the subscriber lists for the current brand')
    .option('--include-hidden', 'Include lists hidden in the UI')
    .option('--counts', 'Also fetch active subscriber counts (one request per list)')
    .action((_options: ListOptions, command: Command) =>
      showLists(getGlobals, command.optsWithGlobals<ListOptions>()),
    )

  lists
    .command('count <list-id>')
    .description('Active subscriber count for one list')
    .action(async (listId: string) => {
      const globals = getGlobals()
      const count = await activeSubscriberCount(clientFrom(globals), listId)

      renderScalar(count, { list_id: listId, active_subscribers: count }, resolveFormat(globals))
    })

  lists
    .command('get <list-id>')
    .description('Show one list, with its subscribers counted by state')
    .action(async (listId: string) => {
      const globals = getGlobals()
      showList(await getList(clientFrom(globals), listId), resolveFormat(globals))
    })

  lists
    .command('create <name>')
    .description('Create a list')
    .addOption(optInOption())
    .action(async (name: string, options: { optIn?: OptIn }) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const list = await createList(clientFrom(globals), name, options.optIn)
      // The id is what a script needs next, so it goes to stdout even in table mode.
      if (format === 'table') {
        info(`Created list "${list.name}" (${list.opt_in} opt-in).`)
        process.stdout.write(`${list.id}\n`)
      } else showList(list, format)
    })

  lists
    .command('update <list-id>')
    .description('Rename a list, or switch its opt-in')
    .option('--name <name>', 'New name')
    .addOption(optInOption())
    .action(async (listId: string, options: { name?: string; optIn?: OptIn }) => {
      if (options.name === undefined && options.optIn === undefined) {
        throw new UsageError('Nothing to update.', 'Pass --name and/or --opt-in.')
      }
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const list = await updateList(clientFrom(globals), listId, options)
      if (format === 'table') info(`Updated list "${list.name}" (${list.opt_in} opt-in).`)
      else showList(list, format)
    })

  lists
    .command('delete <list-id>')
    .alias('rm')
    .description('Delete a list and all its subscribers')
    .option('-y, --yes', 'Delete without asking for confirmation (required when not run interactively)')
    .action(async (listId: string, options: { yes?: boolean }) => {
      const globals = getGlobals()
      const client = clientFrom(globals)

      if (!options.yes) {
        if (!process.stdin.isTTY) {
          throw new UsageError('Refusing to delete without confirmation.', 'Pass --yes to delete from a script.')
        }
        // Fetching it first also fails fast on a wrong or foreign id.
        const list = await getList(client, listId)
        const total = Object.values(list.subscribers).reduce((a, b) => a + b, 0)
        if (!(await confirm(`Delete list "${list.name}" and its ${count(total)} subscribers? This cannot be undone.`))) {
          info('Not deleted.')
          return
        }
      }

      const r = await deleteList(client, listId)
      renderAction({ outcome: 'deleted', list_id: r.id }, `Deleted list ${listId}.`, resolveFormat(globals))
    })

  return lists
}
