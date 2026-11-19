<!--
  Thanks for the PR. Keep it to one logical change — that is the single biggest
  factor in how fast it gets merged.
-->

## What this changes

<!-- One paragraph. The bug or the capability, in plain language. -->

## Why

<!-- What was wrong, or what was missing. Link the issue: Fixes #123 -->

## How

<!-- The approach, and anything a reviewer would question. -->

## Tested

- [ ] `npm run typecheck`
- [ ] `npm test` — 176 tests
- [ ] `npm run build`
- [ ] Playback suite (`npm run smoke`) — required if the player changed
- [ ] Layout audit (`npm run audit`) — required if anything visual changed

**Browsers/devices checked:** <!-- e.g. Chrome 131 desktop, Safari iOS 18 -->

## Screenshots

<!-- Before / after for anything visual. Delete if not applicable. -->

## Honest limits

<!--
  Anything this does NOT fix, any browser where it degrades, any case it refuses.
  Writing a limit down is expected here, not a weakness.
-->

## Checklist

- [ ] One logical change
- [ ] No new dependency the browser could have avoided
- [ ] Listeners, timers and object URLs cleaned up
- [ ] Comments explain *why*, not *what*
- [ ] I have read CONTRIBUTING.md
