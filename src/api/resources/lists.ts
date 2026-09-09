import type { SkrybeClient } from '../client.js'
import { ApiError, Exit, excerpt, isProseEmpty } from '../errors.js'
import { parseNumberedObject, type NamedEntity } from '../parse.js'

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
