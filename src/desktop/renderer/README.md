# Renderer

- `sections/` are the persistent sidebar, conversation, and inspector regions.
- `screens/` replace the conversation with settings or bookmarks.
- `components/` are small controls reused across regions.

Keep feature-specific UI and CSS together. Promote something to `components/` only when more than one region actually uses it.
