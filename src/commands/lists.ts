import { Command, Option } from 'commander'

import { UsageError } from '../api/errors.js'
import {
  activeSubscriberCount,
  addCustomField,
  createList,
  deleteCustomField,
  deleteList,
  getList,
  listLists,
  renameCustomField,
  updateList,
  type CustomField,
  type CustomFieldType,
  type ListDetail,
  type OptIn,
} from '../api/resources/lists.js'
import { confirm } from '../input.js'
import { info, renderAction, renderCollection, renderRecord, renderScalar, resolveFormat, warn } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

const count = (n: number): string => n.toLocaleString('en-US')

const optInOption = () =>
  new Option('--opt-in <mode>', 'single, or double to email a confirmation link first').choices(['single', 'double'])

function showFields(list: ListDetail, format: ReturnType<typeof resolveFormat>): void {
  renderCollection<CustomField>(
    list.custom_fields,
    [
      { header: 'NAME', value: (f) => f.name },
      { header: 'TYPE', value: (f) => f.type.toLowerCase() },
      { header: 'TAG', value: (f) => `[${f.name},fallback=]` },
    ],
    format,
    `List "${list.name}" has no custom fields. Add one with \`skrybe lists fields add <list-id> <name>\`.`,
  )
}

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
      ['Custom fields', list.custom_fields.length ? list.custom_fields.map((f) => `${f.name} (${f.type.toLowerCase()})`).join(', ') : '-'],
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
    .action((options: ListOptions) => showLists(getGlobals, options))

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

  // `skrybe lists fields <list-id>` shows them; add/rename/delete dispatch as sub-verbs.
  const fields = lists
    .command('fields')
    .argument('[list-id]')
    .description("A list's custom fields — run with a list ID to show them")
    .action(async (listId: string | undefined) => {
      if (!listId) throw new UsageError('Which list?', 'Run `skrybe lists fields <list-id>`; `skrybe lists` shows the IDs.')
      const globals = getGlobals()
      showFields(await getList(clientFrom(globals), listId), resolveFormat(globals))
    })

  fields
    .command('add <list-id> <name>')
    .description('Add a custom field; every subscriber gets an empty value for it')
    .addOption(new Option('--type <type>', 'text (default) or date').choices(['text', 'date']))
    .action(async (listId: string, name: string, options: { type?: CustomFieldType }) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const list = await addCustomField(clientFrom(globals), listId, name, options.type)
      if (format === 'table') info(`Added "${name}" to list "${list.name}". Use it in emails as [${name},fallback=].`)
      else showFields(list, format)
    })

  fields
    .command('rename <list-id> <name> <new-name>')
    .description('Rename a custom field, keeping its values')
    .action(async (listId: string, name: string, newName: string) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const list = await renameCustomField(clientFrom(globals), listId, name, newName)
      if (format === 'table') {
        info(`Renamed "${name}" to "${newName}". Autoresponders and segments using it were updated;`)
        info(`[${name},fallback=] tags already in campaigns and templates were not.`)
      } else showFields(list, format)
    })

  fields
    .command('delete <list-id> <name>')
    .alias('rm')
    .description("Delete a custom field and every subscriber's value for it")
    .option('-y, --yes', 'Delete without asking for confirmation (required when not run interactively)')
    .action(async (listId: string, name: string, options: { yes?: boolean }) => {
      const globals = getGlobals()
      const client = clientFrom(globals)

      if (!options.yes) {
        if (!process.stdin.isTTY) {
          throw new UsageError('Refusing to delete without confirmation.', 'Pass --yes to delete from a script.')
        }
        const list = await getList(client, listId)
        const total = Object.values(list.subscribers).reduce((a, b) => a + b, 0)
        const question = `Delete "${name}" from list "${list.name}", with its values for ${count(total)} subscribers? This cannot be undone.`
        if (!(await confirm(question))) {
          info('Not deleted.')
          return
        }
      }

      const format = resolveFormat(globals)
      const list = await deleteCustomField(client, listId, name)
      if (format === 'table') info(`Deleted "${name}" from list "${list.name}".`)
      else showFields(list, format)
    })

  return lists
}
