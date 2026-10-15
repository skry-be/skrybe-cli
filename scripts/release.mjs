#!/usr/bin/env node
// Release helper. Not shipped: package.json `files` publishes dist/ only.
//
//   node scripts/release.mjs prepare 0.2.0   bump the version and date the changelog
//   node scripts/release.mjs notes 0.2.0     print that version's changelog section
//   node scripts/release.mjs check           fail if the current version has no section
//
// `prepare` is what a release PR runs (`npm run release:prepare -- 0.2.0`);
// `check` runs in CI so a release PR can't merge without notes; `notes` is what
// .github/workflows/release.yml puts on the GitHub Release once it publishes.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.SKRYBE_RELEASE_ROOT ?? process.cwd()
const changelogPath = resolve(root, 'CHANGELOG.md')
const packagePath = resolve(root, 'package.json')

const SEMVER = /^\d+\.\d+\.\d+$/

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

/** The body of the `## [heading]` section, without its heading, or null. */
export function section(changelog, heading) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`## [${heading}]`))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## ['))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

function compare(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** Moves the Unreleased notes under `## [version] - date`, leaving Unreleased empty. */
export function dateChangelog(changelog, version, date) {
  const unreleased = section(changelog, 'Unreleased')
  if (!unreleased) throw new Error('CHANGELOG.md has nothing under "## [Unreleased]" to release.')
  if (section(changelog, version) !== null) throw new Error(`CHANGELOG.md already has a section for ${version}.`)
  return changelog.replace(
    `## [Unreleased]\n\n${unreleased}\n`,
    `## [Unreleased]\n\n## [${version}] - ${date}\n\n${unreleased}\n`,
  )
}

const [command, arg] = process.argv.slice(2)
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)

if (isMain) {
  const changelog = readFileSync(changelogPath, 'utf8')
  const current = JSON.parse(readFileSync(packagePath, 'utf8')).version

  if (command === 'prepare') {
    if (!SEMVER.test(arg ?? '')) fail('Usage: npm run release:prepare -- <major.minor.patch>, e.g. 0.2.0')
    if (compare(arg, current) <= 0) fail(`${arg} is not newer than the current version, ${current}.`)
    let dated
    try {
      dated = dateChangelog(changelog, arg, new Date().toISOString().slice(0, 10))
    } catch (err) {
      fail(err.message)
    }
    writeFileSync(changelogPath, dated)
    // Updates package.json and package-lock.json together; no commit, no tag.
    execFileSync('npm', ['version', arg, '--no-git-tag-version'], { cwd: root, stdio: 'ignore' })
    process.stdout.write(
      [
        `Prepared ${arg}: package.json, package-lock.json and CHANGELOG.md.`,
        'Next:',
        `  git checkout -b release/v${arg}`,
        `  git commit -am 'chore: release ${arg}'`,
        `  git push -u origin release/v${arg}   # then open a PR into main`,
        `Merging it publishes ${arg} to npm and tags v${arg}.`,
        '',
      ].join('\n'),
    )
  } else if (command === 'notes') {
    const version = arg ?? current
    const notes = section(changelog, version)
    if (!notes) fail(`CHANGELOG.md has no notes for ${version}.`)
    process.stdout.write(`${notes}\n`)
  } else if (command === 'check') {
    if (!section(changelog, current)) {
      fail(
        `CHANGELOG.md has no "## [${current}]" section, but package.json is at ${current}.\n` +
          'A release PR should come from `npm run release:prepare -- <version>`, which adds it.',
      )
    }
    process.stdout.write(`CHANGELOG.md has notes for ${current}.\n`)
  } else {
    fail('Usage: node scripts/release.mjs prepare <version> | notes [version] | check')
  }
}
