import type { SkrybeClient } from '../client.js'
import { ApiError, Exit, excerpt, isProseEmpty } from '../errors.js'
import { parseJsonObject, parseNumberedObject, type NamedEntity } from '../parse.js'

export interface List extends NamedEntity {
  /**
   * The id as returned by the API. It is an AES-256-CBC ciphertext produced by
   * encrypt_val() in includes/helpers/short.php, not an integer.
   *
   * Caveat worth knowing: the encryption key is the api_key of the FIRST login
   * row, so if the install owner ever rotates their key, every id previously
   * handed out stops decrypting. A future api/v1 should expose raw integers.
   */
  id: string
}

export async function listLists(
  client: SkrybeClient,
  opts: { includeHidden?: boolean } = {},
): Promise<List[]> {
  const body = await client.requestText({
    path: 'api/lists/get-lists.php',
    body: { include_hidden: opts.includeHidden ? 'yes' : 'no' },
    retryable: true,
  })
  if (isProseEmpty(body)) return []
  return parseNumberedObject(body, 'list')
}

/**
 * `api/subscribers/active-subscriber-count.php` returns a bare integer.
 *
 * Anything else is a failure, and must not be reported as a count. Falling back
 * to 0 here would answer "this list has no subscribers" to an error — the one
 * wrong answer a caller cannot detect, and the one most likely to be piped
 * straight into a decision about whether to send.
 */
export async function activeSubscriberCount(
  client: SkrybeClient,
  listId: string,
): Promise<number> {
  const body = await client.requestText({
    path: 'api/subscribers/active-subscriber-count.php',
    body: { list_id: listId },
    retryable: true,
  })

  const trimmed = body.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(
      'malformed_response',
      `Expected a subscriber count for list ${listId}, got: ${excerpt(trimmed)}`,
      Exit.API_ERROR,
      { raw: body },
    )
  }
  return Number.parseInt(trimmed, 10)
}

export type OptIn = 'single' | 'double'

/** One list from `api/lists/get-list.php`, `create.php` or `update-list.php`. */
export interface ListDetail extends List {
  opt_in: OptIn
  /** `active` is who a campaign goes to: confirmed, and not unsubscribed, bounced or complained. */
  subscribers: { active: number; unconfirmed: number; unsubscribed: number; bounced: number; complained: number }
}

export async function getList(client: SkrybeClient, listId: string): Promise<ListDetail> {
  const body = await client.requestText({ path: 'api/lists/get-list.php', body: { list_id: listId }, retryable: true })
  return parseJsonObject<ListDetail>(body, 'list')
}

/** Not retried: a repeat after a lost response would create a second list. */
export async function createList(client: SkrybeClient, name: string, optIn?: OptIn): Promise<ListDetail> {
  const body = await client.requestText({ path: 'api/lists/create.php', body: { name, opt_in: optIn } })
  return parseJsonObject<ListDetail>(body, 'list')
}

export async function updateList(
  client: SkrybeClient,
  listId: string,
  changes: { name?: string; optIn?: OptIn },
): Promise<ListDetail> {
  const body = await client.requestText({
    path: 'api/lists/update-list.php',
    body: { list_id: listId, name: changes.name, opt_in: changes.optIn },
  })
  return parseJsonObject<ListDetail>(body, 'list')
}

/**
 * Deletes the list with its subscribers, segments, autoresponders and rules.
 * The API refuses a list that a scheduled or sending campaign is going to.
 */
export async function deleteList(client: SkrybeClient, listId: string): Promise<{ id: string; deleted: true }> {
  const body = await client.requestText({ path: 'api/lists/delete.php', body: { list_id: listId } })
  return parseJsonObject<{ id: string; deleted: true }>(body, 'delete result')
}
