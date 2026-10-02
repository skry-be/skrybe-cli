import { Command, Option } from 'commander'

import { UsageError } from '../api/errors.js'
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  type Template,
  type TemplateEditor,
} from '../api/resources/templates.js'
import { confirm, resolveOptionalArg } from '../input.js'
import { info, renderAction, renderCollection, renderRecord, resolveFormat } from '../output.js'
import { clientFrom, type GlobalOptions } from './context.js'

/** Template ids are the plain integers the dashboard shows. */
export function templateId(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw new UsageError(`"${value}" is not a template ID.`, 'Run `skrybe templates` to see the IDs.')
  }
  return Number(value)
}

interface FieldOptions {
  name?: string
  htmlText?: string
  plainText?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  editor?: TemplateEditor
}

function fieldOptions(command: Command): Command {
  return command
    .option('--html-text <html|file://path>', 'HTML body, or file:// a path to it')
    .option('--plain-text <text|file://path>', 'Plain text body, or file:// a path to it')
    .option('--from-name <name>', "Default 'From' name for campaigns made from it")
    .option('--from-email <email>', "Default 'From' address")
    .option('--reply-to <email>', "Default 'Reply to' address")
    .addOption(
      new Option('--editor <editor>', 'Editor the Skrybe UI opens it in').choices(['html', 'dragdrop']),
    )
}

const fields = (options: FieldOptions) => ({
  name: options.name,
  htmlText: resolveOptionalArg(options.htmlText, '--html-text'),
  plainText: resolveOptionalArg(options.plainText, '--plain-text'),
  fromName: options.fromName,
  fromEmail: options.fromEmail,
  replyTo: options.replyTo,
  editor: options.editor,
})

function showTemplate(t: Template, format: ReturnType<typeof resolveFormat>): void {
  renderRecord(
    t,
    [
      ['ID', String(t.id)],
      ['Name', t.name],
      ['From', t.from_email ? `${t.from_name} <${t.from_email}>` : t.from_name || '-'],
      ['Reply to', t.reply_to || '-'],
      ['Editor', t.editor],
    ],
    format,
  )
}

async function showTemplates(getGlobals: () => GlobalOptions): Promise<void> {
  const globals = getGlobals()
  renderCollection<Template>(
    await listTemplates(clientFrom(globals)),
    [
      { header: 'ID', value: (t) => String(t.id), align: 'right' },
      { header: 'NAME', value: (t) => t.name },
      { header: 'FROM', value: (t) => t.from_email || '-' },
      { header: 'EDITOR', value: (t) => t.editor },
    ],
    resolveFormat(globals),
    'No templates yet. Create one with `skrybe templates create <name> --html-text file://email.html`.',
  )
}

export function templatesCommand(getGlobals: () => GlobalOptions): Command {
  // `skrybe templates` shows them, like `skrybe lists`; sub-verbs still dispatch.
  const templates = new Command('templates')
    .description('Email templates — run bare to show them')
    .allowExcessArguments(false)
    .action(() => showTemplates(getGlobals))

  templates
    .command('ls')
    .alias('list')
    .description("Show the brand's templates")
    .action(() => showTemplates(getGlobals))

  templates
    .command('get <template-id>')
    .description('Show one template')
    .option('--content', 'Print the HTML body instead (with --json, include both bodies)')
    .action(async (id: string, options: { content?: boolean }) => {
      const globals = getGlobals()
      const format = resolveFormat(globals)
      const t = await getTemplate(clientFrom(globals), templateId(id), { includeContent: options.content })
      // Raw, so `skrybe templates get 7 --content > email.html` saves the email.
      if (options.content && format !== 'json') {
        process.stdout.write(`${t.html_text || t.plain_text || ''}\n`)
        return
      }
      showTemplate(t, format)
    })

  fieldOptions(
    templates
      .command('create <name>')
      .description('Create a template; prints its id')
      .addHelpText('after', '\n--html-text is required. --editor defaults to html.'),
  ).action(async (name: string, options: FieldOptions) => {
    if (options.htmlText === undefined) {
      throw new UsageError('A template needs a body.', 'Pass --html-text, e.g. --html-text file://email.html')
    }
    const globals = getGlobals()
    const format = resolveFormat(globals)
    const t = await createTemplate(clientFrom(globals), fields({ ...options, name }))
    // The id is what a script needs next, so it goes to stdout even in table mode.
    if (format === 'table') {
      info(`Created template "${t.name}".`)
      process.stdout.write(`${t.id}\n`)
    } else showTemplate(t, format)
  })

  fieldOptions(
    templates
      .command('update <template-id>')
      .description('Edit a template; only the fields given change')
      .option('--name <name>', 'New name'),
  ).action(async (id: string, options: FieldOptions) => {
    const changes = fields(options)
    if (Object.values(changes).every((v) => v === undefined)) {
      throw new UsageError('Nothing to update.', 'Pass at least one field to change, e.g. --html-text.')
    }
    const globals = getGlobals()
    const format = resolveFormat(globals)
    const t = await updateTemplate(clientFrom(globals), templateId(id), changes)
    if (format === 'table') info(`Updated template ${t.id}.`)
    showTemplate(t, format)
  })

  templates
    .command('delete <template-id>')
    .alias('rm')
    .description('Delete a template. Campaigns made from it are unaffected')
    .option('-y, --yes', 'Delete without asking for confirmation (required when not run interactively)')
    .action(async (id: string, options: { yes?: boolean }) => {
      const globals = getGlobals()
      const client = clientFrom(globals)
      const template = templateId(id)

      if (!options.yes) {
        if (!process.stdin.isTTY) {
          throw new UsageError('Refusing to delete without confirmation.', 'Pass --yes to delete from a script.')
        }
        const t = await getTemplate(client, template)
        if (!(await confirm(`Delete template ${t.id} "${t.name}"? This cannot be undone.`))) {
          info('Not deleted.')
          return
        }
      }

      const r = await deleteTemplate(client, template)
      renderAction({ outcome: 'deleted', template_id: r.template_id }, `Deleted template ${r.template_id}.`, resolveFormat(globals))
    })

  return templates
}
