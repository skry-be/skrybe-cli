# Changelog

All notable changes to `@skrybe/cli`. Each release's section becomes its GitHub
Release notes. Add entries under Unreleased as changes merge; a release PR
(`npm run release:prepare -- <version>`) dates them.

Commands that call new API endpoints need a Skrybe install that has them
deployed; the API side lives in skry-be/skrybe-dashboard.

## [Unreleased]

### Added
- `autoresponders create <name> --list <id> [--type drip|annually|on_date]
  [--field <date-field>]`: create an autoresponder, e.g. a yearly birthday
  email on a `Birthday` field.
- `autoresponders add-email <id> --subject … --html-text … [--when …]`: add an
  email to one. `--when` is `immediately` or `+3 days` for a drip, and `on`,
  `+9 hours` or `-1 days` for a dated one. Emails are created off unless
  `--enable`, so an agent can draft one for a person to turn on.

## [0.2.0] - 2026-10-15

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
- `brands transport <id> [relay|ses]`: show, or switch, whether a brand sends
  through the relay or SES. Checks the relay accepts the login and From domain
  first (`--no-verify` to skip), refuses mid-send unless `--force`, and reads
  the relay password with `--password-stdin`. Needs the main account key.

### Changed
- The URL defaults to `https://dashboard.skry.be`, so `skrybe auth login` no
  longer needs `--url`. `--url`, `SKRYBE_API_URL` and a saved profile still
  take precedence, and `auth login` now honours `SKRYBE_API_URL` too.

### Fixed
- Piping output into a reader that stops early (`skrybe lists | head`) no
  longer crashes with an EPIPE stack trace; it exits 0 quietly.
- `subscribers add --field 'Two words=…'` now sets fields whose names contain
  spaces.
- `campaigns get` shows a scheduled time in the campaign's own timezone.
- `lists ls --counts` and `lists ls --include-hidden` now take effect; the
  flags were being read by `lists` instead of `ls`.

## [0.1.0] - 2026-09-09

### Added
- First release: `auth`, `whoami`, `brands`, `lists` (with `count`),
  `subscribers add|status|unsubscribe|delete`, `campaigns create`,
  `emails send` and `send-transactional`, `stats emails-sent`, and
  `completion` for bash, zsh and fish.
