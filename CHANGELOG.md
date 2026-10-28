# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [0.3.2] - 2026-10-16

### Fixed

- A `VBS_WORKSPACE_DIR` that doesn't exist yet is no longer an error: `git_clone`
  creates it on first use, `list_repos` returns an empty list, and `doctor`
  reports a warning ("will be created on the first git_clone") instead of a
  failure. Found while testing the plugin install on a fresh machine.

### Changed

- README: unofficial-project disclaimer and a contact email; new `SECURITY.md`
  (private vulnerability reporting).
- First-run notes in the README troubleshooting section: the `/mcp` connect
  timeout caused by the cold `npx` download, and why `doctor` in a plain
  terminal can't see plugin config.
- The `vbstudio_api_token` plugin field description now says the git token is
  used as the bearer token (it still said "Basic auth").

## [0.3.1] - 2026-10-12

### Fixed

- VB Studio CI calls: the git personal access token was being sent as a Basic
  password, which the Builds API rejects (401) even though git accepts it. Found
  by testing against a live instance; the git token is now used as a Bearer token,
  and Oracle's `400 … no longer exists` for an unknown job gets a clear hint.

## [0.3.0] - 2026-10-12

Hardening and completeness release: fixes real defects found in a full audit,
finishes the two long-stubbed integrations from Oracle's published docs, and
makes first-time setup self-diagnosing.

### Added

- **`doctor`** (MCP tool, `ovb3 doctor`, `/vbs-doctor`): checks Node, git,
  workspace, credentials, build tools and optional services, and reports the
  exact fix for anything missing without ever printing a secret. `--live` also
  proves the standalone-VBCS login with a read-only call. `/link` now ends with it.
- **`search_artifacts`**: grep artifact *content* across a repo (text or
  regex). `list_artifacts` only matched file names.
- **`audit_service_calls`**: finds every `Actions.callRest` in a repo's action
  chains and, per endpoint, flags parameter keys that some apps send and others
  omit. Comment- and string-aware scanner; verified against a real Oracle
  template app (call counts match an independent grep).
- **`setup_build_tools`**: `npm install` in a checkout so `run_build` /
  `run_audit` work (VB Studio projects pin Oracle's tarballs themselves).
- **VB Studio CI**: `vbstudio_trigger_build`, `vbstudio_build_status`,
  `vbstudio_job_params`, implemented from Oracle's documented Builds REST API.
  The API base URL is derived from the repo's git remote. Bearer PAT or Basic auth.
- **`vbcs_import_bo_data`**: import business-object data (CSV/XLS/XLSX or ZIP)
  into a standalone VBCS instance, per Oracle's documented raw-body upload.
  `mode: append | replace` is mandatory because Oracle's default silently replaces.
- Export can now target the staging/live database (`target: deployment`) and
  export every object as a ZIP when `boName` is omitted.
- Component Exchange credentials for build/audit: `VB_BUILD_CE_USERNAME` /
  `VB_BUILD_CE_PASSWORD` / `VB_BUILD_CE_ACCESS_TOKEN` (Oracle's `:ce` options).
- Failed builds/audits carry a plain-language `hint` for the failure signatures
  confirmed against real runs.
- Plugin config now has fields for git credentials, standalone VBCS and the CI
  token (secrets are `sensitive`, kept in the system keychain); previously a
  plugin install had nowhere to put them.
- `~/.ovb3/.env` as the config location for npm/npx/global installs, and `./.env`
  is read too (precedence: real env vars > `./.env` > install config). Empty or
  unexpanded `${user_config.x}` plugin values now count as unset.
- Tool annotations (read-only / destructive / open-world hints) on all 24 tools.
- CI: Linux/macOS/Windows × Node 20/22, plus a tarball-content check, an MCP
  server smoke test and plugin-manifest validation. A packaging test keeps the
  two command folders, version numbers and `.env.example` from drifting.
- Tests: 12 → 65.

### Fixed

- **Credentials could leak into logs**: remote URLs and command lines were
  logged verbatim. All log fields and tool errors are now redacted.
- **`VBSTUDIO_GIT_USERNAME` / `VBSTUDIO_GIT_TOKEN` were documented but never
  read.** Git now authenticates with them via a scoped HTTP header (not in the
  URL, `.git/config` or logs), and commit identity honours
  `VBSTUDIO_GIT_USER_NAME` / `_EMAIL`.
- **Git could hang forever on an invisible credential prompt.** Prompts are
  disabled, inherited `GIT_ASKPASS`/editor hooks are stripped, and a 2-minute
  timeout applies; failures are fast and say what to do.
- **Business-object export crashed on real responses**: the client
  `JSON.parse`d CSV/ZIP bodies. Responses are now handled as bytes.
- **Command injection surface in build/audit**: arguments went through a shell.
  Tasks now run via `node` with an argument array (no shell), app names and the
  Component Exchange URL are validated, builds time out, and the whole process
  tree is killed (no orphaned grunt/node processes on Windows).
- `run_build` / `run_audit` crashed with an unhelpful error when build tools
  weren't installed; they now say to run `setup_build_tools`.
- Standalone VBCS: token is cached and refreshed once on a 401 (was a login per
  call); requests have timeouts; a base URL ending in `/ic/builder` is tolerated.
- Help commands globbed `.claude/commands/`, which doesn't exist for plugin
  installs; they are now self-contained.
- `.env.example` documented variables nothing read (`IDCS_CLIENT_*`,
  `VBCS_ENVIRONMENT_NAME`, `VB_BUILD_NPM_REGISTRY`) and omitted ones that matter.

### Removed

- `vbstudio_list_projects` and `vbstudio_trigger_deploy` stubs. Oracle's
  published API has no project-listing or deploy endpoint (deploys are CI jobs;
  use `vbstudio_trigger_build`); they only ever threw "not implemented".

## [0.2.0] - 2026-09-08

Repositioned as a distributable Claude Code plugin for any VBS/VBCS
developer, not a personal tool. No breaking changes to the underlying MCP
tools themselves.

### Added

- Packaged as a Claude Code **plugin** (`.claude-plugin/plugin.json` +
  `.claude-plugin/marketplace.json`): `/plugin marketplace add
  vanamthrishul/ovb3-bridge` + `/plugin install ovb3@ovb3` is now the whole
  install, no clone/build step required.
- Plugin `userConfig` (VBS workspace directory, default repo/app, Component
  Exchange URL) replaces manual `.env` editing for plugin installs. Values are prompted
  at install time, stored by Claude Code, and substituted into the MCP server's
  environment automatically.
- MCP server published to npm as `ovb3-bridge`, launchable via `npx -y
  ovb3-bridge`. It is used by the plugin's bundled `.mcp.json` and is usable directly
  by anyone who'd rather add it to their own `.mcp.json` without the plugin
  system.
- `commands/` at the plugin root (copied from `.claude/commands/`) so all
  `/vbs-*`/`/vbcs-*` commands ship with the plugin, namespaced as
  `/ovb3:vbs-*` etc.
- `docs/VBS-GUIDE.md`: the confirmed VB Studio repo layout, chain-file JS
  service-call conventions, and grunt-vb-build/grunt-vb-audit requirements,
  as public, project-agnostic reference material (previously only captured
  in this maintainer's private local notes).
- `/link` rewritten to work against plugin config instead of editing a local
  `.env` file, since a plugin install has no such file in the target project.

### Changed

- README repositioned: git-based VBS is the primary, advertised path;
  standalone-VBCS REST tools are still shipped and documented, but as a
  secondary surface, not the lead pitch.
- `package.json`: no longer `private`, added `files` allowlist, `repository`/`homepage`/`bugs`/`keywords` for npm registry listing.

## [0.1.0] - 2026-08-12

Initial public release.

### Added

- MCP server (`dist/server.js`, wired via `.mcp.json`) and CLI (`ovb3`) exposing the same tools through both interfaces.
- Artifact read/write for VB Studio git-based project checkouts: pages, flows, chains, service (`openapi3.json`) definitions, across a whole VBS instance (`VBS_WORKSPACE_DIR` holds multiple project repos, each repo can hold multiple VBCS web apps under `webApps/`).
- Git helpers: status, commit, pull, push, clone against a VB Studio-backed git remote.
- Build/audit wrapper shelling out to Oracle's `grunt-vb-build` / `grunt-vb-audit` tasks.
- Standalone VBCS instance support (VBCS apps with no VB Studio project behind them): list applications, lock/unlock, export business-object data, against a real REST API confirmed live.
- `ovb3 init`: interactive CLI setup wizard for linking a VB Studio project or a standalone VBCS instance.
- `/link`: the Claude Code slash-command equivalent of `ovb3 init`.
- `/vbs-*` slash commands (git-based VB Studio tools) and `/vbcs-*` slash commands (standalone VBCS REST tools), each with a self-documenting `-help` command.
- MIT license.

### Known limitations

- VB Studio's own REST API (CI/CD build/deploy, environment management; a separate product/integration from standalone VBCS) is stubbed, not implemented; no live VB Studio instance access has been confirmed for it yet.
- `importBusinessObjectData` (standalone VBCS) is stubbed: Oracle's docs don't publish the request body/content-type for that endpoint.
- `grunt-vb-build` / `grunt-vb-audit` task flags are unconfirmed against a real Gruntfile.
