# OVB3 — Oracle Visual Builder Bridge

**OVB3** = **O**racle **V**isual **B**uilder + **3** (a nod to Thrishul —
त्रिशूल, trident) + **Bridge**.

A Claude Code plugin (+ MCP server + CLI) for working on **git-backed Visual
Builder Studio (VBS) / VBCS apps** directly from Claude: read/write VBCS
artifacts (pages, flows, chains, service definitions), commit/push/pull, and
run Oracle's own `grunt-vb-build`/`grunt-vb-audit` — all without leaving your
editor for the VB Studio browser IDE.

This favors **artifact/git-based automation** (editing the JSON/JS files a
VB Studio project is actually made of, then using git + Oracle's own
`grunt-vb-*` tasks) over browser automation of the VB Studio design-time UI,
which has no documented public API and is brittle to script. See
[`docs/VBS-GUIDE.md`](docs/VBS-GUIDE.md) for the confirmed repo layout, chain
JS conventions, and build/audit requirements this is built against.

The toolkit targets a whole VBS **instance**, not one hardcoded app: an
instance hosts multiple VB Studio projects (each its own git repo), and each
repo can hold multiple VBCS web apps under `webApps/`. Every tool takes the
repo and app as arguments — nothing is wired to a single project, so this
works the same for any VBS developer, on any project.

## Install (recommended: as a Claude Code plugin)

```
/plugin marketplace add vanamthrishul/ovb3-bridge
/plugin install ovb3@ovb3
```

Claude Code will prompt you for the plugin's configuration:

- **VBS workspace directory** (required) — a local folder that holds (or will
  hold) git checkouts of your VB Studio project repos.
- **Default repo checkout** / **default app name** (optional) — convenience
  defaults if you mostly work against one project.
- **Component Exchange URL** (optional) — needed later for `run_build`/`run_audit`
  on apps with shared/custom components (see below); safe to leave blank
  until you know it.

That's the whole install — no cloning this repo, no `npm install`, no editing
`.mcp.json` by hand. Then run `/link` in any project to point it at a real
checkout (or clone one) and confirm everything's wired up.

To reconfigure later: `/plugin` → **OVB3** → Configure, then `/reload-plugins`.

### Alternative: manual MCP config (no plugin)

If you'd rather not use the plugin system, add the server to any project's
`.mcp.json` directly — it runs via `npx`, no local clone needed:

```json
{
  "mcpServers": {
    "vbcs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "ovb3-bridge"],
      "env": {
        "VBS_WORKSPACE_DIR": "/absolute/path/to/a/workspace/folder",
        "VBCS_REPO_PATH": "",
        "VBCS_APP_NAME": "",
        "VB_BUILD_COMPONENT_EXCHANGE_URL": ""
      }
    }
  }
}
```

In this mode there's no `userConfig` prompt, so fill in the `env` block
yourself — blank values are fine for the optional ones. You'll also want to
copy `commands/*.md` from this repo into your project's `.claude/commands/`
if you want the `/vbs-*` shortcuts (the plugin install gets these
automatically, namespaced as `/ovb3:vbs-*`).

### Alternative: clone + build locally

Useful for contributing to OVB3 itself, or if you want to run a specific
commit rather than whatever's on npm:

```bash
git clone https://github.com/vanamthrishul/ovb3-bridge.git
cd ovb3-bridge
npm install      # also compiles TypeScript into dist/ (via "prepare")
npm test         # optional sanity check — should be all green
```

Then point a project's `.mcp.json` at `node`/`dist/server.js` with an
absolute path instead of the `npx` form above.

## Using it — quick tour

**Start with `/link`** (or `/ovb3:link` if you installed as a plugin) — it
checks whether your VBS workspace directory is configured, then walks you
through pointing at an existing repo checkout or cloning one.

Once linked:

| Command | What it does |
|---|---|
| `/vbs-help` | Lists all `/vbs-*` commands with their arguments |
| `/vbs-list-repos` | Local VB Studio project checkouts under your workspace directory |
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

`<repo>` is either the exact folder name under your workspace directory, an
absolute path, or `-`/omitted to use the default-repo setting.

Typical first run:

```
/link
/vbs-list-repos
/vbs-list-apps my-vbs-project
/vbs-read my-vbs-project webApps/myApp/flows/main/main-flow.json
```

You don't have to use the slash commands — plain requests like "read the
order-entry page flow in myApp" work too, since they resolve to the same
underlying MCP tools. The commands just save you from typing that out every
time.

### grunt-vb-build / grunt-vb-audit

These are Oracle-provided npm packages distributed via a private Oracle CDN
tarball feed, not public npm. Install them into whichever VB Studio repo
checkout you're building/auditing (not into OVB3's own dependencies) —
follow Oracle's own install steps in whichever VB Studio project you're
working against. `run_build`/`run_audit` shell out to `npx grunt vb-build` /
`npx grunt vb-audit` inside that repo. Both need your org's Component
Exchange URL to work on apps with shared/custom components (the normal
case) — set it via plugin config, or `VB_BUILD_COMPONENT_EXCHANGE_URL` in the
manual `.mcp.json` form. `run_audit` additionally needs working connectivity
to a live VB Studio backend/tenant service — see
[`docs/VBS-GUIDE.md`](docs/VBS-GUIDE.md) for the confirmed details and known
limitation there.

**If `npm install` fails in that repo checkout**, check general network/proxy
access to `static.oracle.com` (where the Oracle build-tooling tarballs are
pinned by URL in `package.json`) and `registry.npmjs.org` first. If only
non-Oracle packages fail, suspect a stale or broken token in your global
`.npmrc` rather than the Oracle tarball URLs.

### Git credentials

OVB3 doesn't handle git authentication itself — `git_clone`/`git_pull`/`git_push`
shell out to your system's own git, so set up credentials for your VB Studio
remote the normal way (a credential manager, an embedded token in the remote
URL, or SSH keys) before using those tools.

**If a clone/pull/push hangs instead of failing**, it's usually your OS
credential manager silently waiting on an interactive prompt it has no
terminal to show. Check what's cached with `git config --global --list |
grep credential` — if the entry for your VB Studio host is missing or wrong,
clear it from your OS credential manager and retry so git re-prompts (or
switch to an embedded-token remote URL, which never needs a prompt).

## Also included: standalone VBCS REST tools

If some of your VBCS apps aren't backed by a VB Studio git repo at all (a
"standalone" VBCS instance), OVB3 also ships `/vbcs-*` commands (list/lock/unlock
applications, export business-object data) against that instance's REST API.
These are a secondary, REST-only surface — Oracle doesn't expose page/flow
CRUD for standalone instances, so there's no `/vbcs-read`/`/vbcs-write`
equivalent. Run `/vbcs-help` for the current list; configuration for this path
still uses a local `.env` file (`VBCS_BASE_URL`/`VBCS_IDCS_USERNAME`/`VBCS_IDCS_PASSWORD`
— see `.env.example`) rather than plugin config, since it's not the primary
supported path.

## Running the MCP server or CLI directly

```bash
npm run build && npm start   # MCP server over stdio
npm run dev                  # MCP server, dev mode (tsx, no build step)
npm run cli -- list-repos    # CLI, for manual testing without an MCP host
npm run cli -- list-apps <repo>
npm run cli -- read <repo> webApps/myApp/flows/main/main-flow.json
npm run cli -- run-build <repo> myApp
```

Every tool call — whether through MCP or the CLI — is logged to stderr:
path/repo/app touched, git operations, and live-streamed stdout/stderr for
build/audit runs. Nothing happens silently.

## Status

Verified against real cloned VBS project repos: discovery, artifact
read/write, glob listing, git status/commit/pull/push, and `grunt-vb-build`/`grunt-vb-audit`
(task names and `--app=` targeting) all confirmed working against live data.
`run_build` needs a real Component Exchange URL to succeed on apps with
shared components (the normal case); `run_audit` additionally needs VB
Studio backend connectivity that isn't resolved yet — see
[`docs/VBS-GUIDE.md`](docs/VBS-GUIDE.md).

Standalone VBCS REST API (`/vbcs-*`): list applications, lock/unlock, and
export business-object data are confirmed working against a real live
instance. Import business-object data and credential management are
deliberately left unbuilt (unpublished request shapes / not needed yet).

VB Studio's own separate REST API (`vbstudio_*` tools — CI/CD build/deploy,
a different product/base URL/auth from standalone VBCS above) is still fully
stubbed: no live VB Studio instance access has been confirmed for it, so its
endpoint shapes are deliberately not guessed at.
