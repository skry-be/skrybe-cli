import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { UsageError } from '../src/api/errors.js'
import { resolveFormat } from '../src/output.js'

describe('resolveFormat', () => {
  it('defaults to table', () => {
    assert.equal(resolveFormat({}), 'table')
  })

  it('treats --json as a shorthand, and lets it win over --output', () => {
    assert.equal(resolveFormat({ json: true }), 'json')
    assert.equal(resolveFormat({ json: true, output: 'text' }), 'json')
  })

  it('accepts a format regardless of case or padding', () => {
    assert.equal(resolveFormat({ output: '  TEXT ' }), 'text')
  })

  it('reads SKRYBE_OUTPUT when no flag is given', () => {
    process.env.SKRYBE_OUTPUT = 'json'
    try {
      assert.equal(resolveFormat({}), 'json')
      assert.equal(resolveFormat({ output: 'text' }), 'text', 'the flag outranks the env var')
    } finally {
      delete process.env.SKRYBE_OUTPUT
    }
  })

  it('rejects an unsupported format rather than falling back', () => {
    // Quietly giving a table to a script that asked for json would be worse
    // than failing, because the script would parse the table as data.
    assert.throws(() => resolveFormat({ output: 'yaml' }), UsageError)
  })
})
