# Releasing Snaffle

## Branches

The normal path is:

```text
feature branch -> develop -> main -> release tag
```

- Open feature pull requests against `develop`.
- Merge `develop` into `main` when that batch of work is ready to ship.
- Every push to `main` builds Snaffle for macOS, Windows, and Linux. The unsigned builds are available in that GitHub Actions run.
- Push a tag such as `v0.1.0` when those builds should become a GitHub Release.

## GitHub setup

Create the `develop` branch, then protect both `develop` and `main`:

- Require pull requests.
- Require the `Verify / test` check to pass.
- Disable force pushes and branch deletion.

Only merge `develop` into `main`. We are keeping that as a simple team rule for now instead of adding another workflow just to police which branch a pull request came from.

## Building locally

Build the unpacked app when you only need a quick smoke test:

```sh
npm run package:dir
```

Build the normal installer for your current operating system:

```sh
npm run package
```

The packaging command downloads the correct Ketch binary for the current OS and CPU. Ketch is placed outside the ASAR archive so Snaffle can execute it normally.

Packaged builds do not read the repository `.env` file and Chromium DevTools are disabled. Development builds still support both.

## Signing

The current builds are unsigned. That is fine for our own testing, but macOS and Windows may warn other users before opening them. Add macOS notarization and Windows signing before treating these as general public downloads.
