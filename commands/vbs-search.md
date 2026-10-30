---
description: Search artifact file CONTENT across a repo (grep)
argument-hint: [repo] [text] [glob]
allowed-tools: mcp__vbcs__search_artifacts
---
Arguments from the user: $ARGUMENTS

The first word is the repo identifier, the second is the text to find, and an optional third is a glob to limit the search (e.g. webApps/*/flows/**/*.js). Call the search_artifacts MCP tool (mcp__vbcs__search_artifacts). Group matches by file, show line numbers, and note if results were truncated.
