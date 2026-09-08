# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

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
  Exchange URL) replaces manual `.env` editing for plugin installs — prompted
  at install time, stored by Claude Code, substituted into the MCP server's
  environment automatically.
- MCP server published to npm as `ovb3-bridge`, launchable via `npx -y
  ovb3-bridge` — used by the plugin's bundled `.mcp.json`, and usable directly
  by anyone who'd rather add it to their own `.mcp.json` without the plugin
  system.
- `commands/` at the plugin root (copied from `.claude/commands/`) so all
  `/vbs-*`/`/vbcs-*` commands ship with the plugin, namespaced as
  `/ovb3:vbs-*` etc.
- `docs/VBS-GUIDE.md` — the confirmed VB Studio repo layout, chain-file JS
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
- Artifact read/write for VB Studio git-based project checkouts — pages, flows, chains, service (`openapi3.json`) definitions — across a whole VBS instance (`VBS_WORKSPACE_DIR` holds multiple project repos, each repo can hold multiple VBCS web apps under `webApps/`).
- Git helpers: status, commit, pull, push, clone against a VB Studio-backed git remote.
- Build/audit wrapper shelling out to Oracle's `grunt-vb-build` / `grunt-vb-audit` tasks.
- Standalone VBCS instance support (VBCS apps with no VB Studio project behind them): list applications, lock/unlock, export business-object data, against a real REST API confirmed live.
- `ovb3 init` — interactive CLI setup wizard for linking a VB Studio project or a standalone VBCS instance.
- `/link` — the Claude Code slash-command equivalent of `ovb3 init`.
- `/vbs-*` slash commands (git-based VB Studio tools) and `/vbcs-*` slash commands (standalone VBCS REST tools), each with a self-documenting `-help` command.
- MIT license.

### Known limitations

- VB Studio's own REST API (CI/CD build/deploy, environment management — a separate product/integration from standalone VBCS) is stubbed, not implemented — no live VB Studio instance access has been confirmed for it yet.
- `importBusinessObjectData` (standalone VBCS) is stubbed — Oracle's docs don't publish the request body/content-type for that endpoint.
- `grunt-vb-build` / `grunt-vb-audit` task flags are unconfirmed against a real Gruntfile.
