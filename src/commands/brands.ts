import { Argument, Command, Option } from 'commander'

import { AuthError, UsageError } from '../api/errors.js'
import { brandTransport, listBrands, type BrandTransport, type Transport } from '../api/resources/brands.js'
import { renderCollection, renderRecord, resolveFormat } from '../output.js'
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

/** Read a secret from stdin, so it stays out of `ps` output and shell history. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new UsageError('--password-stdin needs the password piped in.', "printf '%s' \"$PW\" | skrybe brands transport …")
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

function parseBrandId(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new UsageError(`"${value}" is not a brand ID.`, 'A brand ID is the number in the brand URL, e.g. app?i=86.')
  }
  return Number(value)
}

interface TransportOptions {
  passwordStdin?: boolean
  username?: string
  host?: string
  /** false with --no-verify */
  verify: boolean
  force?: boolean
}

function showTransport(t: BrandTransport, format: ReturnType<typeof resolveFormat>): void {
  renderRecord(
    t,
    [
      ['Brand', `${t.brand_id} ${t.name}`],
      ['Transport', t.transport],
      ['SMTP host', t.smtp_host || '-'],
      ['Port', t.smtp_port || '-'],
      ['SSL/TLS', t.smtp_ssl || '-'],
      ['Username', t.smtp_username || '-'],
      ['Password', t.smtp_password_set ? 'set' : 'not set'],
    ],
    format,
  )
}

export function brandsCommand(getGlobals: () => GlobalOptions): Command {
  const brands = new Command('brands')
    .description('Brands — run bare to show them')
    .allowExcessArguments(false)
    .action(() => showBrands(getGlobals))

  brands
    .command('ls')
    .alias('list')
    .description('Show the brands visible to the current API key')
    .action(() => showBrands(getGlobals))

  brands
    .command('transport')
    .description('Show or switch whether a brand sends through the relay or SES (main account key only)')
    .argument('<brand-id>', 'numeric brand ID')
    .addArgument(
      new Argument('[transport]', 'relay or ses; leave out to only show the current setting').choices(['relay', 'ses']),
    )
    .option('--password-stdin', 'read the relay password (printed by mta-onboard) from stdin')
    .addOption(new Option('--username <login>', "relay login; default and only accepted value on the relay: brand<brand-id>, plus -<env> outside production"))
    .addOption(new Option('--host <host>', 'relay host, default the server\'s RELAY_SMTP_HOST or mta1.skry.be'))
    .option('--no-verify', 'switch to relay without first logging in to it with the brand\'s From address')
    .option('--force', 'switch even while one of the brand\'s campaigns is sending')
    .action(async (id: string, transport: Transport | undefined, options: TransportOptions) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const brandId = parseBrandId(id)

      if (transport !== 'relay' && (options.passwordStdin || options.username || options.host || !options.verify)) {
        throw new UsageError('--password-stdin, --username, --host and --no-verify only apply when switching to relay.')
      }
      if (!transport && options.force) throw new UsageError('--force only applies when switching.')

      const password = options.passwordStdin ? await readStdin() : undefined
      if (options.passwordStdin && password === '') throw new UsageError('The password on stdin is empty.')

      const result = await brandTransport(
        clientFrom(globals),
        brandId,
        transport && {
          transport,
          password,
          username: options.username,
          host: options.host,
          verify: options.verify,
          force: options.force,
        },
      ).catch((err: unknown) => {
        // The endpoint only takes the main account's key; a brand's key reads as invalid.
        if (err instanceof AuthError) {
          throw new AuthError(
            err.message,
            "brands transport needs the main account's API key, e.g. a profile made with `skrybe auth login --profile admin`.",
          )
        }
        throw err
      })
      showTransport(result, format)
    })

  return brands
}
