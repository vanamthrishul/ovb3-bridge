# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

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
