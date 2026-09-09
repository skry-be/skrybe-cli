import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { UsageError } from '../src/api/errors.js'
import { parseFields, resolveArg, resolveOptionalArg } from '../src/input.js'

const scratch = mkdtempSync(join(tmpdir(), 'skrybe-cli-'))

function withFile(name: string, body: string): string {
  const path = join(scratch, name)
  writeFileSync(path, body)
  return path
}

describe('resolveArg', () => {
  it('returns a plain value untouched', () => {
    assert.equal(resolveArg('<p>hello</p>', '--html-text'), '<p>hello</p>')
  })

  it('reads a file:// path', () => {
    const path = withFile('body.html', '<h1>Q4</h1>\n')
    assert.equal(resolveArg(`file://${path}`, '--html-text'), '<h1>Q4</h1>\n')
  })

  it('keeps a value that merely contains a scheme', () => {
    // A query_string or a URL in a subject line must not be treated as a path.
    const value = 'https://example.com/?utm_source=x'
    assert.equal(resolveArg(value, '--query-string'), value)
  })

  it('names the flag and the path when the file is missing', () => {
    assert.throws(
      () => resolveArg('file:///nope/missing.html', '--html-text'),
      (err: unknown) => {
        assert.ok(err instanceof UsageError)
        assert.match(err.message, /--html-text/)
        assert.match(err.message, /missing\.html/)
        assert.match(err.message, /No such file/)
        return true
      },
    )
  })

  it('passes undefined through for an optional argument', () => {
    assert.equal(resolveOptionalArg(undefined, '--plain-text'), undefined)
  })
})

describe('parseFields', () => {
  it('parses repeatable Name=value pairs', () => {
    assert.deepEqual(parseFields(['Birthday=1990-01-01', 'City=Lagos']), {
      Birthday: '1990-01-01',
      City: 'Lagos',
    })
  })

  it('keeps an = inside the value', () => {
    assert.deepEqual(parseFields(['Query=a=b']), { Query: 'a=b' })
  })

  it('rejects a pair with no name', () => {
    assert.throws(() => parseFields(['=orphan']), UsageError)
  })

  it('rejects a bare word', () => {
    assert.throws(() => parseFields(['Birthday']), UsageError)
  })
})
