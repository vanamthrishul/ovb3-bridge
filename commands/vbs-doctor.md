---
description: Diagnose your OVB3 setup and report exactly what's missing
argument-hint: [repo] [live]
allowed-tools: mcp__vbcs__doctor
---
Arguments from the user: $ARGUMENTS

Call the doctor MCP tool (mcp__vbcs__doctor). If a word in the arguments is "live", pass live=true (it makes one real read-only call to the standalone VBCS instance to prove the login works); any other word is the repo identifier. Show the result as a short checklist (✓ ok, ! warn, ✗ fail, - optional/skipped), then for every non-ok item give its fix in one line. Finish with which workflows are ready to use (git, build/audit, standalone VBCS, VB Studio CI). Never ask for or print secrets.
