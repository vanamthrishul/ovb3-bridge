---
description: List all /vbcs-* commands and what they do
---
Show this table (the commands are namespaced /ovb3:vbcs-* when installed as a plugin) and nothing else except the footnote:

| Command | Arguments | What it does |
|---|---|---|
| /vbcs-list-apps | [filter] | List applications on the standalone VBCS instance |
| /vbcs-lock-app | branchId | Lock a live application (do this before data export/import) |
| /vbcs-unlock-app | branchId | Unlock it again |
| /vbcs-export-data | app version [bo] | Export business-object data (CSV, or ZIP of all) |
| /vbcs-import-data | app version file append\|replace | Import business-object data from a local file |

These talk to the instance in VBCS_BASE_URL with your IDCS login, and are for VBCS apps that have no VB Studio project. For git-backed VB Studio projects see /vbs-help. Run /vbs-doctor if a command can't connect.
