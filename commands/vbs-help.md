---
description: List all /vbs-* commands and what they do
allowed-tools: Glob, Read
---
Find every file matching .claude/commands/vbs-*.md, read each one's YAML frontmatter (description and argument-hint), and present them as a table: command name (e.g. /vbs-list-repos), arguments, and what it does. Order roughly by workflow: discovery first (list-repos, list-apps), then artifacts (read, write, list-artifacts), then git (status, commit, pull, push), then build/audit. Keep each row to one line. After the table, add a one-line note that `<repo>` means an exact folder name under VBS_WORKSPACE_DIR, or "-" for the VBCS_REPO_PATH default.
