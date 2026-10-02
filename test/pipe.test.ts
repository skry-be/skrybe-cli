import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { startStub } from './helpers.js'

describe('output into a closed pipe', () => {
  // `skrybe lists | head -1`: head exits after its first line, and the next
  // write fails with EPIPE. That used to crash with a stack trace and exit 1.
  it('exits 0 without a stack trace when the reader stops early', async () => {
    const lists = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [`list${i + 1}`, { id: `id${i}`, name: `List number ${i}` }]),
    )
    const stub = await startStub([{ body: JSON.stringify(lists) }])
    const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))

    const child = spawn(process.execPath, ['--import', 'tsx', entry, 'lists'], {
      env: {
        ...process.env,
        SKRYBE_API_URL: stub.url,
        SKRYBE_API_KEY: 'test-key',
        SKRYBE_CONFIG: join(mkdtempSync(join(tmpdir(), 'skrybe-')), 'config.json'),
      },
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    // Read one chunk, then hang up, as head does once it has enough.
    child.stdout.once('data', () => child.stdout.destroy())

    const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
    assert.equal(code, 0)
    assert.doesNotMatch(stderr, /EPIPE|at /)
  })
})
