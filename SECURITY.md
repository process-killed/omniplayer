<div align="center">

# 🔐 Security Policy

**OmniPlay runs untrusted media in your browser. Security reports are taken seriously.**

![Supported](https://img.shields.io/badge/supported-1.24.x-2ea043?style=flat-square)
![Response](https://img.shields.io/badge/response-5%20working%20days-22d3ee?style=flat-square)

</div>

---

## Supported versions

| Version | Supported |
| :-- | :-- |
| `1.24.x` | ✅ |
| `1.20 – 1.23` | ⚠️ critical fixes only |
| `< 1.20` | ❌ |

---

## Report a vulnerability

**Do not open a public issue.** Use either channel:

- GitHub → **Security** tab → *Report a vulnerability* (private advisory)
- Email **dbobmusicq@gmail.com** with `[SECURITY]` in the subject

Please include: affected version, browser and OS, reproduction steps, and what an attacker
gains. Proof-of-concept files are welcome; do not attach private media.

**What happens next:** acknowledgement within **5 working days**, an assessment with a
severity and a fix plan within **10**, and credit in the release notes unless you prefer
anonymity.

---

## What counts as a vulnerability here

OmniPlay has no backend and no accounts, so the interesting surface is the browser itself.

| In scope | Out of scope |
| :-- | :-- |
| XSS through media metadata, subtitles or file names | A media file that simply crashes the tab (send it as a bug) |
| Subtitle files (SRT/VTT/ASS) executing script | Denial of service by opening a 100 GB file you chose |
| Prototype pollution via parsed manifests or headers | Missing security headers on a third-party host you configured |
| Data exfiltration to a host the user did not configure | CORS failures — those are the host's policy, not a flaw |
| Bypassing the CORS-proxy or download restrictions | Self-XSS in DevTools |
| Stored data leaking between browser profiles | Anything requiring an already-compromised device |

---

## How the player is built to be safe

<details open>
<summary><b>No server, no upload</b></summary>

<br/>

Media is read locally or fetched directly from the URL you paste. Nothing is sent to a
server operated by this project — there isn't one.

</details>

<details>
<summary><b>Untrusted text is never executed</b></summary>

<br/>

Subtitle and danmaku text is inserted as text nodes, never as HTML. ASS styling is rendered
by our own renderer, which reads a whitelist of fields — it does not run embedded script.

</details>

<details>
<summary><b>Network access is opt-in and visible</b></summary>

<br/>

A CORS proxy and a torrent gateway are only used if you configure them. The proxy URL is
stored locally and shown in Settings → Network, so you can always see what is in play.

</details>

<details>
<summary><b>Downloads never go through a proxy</b></summary>

<br/>

Files are fetched from the origin directly, so a proxy operator never sees your downloads.

</details>

---

## Privacy

No analytics, no telemetry, no third-party fonts at runtime, no cookies. Library, history
and settings live in your browser's IndexedDB and localStorage, and are removed when you
clear site data.

---

<div align="center"><sub>Thank you for helping keep people's media theirs.</sub></div>
