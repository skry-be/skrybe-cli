import { Command } from 'commander'

import { activeSubscriberCount, listLists } from '../api/resources/lists.js'
import { dim, info, printJson, printTable } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

export function listsCommand(getGlobals: () => GlobalOptions): Command {
  const lists = new Command('lists').description('Inspect subscriber lists')

  lists
    .command('list')
    .alias('ls')
    .description('List the subscriber lists for the current brand')
    .option('--include-hidden', 'Include lists hidden in the UI')
    .option('--counts', 'Fetch the active subscriber count for each list (one request per list)')
    .action(async (options: { includeHidden?: boolean; counts?: boolean }) => {
      const globals = getGlobals()
      const client = clientFrom(globals)
      const rows = await listLists(client, { includeHidden: options.includeHidden })

      if (rows.length === 0) {
        if (globals.json) printJson([])
        else info(dim('No lists found for this brand.'))
        return
      }

      // There is no bulk count endpoint, so this is N requests. Opt-in only.
      // A single failing list must not take down the whole listing — a stale or
      // cross-brand id shows as `-` rather than aborting.
      const counts = options.counts
        ? await Promise.all(
            rows.map((row) =>
              activeSubscriberCount(client, row.id).catch(() => null),
            ),
          )
        : null

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
                  r.active_subscribers == null
                    ? '-'
                    : r.active_subscribers.toLocaleString('en-US'),
                align: 'right' as const,
              },
            ]
          : []),
      ])
    })

  lists
    .command('count <list-id>')
    .description('Show the active subscriber count for one list')
    .action(async (listId: string) => {
      const globals = getGlobals()
      const count = await activeSubscriberCount(clientFrom(globals), listId)

      if (globals.json) printJson({ list_id: listId, active_subscribers: count })
      else process.stdout.write(`${count}\n`)
    })

  return lists
}
