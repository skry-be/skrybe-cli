import type { SkrybeClient } from '../client.js'

interface EmailsSentResponse {
  total_emails_sent: number
}

/**
 * `api/stats/emails-sent.php` is a GET, takes no api_key, and is cached for
 * 300s server-side. It is an installation-wide counter (campaigns +
 * autoresponders + transactional), not a per-brand figure.
 */
export async function totalEmailsSent(client: SkrybeClient): Promise<number> {
  const data = await client.requestJson<EmailsSentResponse>({
    path: 'api/stats/emails-sent.php',
    method: 'GET',
    anonymous: true,
    retryable: true,
  })
  return data.total_emails_sent ?? 0
}
