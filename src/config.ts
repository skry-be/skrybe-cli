import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { UsageError } from './api/errors.js'

export interface Profile {
  /** Base URL of the Skrybe install, no trailing slash. */
  url: string
  /** The api_key from Settings. One key maps to exactly one brand. */
  apiKey: string
}

export interface ConfigFile {
  currentProfile: string
  profiles: Record<string, Profile>
}

const EMPTY: ConfigFile = { currentProfile: 'default', profiles: {} }

export function configPath(): string {
  if (process.env.SKRYBE_CONFIG) return process.env.SKRYBE_CONFIG
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? join(xdg, 'skrybe', 'config.json') : join(homedir(), '.skrybe', 'config.json')
}

export function readConfig(): ConfigFile {
  const path = configPath()
  if (!existsSync(path)) return { ...EMPTY, profiles: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ConfigFile>
    return {
      currentProfile: parsed.currentProfile ?? 'default',
      profiles: parsed.profiles ?? {},
    }
  } catch (err) {
    throw new UsageError(
      `Could not read ${path}: ${(err as Error).message}`,
      'Fix or delete the file, then run `skrybe auth login` again.',
    )
  }
}

/** Writes 0600, in a 0700 directory. The file holds a credential. */
export function writeConfig(config: ConfigFile): void {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export interface ResolveOptions {
  profile?: string
  url?: string
}

export interface ResolvedProfile extends Profile {
  /** Which profile the values came from, or null if fully from env/flags. */
  name: string | null
}

/**
 * Resolution order, highest priority first:
 *   1. SKRYBE_API_KEY / SKRYBE_API_URL     (env wins, so CI needs no config file)
 *   2. --profile <name>
 *   3. SKRYBE_PROFILE
 *   4. currentProfile from the config file
 *
 * `--url` may override the resolved URL on its own, which is what lets
 * `auth login --url ...` work before any profile exists.
 *
 * There is deliberately no `--api-key` flag: argv is visible in `ps` and lands
 * in shell history.
 */
export function resolveProfile(opts: ResolveOptions = {}): ResolvedProfile {
  const envKey = process.env.SKRYBE_API_KEY?.trim()
  const envUrl = process.env.SKRYBE_API_URL?.trim()

  const requested = opts.profile ?? process.env.SKRYBE_PROFILE
  const config = readConfig()
  const name = requested ?? config.currentProfile
  const stored = config.profiles[name]

  const apiKey = envKey || stored?.apiKey
  const url = opts.url ?? envUrl ?? stored?.url

  if (!apiKey) {
    if (requested && !stored) {
      throw new UsageError(
        `No profile named "${requested}".`,
        `Known profiles: ${Object.keys(config.profiles).join(', ') || '(none)'}`,
      )
    }
    throw new UsageError(
      'No API key configured.',
      'Run `skrybe auth login`, or set SKRYBE_API_KEY and SKRYBE_API_URL.',
    )
  }
  if (!url) {
    throw new UsageError(
      'No Skrybe URL configured.',
      'Pass --url https://your-install.example.com, or set SKRYBE_API_URL.',
    )
  }

  return { name: envKey && !stored ? null : name, url: normaliseUrl(url), apiKey }
}

export function normaliseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new UsageError(
      `"${url}" is not a valid URL.`,
      'Include the scheme, e.g. https://app.example.com',
    )
  }
  return trimmed
}

export function saveProfile(name: string, profile: Profile, makeCurrent = true): void {
  const config = readConfig()
  config.profiles[name] = profile
  if (makeCurrent) config.currentProfile = name
  writeConfig(config)
}

export function deleteProfile(name: string): boolean {
  const config = readConfig()
  if (!config.profiles[name]) return false
  delete config.profiles[name]
  if (config.currentProfile === name) {
    config.currentProfile = Object.keys(config.profiles)[0] ?? 'default'
  }
  writeConfig(config)
  return true
}
