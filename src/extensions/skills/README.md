# Skills

Skills are portable instruction packages stored as a directory containing `SKILL.md`, with optional `scripts/`, `references/`, and `assets/` resources. The frontmatter requires `name` and `description`.

Snaffle discovers project skills from `.snaffle/skills`, `.agents/skills`, `.codex/skills`, and `.claude/skills`. It also discovers personal skills from `~/.snaffle/skills`, the equivalent imported-harness home directories, and the application data `skills` directory. Project skills win when names collide. Bundled first-party skills use a separate read-only application resource so updates do not modify user-owned skills.

There is one runtime with two entrances:

- The model uses the lazy `use_skill` broker to search metadata and load only the selected `SKILL.md` or referenced text resource.
- A person explicitly selects `/skill-name` from the chat command palette, which inserts an activation request into the composer.

Skills provide context and workflows. They never bypass tool permissions, workspace boundaries, approvals, or the normal agent loop.

Skills imported from `.codex` or `.claude` are marked as having unknown compatibility unless they opt in. A skill may declare comma- or space-separated required tools; Snaffle disables it when a declared tool is unsupported. The standard free-form `compatibility` field is shown as a warning rather than guessed at.

```yaml
metadata:
  snaffle.dev/compatible: "true"
  snaffle.dev/required-tools: imagegen, browser
```
