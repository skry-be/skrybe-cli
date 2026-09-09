import { createInterface } from 'node:readline/promises'

import { Command } from 'commander'

import { SkrybeClient } from '../api/client.js'
import { UsageError } from '../api/errors.js'
import { listBrands } from '../api/resources/brands.js'
import {
  configPath,
  deleteProfile,
  normaliseUrl,
  readConfig,
  resolveProfile,
  saveProfile,
} from '../config.js'
import { bold, dim, info, printJson, printTable, renderCollection, resolveFormat, success } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

/**
 * Read the key from stdin rather than argv. A key passed as a flag shows up in
 * `ps` output and in shell history.
 */
async function promptForKey(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8').trim()
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await rl.question('API key: ')).trim()
  } finally {
    rl.close()
  }
}

export function authCommand(getGlobals: () => GlobalOptions): Command {
  const auth = new Command('auth').description('Manage API credentials and profiles')

  // `--url` and `--profile` are declared once on the root program. Commander
  // hoists a parent option regardless of where it appears in argv, so
  // redeclaring them here would shadow them and they would never reach this
  // action. Read them from the globals instead.
  auth
    .command('login')
    .description('Store an API key for a Skrybe install')
    .summary('Store an API key (use the global --url and --profile flags)')
    .option('--no-verify', 'Skip checking the key against the API before saving')
    .action(async (options: { verify: boolean }) => {
      const globals = getGlobals()
      if (!globals.url) {
        throw new UsageError(
          'A Skrybe URL is required to log in.',
          'skrybe auth login --url https://your-install.example.com',
        )
      }
      const profileName = globals.profile ?? 'default'
      const url = normaliseUrl(globals.url)
      const apiKey = process.env.SKRYBE_API_KEY?.trim() || (await promptForKey())

      if (apiKey === '') {
        throw new UsageError(
          'No API key provided.',
          'Generate one in the Skrybe UI under Settings, then paste it when prompted.',
        )
      }

      if (options.verify) {
        const client = new SkrybeClient({ url, apiKey })
        const brands = await listBrands(client)
        const label = brands[0]?.name
        success(
          label
            ? `Authenticated against ${url} as brand ${bold(label)}.`
            : `Authenticated against ${url}.`,
        )
      }

      saveProfile(profileName, { url, apiKey })
      success(`Saved profile ${bold(profileName)} to ${configPath()}`)
    })

  auth.addCommand(whoamiCommand(getGlobals))

  auth
    .command('list')
    .alias('ls')
    .description('List saved profiles')
    .action(() => {
      const config = readConfig()
      const rows = Object.entries(config.profiles).map(([name, p]) => ({
        name,
        url: p.url,
        current: name === config.currentProfile,
      }))

      renderCollection(
        rows,
        [
          { header: '', value: (r) => (r.current ? '*' : ' ') },
          { header: 'PROFILE', value: (r) => r.name },
          { header: 'URL', value: (r) => r.url },
        ],
        resolveFormat(getGlobals()),
        'No profiles saved. Run `skrybe auth login --url <url>`.',
      )
    })

  auth
    .command('logout')
    .description('Remove a saved profile (defaults to the current one)')
    .action(() => {
      const name = getGlobals().profile ?? readConfig().currentProfile
      if (deleteProfile(name)) {
        success(`Removed profile ${bold(name)}.`)
      } else {
        info(dim(`No profile named "${name}".`))
      }
    })

  return auth
}

/**
 * Built as a factory because a Commander instance cannot be attached to two
 * parents — `skrybe whoami` and `skrybe auth whoami` each need their own.
 */
export function whoamiCommand(getGlobals: () => GlobalOptions): Command {
  return new Command('whoami')
    .description('Show the active profile and the brand its key belongs to')
    .action(async () => {
      const globals = getGlobals()
      const profile = resolveProfile({ profile: globals.profile, url: globals.url })
      const brands = await listBrands(clientFrom(globals))

      const format = resolveFormat(globals)
      if (format === 'json') {
        printJson({ profile: profile.name, url: profile.url, brands })
        return
      }
      if (format === 'text') {
        for (const brand of brands.length > 0 ? brands : [{ id: '', name: '' }]) {
          process.stdout.write(`${profile.name ?? ''}\t${profile.url}\t${brand.id}\t${brand.name}\n`)
        }
        return
      }

      info(`${bold('Profile')}  ${profile.name ?? dim('(from environment)')}`)
      info(`${bold('URL')}      ${profile.url}`)
      if (brands.length === 0) {
        info(dim('This key is not associated with any brand.'))
        return
      }
      info('')
      printTable(brands, [
        { header: 'BRAND ID', value: (b) => b.id },
        { header: 'NAME', value: (b) => b.name },
      ])
    })
}
