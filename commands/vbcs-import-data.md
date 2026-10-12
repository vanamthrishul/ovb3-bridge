---
description: Import business-object data into a standalone VBCS instance from a local file
argument-hint: [appName] [appVersion] [file] [append|replace]
allowed-tools: mcp__vbcs__vbcs_import_bo_data, mcp__vbcs__vbcs_lock_application
---
Arguments: $ARGUMENTS

Words, in order: appName, appVersion, local file path (.csv/.xls/.xlsx for one object — the file name must equal the object id — or .zip for several), and mode. If mode is missing, ask for it; never assume. "replace" OVERWRITES the object's existing data, so before calling it, state that plainly and get an explicit yes from the user. For a live application, remind the user to lock it first (/vbcs-lock-app). Call the vbcs_import_bo_data MCP tool (mcp__vbcs__vbcs_import_bo_data) and report the result.
