import { Command } from 'commander'

import { listBrands } from '../api/resources/brands.js'
import { renderCollection, resolveFormat } from '../output.js'
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
    .allowExcessArguments(false)
    .action(() => showBrands(getGlobals))

  brands
    .command('ls')
    .alias('list')
    .description('Show the brands visible to the current API key')
    .action(() => showBrands(getGlobals))

  return brands
}
