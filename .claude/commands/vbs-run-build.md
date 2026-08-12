---
description: Run grunt-vb-build for a VBCS app
argument-hint: [repo] [appName]
allowed-tools: mcp__vbcs__run_build
---
Arguments: $ARGUMENTS

The first word is the repo identifier, the second (if given) is the app name (omit to use the VBCS_APP_NAME default). Call the run_build MCP tool (mcp__vbcs__run_build) with those. Report the exit code, and if it failed, summarize the relevant error lines from stderr rather than dumping the whole log.
