# Repository setup — the SEO and polish checklist

Everything here is set in GitHub's UI. It cannot be done from a zip, but it is what turns a
repository into something people find and trust.

---

## 1 · Description (the line under the repo name)

```
A browser media player that actually plays your files — MKV, HEVC, AV1, HLS, DASH, torrents, multi-audio, ASS & PGS subtitles. No uploads, no accounts, no tracking.
```

First 160 characters are what search results and social cards show. Lead with *what it does*,
not the brand name.

---

## 2 · Topics (max 20 — these are your keywords)

```
video-player  media-player  mkv  hevc  webcodecs  hls  dash  torrents  webtorrent
subtitles  ass-subtitles  pgs  multi-audio  pwa  typescript  vite  browser-player
video-streaming  self-hosted  no-backend
```

Copy-paste each one into **About → ⚙ → Topics**. Topic pages are how people discover
projects they were not searching for.

---

## 3 · Social preview

**Settings → General → Social preview** — upload `assets/hero.svg` rendered to PNG at
**1280 × 640**. This is the image on every link shared to X, Discord, Slack and WhatsApp.

---

## 4 · Community standards

Add these files at the paths below; GitHub then shows a green **Community Standards**
checklist on the repo home, which measurably increases trust and click-through.

| File | Path |
| :-- | :-- |
| Code of conduct | `CODE_OF_CONDUCT.md` |
| Contributing | `CONTRIBUTING.md` |
| Security policy | `SECURITY.md` |
| Issue templates | `.github/ISSUE_TEMPLATE/*.yml` |
| PR template | `.github/pull_request_template.md` |

---

## 5 · README rules that matter for search

- **First paragraph carries the keywords.** GitHub indexes README text; the opening
  sentence is weighted most.
- **Real screenshots.** Pages with images get shared far more than text-only ones.
- **Headings as questions** (`## Why this exists`) match how people search.
- **Alt text on every image** — it is read by search engines and by screen readers.
- **Relative image paths** (`assets/…`) so the README renders on forks too.

---

## 6 · Repository settings worth turning on

| Setting | Where | Why |
| :-- | :-- | :-- |
| Issues + Discussions | Settings → General | Discussions absorb questions that would otherwise be empty issues |
| Private vulnerability reporting | Settings → Security | Required for the security template to work |
| Dependabot alerts | Settings → Security | Free dependency warnings |
| Branch protection on `main` | Settings → Branches | Requires the test suite before merge |
| Releases with notes | Releases → Draft | Each release is a page search engines index |

---

## 7 · After the first release

1. Add the release badge to the README with a real link.
2. Submit to lists that accept open-source tools (awesome-video, awesome-selfhosted).
3. Keep the About description and topics current — they are the cheapest SEO you have.
