# Skills

Skills are portable instruction packages stored as a directory containing `SKILL.md`, with optional `scripts/`, `references/`, and `assets/` resources. The frontmatter requires `name` and `description`.

Snaffle discovers project skills from `.snaffle/skills`, `.agents/skills`, `.codex/skills`, and `.claude/skills`. It also discovers personal skills from the equivalent home-directory locations and the application data `skills` directory. Project skills win when names collide.

There is one runtime with two entrances:

- The model uses the lazy `use_skill` broker to search metadata and load only the selected `SKILL.md` or referenced text resource.
- A person explicitly selects `/skill-name` from the chat command palette, which inserts an activation request into the composer.

Skills provide context and workflows. They never bypass tool permissions, workspace boundaries, approvals, or the normal agent loop.
