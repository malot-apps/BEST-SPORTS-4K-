# Best Sport's 4K — project structure

Two parallel, non-mixed versions of the site live side by side:

```
project/
├── blogger/                         ← what you paste into Blogger today
│   ├── sports-hub-widget.html       (the actual gadget: dashboard, tabs, standings...)
│   ├── hls-player-example.html      (reference-only standalone player, not linked in)
│   └── README.md
│
└── github-pages/                    ← optional, richer static site for later
    ├── index.html                   (same widget + SEO/PWA head + enhancement includes)
    ├── manifest.webmanifest
    ├── service-worker.js
    ├── version.json
    ├── 404.html
    ├── robots.txt
    ├── sitemap.xml
    ├── assets/
    │   ├── css/github-enhancements.css
    │   ├── js/github-enhancements.js
    │   └── icons/icon-source.svg
    └── .github/workflows/deploy.yml
```

Your existing stream/playlist/proxy module is **not included here** and is
not modified — this project only ever calls a `window.openStreamPlayer()`
hook, defined by your own separate script, in both versions.

## Which version do I use?

- **Right now, on Blogger:** use `blogger/sports-hub-widget.html`. Nothing
  else in this repo is needed for Blogger to work.
- **Later, on GitHub Pages:** use everything in `github-pages/`. It's the
  same core widget, plus optional static-site features Blogger can't host
  (service worker, installable app, custom 404, sitemap, CI deploy).

The two are kept deliberately separate — see "Why they're not merged" below.

## Installing on Blogger

See `blogger/README.md`. Short version: paste `sports-hub-widget.html` into
an HTML/JavaScript gadget. Done.

## Installing on GitHub Pages

1. Create a repo, e.g. `bestsports4k`.
2. Copy everything from `github-pages/` into the repo root (or push the
   `github-pages/` folder as-is and set the workflow's `path:` accordingly —
   the included workflow already points at `github-pages/`).
3. Replace every `YOUR-USERNAME` / `YOUR-REPO` placeholder in:
   - `index.html` (Open Graph/Twitter URLs)
   - `robots.txt`
   - `sitemap.xml`
4. Generate real PNG icons from `assets/icons/icon-source.svg` (192×192,
   512×512, and a maskable 512×512 — any SVG-to-PNG tool or
   `npx pwa-asset-generator` works) and drop them in `assets/icons/`.
5. In the repo: **Settings → Pages → Source → GitHub Actions**.
6. Push to `main`. The included workflow (`.github/workflows/deploy.yml`)
   builds nothing (there's no build step — it's static) and publishes the
   folder directly.
7. Bump the `"version"` string in `version.json` on every future deploy so
   returning visitors get the "update available" banner.

## Why the two versions aren't merged

Service workers, web app manifests, and `beforeinstallprompt` all require:
- a fixed, predictable path structure Blogger doesn't give you,
- HTTP response headers Blogger doesn't let you control,
- a scope rooted at your actual domain, which a Blogger gadget embedded in a
  templated page doesn't have.

Loading `github-enhancements.js` inside Blogger would likely just fail
quietly (best case) or register a broken service worker a visitor can't
easily clear (worst case). Keeping them in separate folders means you can
develop the GitHub Pages version at your own pace without any risk to the
Blogger site that's live today.

## Migration guide: Blogger → GitHub Pages

1. Get comfortable with the GitHub Pages version running *alongside* Blogger
   first (e.g. at `username.github.io/reponame`) — don't cut over on day one.
2. Confirm the live scores, standings, and countdown all populate correctly
   from the same ESPN endpoints (identical JS logic in both versions, so this
   should just work).
3. Re-point your stream module: whatever currently calls
   `window.openStreamPlayer` on Blogger needs to be included in the GitHub
   Pages `index.html` too (add its `<script>` tag — we haven't touched or
   duplicated that logic).
4. Point your domain's DNS (if you use a custom domain) at GitHub Pages via
   a `CNAME` file in the repo root, once you're ready to switch traffic.
5. Leave the Blogger blog live as a fallback/redirect for a while, or set up
   a simple redirect post pointing to the new domain.
6. Only after traffic has moved, retire the Blogger gadget.

## Future enhancements you can add later without touching Blogger

All of these are additive to `github-pages/` only:

- Real code-splitting/dynamic `import()` if the widget grows (currently one
  file is simple enough not to need it).
- Swap the inline `<script>` blocks in `index.html` for external `.js` files
  under `assets/js/` once you're comfortable editing outside a single file.
- Add a `CHANGELOG.md` and wire `version.json`'s bump into the deploy workflow
  automatically (e.g. a step that writes the short git SHA into it).
- Localize the widget's Bangla/English strings into a small `i18n.json`
  instead of inline ternaries, if more languages get added.
- Add Lighthouse CI to the GitHub Actions workflow to catch performance/
  accessibility regressions on every push.
- Expand `sitemap.xml` if you add more static pages (e.g. an About page).

None of these require a backend or change anything about how the Blogger
version works.
