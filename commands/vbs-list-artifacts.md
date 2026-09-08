---
description: List VBCS artifact files matching a glob pattern
argument-hint: [repo] [glob pattern]
allowed-tools: mcp__vbcs__list_artifacts
---
Arguments: $ARGUMENTS

The first word is the repo identifier, the rest is a glob pattern (default to "webApps/**/*.json" if none given). Call the list_artifacts MCP tool (mcp__vbcs__list_artifacts) with those, then show the matches as a list.
