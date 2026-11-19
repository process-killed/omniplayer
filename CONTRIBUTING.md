<div align="center">

# 🛠️ Contributing to OmniPlay

**Bug reports, playback fixes, subtitle work, docs — all welcome.**

![PRs](https://img.shields.io/badge/PRs-welcome-6d5efc?style=flat-square)
![Tests](https://img.shields.io/badge/tests-must%20pass-2ea043?style=flat-square)
![Style](https://img.shields.io/badge/style-TypeScript%20strict-22d3ee?style=flat-square)

</div>

---

## The fastest way to help

| You have | Do this |
| :-- | :-- |
| **A file that will not play** | Open a *Playback issue* and attach the container details from **Diagnostics** |
| **A bug in the UI** | Open a *Bug report* with the viewport size and a screenshot |
| **An idea** | Open a *Feature request* — describe the problem, not the implementation |
| **A fix** | Open a PR against `main`; keep it focused on one thing |
| **Better docs** | PRs to `README.md` and `docs/` are always welcome, no issue needed |

---

## Set up

```bash
git clone https://github.com/process-killed/omniplayer
cd omniplayer
npm ci --ignore-scripts     # required: one dependency's postinstall fails outside pnpm
npm run dev                 # http://localhost:5173
```

<details>
<summary><b>Why <code>--ignore-scripts</code>?</b></summary>

<br/>

`webtorrent` pulls a package whose install script runs `npx only-allow pnpm`. That fails and
aborts `npm install`. Nothing in the build needs it — the browser bundle is vendored at
`public/vendor/webtorrent.min.js`.

</details>

---

## Before you open a PR

```bash
npm run typecheck   # tsc --noEmit
npm test            # 176 unit tests
npm run build       # production build must succeed
```

If you touched playback, the player, or anything layout-related, also run:

```bash
npm run smoke       # real playback in a headless browser
npm run audit       # 14 viewports × every route
```

> **Kill stale servers first.** A killed test run can leave a server holding its port, and a
> later run then tests an old build. `pkill -f scripts/audit.mjs` before running the suites.

---

## What we look for

<table>
<tr>
<td width="50%" valign="top">

**Code**

- TypeScript strict — no `any` without a comment explaining why
- No new runtime dependency unless the browser cannot do it
- Clean up listeners, timers and object URLs you create
- Comment the *why*, never the *what*

</td>
<td width="50%" valign="top">

**Behaviour**

- One logical change per PR
- Describe the bug and the fix, not just the diff
- Say what you tested, and on which browser/device
- If a fix has a limit, write it down — we document limits

</td>
</tr>
</table>

---

## Commit messages

```
fix(player): keep volume instant when the audio graph is suspended
feat(embed): add playlist parameter for episode chains
docs(readme): explain the --ignore-scripts requirement
```

`type(scope): summary` — imperative, lower-case, under 72 characters.

---

## Adding a feature: the bar

1. **It must not slow down playback when unused.** Lazy-load heavy code.
2. **It must degrade, not break.** No engine is guaranteed on every browser.
3. **It must be honest in the UI.** If something cannot work, say so — never fake success.
4. **It must survive a phone.** Check 360 × 640 and the low-memory profile.

---

## Reporting playback problems well

The **Diagnostics** page has a *Copy* button. That JSON — engine, container, codecs,
network result, CORS state — turns a vague report into a fixable one. Please include it.

For files that fail only in one browser, say which. Chrome plays WebM-profile MKV natively;
Firefox does not. That difference is usually the whole bug.

---

## Review process

| Step | What happens |
| :-- | :-- |
| 1 | A maintainer acknowledges within a week |
| 2 | CI and the test suites must pass |
| 3 | Review comments focus on behaviour and limits, not taste |
| 4 | Squash-merge into `main` |

If a PR goes quiet, comment on it — pings are welcome, not rude.

---

## License

By contributing you agree your work is licensed under the project's MIT license.

<div align="center"><sub>Thank you for making a player that actually plays things.</sub></div>
