import { Command } from 'commander'

import { activeSubscriberCount, listLists } from '../api/resources/lists.js'
import { dim, info, printJson, printTable, warn } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

interface ListOptions {
  includeHidden?: boolean
  counts?: boolean
}

async function showLists(getGlobals: () => GlobalOptions, options: ListOptions): Promise<void> {
  const globals = getGlobals()
  const client = clientFrom(globals)
  const rows = await listLists(client, { includeHidden: options.includeHidden })

  if (rows.length === 0) {
    // An empty collection is not a failure — exit 0, and say so on stderr so
    // `--json` still emits a valid empty array on stdout.
    if (globals.json) printJson([])
    else info(dim('No lists yet. Create one in the Skrybe UI.'))
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

  if (globals.json) {
    printJson(enriched)
    return
  }

  printTable(enriched, [
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
  ])
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
    .action((options: ListOptions) => showLists(getGlobals, options))

  lists
    .command('count <list-id>')
    .description('Active subscriber count for one list')
    .action(async (listId: string) => {
      const globals = getGlobals()
      const count = await activeSubscriberCount(clientFrom(globals), listId)

      if (globals.json) printJson({ list_id: listId, active_subscribers: count })
      else process.stdout.write(`${count}\n`)
    })

  return lists
}
