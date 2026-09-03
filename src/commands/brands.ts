import { Command } from 'commander'

import { listBrands } from '../api/resources/brands.js'
import { dim, info, printJson, printTable } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

async function showBrands(getGlobals: () => GlobalOptions): Promise<void> {
  const globals = getGlobals()
  const rows = await listBrands(clientFrom(globals))

  if (rows.length === 0) {
    if (globals.json) printJson([])
    else info(dim('No brands found for this API key.'))
    return
  }

  if (globals.json) {
    printJson(rows)
    return
  }

  printTable(rows, [
    { header: 'ID', value: (b) => b.id },
    { header: 'NAME', value: (b) => b.name },
  ])
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

  return brands
}
