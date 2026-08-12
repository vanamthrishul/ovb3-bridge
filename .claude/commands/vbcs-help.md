---
description: List all /vbcs-* commands and what they do
allowed-tools: Glob, Read
---
Find every file matching .claude/commands/vbcs-*.md, read each one's YAML frontmatter (description and argument-hint), and present them as a table: command name (e.g. /vbcs-list-apps), arguments, and what it does. Keep each row to one line. After the table, add a one-line note that these tools target a standalone VBCS instance (VBCS_BASE_URL in .env, configured via /link) — not a VB Studio git repo, which is what the separate /vbs-* commands (see /vbs-help) are for.
