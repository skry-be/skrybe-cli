import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))

/** Run the real CLI, so the script is generated from the actual command tree. */
function generate(shell: string): string {
  return execFileSync(process.execPath, ['--import', 'tsx', entry, 'completion', shell], {
    encoding: 'utf8',
  })
}

describe('completion', () => {
  it('offers every top-level command at the root', () => {
    const script = generate('bash')
    for (const command of ['auth', 'brands', 'lists', 'campaigns', 'emails', 'subscribers', 'stats']) {
      assert.match(script, new RegExp(`\\b${command}\\b`), `${command} should be completable`)
    }
  })

  it('completes an alias as a path, not just as a suggestion', () => {
    // `skrybe subs <tab>` has to reach the subscribers subcommands; without an
    // entry keyed on the alias it would silently fall back to the root list.
    assert.match(generate('bash'), /"subs"\) echo "add unsubscribe delete/)
  })

  it('offers the shells for `completion` and the formats for --output', () => {
    const script = generate('bash')
    assert.match(script, /"completion"\) echo "bash zsh fish/)
    assert.match(script, /--output\) COMPREPLY=\(\$\(compgen -W "table json text"/)
  })

  it('picks up a nested command with its options', () => {
    assert.match(generate('bash'), /"subscribers add"\) echo ".*--field/)
  })

  it('guards zsh against being sourced before compinit', () => {
    assert.match(generate('zsh'), /\$\+functions\[compdef\]/)
  })

  it('turns off file completion for fish, which takes no path arguments', () => {
    assert.match(generate('fish'), /^complete -c skrybe -f$/m)
  })

  it('rejects a shell it cannot generate for', () => {
    assert.throws(() => generate('powershell'))
  })
})
