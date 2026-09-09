import { Command } from 'commander'

import {
  deleteSubscriber,
  subscribe,
  subscriptionStatus,
  unsubscribe,
} from '../api/resources/subscribers.js'
import { parseFields } from '../input.js'
import { renderAction, renderScalar, resolveFormat } from '../output.js'
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

export function subscribersCommand(getGlobals: () => GlobalOptions): Command {
  const subscribers = new Command('subscribers')
    .alias('subs')
    .description('Add, remove and inspect subscribers')

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
