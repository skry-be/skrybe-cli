import { Command, Option } from 'commander'

import { UsageError } from '../api/errors.js'
import { createBrand, listBrands, type QuotaMode } from '../api/resources/brands.js'
import { info, renderRecord, resolveFormat, renderCollection, warn } from '../output.js'
import { readSecret } from '../input.js'
import { clientFrom, type GlobalOptions } from './context.js'

async function showBrands(getGlobals: () => GlobalOptions): Promise<void> {
  const globals = getGlobals()
  const format = resolveFormat(globals)
  const rows = await listBrands(clientFrom(globals))

  renderCollection(
    rows,
    [
      { header: 'ID', value: (b) => b.id },
      { header: 'NAME', value: (b) => b.name },
    ],
    format,
    'No brands found for this API key.',
  )
}

export function brandsCommand(getGlobals: () => GlobalOptions): Command {
  const brands = new Command('brands')
    .description('Brands — run bare to show them')
    .addHelpText('after', '\nAdmin commands (need the install admin API key):\n  create    Create a brand')
    .allowExcessArguments(false)
    .action(() => showBrands(getGlobals))

  brands
    .command('ls')
    .alias('list')
    .description('Show the brands visible to the current API key')
    .action(() => showBrands(getGlobals))

  brands
    .command('create')
    .alias('new')
    .description('Create a brand (requires an admin API key)')
    .requiredOption('--name <name>', 'Brand name')
    .requiredOption('--from-email <email>', 'Default sender address')
    .option('--from-name <name>', 'Sender name (default: the brand name)')
    .option('--reply-to <email>', 'Reply-to address (default: the sender address)')
    .option('--login-email <email>', 'Client login username (default: the sender address)')
    .option('--password-stdin', 'Read a client login password from stdin; without it no client login is created')
    .option('--currency <code>', 'Currency code, e.g. USD')
    .option('--language <code>', 'Client language, e.g. en_US')
    .addOption(
      new Option('--quota <mode>', 'Sending quota: unlimited, custom (monthly, resets on a day) or no-expiry')
        .choices(['unlimited', 'custom', 'no-expiry']),
    )
    .option('--monthly-limit <n>', 'Emails allowed per period (with --quota custom or no-expiry)')
    .option('--reset-day <1-31>', 'Day of the month the quota resets (with --quota custom)')
    .option('--smtp-host <host>', 'Custom SMTP host')
    .option('--smtp-port <port>', 'Custom SMTP port')
    .option('--smtp-ssl <ssl>', 'Custom SMTP encryption, e.g. tls or ssl')
    .option('--smtp-username <user>', 'Custom SMTP username')
    .addHelpText(
      'after',
      '\nSecrets are never taken as flags. Pipe the client password with --password-stdin;\n' +
        'set SKRYBE_SMTP_PASSWORD for the SMTP password.',
    )
    .action(async (o: CreateOptions) => {
      const input = validateCreate(o)
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const password = o.passwordStdin ? await readSecret('Client password') : undefined
      if (o.passwordStdin && !password) throw new UsageError('No password received on stdin.')

      const created = await createBrand(clientFrom(globals), {
        ...input,
        password,
        smtpPassword: process.env.SKRYBE_SMTP_PASSWORD || undefined,
      })

      if (format === 'table') {
        info(`Created brand "${created.app_name}" (id ${created.brand_id}).`)
        renderRecord(
          created,
          [
            ['Brand ID', String(created.brand_id)],
            ['Name', created.app_name],
            ['From', `${created.from_name} <${created.from_email}>`],
            ['Reply-to', created.reply_to],
            ['API key', created.app_key],
          ],
          format,
        )
        warn('Save the API key now; it cannot be shown again.')
      } else renderRecord(created, [], format)
    })

  return brands
}

interface CreateOptions {
  name: string
  fromEmail: string
  fromName?: string
  replyTo?: string
  loginEmail?: string
  passwordStdin?: boolean
  currency?: string
  language?: string
  quota?: QuotaMode
  monthlyLimit?: string
  resetDay?: string
  smtpHost?: string
  smtpPort?: string
  smtpSsl?: string
  smtpUsername?: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function integer(value: string | undefined, flag: string, min: number, max?: number): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    throw new UsageError(`${flag} must be a whole number${max ? ` from ${min} to ${max}` : ` of at least ${min}`}.`)
  }
  return n
}

/** Catch bad flag combinations here, where the message can name the flag. */
export function validateCreate(o: CreateOptions) {
  if (o.name.trim() === '') throw new UsageError('--name cannot be empty.')
  for (const [flag, value] of [
    ['--from-email', o.fromEmail],
    ['--reply-to', o.replyTo],
    ['--login-email', o.loginEmail],
  ] as const) {
    if (value !== undefined && !EMAIL.test(value)) throw new UsageError(`${flag} "${value}" is not an email address.`)
  }

  const monthlyLimit = integer(o.monthlyLimit, '--monthly-limit', 0)
  const resetDay = integer(o.resetDay, '--reset-day', 1, 31)
  if (monthlyLimit !== undefined && o.quota !== 'custom' && o.quota !== 'no-expiry') {
    throw new UsageError('--monthly-limit needs --quota custom or no-expiry.')
  }
  if ((o.quota === 'custom' || o.quota === 'no-expiry') && monthlyLimit === undefined) {
    throw new UsageError(`--quota ${o.quota} needs --monthly-limit.`)
  }
  if (resetDay !== undefined && o.quota !== 'custom') {
    throw new UsageError('--reset-day needs --quota custom.')
  }

  return {
    name: o.name.trim(),
    fromEmail: o.fromEmail,
    fromName: o.fromName,
    replyTo: o.replyTo,
    loginEmail: o.loginEmail,
    currency: o.currency,
    language: o.language,
    quota: o.quota,
    monthlyLimit,
    resetDay,
    smtpHost: o.smtpHost,
    smtpPort: o.smtpPort,
    smtpSsl: o.smtpSsl,
    smtpUsername: o.smtpUsername,
  }
}
