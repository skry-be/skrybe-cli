# @skrybe/cli

Command line interface for the Skrybe email marketing API.

```bash
npx @skrybe/cli lists list
```

## Getting started

Generate an API key in the Skrybe UI under **Settings**, then:

```bash
skrybe auth login --url https://your-install.example.com
# API key: (paste it here — it is read from stdin, never from a flag)

skrybe lists list
```

## Commands

| Command | What it does |
| --- | --- |
| `skrybe auth login` | Store an API key for an install |
| `skrybe auth whoami` | Show the active profile and its brand |
| `skrybe auth list` | List saved profiles |
| `skrybe auth logout` | Remove a saved profile |
| `skrybe brands list` | Brands visible to the current key |
| `skrybe lists list` | Subscriber lists for the current brand |
| `skrybe lists list --counts` | ...with active subscriber counts (one request per list) |
| `skrybe lists count <id>` | Active subscriber count for one list |
| `skrybe stats emails-sent` | Installation-wide emails-sent counter |

Commands the HTTP API cannot serve yet — `campaigns list`, `campaigns send`,
`lists create` and friends — are registered so they fail with an explanation
rather than "unknown command". They land with the `api/v1` build-out.

## Profiles

One API key maps to exactly one brand, so a profile per brand is the natural unit:

```bash
skrybe auth login --url https://app.example.com --profile acme
skrybe --profile acme lists list
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
skrybe lists list --json | jq -r '.[].id'
```

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
npm run build
node dist/index.js --help
```

The client absorbs the legacy API's quirks in `src/api/` so command code never
sees them — form vs JSON bodies, HTTP 200 on failure, and the unescaped
`{"list1": {...}}` payload shape. See the comments in `src/api/parse.ts` and
`src/api/errors.ts`.
