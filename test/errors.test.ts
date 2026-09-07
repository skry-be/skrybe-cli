import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  Exit,
  classifyProse,
  excerpt,
  isProseEmpty,
  isProseSuccess,
  exitCodeForStatus,
} from '../src/api/errors.js'

describe('classifyProse', () => {
  it('maps an auth failure to the auth exit code', () => {
    const err = classifyProse('Invalid API key')
    assert.equal(err?.code, 'invalid_api_key')
    assert.equal(err?.exitCode, Exit.AUTH)
  })

  it('maps a missing key separately from a rejected one', () => {
    assert.equal(classifyProse('API key not passed')?.code, 'api_key_missing')
  })

  it('classifies "List ID not passed", which an undecryptable id also produces', () => {
    // The regression behind `skrybe lists count <bad-id>` printing 0: this
    // string was absent from the table, so it read as data rather than failure.
    const err = classifyProse('List ID not passed')
    assert.equal(err?.code, 'list_id_invalid')
    assert.equal(err?.exitCode, Exit.USAGE)
    assert.match(err?.hint ?? '', /skrybe lists/)
  })

  it('classifies a missing list as an API error, not a usage error', () => {
    const err = classifyProse('List does not exist')
    assert.equal(err?.code, 'list_not_found')
    assert.equal(err?.exitCode, Exit.API_ERROR)
  })

  it('ignores case and surrounding whitespace', () => {
    assert.equal(classifyProse('  invalid API KEY \n')?.code, 'invalid_api_key')
  })

  it('keeps the server wording as the message', () => {
    assert.equal(classifyProse('Invalid API key')?.message, 'Invalid API key')
  })

  it('folds the "Unable to ..." family into one code', () => {
    for (const body of [
      'Unable to create campaign',
      'Unable to schedule campaign',
      'Unable to create and send campaign',
    ]) {
      const err = classifyProse(body)
      assert.equal(err?.code, 'operation_failed', body)
      assert.equal(err?.message, body)
    }
  })

  it('returns null for a body that is data', () => {
    // Anything unrecognised has to fall through as data, or a subscriber count
    // and a list payload would both be read as failures.
    assert.equal(classifyProse('4211'), null)
    assert.equal(classifyProse('0'), null)
    assert.equal(classifyProse('{"list1": {"id": "a", "name": "b"}}'), null)
    assert.equal(classifyProse(''), null)
  })

  it('carries the status and raw body through when given one', () => {
    const err = classifyProse('Invalid API key', 200)
    assert.equal(err?.status, 200)
    assert.equal(err?.raw, 'Invalid API key')
  })
})

describe('isProseEmpty', () => {
  it('treats an empty collection as empty, not as an error', () => {
    assert.equal(isProseEmpty('No lists found'), true)
    assert.equal(isProseEmpty('No brands found'), true)
    assert.equal(isProseEmpty('  no lists found  '), true)
  })

  it('does not swallow a real failure', () => {
    assert.equal(isProseEmpty('Invalid API key'), false)
    assert.equal(isProseEmpty('List does not exist'), false)
  })
})

describe('isProseSuccess', () => {
  it('recognises the bare-prose successes', () => {
    assert.equal(isProseSuccess('1'), true)
    assert.equal(isProseSuccess('Campaign created'), true)
    assert.equal(isProseSuccess('Already subscribed.'), true)
  })

  it('is not fooled by a failure', () => {
    assert.equal(isProseSuccess('Unable to create campaign'), false)
  })
})

describe('exitCodeForStatus', () => {
  it('separates auth, quota and usage from generic failure', () => {
    assert.equal(exitCodeForStatus(401), Exit.AUTH)
    assert.equal(exitCodeForStatus(403), Exit.AUTH)
    assert.equal(exitCodeForStatus(402), Exit.QUOTA_OR_RATE_LIMIT)
    assert.equal(exitCodeForStatus(429), Exit.QUOTA_OR_RATE_LIMIT)
    assert.equal(exitCodeForStatus(400), Exit.USAGE)
    assert.equal(exitCodeForStatus(422), Exit.USAGE)
    assert.equal(exitCodeForStatus(500), Exit.API_ERROR)
    assert.equal(exitCodeForStatus(418), Exit.API_ERROR)
  })
})

describe('excerpt', () => {
  it('collapses whitespace onto one line', () => {
    assert.equal(excerpt('a\n\n  b\tc  '), 'a b c')
  })

  it('truncates past the limit', () => {
    assert.equal(excerpt('abcdef', 3), 'abc…')
    assert.equal(excerpt('abc', 3), 'abc')
  })

  it('says so rather than rendering nothing for an empty body', () => {
    assert.equal(excerpt('   \n '), '(an empty response)')
  })
})
