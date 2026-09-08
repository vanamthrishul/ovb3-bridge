---
description: Write a VBCS artifact file (page/flow/chain/service JSON)
argument-hint: [repo] [path] [optional: local file to read new content from]
allowed-tools: mcp__vbcs__write_artifact, mcp__vbcs__read_artifact, Read
---
Arguments: $ARGUMENTS

The first word is the repo identifier, the second is the repo-relative artifact path to write. If a third argument is given, read that local file's content with the Read tool and use it verbatim. Otherwise, use whatever new content for that artifact was already worked out earlier in this conversation — if none was, ask me what to write instead of guessing.

Before writing: briefly state what's about to change. Then call the write_artifact MCP tool (mcp__vbcs__write_artifact) with repo, path, and content, and report bytes written.
