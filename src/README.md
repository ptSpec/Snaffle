# Source map

Read the root `PROJECT_CONTEXT.md` for product-wide decisions, then read the README for the domain being changed. Do not load unrelated domains merely to understand the repository.

| Domain | Owns | Start with |
| --- | --- | --- |
| `agent/` | Model/tool loop, trace, delegation | `agent/README.md` |
| `context/` | Prompt projection, budgets, reports, compaction | `context/README.md` |
| `tools/` | Five coding tools, Plan, web tools | `tools/README.md` |
| `capabilities/` | Custom and Expanded active tool surfaces | `capabilities/README.md` |
| `providers/` | Provider adapters, definitions, profiles | `providers/README.md` |
| `execution/` | Workspace boundary and command isolation | `execution/README.md` |
| `git/` | Repository inspection, diffs, saves, commits | `git/README.md` |
| `attachments/` | Stored attachment content and model payloads | `attachments/README.md` |
| `mcp/` | Lazy MCP broker and server lifecycle | `mcp/README.md` |
| `extensions/` | Skills and future plugin packages | `extensions/README.md` |
| `benchmarks/` | Comparison protocol and evaluation guidance | `benchmarks/README.md` |
| `desktop/` | Electron, persistence, IPC, renderer | `desktop/README.md` |

Keep domain logic outside `desktop/`. Add a new boundary only after code has a real owner that does not fit an existing one.
