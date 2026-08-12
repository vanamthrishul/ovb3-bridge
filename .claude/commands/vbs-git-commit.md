---
description: Stage and commit changes in a VBS repo checkout
argument-hint: [repo] [commit message]
allowed-tools: mcp__vbcs__git_commit
---
Arguments: $ARGUMENTS

The first word is the repo identifier, everything after it is the commit message. Call the git_commit MCP tool (mcp__vbcs__git_commit) with those, then report the resulting commit hash and change summary (files changed, insertions, deletions).
