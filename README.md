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
| `skrybe brands` | Brands visible to the current key |
| `skrybe whoami` | Show the active profile and its brand |
| `skrybe subscribers add <email> --list <id>` | Add a subscriber, or update one already on the list |
| `skrybe subscribers status <email> --list <id>` | Subscribed, Unsubscribed, Bounced, Complained... |
| `skrybe subscribers unsubscribe <email> --list <id>` | Unsubscribe, keeping the record |
| `skrybe subscribers delete <email> --list <id>` | Remove the record outright |
| `skrybe campaigns create ...` | Create a campaign, optionally sending or scheduling it |
| `skrybe emails send ...` | Send or schedule an email to addresses or lists |
| `skrybe emails send-transactional ...` | Send one email immediately, bypassing the queue |
| `skrybe auth login` | Store an API key for an install |
| `skrybe auth list` | List saved profiles |
| `skrybe auth logout` | Remove a saved profile |
| `skrybe stats emails-sent` | Installation-wide emails-sent counter |
| `skrybe completion <shell>` | Print a bash, zsh or fish completion script |

`ls` works as an explicit alias everywhere (`skrybe lists ls`).

Commands the HTTP API cannot serve yet — `campaigns list`, `lists create` and
friends — are registered so they fail with an explanation rather than "unknown
command". They land with the `api/v1` build-out.

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

### Custom fields

`subscribers add` sets custom fields by their personalization tag name — the
`Birthday` in `[Birthday,fallback=]`:

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
