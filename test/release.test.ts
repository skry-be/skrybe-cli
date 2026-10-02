import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// @ts-expect-error: a plain .mjs script with no type declarations
import { dateChangelog, section } from '../scripts/release.mjs'

const CHANGELOG = `# Changelog

## [Unreleased]

### Added
- A new thing.

## [0.1.0] - 2026-09-09

### Added
- First release.
`

describe('release script', () => {
  it('reads one section, without its heading', () => {
    assert.equal(section(CHANGELOG, '0.1.0'), '### Added\n- First release.')
    assert.equal(section(CHANGELOG, 'Unreleased'), '### Added\n- A new thing.')
    assert.equal(section(CHANGELOG, '9.9.9'), null)
  })

  it('dates the Unreleased notes under the new version and leaves Unreleased empty', () => {
    const dated = dateChangelog(CHANGELOG, '0.2.0', '2026-10-02')

    assert.equal(section(dated, 'Unreleased'), '')
    assert.equal(section(dated, '0.2.0'), '### Added\n- A new thing.')
    assert.match(dated, /## \[Unreleased\]\n\n## \[0\.2\.0\] - 2026-10-02\n/)
    assert.equal(section(dated, '0.1.0'), '### Added\n- First release.')
  })

  it('refuses to release with nothing under Unreleased, or twice', () => {
    const dated = dateChangelog(CHANGELOG, '0.2.0', '2026-10-02')
    assert.throws(() => dateChangelog(dated, '0.3.0', '2026-10-03'), /nothing under/)
    assert.throws(() => dateChangelog(CHANGELOG, '0.1.0', '2026-10-02'), /already has a section/)
  })

  describe('as a command', () => {
    const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url))
    const run = (root: string, ...args: string[]) =>
      promisify(execFile)(process.execPath, [script, ...args], {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, SKRYBE_RELEASE_ROOT: root },
      })
    const project = (version: string, changelog = CHANGELOG) => {
      const root = mkdtempSync(join(tmpdir(), 'skrybe-release-'))
      writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'x', version }, null, 2)}\n`)
      writeFileSync(join(root, 'CHANGELOG.md'), changelog)
      return root
    }

    it('prepare bumps package.json and dates the changelog', async () => {
      const root = project('0.1.0')

      await run(root, 'prepare', '0.2.0')

      assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '0.2.0')
      assert.equal(section(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), '0.2.0'), '### Added\n- A new thing.')
    })

    it('prepare refuses a version that is not newer, changing nothing', async () => {
      const root = project('0.1.0')

      await assert.rejects(run(root, 'prepare', '0.1.0'), /not newer/)
      await assert.rejects(run(root, 'prepare', 'v0.2'), /Usage/)
      assert.equal(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), CHANGELOG)
    })

    it('check passes only when the current version has notes', async () => {
      await run(project('0.1.0'), 'check')
      await assert.rejects(run(project('0.2.0'), 'check'), /no "## \[0\.2\.0\]" section/)
    })
  })
})
