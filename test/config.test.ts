import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { DEFAULT_URL, resolveProfile, saveProfile } from '../src/config.js'

const ENV = ['SKRYBE_CONFIG', 'SKRYBE_API_KEY', 'SKRYBE_API_URL', 'SKRYBE_PROFILE'] as const

describe('resolveProfile URL', () => {
  let dir: string
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
    for (const k of ENV) delete process.env[k]
    dir = mkdtempSync(join(tmpdir(), 'skrybe-config-'))
    process.env.SKRYBE_CONFIG = join(dir, 'config.json')
  })

  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to the hosted dashboard when nothing names a URL', () => {
    process.env.SKRYBE_API_KEY = 'k'
    assert.equal(resolveProfile().url, 'https://dashboard.skry.be')
    assert.equal(DEFAULT_URL, 'https://dashboard.skry.be')
  })

  it('treats an empty SKRYBE_API_URL as unset', () => {
    process.env.SKRYBE_API_KEY = 'k'
    process.env.SKRYBE_API_URL = '  '
    assert.equal(resolveProfile().url, DEFAULT_URL)
  })

  it('prefers a stored profile URL over the default', () => {
    saveProfile('default', { url: 'https://self.example.test', apiKey: 'k' })
    assert.equal(resolveProfile().url, 'https://self.example.test')
  })

  it('prefers SKRYBE_API_URL over a stored profile, and --url over both', () => {
    saveProfile('default', { url: 'https://self.example.test', apiKey: 'k' })
    process.env.SKRYBE_API_URL = 'https://env.example.test/'
    assert.equal(resolveProfile().url, 'https://env.example.test')
    assert.equal(resolveProfile({ url: 'https://flag.example.test' }).url, 'https://flag.example.test')
  })
})
