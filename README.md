# ConvoyRun

Desktop app (Windows/Linux) for generating ATS/ETS2 convoy event flyers — map composition, multi-timezone scheduling, Discord/TMP text export, and PNG metadata round-trip. Port of `convoyrama.github.io/event.html` to a native Tauri app, not a 1:1 copy.

## Quickstart

```bash
npm install
npm run tauri dev      # dev build with hot reload
npm run tauri build    # release build (deb + nsis, no AppImage)
```

Requires Rust (stable) and Node.js. On Linux, install the WebKitGTK/GTK dev packages Tauri needs (see `.github/workflows/release.yml` for the exact `apt` list used in CI).

## Environment

No env vars or secrets required. The time-verification indicator (header, top-right) makes outbound HTTPS requests to `convoyrama.github.io` and `github.com` via the Tauri `http` plugin — see `capabilities/default.json` for the exact scope.

## Docs

Architecture, feature list, and CI/CD standard live in `../docs/` (one level up from this repo root) — see `docs/README.md` for the index.
