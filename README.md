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
| `skrybe auth login` | Store an API key for an install |
| `skrybe auth list` | List saved profiles |
| `skrybe auth logout` | Remove a saved profile |
| `skrybe stats emails-sent` | Installation-wide emails-sent counter |

`ls` works as an explicit alias everywhere (`skrybe lists ls`).

Commands the HTTP API cannot serve yet — `campaigns list`, `campaigns send`,
`lists create` and friends — are registered so they fail with an explanation
rather than "unknown command". They land with the `api/v1` build-out.

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

`--json` writes the raw payload to stdout; progress and diagnostics go to
stderr, so redirection and pipes stay clean:

```bash
skrybe lists --json | jq -r '.[].id'
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
