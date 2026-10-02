# @skrybe/cli

Command line interface for the Skrybe email marketing API.

```bash
npx @skrybe/cli lists
```

## Install

Requires Node.js 20.19 or newer.

```bash
npm install -g @skrybe/cli   # then: skrybe lists
npx @skrybe/cli lists        # or run it without installing
```

## Getting started

The API key is the whole credential — there is no separate login. Generate one
in the Skrybe UI under **Settings**, then:

```bash
skrybe auth login --url https://your-install.example.com
# API key: (paste it here — it is read from stdin, never from a flag)

skrybe lists
```

## Commands

A bare resource name shows the collection — the common case needs no verb.

| Command | What it does |
| --- | --- |
| `skrybe lists` | Subscriber lists for the current brand |
| `skrybe lists --counts` | ...with active subscriber counts (one request per list) |
| `skrybe lists count <id>` | Active subscriber count for one list |
| `skrybe lists get <id>` | One list, with subscribers counted by state |
| `skrybe lists create <name>` | Create a list (`--opt-in double`); prints the new id |
| `skrybe lists update <id>` | Rename a list (`--name`) or switch its `--opt-in` |
| `skrybe lists fields <id>` | A list's custom fields, with their personalization tags |
| `skrybe lists fields add <id> <name>` | Add a custom field (`--type date`) |
| `skrybe lists fields rename <id> <name> <new>` | Rename a field; autoresponders and segments using it follow |
| `skrybe lists fields delete <id> <name>` | Delete a field and its values (asks first; `--yes` in scripts) |
| `skrybe lists delete <id>` | Delete a list and its subscribers (asks first; `--yes` in scripts) |
| `skrybe brands` | Brands visible to the current key |
| `skrybe whoami` | Show the active profile and its brand |
| `skrybe subscribers ls --list <id>` | A list's subscribers, oldest first (`--status`, `--page`, `--limit`, `--all`) |
| `skrybe subscribers add <email> --list <id>` | Add a subscriber, or update one already on the list |
| `skrybe subscribers status <email> --list <id>` | Subscribed, Unsubscribed, Bounced, Complained... |
| `skrybe subscribers unsubscribe <email> --list <id>` | Unsubscribe, keeping the record |
| `skrybe subscribers delete <email> --list <id>` | Remove the record outright |
| `skrybe campaigns` | Campaigns, newest first (`--status`, `--page`, `--limit`, `--all`) |
| `skrybe campaigns get <id>` | One campaign's details; `--content` prints its HTML |
| `skrybe campaigns stats <id>` | Opens, clicks, bounces, complaints, unsubscribes, per-link clicks |
| `skrybe campaigns update <id> --subject ...` | Edit a draft or scheduled campaign; only the fields given change |
| `skrybe campaigns duplicate <id>` | Copy a campaign into a new draft (`--title`); prints the new id |
| `skrybe campaigns delete <id>` | Delete a campaign (asks first; `--yes` in scripts). A sent one loses its report |
| `skrybe campaigns create ...` | Create a campaign, optionally sending or scheduling it |
| `skrybe campaigns send <id> --list <id>` | Send a draft now (`--dry-run` counts recipients, sends nothing) |
| `skrybe campaigns schedule <id> --at <time> --list <id>` | Schedule a draft, or move a scheduled campaign (`--timezone`, `--dry-run`) |
| `skrybe campaigns unschedule <id>` | Turn a scheduled campaign back into a draft |
| `skrybe campaigns test <id> --to <email>` | Send a test to up to 5 addresses (20 requests an hour per brand) |
| `skrybe emails send ...` | Send or schedule an email to addresses or lists |
| `skrybe emails send-transactional ...` | Send one email immediately, bypassing the queue |
| `skrybe auth login` | Store an API key for an install |
| `skrybe auth list` | List saved profiles |
| `skrybe auth logout` | Remove a saved profile |
| `skrybe stats emails-sent` | Installation-wide emails-sent counter |
| `skrybe completion <shell>` | Print a bash, zsh or fish completion script |

`ls` works as an explicit alias everywhere (`skrybe lists ls`).

Commands the HTTP API cannot serve yet — `campaigns stop` and `campaigns
resume` — are registered so they fail with an explanation rather than "unknown
command". The API is gaining them one endpoint at a time.

### Passing a body from a file

An HTML email will not fit on a command line, so anywhere a value is accepted
you can point at a file instead, using the same `file://` convention as the AWS
CLI:

```bash
skrybe campaigns create \
  --title 'Q4 newsletter' --subject 'Your Q4 update' \
  --from-name Acme --from-email hello@acme.test --reply-to hello@acme.test \
  --html-text file://campaign.html \
  --list <list-id>
```

Add `--send` to send it immediately, or `--schedule 'June 15, 2027 6:05pm'` to
schedule it. Without either, it stays a draft.

### Sending a draft

`campaigns send` sends a campaign that is still a draft, to the lists and
segments you name:

```bash
skrybe campaigns send 42 --list <list-id> --exclude-list <list-id> --dry-run
# ✓ Campaign 42 would go to 1,204 recipients. Nothing was sent.

skrybe campaigns send 42 --list <list-id> --exclude-list <list-id>
# Send campaign 42 to 1,204 recipients? [y/N]
```

It asks before sending. From a script, where there is no one to answer, it
refuses unless you pass `--yes`. Only a draft can be sent, so running it again
after a dropped connection reports `campaign_not_draft` instead of sending a
second time.

### Scheduling

`campaigns schedule` takes the same recipients as `send`, plus a time:

```bash
skrybe campaigns schedule 42 --list <list-id> --at '2027-06-15 18:05' --timezone Africa/Lagos
# Schedule campaign 42 for 2027-06-15 18:05 Africa/Lagos to 1,204 recipients? [y/N]
```

The time is read in `--timezone`, or in the account's timezone if you leave it
out, and must be in the future. Running it on a campaign that is already
scheduled moves it. The recipients count against the brand's quota as soon as
the campaign is scheduled. `campaigns unschedule` turns it back into a draft and
gives that quota back. Like `send`, it asks before scheduling and needs `--yes`
from a script.

### Test sends

`campaigns test` sends a campaign to a few addresses before it goes to a list:

```bash
skrybe campaigns test 42 --to ada@example.com --to team@example.com
```

It sends to at most 5 addresses per call. Each brand gets 20 test sends an
hour, shared with the test-send box in the Skrybe UI. It exits `1` if any
address fails, and `--json` shows the result for each address.

### Exporting a list

`subscribers ls` pages through a list, oldest first. Each subscriber is in
exactly one state: `active`, `unconfirmed`, `unsubscribed`, `bounced` or
`complained`. `active` is who a campaign sends to.

```bash
skrybe subscribers ls --list <id> --status active --all --output text > active.tsv
skrybe subscribers ls --list <id> --all --json | jq '.[] | {email, city: .custom_fields.City}'
```

`--output text` gives email, name, status and join time, tab-separated.
`--json` adds each subscriber's custom fields by name, with dates as
`YYYY-MM-DD`.

### Custom fields

`subscribers add` sets custom fields by their personalization tag name — the
`Birthday` in `[Birthday,fallback=]`. `skrybe lists fields <list-id>` shows a
list's fields, and `lists fields add` creates one:

```bash
skrybe subscribers add ada@example.com --list <id> \
  --name 'Ada Lovelace' --field Birthday=1990-01-01 --field City=Lagos
```

Adding an address that is already on the list updates it and exits `0`, since
re-running a script is not a failure. `--json` reports which happened:

```json
{ "email": "ada@example.com", "list_id": "...", "outcome": "already_subscribed" }
```

## Profiles

One API key maps to exactly one brand, so a profile per brand is the natural unit:

```bash
skrybe auth login --url https://app.example.com --profile acme
skrybe --profile acme lists
```

Credentials live in `~/.skrybe/config.json` (mode `0600`, in a `0700` directory).
Override with `SKRYBE_CONFIG`, or respect `XDG_CONFIG_HOME`.

Resolution order, highest first:

1. `SKRYBE_API_KEY` / `SKRYBE_API_URL`
2. `--profile <name>`
3. `SKRYBE_PROFILE`
4. the current profile in the config file

Env wins so CI needs no config file on disk.

## Scripting

`--output` picks the shape. Data goes to stdout and diagnostics to stderr, so
redirection and pipes stay clean:

| Format | For |
| --- | --- |
| `table` | reading — aligned columns with a header (the default) |
| `json` | `jq` — the full record, with numbers and nulls intact |
| `text` | `cut`, `while read` — tab-separated, no header, no padding |

```bash
skrybe lists --output json | jq -r '.[].id'
skrybe lists --output text | cut -f2
```

`--json` is a shorthand for `--output json`, and `SKRYBE_OUTPUT` sets a default.

`table` is the human format, so a command that performs an action prints a
sentence to stderr and leaves stdout empty. Under `json` and `text` it emits its
result record to stdout instead:

```bash
$ skrybe subscribers add ada@example.com --list <id> --output json
{ "email": "ada@example.com", "list_id": "...", "outcome": "subscribed" }
```

Errors follow the format too, so a script does not have to parse one shape on
success and another on failure:

```bash
$ skrybe subscribers status nobody@example.com --list bogus --output json
{ "error": { "code": "list_id_invalid", "message": "List ID not passed", "hint": "..." } }
```

An empty collection is a success, not an error: `skrybe lists` exits `0` and
`--json` emits `[]` when the brand has no lists.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | API error |
| `2` | Usage error (bad flag, missing config, unimplemented command) |
| `3` | Authentication failure |
| `4` | Quota exceeded or rate limited |

## Shell completion

Generated from the command tree, so it stays in step with the commands:

```bash
eval "$(skrybe completion bash)"    # add to ~/.bashrc
eval "$(skrybe completion zsh)"     # add to ~/.zshrc
skrybe completion fish > ~/.config/fish/completions/skrybe.fish
```

It completes subcommands, aliases, long flags, and the fixed values for
`--output` and `completion`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
node dist/index.js --help
```

Tests run on `node:test` and talk to a throwaway HTTP server that answers the
way the PHP endpoints actually do — a 200 carrying a prose failure, a
string-concatenated payload with an unescaped name — because a mocked `fetch`
would assert nothing about the quirks the client exists to absorb.

The client absorbs the legacy API's quirks in `src/api/` so command code never
sees them — form vs JSON bodies, HTTP 200 on failure, and the unescaped
`{"list1": {...}}` payload shape. See the comments in `src/api/parse.ts` and
`src/api/errors.ts`.
