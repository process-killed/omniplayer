# OmniPlayer Extensions

Extensions are **plain GitHub repositories** containing a `manifest.json` and some
JavaScript. They run on the user's device inside a sandboxed frame. There is no
extension server, no marketplace backend and no server-side execution.

## Install

1. Open **Extensions** in the sidebar.
2. Press **Add extension**.
3. Paste one of:
   - `https://github.com/<owner>/<repo>`
   - `https://github.com/<owner>/<repo>/tree/<branch>`
   - `https://github.com/<owner>/<repo>/tree/<branch>/<subfolder>`
   - `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/manifest.json`
4. Review the manifest, the commit and the requested permissions.
5. Press **Install**, then **Enable**.

## What the runtime guarantees

| Guarantee | How |
| --- | --- |
| No DOM access | Extension code runs in an iframe with `sandbox="allow-scripts"` only — opaque origin, no `allow-same-origin` |
| No silent updates | Files are pinned to a commit SHA at install time; a new commit is only adopted after you install again |
| No arbitrary network | The sandbox has no `network.fetch` grant; requests go through the host, which denies by default |
| Namespaced storage | Every extension's key/value data is prefixed with its id |
| Permission gating | Every bridge request is checked against the permissions you approved |

## Status of this build

Implemented and tested: GitHub URL parsing, commit pinning, manifest validation,
permission review, IndexedDB storage of files, sandboxed activation, navigation
contributions, namespaced storage, logging and player state reads.

Not implemented yet — do not assume otherwise: the FFmpeg.wasm processing pipeline,
subtitle/media processors, theme and panel registration, worker spawning, network
grants, and the declarative UI component renderer. The manifest accepts those
capabilities, and the runtime refuses them with a clear log line rather than
pretending they work.
