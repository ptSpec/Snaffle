# Source map

- `agent/` runs the model/tool loop.
- `context/` builds and compacts model-facing history.
- `execution/` controls workspace access and command isolation.
- `tools/` contains the small built-in tool set.
- `providers/` translates the protocol to model APIs.
- `desktop/` owns Electron, persistence, and the renderer.
- `git/` provides Git data and actions without depending on Electron.
- `mcp/`, `extensions/`, and `benchmarks/` are reserved integration boundaries.

Keep domain logic outside `desktop/`. Add a new boundary only after code has a real owner that does not fit an existing one.
