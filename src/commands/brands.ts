import { Command } from 'commander'

import { listBrands } from '../api/resources/brands.js'
import { dim, info, printJson, printTable } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

export function brandsCommand(getGlobals: () => GlobalOptions): Command {
  const brands = new Command('brands').description('Inspect brands')

  brands
    .command('list')
    .alias('ls')
    .description('List brands visible to the current API key')
    .action(async () => {
      const globals = getGlobals()
      const rows = await listBrands(clientFrom(globals))

      if (globals.json) {
        printJson(rows)
        return
      }
      if (rows.length === 0) {
        info(dim('No brands found for this API key.'))
        return
      }
      printTable(rows, [
        { header: 'ID', value: (b) => b.id },
        { header: 'NAME', value: (b) => b.name },
      ])
    })

  return brands
}
