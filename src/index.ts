import { Command } from 'commander'
import type { Command as CommanderCommand } from 'commander'

import { CliError, Exit } from './api/errors.js'
import { authCommand, whoamiCommand } from './commands/auth.js'
import { brandsCommand } from './commands/brands.js'
import { campaignsCommand } from './commands/campaigns.js'
import type { GlobalOptions } from './commands/context.js'
import { emailsCommand } from './commands/emails.js'
import { listsCommand } from './commands/lists.js'
import { statsCommand } from './commands/stats.js'
import { subscribersCommand } from './commands/subscribers.js'
import { registerStubs } from './commands/unimplemented.js'
import { bold, dim, red } from './output.js'
import { version } from './version.js'

const program = new Command()
const getGlobals = (): GlobalOptions => program.opts<GlobalOptions>()

program
  .name('skrybe')
  .description('Command line interface for the Skrybe email marketing API')
  .version(version(), '-v, --version')
  .option('--profile <name>', 'Credential profile to use (default: the current profile)')
  .option('--url <url>', 'Override the Skrybe base URL for this invocation')
  .option('--json', 'Emit raw JSON on stdout instead of a table')
  .addHelpText(
    'after',
    `
${bold('Credentials')}
  Resolution order: SKRYBE_API_KEY / SKRYBE_API_URL, then --profile,
  then SKRYBE_PROFILE, then the current profile in the config file.

  Get started with:  skrybe auth login --url https://your-install.example.com

${dim('The API key is read from stdin, never from a flag — argv is visible in `ps`.')}
`,
  )

const campaigns = campaignsCommand(getGlobals)
const lists = listsCommand(getGlobals)

program.addCommand(authCommand(getGlobals))
program.addCommand(whoamiCommand(getGlobals))
program.addCommand(brandsCommand(getGlobals))
program.addCommand(lists)
program.addCommand(campaigns)
program.addCommand(emailsCommand(getGlobals))
program.addCommand(subscribersCommand(getGlobals))
program.addCommand(statsCommand(getGlobals))

registerStubs(new Map<string, CommanderCommand>([
  ['campaigns', campaigns],
  ['lists', lists],
]))

function report(err: unknown): number {
  if (err instanceof CliError) {
    process.stderr.write(`${red('Error')} [${err.code}]: ${err.message}\n`)
    if (err.hint) process.stderr.write(`${dim(err.hint)}\n`)
    return err.exitCode
  }

  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${red('Error')}: ${message}\n`)
  return Exit.API_ERROR
}

/** Codes Commander uses when it has already printed the requested output. */
const CLEAN_EXIT_CODES = new Set([
  'commander.helpDisplayed',
  'commander.help',
  'commander.version',
])

/**
 * `exitOverride` is not inherited by subcommands, so without this walk an
 * unknown flag on `skrybe lists list` would exit 1 (our "API error") rather
 * than 2 ("usage"). Scripts branch on those.
 */
function applyExitPolicy(command: CommanderCommand): void {
  command.exitOverride((err) => {
    process.exit(CLEAN_EXIT_CODES.has(err.code) ? Exit.OK : Exit.USAGE)
  })
  for (const child of command.commands) applyExitPolicy(child)
}

async function main(): Promise<void> {
  applyExitPolicy(program)
  await program.parseAsync(process.argv)
}

main().catch((err: unknown) => {
  process.exit(report(err))
})
