# Extensions

Extensions group optional user-installed capabilities. `plugins/` owns package loading and `skills/` owns instruction resources.

Both should feed existing capability and context boundaries instead of creating a second agent runtime.

## Start here

- `skills/README.md` describes the implemented portable instruction-package runtime.
- `plugins/README.md` records the deliberately limited future plugin boundary.

## Invariants

- Installation, availability, activation for a model, and activation for a run are separate states.
- Installing an extension never adds its schema or instructions to ordinary model requests.
- Extension actions use normal workspace, permission, approval, trace, and output boundaries.
- Arbitrary extension code does not run in the Electron renderer or main process.
