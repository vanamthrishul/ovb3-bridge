---
description: Show git status for a VBS repo checkout
argument-hint: [repo]
allowed-tools: mcp__vbcs__git_status
---
Repo argument: $ARGUMENTS

Call the git_status MCP tool (mcp__vbcs__git_status) with that repo (omit if none given, to use the VBCS_REPO_PATH default). Summarize clearly: current branch, ahead/behind counts, and any modified/staged/untracked files.
