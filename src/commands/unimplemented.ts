import { Command } from 'commander'

import { CliError, Exit } from '../api/errors.js'

/**
 * Operations users will reasonably reach for that the HTTP API cannot do yet —
 * they exist only as session-authenticated UI pages, and the login is Turnstile
 * and 2FA gated, so there is nothing to call.
 *
 * Registering them as real commands means `skrybe campaigns list` explains the
 * situation instead of printing "unknown command", and it fixes the command
 * names now so adding the api/v1 endpoint later is not a breaking change.
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
    name: 'list',
    aliases: ['ls'],
    description: 'List campaigns (not yet available in the API)',
    blockedBy: 'includes/campaigns/list-campaigns-ajax.php',
  },
  {
    parent: 'campaigns',
    name: 'get',
    args: '<campaign-id>',
    description: 'Show one campaign (not yet available in the API)',
    blockedBy: 'report.php',
  },
  {
    parent: 'campaigns',
    name: 'stats',
    args: '<campaign-id>',
    description: 'Opens, clicks, bounces for a campaign (not yet available in the API)',
    blockedBy: 'report.php and includes/reports/main.php',
  },
  {
    parent: 'campaigns',
    name: 'send',
    args: '<campaign-id>',
    description: 'Send an existing draft (not yet available in the API)',
    blockedBy: 'includes/create/send-now.php',
  },
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
  {
    parent: 'lists',
    name: 'create',
    args: '<name>',
    description: 'Create a list (not yet available in the API)',
    blockedBy: 'includes/subscribers/import-add.php',
  },
  {
    parent: 'lists',
    name: 'delete',
    aliases: ['rm'],
    args: '<list-id>',
    description: 'Delete a list (not yet available in the API)',
    blockedBy: 'includes/list/delete.php',
  },
]

/** The error a stubbed operation raises, shared by the parent default and the leaf. */
export function notImplemented(parent: string, name: string, blockedBy: string): never {
  throw new CliError(
    'not_implemented',
    `\`skrybe ${parent}${name ? ` ${name}` : ''}\` is not available yet: the Skrybe HTTP API has no endpoint for it.`,
    Exit.USAGE,
    `This operation currently exists only in the web UI (${blockedBy}).\nIt is planned for the api/v1 build-out.`,
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
