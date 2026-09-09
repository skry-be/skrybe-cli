import { Command } from 'commander'
import type { Command as CommanderCommand } from 'commander'

import { CliError, Exit } from './api/errors.js'
import { authCommand, whoamiCommand } from './commands/auth.js'
import { brandsCommand } from './commands/brands.js'
import { campaignsCommand } from './commands/campaigns.js'
import { completionCommand } from './commands/completion.js'
import type { GlobalOptions } from './commands/context.js'
import { emailsCommand } from './commands/emails.js'
import { listsCommand } from './commands/lists.js'
import { statsCommand } from './commands/stats.js'
import { subscribersCommand } from './commands/subscribers.js'
import { registerStubs } from './commands/unimplemented.js'
import { bold, dim, red, resolveFormat, type OutputFormat } from './output.js'
import { version } from './version.js'

const program = new Command()
const getGlobals = (): GlobalOptions => program.opts<GlobalOptions>()

program
  .name('skrybe')
  .description('Command line interface for the Skrybe email marketing API')
  .version(version(), '-v, --version')
  .option('--profile <name>', 'Credential profile to use (default: the current profile)')
  .option('--url <url>', 'Override the Skrybe base URL for this invocation')
  .option('--output <format>', 'Output format: table (default), json or text')
  .option('--json', 'Shorthand for --output json')
  .addHelpText(
    'after',
    `
${bold('Output')}
  --output table   aligned columns, for reading (the default)
  --output json    the full record, for jq
  --output text    tab-separated, no header, for cut and while read

  Commands that perform an action print a sentence to stderr under 'table',
  and emit their result record to stdout under 'json' and 'text'.
  Set a default with SKRYBE_OUTPUT.

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
program.addCommand(completionCommand(() => program))

registerStubs(new Map<string, CommanderCommand>([
  ['campaigns', campaigns],
  ['lists', lists],
]))

/**
 * The format may be unreadable here — this runs for parse failures too, before
 * options are known — so fall back to the human format rather than throwing a
 * second error while reporting the first.
 */
function errorFormat(): OutputFormat {
  try {
    return resolveFormat(program.opts<GlobalOptions>())
  } catch {
    return 'table'
  }
}

/**
 * Errors go to stderr in every format. Under `json` they go as JSON: a script
 * running with --output json otherwise gets JSON on success and prose on
 * failure, and has to parse two shapes to find out which happened.
 */
function report(err: unknown): number {
  const cli = err instanceof CliError ? err : null
  const code = cli?.code ?? 'error'
  const message = cli ? cli.message : err instanceof Error ? err.message : String(err)
  const exitCode = cli?.exitCode ?? Exit.API_ERROR

  if (errorFormat() === 'json') {
    process.stderr.write(
      `${JSON.stringify({ error: { code, message, hint: cli?.hint ?? null } }, null, 2)}\n`,
    )
    return exitCode
  }

  process.stderr.write(cli ? `${red('Error')} [${code}]: ${message}\n` : `${red('Error')}: ${message}\n`)
  if (cli?.hint) process.stderr.write(`${dim(cli.hint)}\n`)
  return exitCode
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
