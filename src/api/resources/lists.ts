import type { SkrybeClient } from '../client.js'
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
  })
  return parseNumberedObject(body, 'list')
}

/** `api/subscribers/active-subscriber-count.php` returns a bare integer. */
export async function activeSubscriberCount(
  client: SkrybeClient,
  listId: string,
): Promise<number> {
  const body = await client.requestText({
    path: 'api/subscribers/active-subscriber-count.php',
    body: { list_id: listId },
  })
  const count = Number.parseInt(body.trim(), 10)
  return Number.isNaN(count) ? 0 : count
}
