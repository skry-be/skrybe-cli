import { Command, Option } from 'commander'

import { UsageError } from '../api/errors.js'
import {
  MAX_SUBSCRIBERS_PAGE,
  SUBSCRIBER_STATUSES,
  deleteSubscriber,
  listAllSubscribers,
  listSubscribers,
  subscribe,
  subscriptionStatus,
  unsubscribe,
  type Subscriber,
  type SubscriberStatus,
} from '../api/resources/subscribers.js'
import { parseFields } from '../input.js'
import { info, renderAction, renderCollection, renderScalar, resolveFormat, when } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

interface AddOptions {
  list: string
  name?: string
  country?: string
  ipAddress?: string
  referrer?: string
  gdpr?: boolean
  silent?: boolean
  field: string[]
}

interface RefOptions {
  list: string
}

/** Repeatable option collector for Commander. */
const collect = (value: string, previous: string[]): string[] => [...previous, value]

interface ShowOptions {
  list: string
  status?: SubscriberStatus
  page?: string
  limit?: string
  all?: boolean
}

function showOptions(command: Command): Command {
  return command
    .requiredOption('--list <list-id>', 'List ID, as shown by `skrybe lists`')
    .addOption(new Option('--status <status>', 'Only subscribers in this state').choices(SUBSCRIBER_STATUSES))
    .option('--page <n>', 'Page to show, oldest first (default 1)')
    .option('--limit <n>', `Subscribers per page, up to ${MAX_SUBSCRIBERS_PAGE} (default 100)`)
    .option('--all', 'Fetch every page')
}

function positive(value: string | undefined, flag: string, max?: number): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || (max !== undefined && n > max)) {
    throw new UsageError(`${flag} must be a whole number from 1${max ? ` to ${max}` : ' up'}.`)
  }
  return n
}

async function showSubscribers(getGlobals: () => GlobalOptions, options: ShowOptions): Promise<void> {
  if (options.all && (options.page !== undefined || options.limit !== undefined)) {
    throw new UsageError('--all fetches every page, so it cannot be combined with --page or --limit.')
  }
  const globals = getGlobals()
  const format = resolveFormat(globals)
  const client = clientFrom(globals)

  let rows: Subscriber[]
  if (options.all) {
    rows = await listAllSubscribers(client, options.list, { status: options.status })
  } else {
    const page = await listSubscribers(client, options.list, {
      status: options.status,
      page: positive(options.page, '--page'),
      limit: positive(options.limit, '--limit', MAX_SUBSCRIBERS_PAGE),
    })
    rows = page.subscribers
    // Where this page sits, for people; stderr keeps stdout a clean collection.
    if (format === 'table' && page.total > rows.length) {
      const first = (page.page - 1) * page.limit
      info(`Showing ${first + 1}-${first + rows.length} of ${page.total.toLocaleString('en-US')}. Use --page, or --all.`)
    }
  }

  renderCollection<Subscriber>(
    rows,
    [
      { header: 'EMAIL', value: (s) => s.email },
      { header: 'NAME', value: (s) => s.name },
      { header: 'STATUS', value: (s) => s.status },
      { header: 'JOINED', value: (s) => when(s.joined_at) },
    ],
    format,
    options.status ? `No ${options.status} subscribers.` : 'No subscribers on this page.',
  )
}

export function subscribersCommand(getGlobals: () => GlobalOptions): Command {
  const subscribers = new Command('subscribers')
    .alias('subs')
    .description('Add, remove and inspect subscribers')

  // A sub-verb rather than a bare `skrybe subscribers --list <id>`: the sub-verbs
  // each take their own --list, and a --list declared on this parent would be
  // claimed by it wherever it appears, leaving `add`/`status` without theirs.
  showOptions(
    subscribers.command('ls').alias('list').description("Show a list's subscribers, oldest first"),
  ).action((options: ShowOptions) => showSubscribers(getGlobals, options))

  subscribers
    .command('add <email>')
    .description('Add a subscriber to a list, or update one already on it')
    .requiredOption('--list <list-id>', 'List ID, as shown by `skrybe lists`')
    .option('--name <name>', "The subscriber's name")
    .option('--country <code>', 'Two-letter ISO country code, e.g. NG')
    .option('--ip-address <ip>', 'IP address the signup came from')
    .option('--referrer <url>', 'URL the signup came from')
    .option('--gdpr', 'Record GDPR consent for an EU signup')
    .option('--silent', 'Add to a double opt-in list without sending the confirmation email')
    .option(
      '--field <Name=value>',
      'Custom field, by personalization tag name. Repeatable.',
      collect,
      [],
    )
    .action(async (email: string, options: AddOptions) => {
      const globals = getGlobals()
      const outcome = await subscribe(clientFrom(globals), {
        listId: options.list,
        email,
        name: options.name,
        country: options.country,
        ipAddress: options.ipAddress,
        referrer: options.referrer,
        gdpr: options.gdpr,
        silent: options.silent,
        fields: parseFields(options.field),
      })

      renderAction(
        { email, list_id: options.list, outcome },
        outcome === 'already_subscribed'
          ? `${email} was already subscribed; its details were updated.`
          : `${email} subscribed.`,
        resolveFormat(globals),
      )
    })

  subscribers
    .command('unsubscribe <email>')
    .description('Unsubscribe an address, keeping its record on the list')
    .requiredOption('--list <list-id>', 'List ID, as shown by `skrybe lists`')
    .action(async (email: string, options: RefOptions) => {
      const globals = getGlobals()
      await unsubscribe(clientFrom(globals), { listId: options.list, email })

      renderAction(
        { email, list_id: options.list, outcome: 'unsubscribed' },
        `${email} unsubscribed.`,
        resolveFormat(globals),
      )
    })

  subscribers
    .command('delete <email>')
    .alias('rm')
    .description('Delete a subscriber from a list outright')
    .requiredOption('--list <list-id>', 'List ID, as shown by `skrybe lists`')
    .action(async (email: string, options: RefOptions) => {
      const globals = getGlobals()
      await deleteSubscriber(clientFrom(globals), { listId: options.list, email })

      renderAction(
        { email, list_id: options.list, outcome: 'deleted' },
        `${email} deleted.`,
        resolveFormat(globals),
      )
    })

  subscribers
    .command('status <email>')
    .description('Show whether an address is subscribed, bounced, complained and so on')
    .requiredOption('--list <list-id>', 'List ID, as shown by `skrybe lists`')
    .action(async (email: string, options: RefOptions) => {
      const globals = getGlobals()
      const status = await subscriptionStatus(clientFrom(globals), {
        listId: options.list,
        email,
      })

      // Bare value on stdout, so `skrybe subscribers status ... | grep -q Subscribed`
      // and `$(...)` capture behave.
      renderScalar(status, { email, list_id: options.list, status }, resolveFormat(globals))
    })

  return subscribers
}
