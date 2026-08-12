# OVB3 — Oracle Visual Builder Bridge

**OVB3** = **O**racle **V**isual **B**uilder + **3** (a nod to Thrishul —
त्रिशूल, trident) + **Bridge**.

MCP server + CLI for driving Oracle Visual Builder Studio (VBS) / Visual
Builder Cloud Service (VBCS) app development from Claude — reading/writing
VBCS artifacts, running Oracle's build/audit tasks, and (once a live dev
instance is available) driving VB Studio's CI/CD REST API.

This favors **artifact/git-based automation** (editing the JSON/JS files VB
Studio projects are made of, then using git + Oracle's own `grunt-vb-*`
tasks) over browser automation of the VB Studio design-time UI, which has no
documented public API and is brittle to script.

The toolkit targets a whole VBS **instance**, not one hardcoded app: an
instance hosts multiple VB Studio projects (each its own git repo), and each
repo can hold multiple VBCS web apps under `webApps/`. Every tool takes the
repo and app as arguments; nothing is wired to a single project.

## Install

```bash
git clone https://github.com/vanamthrishul/ovb3-bridge.git
cd ovb3-bridge        # or whatever local folder name you cloned it into — that's cosmetic
npm install          # also compiles TypeScript into dist/ (via the "prepare" script)
npm run cli -- init   # guided setup — see below
npm test              # optional sanity check — should be all green
```

That's the whole install. There's no npm-registry package and deliberately no
"one-line npx install" — this tool holds real per-machine state (your `.env`
credentials, and local checkouts of VBS repos under `VBS_WORKSPACE_DIR`), so
a stable clone is the right model, not an ephemeral npx run. Clone it once to
wherever you keep dev tools, configure it there, and point any Claude Code
project's `.mcp.json` at that one stable checkout (see below).

### `ovb3 init` — guided setup

`npm run cli -- init` (or just `ovb3 init` once installed on your `PATH`)
walks you through linking either a VB Studio project or a standalone VBCS
instance, and writes the relevant non-secret fields into `.env` for you
(creating it from `.env.example` first if it doesn't exist yet). This is the
CLI-native equivalent of the `/link` slash command below — same rules, same
fields, just usable without Claude Code. Like `/link`, it never asks for or
writes credentials; those are always yours to fill into `.env` directly.

### Using it in Claude Code

**This repo** already has `.mcp.json` + `.claude/commands/vbs-*.md` committed,
so opening this folder in Claude Code and starting a new session picks up
both automatically (MCP servers and commands are loaded at session start —
restart/reload if you had a session open before installing).

**Any other project**: add an entry to that project's own `.mcp.json`
pointing at this checkout's absolute path:

```json
{
  "mcpServers": {
    "vbcs": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/ovb3-bridge/dist/server.js"]
    }
  }
}
```

Then copy `.claude/commands/vbs-*.md` from this repo into that project's
`.claude/commands/` if you want the `/vbs-*` shortcuts there too.

> The MCP server key (`vbcs`) and the `/vbs-*` command prefix are left as-is
> after the OVB3 rename on purpose — they name the *domain* (VB Studio/VBCS),
> not the project brand, so they don't need to track whatever this repo is
> called.

## Using it — quick tour

**Start with `/link`** — a guided setup that asks whether you're connecting
to a VB Studio project (git-backed) or a standalone VBCS instance (REST-only,
no git remote), collects the details, and writes the relevant non-secret
`.env` vars for you. Secrets (git tokens, IDCS password) are never asked for
or written by `/link` — you fill those into `.env` yourself, as always.
(Not using Claude Code? `ovb3 init` from a terminal does the same thing —
see above.)

Once linked, use `/vbs-*` commands for a VB Studio-backed project, or
`/vbcs-*` commands for a standalone VBCS instance:

| Command | What it does |
|---|---|
| `/vbs-help` | Lists all `/vbs-*` commands with their arguments |
| `/vbs-list-repos` | Local VB Studio project checkouts under `VBS_WORKSPACE_DIR` |
| `/vbs-list-apps <repo>` | VBCS apps inside a repo (`webApps/<name>`) |
| `/vbs-read <repo> <path>` | Read an artifact file |
| `/vbs-write <repo> <path> [file]` | Write an artifact file |
| `/vbs-list-artifacts <repo> <glob>` | Find artifacts matching a pattern |
| `/vbs-git-status <repo>` | Git status |
| `/vbs-git-commit <repo> <message>` | Stage + commit |
| `/vbs-git-pull <repo>` | Pull |
| `/vbs-git-push <repo>` | Push |
| `/vbs-run-build <repo> [app]` | Run `grunt-vb-build` |
| `/vbs-run-audit <repo> [app]` | Run `grunt-vb-audit` |

`<repo>` is either the exact folder name under `VBS_WORKSPACE_DIR`, an
absolute path, or `-`/omitted to use the `VBCS_REPO_PATH` default.

For a standalone VBCS instance (no VB Studio project, no git remote — see
`/vbcs-help` for the always-current, self-generated list):

| Command | What it does |
|---|---|
| `/vbcs-help` | Lists all `/vbcs-*` commands with their arguments |
| `/vbcs-list-apps` | Applications on the linked VBCS instance |
| `/vbcs-lock-app <branchId>` | Lock a live application |
| `/vbcs-unlock-app <branchId>` | Unlock a live application |
| `/vbcs-export-data <appName> <appVersion> <boName>` | Export a business object's data records |

These call the standalone VBCS REST API directly (`VBCS_BASE_URL` in
`.env`), not a git repo — there's no `/vbcs-read`/`/vbcs-write` equivalent
because Oracle doesn't expose page/flow CRUD over REST for standalone
instances, only the operations above plus data import (still stubbed — see
Status).

Typical first run:

```
/vbs-list-repos                              # see what's checked out
/vbs-list-apps my-vbs-project                # see the apps inside it
/vbs-read my-vbs-project webApps/myApp/flows/main/main-flow.json
```

You don't have to use the slash commands — plain requests like "read the
order-entry page flow in myApp" work too, since they resolve to the
same underlying MCP tools. The commands just save you from typing that out
every time.

### `.env`

See `.env.example` for the full list. Key ones:

- `VBS_WORKSPACE_DIR` — a local directory containing checkouts of one or more
  VB Studio project repos. `list_repos` / `list_apps` discover what's
  available under here.
- `VBCS_REPO_PATH` / `VBCS_APP_NAME` — optional single-repo/app defaults, for
  when a tool call doesn't specify one explicitly.
- `VBSTUDIO_GIT_*` — git remote + auth for commit/push/pull helpers.
- `IDCS_*` / `VBSTUDIO_API_BASE_URL` — VB Studio's own REST API auth (builds,
  pipelines, issues). Leave blank for now; the `vbstudio_*` tools are stubs —
  no live VB Studio instance access has been confirmed for this API yet, so
  its endpoint shapes aren't wired up (see "Status" below).
- `VBCS_BASE_URL` / `VBCS_IDCS_USERNAME` / `VBCS_IDCS_PASSWORD` — a
  standalone VBCS instance's own REST API (different product/auth from VB
  Studio's). `VBCS_BASE_URL` is normally set by `/link`; the two credential
  vars are always yours to fill in directly.

### Checking out a VBS repo to work against

```bash
# clone target repos into the workspace dir (uses VBSTUDIO_GIT_TOKEN from .env)
git clone https://<username>@<your-vb-studio-host>/.../scm/<repo>.git workspace/<repo-name>
```

Then `/vbs-list-repos` / `/vbs-list-apps` will pick it up immediately — no
toolkit restart needed, since discovery reads the filesystem live.

### grunt-vb-build / grunt-vb-audit

These are Oracle-provided npm packages distributed via a private Oracle CDN
tarball feed, not public npm. Install them into whichever VB Studio repo
checkout you're building/auditing (not into this toolkit's own
`node_modules`) — follow Oracle's own install steps for those packages in
whichever VB Studio project you're working against. `run_build` / `run_audit`
shell out to `npx grunt vb-build` / `npx grunt vb-audit` inside that repo —
both task names confirmed correct against real installed package source.
Both also need your org's Component Exchange URL (`VB_BUILD_COMPONENT_EXCHANGE_URL`
in `.env`) to work on apps with shared/custom components (the normal case);
without it, `run_build` fails with Oracle's own "Missing mandatory component
exchange URL" error. `run_audit` additionally needs working connectivity to a
live VB Studio backend/tenant service — unresolved as of now, see `build.ts`.

## Running the MCP server or CLI directly

```bash
npm run build && npm start   # MCP server over stdio
npm run dev                  # MCP server, dev mode (tsx, no build step)
npm run cli -- init          # guided setup (see above)
npm run cli -- list-repos    # CLI, for manual testing without an MCP host
npm run cli -- list-apps <repo>
npm run cli -- read <repo> webApps/myApp/flows/main/main-flow.json
npm run cli -- run-build <repo> myApp
npm run cli -- vbcs-list-apps [filter]              # standalone VBCS instance (VBCS_BASE_URL)
npm run cli -- vbcs-lock-app <branchId>
npm run cli -- vbcs-unlock-app <branchId>
npm run cli -- vbcs-export-data <appName> <appVersion> <boName>
```

Every tool call — whether through MCP or the CLI — is logged to stderr:
path/repo/app touched, git operations, and live-streamed stdout/stderr for
build/audit runs. Nothing happens silently.

## Status

Scaffolded and verified against a real cloned VBS project repo: discovery,
artifact read, glob listing, and git status all confirmed working against
live data.

Standalone VBCS REST API (`/vbcs-*` commands, `src/tools/vbcs-api.ts`): list
applications, lock/unlock, and export business-object data are implemented
against endpoint shapes confirmed from Oracle's published docs, and have been
exercised and confirmed working against a real live instance — including the
token response and `applist` response shapes. Import business-object data and
credential management are deliberately left stubbed/unbuilt (unpublished
request shapes / not needed yet).

VB Studio's own REST API (`vbstudio_*` tools — a separate product/integration
from standalone VBCS above, different base URL and auth) is still fully
stubbed: no live VB Studio instance access has been confirmed for it, so its
endpoint shapes are deliberately not guessed at.

This folder is the ongoing development home for the toolkit — new tools and
fixes land here and get pushed up, not maintained as a separate release
artifact.
