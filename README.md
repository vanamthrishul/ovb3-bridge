# OVB3 — Oracle Visual Builder Bridge

**OVB3** = **O**racle **V**isual **B**uilder + **3** (a nod to Thrishul —
त्रिशूल, trident) + **Bridge**.

Work on **Oracle Visual Builder Studio (VBS) / VBCS** apps from Claude instead
of the browser IDE. OVB3 is a Claude Code plugin, an MCP server and a CLI that
let Claude read, search, edit, build, audit, commit and push the files a VB
Studio project is made of — plus manage data and CI jobs on your instance.

It deliberately works on the **artifacts and git** (the JSON/JS files and the
repo behind a VB Studio project, plus Oracle's own `grunt-vb-*` tasks) rather
than scripting the design-time browser UI, which has no public API and breaks
whenever Oracle updates it. See [`docs/VBS-GUIDE.md`](docs/VBS-GUIDE.md) for the
confirmed repo layout and build behavior this is built against.

Nothing is tied to one project: an instance hosts many VB Studio projects (git
repos), each holding many apps under `webApps/`, and every tool takes the repo
and app as arguments.

## Quick start

**1. Install** (Claude Code):

```
/plugin marketplace add vanamthrishul/ovb3-bridge
/plugin install ovb3@ovb3
```

Claude Code asks for a **workspace folder** (any folder to hold your repo
checkouts) and, optionally, git credentials and defaults. Secrets such as the
git token are kept in your system keychain.

**2. Link a project:** run `/ovb3:link` — it walks you through cloning a repo
(or pointing at one you already have).

**3. Check it:** run `/ovb3:vbs-doctor`. It tells you what works, what's
missing, and the exact fix for each — **this is the first thing to run
whenever something doesn't work.**

No Claude Code? The same tools ship as a CLI and a plain MCP server — see
[Other ways to run it](#other-ways-to-run-it).

## What you can do

| Area | Tools (also `ovb3 <command>` in the CLI) | Notes |
|---|---|---|
| **Diagnose** | `doctor` | Checks Node, git, workspace, credentials, build tools; never prints secrets |
| **Browse & edit** | `list_repos`, `list_apps`, `list_artifacts`, `read_artifact`, `write_artifact` | `write_artifact` refuses invalid JSON and any path outside the repo |
| **Search** | `search_artifacts` | Grep file *content* (text or regex) across a repo |
| **Cross-app audit** | `audit_service_calls` | Finds every `Actions.callRest` call and flags parameter keys some apps send and others omit |
| **Git** | `git_status`, `git_commit`, `git_pull`, `git_push`, `git_clone` | Non-interactive: authenticates with your token and fails fast instead of hanging |
| **Build & audit** | `setup_build_tools`, `run_build`, `run_audit` | Oracle's `grunt-vb-build` / `grunt-vb-audit`; failures come with a plain-language hint |
| **VB Studio CI** | `vbstudio_trigger_build`, `vbstudio_build_status`, `vbstudio_job_params` | Oracle's documented Builds REST API; the base URL is derived from your repo's git remote |
| **Standalone VBCS** | `vbcs_list_applications`, `vbcs_lock_application`, `vbcs_unlock_application`, `vbcs_export_bo_data`, `vbcs_import_bo_data` | For VBCS apps with no VB Studio project; export/import business-object data as CSV/ZIP |

Slash commands exist for each (`/vbs-help` and `/vbcs-help` list them; they're
namespaced `/ovb3:…` when installed as a plugin). You can also just ask in
plain language — "find every app that calls the Orders service without the
`region` parameter" resolves to the same tools.

### Example: check a shared service is called consistently

```
/vbs-audit-calls my-vbs-project Orders/getOrders
```

reports, per endpoint, which apps call it and any parameter key that some apps
pass and others don't. It compares which keys are passed, not their values
(values are arbitrary expressions).

## Setting up credentials

Never paste credentials into a Claude conversation. Set them in plugin
settings (`/plugin` → **OVB3** → Configure, then `/reload-plugins`) or in a
config file (see below).

| You want | Set |
|---|---|
| Clone / pull / push over HTTPS | `VBSTUDIO_GIT_USERNAME` + `VBSTUDIO_GIT_TOKEN` (a VB Studio personal access token) |
| `run_build` / `run_audit` on apps with web components (most) | `VB_BUILD_COMPONENT_EXCHANGE_URL` — in VB Studio under Tenant Settings → Component Exchange; a private exchange looks like `https://<vbs-host>/<org>/s/<org>_<project>/compcatalog/0.2.0` |
| VB Studio CI jobs | `VBSTUDIO_API_TOKEN` (or leave it blank and your `VBSTUDIO_GIT_TOKEN` is reused as the bearer token) |
| Standalone VBCS | `VBCS_BASE_URL` (bare host, **no** `/ic/builder`), `VBCS_IDCS_USERNAME`, `VBCS_IDCS_PASSWORD` |

Git credentials are sent as a scoped HTTP header — never put in URLs, logs or
`.git/config` — and everything logged or returned in an error is redacted.
Personal access tokens **expire**: if git starts failing with "Authentication
failed" on something that used to work, generate a new one.

Outside the plugin, config is read from (highest priority first): real
environment variables, `./.env`, then the install's own file — `<clone>/.env`
for a git clone, `~/.ovb3/.env` for npm/npx installs (override with
`OVB3_ENV_FILE`). [`.env.example`](.env.example) documents every variable.
`ovb3 init` creates and fills it interactively (non-secret fields only).

## Build and audit: what to expect

`run_build` / `run_audit` run Oracle's tasks directly (no shell) inside your
repo checkout:

1. Run **`setup_build_tools`** once per checkout. VB Studio projects pin
   Oracle's `grunt-vb-build` / `grunt-vb-audit` tarballs in their own
   `package.json`, so no extra registry setup is needed. (If `npm install`
   fails, check access to `static.oracle.com` and `registry.npmjs.org`; if only
   non-Oracle packages fail, suspect a stale token in your global `.npmrc`.)
2. Set the **Component Exchange URL** (above). Without it Oracle's own task
   stops with *Missing mandatory component exchange URL* — OVB3 detects that
   and tells you what to set. If your exchange needs a login, also set
   `VB_BUILD_CE_USERNAME` + `VB_BUILD_CE_PASSWORD` (or `VB_BUILD_CE_ACCESS_TOKEN`).
3. **`run_audit` also needs network access to a live Visual Builder backend**
   (it fetches `vb.services.catalog.json`). On a machine that can't reach one
   you'll see `ETIMEDOUT`; that's a connectivity requirement, not a config flag.

Builds are stopped after 15 minutes by default (`OVB3_BUILD_TIMEOUT_MS`), and
the whole process tree is killed, so nothing is left running.

## Limits you should know about

These are properties of Oracle's APIs, not gaps waiting to be filled:

- **Standalone VBCS (no VB Studio project) has no page/flow editing.** Oracle's
  published REST API for it has 14 endpoints — list/lock/unlock apps, a token
  endpoint, credential CRUD, and business-object data export/import. There is no
  whole-app export/import, version, build or deploy endpoint. If you want
  artifact editing, work from the app's VB Studio project.
- **VB Studio has no "deploy" API call** — deploys are CI jobs or pipelines, so
  use `vbstudio_trigger_build` on the deploy job. Pipeline endpoints exist in
  Oracle's docs but their request shapes weren't published clearly enough to
  build against, so they're not included.
- **The service-call audit reads JavaScript action chains** (`Actions.callRest`).
  It's a comment- and string-aware scanner, not a full JS parser; unusual
  dynamically built calls won't be seen.
- **Data import replaces by default in Oracle's API**, so `vbcs_import_bo_data`
  makes you choose `append` or `replace` explicitly.

## Other ways to run it

**Plain MCP config (no plugin)** — add to any project's `.mcp.json`; runs via
`npx`, nothing to clone:

```json
{
  "mcpServers": {
    "vbcs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "ovb3-bridge"],
      "env": { "VBS_WORKSPACE_DIR": "/absolute/path/to/a/workspace/folder" }
    }
  }
}
```

Copy `commands/*.md` into `.claude/commands/` if you want the `/vbs-*` shortcuts.

**CLI** — `npm install -g ovb3-bridge`, then `ovb3 init`, `ovb3 doctor`,
`ovb3 list-repos`, `ovb3 search <repo> <text>`, … (`ovb3 --help` lists them all).
Run `ovb3 init` yourself in a terminal; when driving setup through an AI agent,
use `/link` instead — the wizard is interactive and an agent can't type into it.

**From source** (contributing, or running an unreleased commit):

```bash
git clone https://github.com/vanamthrishul/ovb3-bridge.git
cd ovb3-bridge
npm install      # also compiles TypeScript into dist/ (via "prepare")
npm test
node dist/cli.js doctor
```

Every tool call is logged to stderr — what was touched, git operations,
build/audit output as it streams — so nothing happens silently.

## Troubleshooting

Run **`doctor`** first. Beyond that:

- **`plugin:ovb3:vbcs` shows ✗ in `/mcp` right after install** — the first
  launch downloads the package via `npx`, which can exceed Claude Code's 30s
  connect limit on a slow or restricted network. Select the server in `/mcp` and
  choose reconnect (it starts fast once the cache is warm), or run
  `npx -y ovb3-bridge` once in a terminal first and press `Ctrl+C` after the
  startup line.
- **`doctor` in a plain terminal says everything is unset** — plugin config is
  only injected when Claude Code launches the server. Run `/ovb3:vbs-doctor`
  inside Claude Code to see the real picture.
- **Git says "Authentication failed"** — your token is missing, wrong or expired
  (see credentials above). OVB3 never waits on a hidden prompt; it fails in
  seconds with this message.
- **Git stalls then times out** — the host in the remote URL is unreachable. A
  stale host in an old URL (e.g. a retired test environment) is a common cause.
- **`Missing mandatory component exchange URL`** — set the Component Exchange URL.
- **`Backend fetch failed … ETIMEDOUT` from `run_audit`** — this machine can't
  reach a Visual Builder backend (VPN/proxy).
- **VBCS login fails** — `VBCS_BASE_URL` must be the bare host. If you copied
  it from the browser and it's very long with `?state=…` in it, that's a login
  redirect, not the instance URL.

## Contributing

Issues and PRs welcome. `npm test` must pass; CI runs it on Linux, macOS and
Windows. A packaging test keeps the two command folders, the version numbers
and `.env.example` in sync with the code.

MIT licensed.
