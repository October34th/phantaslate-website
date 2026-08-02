<div align="center">

<img src="assets/img/mark-96.png" alt="Phantaslate" width="72" height="72">

# phantaslate.com

**Translate Without a Trail**

The marketing site for [Phantaslate](https://github.com/October34th/phantaslate) —
a stateless translator that passes your words through and keeps nothing.

[![Site](https://img.shields.io/badge/site-phantaslate.com-03B4A5?style=flat-square)](https://phantaslate.com)
[![Extension](https://img.shields.io/badge/extension-October34th%2Fphantaslate-0D2045?style=flat-square)](https://github.com/October34th/phantaslate)
[![Build](https://img.shields.io/badge/build-none%20required-6B7A93?style=flat-square)](#running-it-locally)
[![Third-party requests](https://img.shields.io/badge/third--party%20requests-0-03B4A5?style=flat-square)](#zero-third-party-requests)

</div>

---

## What this is

Static HTML and CSS with one small script. No framework, no bundler, no
package manager, no build step. Clone it, open it, edit it.

That's a deliberate choice rather than minimalism for its own sake: a site
whose entire argument is *nothing is happening behind your back* shouldn't
need a toolchain to explain what it does. Every file that reaches a
visitor's browser is a file you can read in this repository.

```
phantaslate-website/
├── index.html              homepage
├── privacy.html            privacy policy
├── 404.html                not-found page
├── _headers                Cloudflare Pages headers — ignored locally
├── robots.txt
├── sitemap.xml
├── site.webmanifest
├── assets/
│   ├── css/
│   │   ├── fonts.css       @font-face rules, CJKV + Vietnamese handling
│   │   └── styles.css      everything else, token-driven
│   ├── js/demo.js          the try-it panel
│   ├── fonts/              6 self-hosted woff2 files
│   ├── img/                logo, screenshots (WebP + PNG fallback)
│   └── favicon/            16 / 32 / 48 / 128 px
└── tools/
    └── subset-fonts.py     optional font-size optimisation
```

---

## Zero third-party requests

No font CDN, no analytics, no tracking pixels, no embedded media. Every byte
comes from `phantaslate.com`.

This isn't purism. `fonts.googleapis.com` is unreachable from mainland
China, and Phantaslate is built CJKV-first — a render-blocking dependency
that hangs until timeout for a large share of the intended audience isn't an
acceptable default. Serving everything from one origin means assets load
with the page or fail with it, never separately.

The `_headers` file enforces this with a Content-Security-Policy set to
`'self'` across the board. If someone later adds an external dependency, it
breaks loudly instead of quietly.

**One consequence worth knowing:** `unsafe-inline` is absent from both
`script-src` and `style-src`. An inline `<script>` block or a `style=""`
attribute will work perfectly on your machine and be blocked in production.
Keep JavaScript in `assets/js/` and styling in `assets/css/`.

---

## Running it locally

Double-clicking `index.html` mostly works, but `file://` blocks font loading
in some browsers — you'll see fallback typefaces and think something broke.
Serve it over HTTP instead:

```powershell
cd C:\PersonalDocumentsLocal\ClaudeLocalFileFolder\phantaslate-website
python -m http.server 8000
```

Then open <http://localhost:8000>.

VS Code's Live Server extension does the same thing from a right-click.

---

## Deploying

Cloudflare Pages, connected to this repository:

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**
2. Select this repo
3. Build command: **leave empty**. Output directory: **`/`**
4. **Custom domains** → add `phantaslate.com` and `www.phantaslate.com`

DNS for the domain is already on Cloudflare, so the records are created
automatically. **Leave the `api` subdomain alone** — it stays DNS-only and
points at the relay on Render.

Every push to `main` redeploys.

---

## No translation happens on this site

Worth stating plainly, because the hero panel looks like a translator: **it
isn't one.** It is a static preview of the extension's interface — fixed
sample text, fixed result, no input field, no button that does anything.

The site ships **no JavaScript at all**. There is no `<script>` tag on any
page, no `fetch`, no relay URL, nothing that could contact
`api.phantaslate.com` or anywhere else. The `_headers` CSP sets
`connect-src 'none'` to enforce it — a future change that adds a network
call has to loosen that line deliberately.

That's the honest position while the relay is scoped for the extension only.
Its origin check, character cap and abuse handling all assume an extension
origin and an install token; a public web page has neither. A panel that
quietly worked here would either fail oddly or cost money unpredictably.

If a working web translator is ever wanted, it needs three things first:

- [ ] `phantaslate.com` added to `PHANTASLATE_ORIGINS`
- [ ] its own character cap, separate from the extension's 20,000/day
- [ ] its own rate limiting, since there's no install token to key on

---

## Where the site sends people

Every call to action points to GitHub, because the Chrome Web Store listing
isn't live yet:

| Location | Target |
| --- | --- |
| Header button | `#extension` section |
| Hero primary | GitHub repository |
| Hero secondary | `#how` section |
| Extension section primary | GitHub repository |
| Extension section secondary | GitHub releases page |
| "Read the code" / "View source" | GitHub repository |

The hero note and a dashed chip in the extension section both say the store
listing is pending, so the absence reads as *not yet* rather than *missing*.

**When the listing goes live**, replace the two GitHub links in the hero and
extension sections with the store URL, drop the two "pending" mentions, and
change the header button back to "Add to Chrome".

## Typography

Two families, six files, all self-hosted.

| Family | Weights | Role |
| --- | --- | --- |
| Plus Jakarta Sans | 700, 800 | Headings, wordmark |
| DM Sans | 400, 500 | Body text, labels, UI |
| Be Vietnam Pro | 400, 500 | Vietnamese glyphs only — see below |

### Vietnamese

DM Sans has no Vietnamese glyphs published by Google, at any weight, in any
subset. There is no file to download that fixes this from DM Sans's side.

`fonts.css` loads Be Vietnam Pro under the **same** `font-family: 'DM Sans'`,
scoped with `unicode-range` to exactly the codepoints DM Sans is missing. The
browser resolves per character — DM Sans for Latin, Be Vietnam Pro for
Vietnamese diacritics. Every rule that already says `font-family: var(--body)`
picks this up unchanged.

This is a CSS technique, not font splicing. Merging glyphs into the DM Sans
file itself was considered and rejected: the two typefaces don't share close
enough stroke weight or x-height for spliced glyphs to look native.

Plus Jakarta Sans needs none of this — it has a real Vietnamese subset, and
the installed files are the `latin+vietnamese` cuts.

### CJKV

Han unification means Chinese and Japanese share codepoints while drawing
some characters differently. A font stack alone can't tell them apart, so:

- CJKV text in the markup carries a `lang` attribute
- `fonts.css` matches on `:lang()` with per-script fallback chains
  (PingFang, Hiragino, Yu Gothic, Malgun Gothic, Noto CJK, WenQuanYi)
- `demo.js` sets `lang` on both panes of the try-it panel as languages change

**If you add copy in a CJKV language anywhere, tag it.** Untagged CJK text
renders in whichever face the browser guesses.

### Optional: smaller font files

The Be Vietnam Pro files ship as `latin+vietnamese` because
google-webfonts-helper merges subsets — each carries a Latin alphabet this
site never draws from it. `unicode-range` means those glyphs are downloaded
but never selected, so it's a weight issue, not a correctness one.

```powershell
pip install fonttools brotli
python tools\subset-fonts.py
```

Cuts both files by roughly 60%. Runs on your machine only — visitors never
execute anything. Originals are kept as `.woff2.original` and are gitignored.

---

## Images

Screenshots ship as WebP with PNG fallback via `<picture>` — roughly 25–32 KB
each against 400 KB for the PNGs. That's invisible on a desk in a city and
decisive on mobile data routed to a distant edge.

The header mark is a 96 px asset, not the 799 px original scaled in-browser.

If you replace a screenshot, regenerate both formats and keep the
`width`/`height` attributes accurate — they reserve layout space and stop the
page jumping as images load.

---

## Content decisions worth not undoing by accident

- **"No account" stays out of the hero.** The brand guide scopes that claim
  to the browser extension specifically. This site speaks for the whole
  brand, including future paid platform apps, so the claim lives only inside
  the extension section.
- **No login control in the header.** There's nothing for an account to do
  yet. A "Log in" button on a page selling account-free translation reads as
  a contradiction.
- **No analytics, and the footer says so.** If traffic numbers become
  necessary, a cookie-free option (Plausible, server-side request counts)
  stays consistent with the claim. A conventional analytics tag would not.
- **The privacy policy names DeepSeek explicitly**, including what happens to
  text once it leaves the relay. A privacy promise that omits that isn't
  worth much.

---

## Known TODOs

- [ ] Replace both `Add to Chrome` links (currently `#`) with the Chrome Web
      Store URL — one in the header, one in the extension section
- [ ] Decide whether `PRIVACY.md` in the extension repo or `privacy.html`
      here is canonical; they will drift otherwise
- [ ] Confirm the "Russian and Arabic... candidates for a later release" line
      in the Languages section reflects an actual plan
- [ ] Localisation. English-only for now. URL structure (`/ja/`, `/vi/`) and
      `hreflang` are easier to get right before there are inbound links to
      preserve

---

## Licence

Two scopes, deliberately split — see [`LICENSE`](LICENSE) for the full text.

| Material | Terms |
| --- | --- |
| HTML, CSS, JS, tooling, config | MIT — take it, fork it, build on it |
| `assets/img/`, `assets/favicon/`, the name, logo, wordmark, tagline | **All rights reserved** |
| `assets/fonts/` | SIL Open Font Licence 1.1 (third-party) |

The brand assets are visible in this repository because a website has to
serve its own images, and because this repo exists so the site's privacy
claims can be checked against its source. **Publication is not permission.**
Fork freely — but replace the branding with your own before publishing
anything derived from it.

Bundled fonts are used under the OFL and credited to their creators:
Plus Jakarta Sans (Tokotype), DM Sans (Colophon Foundry, Jonny Pinhorn,
Indian Type Foundry), Be Vietnam Pro (Be Team).

> GitHub's licence detector will probably label this repository "MIT" in the
> sidebar. That label is a convenience, not a legal statement — the brand
> assets are excluded regardless.

---

<div align="center">

**Stateless by design. Private by architecture.**

</div>
