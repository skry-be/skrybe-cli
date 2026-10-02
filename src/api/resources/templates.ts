import type { SkrybeClient } from '../client.js'
import { parseJsonObject } from '../parse.js'

/** The editor the Skrybe UI opens a template in. */
export type TemplateEditor = 'html' | 'dragdrop'

export interface Template {
  id: number
  name: string
  from_name: string
  from_email: string
  reply_to: string
  editor: TemplateEditor
  /** Only from `getTemplate` with `includeContent`. */
  html_text?: string
  plain_text?: string
}

export interface TemplateFields {
  name?: string
  htmlText?: string
  plainText?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  editor?: TemplateEditor
}

const body = (fields: TemplateFields) => ({
  name: fields.name,
  html_text: fields.htmlText,
  plain_text: fields.plainText,
  from_name: fields.fromName,
  from_email: fields.fromEmail,
  reply_to: fields.replyTo,
  editor: fields.editor,
})

/** The brand's templates by name, without their HTML. */
export async function listTemplates(client: SkrybeClient): Promise<Template[]> {
  const text = await client.requestText({ path: 'api/templates/get-templates.php', retryable: true })
  return parseJsonObject<{ templates: Template[] }>(text, 'templates').templates
}

export async function getTemplate(
  client: SkrybeClient,
  templateId: number,
  opts: { includeContent?: boolean } = {},
): Promise<Template> {
  const text = await client.requestText({
    path: 'api/templates/get-template.php',
    body: { template_id: templateId, include_content: opts.includeContent ? 'yes' : undefined },
    retryable: true,
  })
  return parseJsonObject<Template>(text, 'template')
}

/** `name` and `htmlText` are required. Not retried: a repeat would create a second template. */
export async function createTemplate(client: SkrybeClient, fields: TemplateFields): Promise<Template> {
  const text = await client.requestText({ path: 'api/templates/create-template.php', body: body(fields) })
  return parseJsonObject<Template>(text, 'template')
}

/** Only the fields given change. */
export async function updateTemplate(client: SkrybeClient, templateId: number, fields: TemplateFields): Promise<Template> {
  const text = await client.requestText({
    path: 'api/templates/update-template.php',
    body: { template_id: templateId, ...body(fields) },
  })
  return parseJsonObject<Template>(text, 'template')
}

/** Campaigns already made from it are unaffected. */
export async function deleteTemplate(
  client: SkrybeClient,
  templateId: number,
): Promise<{ template_id: number; deleted: true }> {
  const text = await client.requestText({ path: 'api/templates/delete-template.php', body: { template_id: templateId } })
  return parseJsonObject<{ template_id: number; deleted: true }>(text, 'delete result')
}
