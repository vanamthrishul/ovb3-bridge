---
description: Read a VBCS artifact file (page/flow/chain/service JSON)
argument-hint: [repo] [path]
allowed-tools: mcp__vbcs__read_artifact
---
Arguments: $ARGUMENTS

The first word is the repo identifier, the rest is the repo-relative artifact path (e.g. webApps/myApp/flows/main/main-flow.json). Call the read_artifact MCP tool (mcp__vbcs__read_artifact) with those, then show the content — pretty-print it if it's JSON.
