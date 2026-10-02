# Changelog

All notable changes to `@skrybe/cli`. Each release's section becomes its GitHub
Release notes. Add entries under Unreleased as changes merge; a release PR
(`npm run release:prepare -- <version>`) dates them.

Commands that call new API endpoints need a Skrybe install that has them
deployed; the API side lives in skry-be/skrybe-dashboard.

## [Unreleased]

### Added
- `campaigns ls`/bare `campaigns`, `campaigns get` and `campaigns stats`: read
  campaigns, their details and their stats.
- `campaigns send <id>`: send an existing draft, with `--dry-run` and a
  confirmation prompt (`--yes` in scripts).
- `campaigns test <id> --to …`: send a test to up to five addresses.
- `campaigns schedule <id> --at … [--timezone]` and `campaigns unschedule <id>`.
- `campaigns update`, `campaigns duplicate` and `campaigns delete`.
- `campaigns activity <id> --type opens|clicks|bounces|complaints|unsubscribes`:
  who did what, a page at a time or `--all`.
- `campaigns create --template <id>`: start from a template's body and sender.
- `lists get`, `lists create`, `lists update` and `lists delete`.
- `lists fields <id>` and `lists fields add|rename|delete`: custom fields.
- `subscribers ls --list <id>`: a list's subscribers by status, with custom
  fields under `--json`.
- `templates`, `templates get|create|update|delete`.
- `autoresponders`, `autoresponders emails <id>` and `autoresponders stats
  <email-id>` (read-only).

### Fixed
- Piping output into a reader that stops early (`skrybe lists | head`) no
  longer crashes with an EPIPE stack trace; it exits 0 quietly.
- `subscribers add --field 'Two words=…'` now sets fields whose names contain
  spaces.
- `campaigns get` shows a scheduled time in the campaign's own timezone.

## [0.1.0] - 2026-09-09

### Added
- First release: `auth`, `whoami`, `brands`, `lists` (with `count`),
  `subscribers add|status|unsubscribe|delete`, `campaigns create`,
  `emails send` and `send-transactional`, `stats emails-sent`, and
  `completion` for bash, zsh and fish.
