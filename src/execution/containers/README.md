# Container execution

Future home of the optional container backend and its small runtime adapter.

Do not put container checks into individual tools. Implement the existing execution boundary so host and container projects behave alike.

## Intended first path

- Prefer small Docker and Podman CLI adapters over daemon-specific SDKs.
- Copy a captured project baseline into a private `/workspace`, run there, calculate a patch, and apply only reviewed changes back to the host.
- Keep provider and integration credentials in the trusted host process.
- Pull language images on demand instead of inflating the desktop installer.
- Add a structured `snaffle-worker` only when it removes demonstrated cross-runtime parsing or lifecycle duplication.

Container setup is contextual to the selected execution mode. It does not belong in the minimal first-launch onboarding flow, and no missing runtime may silently degrade to unrestricted host execution.
