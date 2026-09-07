import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ApiError } from '../src/api/errors.js'
import { parseNumberedObject } from '../src/api/parse.js'

import { phpNumberedPayload } from './helpers.js'

describe('parseNumberedObject', () => {
  it('reads a well-formed payload', () => {
    const body = phpNumberedPayload('list', [
      { id: 'AbC892763xy', name: 'Newsletter' },
      { id: 'ZzZ763892qq', name: 'Announcements' },
    ])

    assert.deepEqual(parseNumberedObject(body, 'list'), [
      { id: 'AbC892763xy', name: 'Newsletter' },
      { id: 'ZzZ763892qq', name: 'Announcements' },
    ])
  })

  it('reads the brand payload, whose ids are bare integers', () => {
    const body = phpNumberedPayload('brand', [{ id: '86', name: 'Cafe One' }])
    assert.deepEqual(parseNumberedObject(body, 'brand'), [{ id: '86', name: 'Cafe One' }])
  })

  it('returns an empty array for an empty body', () => {
    assert.deepEqual(parseNumberedObject('', 'list'), [])
    assert.deepEqual(parseNumberedObject('   \n ', 'list'), [])
  })

  it('ignores keys that are not the requested prefix', () => {
    const body = '{"list1": {"id": "a", "name": "Keep"}, "total": {"id": "x", "name": "Drop"}}'
    assert.deepEqual(parseNumberedObject(body, 'list'), [{ id: 'a', name: 'Keep' }])
  })

  it('orders by the numeric suffix, not by string order', () => {
    // list10 sorts before list2 as a string. PHP emits them in order and V8
    // preserves that, so this only bites if an endpoint ever reorders them.
    const body =
      '{"list1": {"id": "a", "name": "One"},' +
      ' "list10": {"id": "j", "name": "Ten"},' +
      ' "list2": {"id": "b", "name": "Two"}}'

    assert.deepEqual(
      parseNumberedObject(body, 'list').map((row) => row.name),
      ['One', 'Two', 'Ten'],
    )
  })

  describe('names the server does not escape', () => {
    // get-lists.php interpolates the name straight into the string it echoes,
    // so awkward names reach us verbatim. Some of them make the payload invalid
    // JSON, which is what the structural fallback exists for.
    const surrounded = (name: string) =>
      phpNumberedPayload('list', [
        { id: 'AAA111', name: 'Before' },
        { id: 'BBB222', name },
        { id: 'CCC333', name: 'After' },
      ])

    const roundTrips = (name: string) => {
      assert.deepEqual(parseNumberedObject(surrounded(name), 'list'), [
        { id: 'AAA111', name: 'Before' },
        { id: 'BBB222', name },
        { id: 'CCC333', name: 'After' },
      ])
    }

    it('recovers a quoted word from a payload JSON.parse rejects', () => {
      assert.throws(() => JSON.parse(surrounded('Q4 "Big" Push')) as unknown)
      roundTrips('Q4 "Big" Push')
    })

    it('recovers a name ending in a quote', () => {
      assert.throws(() => JSON.parse(surrounded('Say "hi"')) as unknown)
      roundTrips('Say "hi"')
    })

    it('recovers the last entry when its name ends in a quote', () => {
      const body = phpNumberedPayload('list', [{ id: 'AAA111', name: 'trailing "quote"' }])
      assert.deepEqual(parseNumberedObject(body, 'list'), [
        { id: 'AAA111', name: 'trailing "quote"' },
      ])
    })

    it('keeps a name containing a brace or a comma', () => {
      roundTrips('ends}')
      roundTrips('Lagos, Abuja')
    })

    it('keeps every id intact when a name forges a second "name" key', () => {
      // `x", "name": "injected` leaves the payload *valid* JSON with a duplicate
      // key, and JS keeps the last one — so the name renders as `injected` and
      // the structural fallback never runs. Cosmetic only: the id, which is
      // what anything downstream uses, is unaffected. The real fix is
      // json_encode() in get-lists.php.
      const rows = parseNumberedObject(surrounded('x", "name": "injected'), 'list')
      assert.deepEqual(
        rows.map((row) => row.id),
        ['AAA111', 'BBB222', 'CCC333'],
      )
      assert.equal(rows[1]?.name, 'injected')
    })
  })

  it('throws with the body attached when nothing is recognisable', () => {
    const body = '<br />\n<b>Warning</b>: mysqli_query(): MySQL server has gone away'

    assert.throws(
      () => parseNumberedObject(body, 'list'),
      (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.code, 'malformed_response')
        // The regression: the raw body used to be dropped, leaving the user
        // with a hint that pointed at a --json output that never appeared.
        assert.equal(err.raw, body)
        assert.match(err.hint ?? '', /MySQL server has gone away/)
        return true
      },
    )
  })

  it('collapses a multi-line body into a single-line hint', () => {
    assert.throws(
      () => parseNumberedObject('one\n\n  two\n\tthree', 'list'),
      (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.equal(err.hint, 'The server sent: one two three')
        return true
      },
    )
  })

  it('truncates a very long body in the hint but keeps it whole on the error', () => {
    const body = `x${'y'.repeat(5000)}`

    assert.throws(
      () => parseNumberedObject(body, 'list'),
      (err: unknown) => {
        assert.ok(err instanceof ApiError)
        assert.ok((err.hint ?? '').length < 300, 'hint should not dump the whole page')
        assert.match(err.hint ?? '', /…$/)
        assert.equal(err.raw, body)
        return true
      },
    )
  })
})
