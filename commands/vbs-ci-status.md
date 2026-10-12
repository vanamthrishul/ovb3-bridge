---
description: Check the status of a VB Studio CI build
argument-hint: [repo] [jobName] [buildNumber]
allowed-tools: mcp__vbcs__vbstudio_build_status
---
Arguments: $ARGUMENTS

The first word is the repo identifier, the last word is the build number, and everything between is the job name. Call the vbstudio_build_status MCP tool (mcp__vbcs__vbstudio_build_status) and report the status verbatim.
