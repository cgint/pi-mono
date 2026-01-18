# Analysis of Built-in Tool Implementations

This document provides a technical overview of the built-in tools in the `pi-mono` codebase, detailing their reliability, safety, and specialized implementation features.

---

## 1. Core Architecture

The tool system uses a functional factory pattern (e.g., `createReadTool`) that returns an `AgentTool` object.

### Key Architectural Patterns
- **TypeBox Validation**: Every tool's parameters are strictly defined using TypeBox schemas, ensuring data integrity before execution.
- **`Operations` Interface**: Decouples logic from side effects. This allows the same tool (e.g., `read`) to work locally using `fs` or remotely via custom providers (like SSH).
- **Standardized Truncation**: Managed by `truncate.ts` to keep LLM context within safe limits (default 30KB/2000 lines).

---

## 2. File Editing Tool (`edit.ts`)

The `edit` tool provides a "surgical" alternative to full file rewrites.

### Reliability Features
- **Progressive Fuzzy Matching**: Tries an exact match first. If that fails, it applies normalization (line endings, whitespace, Unicode "smart" characters) to find the intended block.
- **Uniqueness Guard**: Rejects the edit if the `oldText` occurs more than once in the file, preventing ambiguous replacements.
- **Format Preservation**: Automatically detects and restores original line endings (CRLF/LF) and UTF-8 BOM.
- **Verification**: Verifies that the replacement actually changed the file content before committing to disk.

---

## 3. Data Extraction Tools

### Read Tool (`read.ts`)
- **Multi-Format Support**: Reads both text files and images (JPG, PNG, GIF, WebP).
- **Image Processing**: Automatically resizes images to a maximum of 2000x2000 for LLM compatibility.
- **Smart Truncation**: Uses "Head Truncation" (keeps the beginning). If the output exceeds limits, it provides a precise "Use offset=X to continue" hint to the agent.

### Grep Tool (`grep.ts`)
- **Engine**: Powered by **ripgrep (rg)** for extreme performance.
- **JSON Streaming**: Parses `rg` output in JSON format to extract matching lines and context accurately.
- **Constraints**: Limits the total number of matches (default 100) and context size to avoid context explosion.

### Find Tool (`find.ts`)
- **Engine**: Powered by **fd** for fast, user-friendly file searching.
- **Intelligent Defaults**: Respects `.gitignore` and hidden file rules by default.
- **Performance**: Relativizes paths to the search root for cleaner agent output.

### Ls Tool (`ls.ts`)
- **Standardization**: Sorts contents alphabetically.
- **Clarity**: Appends `/` to directories and handles dotfiles consistently.

---

## 4. Execution & Integration Tools

### Bash Tool (`bash.ts`)
- **Streaming**: Supports real-time stdout/stderr streaming back to the UI.
- **Safety**: Uses `killProcessTree` on abort to ensure no orphaned processes remain.
- **Log Management**: If output is excessive, it switches to "Tail Truncation" (showing the latest 30KB) and saves the full execution log to a temporary file.

### Attach Tool (`attach.ts`) (Specific to `mom`)
- **Slack Integration**: Allows the agent to share files, images, or documents back to the Slack channel.
- **Security**: Restricted to files within the designated `/workspace/` directory.

---

## 5. The Skills System (`skills.ts`)

Beyond built-in tools, the agent can use "Skills"—external CLI tools discovered dynamically.

### Discovery & Definition
- **`SKILL.md`**: Each skill directory contains a Markdown file with required frontmatter (`name`, `description`).
- **Standardization**: Follows the [Agent Skills specification](https://agentskills.io/).
- **Validation**: Strict naming (lowercase, hyphens) and length limits for description/name.
- **Integration**: Skills are injected into the system prompt as an `<available_skills>` XML block, which the agent reads to understand how to invoke the CLI scripts.

---

## 6. Truncation Strategy (`truncate.ts`)

To manage the LLM's finite context window, the system employs two truncation strategies:

- **Head Truncation**: Used for `read`, `ls`, and `grep`. Preserves the beginning of the content. Essential for files where the header contains critical context.
- **Tail Truncation**: Used for `bash`. Preserves the latest output. Essential for shell commands where the most recent logs indicate the current state or error.

---

## 7. Relevant Files Summary

- `packages/coding-agent/src/core/tools/`: Core tool implementations.
- `packages/coding-agent/src/core/skills.ts`: Skill discovery and formatting.
- `packages/mom/src/tools/attach.ts`: Slack-specific file sharing.
- `packages/coding-agent/src/core/tools/truncate.ts`: Context management utilities.
