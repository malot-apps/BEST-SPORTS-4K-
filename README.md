# Best Sport's 4K — GitHub Pages site

A single-page PWA: live football scores/standings (FIFA World Cup 2026 +
Premier League, via public ESPN endpoints) plus a 24-hour sports channel
player built on hls.js.

## Layout

Everything is deployed straight from the repo root — there is no build step.

```
.
├── index.html                        (dashboard + tabs + standings + player, all in one page)
├── github-enhancements.css           (install/update banner styles)
├── github-enhancements.js            (service worker registration, install prompt, update checker)
├── service-worker.js                 (offline app-shell caching)
├── manifest.webmanifest              (PWA manifest)
├── version.json                      (bump on every deploy — powers the update banner)
├── source.txt                        (points at the active channel playlist: ./list.json)
├── list.json                         (the 24hr sports channel list, name + HLS url pairs)
├── 404.html
├── robots.txt / sitemap.xml
├── icon-source.svg                   (master icon; assets/icons/*.png are generated from it)
├── assets/icons/                     (generated app icons: 192/512/512-maskable/apple-touch/favicons)
├── Reusable HLS Video Player/
│   ├── player.js                     (the actual player used by index.html)
│   ├── style.css                     (styles for the standalone demo page below only)
│   └── index.html                    (standalone reference/demo page — not linked from the live site)
└── .github/workflows/static.yml      (GitHub Actions: publish repo root to GitHub Pages)
```

All paths in `index.html`, `manifest.webmanifest`, and `service-worker.js`
are relative, so the site works whether it's deployed at a domain root
(`username.github.io`) or a project subpath (`username.github.io/repo-name/`).

## Deploying

1. Push to `main`.
2. In the repo: **Settings → Pages → Source → GitHub Actions**. The included
   workflow (`.github/workflows/static.yml`) publishes the repo as-is.
3. Bump the `"version"` string in `version.json` on every deploy so
   returning visitors get the "update available" banner.

## The live channel player

- `source.txt` contains either an absolute `https://...` URL or a path
  relative to the site root (currently `./list.json`) pointing at either a
  JSON array of `{ "name": ..., "url": ... }` objects or an `.m3u`/`.m3u8`
  playlist.
- `Reusable HLS Video Player/player.js` fetches that, renders the channel
  grid, and drives an `hls.js`-backed `<video>` with reconnect/retry,
  fullscreen, Picture-in-Picture, and quality/buffering indicators.
- Match cards' "Watch Live" buttons call `window.openStreamPlayer(title)`.
  A default implementation (opens the channel player section) ships in
  `player.js`; you can override it by defining your own
  `window.openStreamPlayer` in a script tag added after `player.js`.

## Notes on the reference player demo

`Reusable HLS Video Player/index.html` + its own `style.css` are a
standalone, self-contained reference implementation — not linked from the
live site — kept for anyone who wants to see the player in isolation. It is
independent of the scoped player styles embedded in the main `index.html`
`<style>` block, so edits to one do not affect the other.
