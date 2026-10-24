---
name: jev-rules
description: Set up or troubleshoot project rule selection for the Codex Jev rules adapter. Use for .codex/jev-rules selection and hook behavior.
---

Put scoped Markdown rules under `.codex/jev-rules/` in the working project.
Use upstream rule frontmatter: `description`, optional `applies`,
`does_not_apply`, and `always: true`, followed by the actual rule body.

Trusted prompt and patch hooks select rules with the upstream Jev selection and
rendering library. This adapter handles Codex patch file paths, delivers a rule
once per session unless its body changes, and preserves the upstream 9000-character
rendering budget. Without Jev, unjudged rules are injected within that budget.
Use TYPESAFE_API_KEY or the existing ~/.config/typesafe/.env key.

This does not install Claude's pane UI, AskUserQuestion handler or codebase-map
injection. It does not copy rules out of `.claude/` or replace AGENTS.md.
Hooks resolve rules relative to the event cwd; run from the intended project root.
Treat rules as project instructions, subject to the user's task and higher-level policy.
