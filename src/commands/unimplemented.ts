import { Command } from 'commander'

import { CliError, Exit } from '../api/errors.js'

/**
 * Operations users will reasonably reach for that the HTTP API cannot do yet —
 * they exist only as session-authenticated UI pages, and the login is Turnstile
 * and 2FA gated, so there is nothing to call.
 *
 * Registering them as real commands means `skrybe campaigns stop` explains the
 * situation instead of printing "unknown command", and it fixes the command
 * names now so adding the endpoint later is not a breaking change. The API is
 * gaining these one endpoint at a time; each stub goes when its endpoint lands.
 */
export interface Stub {
  parent: string
  name: string
  aliases?: string[]
  args?: string
  description: string
  /** The UI page that performs this today, for the error message. */
  blockedBy: string
}

export const STUBS: Stub[] = [
  {
    parent: 'campaigns',
    name: 'stop',
    args: '<campaign-id>',
    description: 'Stop a sending campaign (not yet available in the API)',
    blockedBy: 'includes/create/stop-campaign.php',
  },
  {
    parent: 'campaigns',
    name: 'resume',
    args: '<campaign-id>',
    description: 'Resume a stopped campaign (not yet available in the API)',
    blockedBy: 'includes/create/resume-campaign.php',
  },
]

/** The error a stubbed operation raises, shared by the parent default and the leaf. */
export function notImplemented(parent: string, name: string, blockedBy: string): never {
  throw new CliError(
    'not_implemented',
    `\`skrybe ${parent}${name ? ` ${name}` : ''}\` is not available yet: the Skrybe HTTP API has no endpoint for it.`,
    Exit.USAGE,
    `This operation currently exists only in the web UI (${blockedBy}).\nIt is being added to the API in stages.`,
  )
}

export function registerStubs(parents: Map<string, Command>): void {
  for (const stub of STUBS) {
    const parent = parents.get(stub.parent)
    if (!parent) continue

    const command = parent
      .command(stub.args ? `${stub.name} ${stub.args}` : stub.name)
      .description(stub.description)
      .action(() => notImplemented(stub.parent, stub.name, stub.blockedBy))

    for (const alias of stub.aliases ?? []) command.alias(alias)
  }
}
