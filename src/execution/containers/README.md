# Private workspace reconciliation

Future home of the captured-project and reviewed-patch behavior required before an isolated workspace becomes the default.

Do not put container checks into individual tools. Implement the existing execution boundary so host and container projects behave alike.

## Intended first path

- Copy a captured project baseline into a private `/workspace`, run there, calculate a patch, and apply only reviewed changes back to the host.
- Keep provider and integration credentials in the trusted host process.
- Pull language images on demand instead of inflating the desktop installer.
- Keep reconciliation independent of the runtime SDK so an unsuccessful Microsandbox experiment remains easy to remove.

Runtime setup is contextual to the selected execution mode. It does not belong in the minimal first-launch onboarding flow, and no missing runtime may silently degrade to unrestricted host execution.
