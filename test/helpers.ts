import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after } from 'node:test'

export interface Received {
  method: string
  path: string
  contentType: string | undefined
  /** Form fields, already decoded. */
  fields: Record<string, string>
  rawBody: string
}

export interface Reply {
  body: string
  status?: number
  headers?: Record<string, string>
  /** Hold the response open for this long — for exercising the client timeout. */
  delayMs?: number
}

export interface Stub {
  url: string
  /** Every request the server saw, in order. */
  received: Received[]
  close: () => Promise<void>
}

/**
 * Start an HTTP server that answers with `replies` in order, repeating the last
 * one once exhausted. `handler` takes precedence when given.
 *
 * The point of testing against a real socket rather than a mocked fetch is that
 * the legacy API's quirks are wire-level — a 200 carrying a prose failure, a
 * form body, a missing Content-Type — and a mock that returns whatever the
 * client asked for would assert nothing about them.
 */
export async function startStub(
  replies: Reply[] | ((req: Received, index: number) => Reply),
): Promise<Stub> {
  const received: Received[] = []
  const pick = typeof replies === 'function' ? replies : (_r: Received, i: number) =>
    replies[Math.min(i, replies.length - 1)] ?? { body: '' }

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const rawBody = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url ?? '/', 'http://localhost')

    const fields: Record<string, string> = {}
    const contentType = req.headers['content-type']
    if (contentType?.includes('application/x-www-form-urlencoded')) {
      for (const [k, v] of new URLSearchParams(rawBody)) fields[k] = v
    } else if (contentType?.includes('application/json') && rawBody !== '') {
      Object.assign(fields, JSON.parse(rawBody) as Record<string, string>)
    }
    for (const [k, v] of url.searchParams) fields[k] = v

    const entry: Received = {
      method: req.method ?? 'GET',
      path: url.pathname,
      contentType,
      fields,
      rawBody,
    }
    const index = received.length
    received.push(entry)

    const reply = pick(entry, index)
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs))
    res.writeHead(reply.status ?? 200, reply.headers ?? {})
    res.end(reply.body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })

  // Belt and braces: a failing assertion must not leave the runner hanging on
  // an open listener.
  after(close)

  return { url: `http://127.0.0.1:${port}`, received, close }
}

/**
 * Build the exact payload `api/lists/get-lists.php` and `get-brands.php` emit —
 * string-concatenated, unescaped, with their real indentation. Tests that build
 * the payload with JSON.stringify would never see the bug the parser exists for.
 */
export function phpNumberedPayload(
  prefix: 'list' | 'brand',
  rows: { id: string; name: string }[],
): string {
  let output = '{'
  rows.forEach((row, i) => {
    output += `"${prefix}${i + 1}":
		{
			"id": "${row.id}",
			"name": "${row.name}"
		},`
  })
  return `${output.slice(0, -1)}}`
}
