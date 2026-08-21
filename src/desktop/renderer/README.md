# Renderer

The renderer owns presentation and local interaction state. It receives typed data and actions through preload; it never reads files, launches processes, or retrieves secrets directly.

## Start here

- `App.tsx` composes the three panels and top-level navigation. Keep new feature behavior in its owning screen or section instead of growing this file by default.
- `sections/sidebar/` owns workspace and thread navigation.
- `sections/conversation/` owns the timeline, composer, attachments, Markdown, Mermaid, context display, and Keep Aside.
- `sections/inspector/` owns trace, usage, subagent, per-turn built-in-tool changes, and Git inspection.
- `sections/terminal/` owns the explicit user terminal surface.
- `screens/settings/`, `screens/search/`, and `screens/bookmarks/` replace the conversation for application-level flows.
- `components/` contains controls genuinely reused across regions.

## Invariants

Keep feature-specific UI and CSS together. Promote something to `components/` only when more than one region actually uses it.

- Use semantic theme variables rather than component-local literal colors.
- Do not add a model protocol event when existing trace or persisted state can derive the UI.
- Keep the conversation usable when either sidebar is collapsed and at smaller window sizes.
- First-launch onboarding is one localized screen that writes the same provider, theme, web, and subagent settings as the normal settings UI.
