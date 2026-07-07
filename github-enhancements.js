/*
  github-enhancements.js
  ------------------------------------------------------------
  GITHUB PAGES ONLY. Do not paste this into the Blogger gadget — service
  workers require full control over paths/scope that Blogger doesn't give you,
  and a botched registration can leave a stale worker stuck in a visitor's
  browser with no easy way for you to remove it.

  What it does (each piece is independent — comment out what you don't want):
    1. Registers service-worker.js for offline app-shell caching.
    2. Shows a small "Install app" banner using the PWA beforeinstallprompt event.
    3. Polls a version.json file every few minutes and shows an "update
       available" banner when the deployed version changes.
    4. Upgrades settings storage from localStorage to IndexedDB (falls back
       to localStorage automatically if IndexedDB is unavailable).

  Depends on: nothing external (vanilla JS). Optionally pairs with
  github-enhancements.css for the banner styles.

  Include (at the end of <body>, after the widget's own script):
    <link rel="stylesheet" href="github-enhancements.css">
    <script src="github-enhancements.js" defer></script>
------------------------------------------------------------ */

(function () {
  "use strict";

  /* ---------------------------------------------------------------------
   * 1. Service worker registration (offline app-shell caching)
   * ------------------------------------------------------------------- */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      // Relative path (not "/service-worker.js") so this also works when the
      // site is deployed under a GitHub Pages project subpath, e.g.
      // https://USER.github.io/REPO/ instead of the domain root.
      navigator.serviceWorker.register("service-worker.js").then(function (reg) {
        // Watch for a new worker taking over and surface it as an update banner.
        reg.addEventListener("updatefound", function () {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", function () {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateBanner(function () { installing.postMessage("SKIP_WAITING"); location.reload(); });
            }
          });
        });
      }).catch(function (err) {
        console.warn("[github-enhancements] Service worker registration failed:", err);
      });
    });
  }

  /* ---------------------------------------------------------------------
   * 2. Install prompt (PWA "Add to Home Screen")
   * ------------------------------------------------------------------- */
  let deferredInstallPrompt = null;

  function setupInstallBanner() {
    const banner = ensureBanner("bs4k-install-banner", function (root) {
      root.innerHTML = "";
      const text = document.createElement("span");
      text.textContent = "Install this app for quicker access and offline scores.";
      const installBtn = document.createElement("button");
      installBtn.type = "button";
      installBtn.textContent = "Install";
      const dismissBtn = document.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.className = "dismiss";
      dismissBtn.textContent = "✕";
      dismissBtn.setAttribute("aria-label", "Dismiss install prompt");
      root.appendChild(text);
      root.appendChild(installBtn);
      root.appendChild(dismissBtn);

      installBtn.addEventListener("click", function () {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.finally(function () {
          deferredInstallPrompt = null;
          root.classList.remove("visible");
        });
      });
      dismissBtn.addEventListener("click", function () { root.classList.remove("visible"); });
    });

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      banner.classList.add("visible");
    });

    window.addEventListener("appinstalled", function () {
      banner.classList.remove("visible");
      deferredInstallPrompt = null;
    });
  }

  /* ---------------------------------------------------------------------
   * 3. Background update checker (polls version.json)
   * ------------------------------------------------------------------- */
  function setupUpdateChecker() {
    const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
    let knownVersion = null;

    async function check() {
      try {
        const res = await fetch("version.json", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (knownVersion === null) { knownVersion = data.version; return; }
        if (data.version !== knownVersion) {
          showUpdateBanner(function () { location.reload(); });
        }
      } catch (e) { /* offline or file missing — silently skip this cycle */ }
    }

    check();
    setInterval(check, CHECK_INTERVAL_MS);
  }

  function showUpdateBanner(onReload) {
    const banner = ensureBanner("bs4k-update-banner", function (root) {
      root.innerHTML = "";
      const text = document.createElement("span");
      text.textContent = "A new version of this site is available.";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Refresh";
      btn.addEventListener("click", onReload);
      root.appendChild(text);
      root.appendChild(btn);
    });
    banner.classList.add("visible");
  }

  function ensureBanner(className, build) {
    let node = document.querySelector("." + className);
    if (!node) {
      node = document.createElement("div");
      node.className = className;
      document.body.appendChild(node);
      build(node);
    }
    return node;
  }

  /* ---------------------------------------------------------------------
   * 4. IndexedDB-backed settings store (progressive upgrade over localStorage)
   *    Exposed as window.bs4kSettingsStore so the main widget script can
   *    optionally use it instead of (or alongside) localStorage.
   * ------------------------------------------------------------------- */
  const IDB_NAME = "bs4k-store";
  const IDB_STORE = "settings";

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!("indexedDB" in window)) { reject(new Error("IndexedDB unavailable")); return; }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  const settingsStore = {
    async get(key, fallback) {
      try {
        const db = await openDb();
        return await new Promise(function (resolve) {
          const tx = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
          tx.onsuccess = function () { resolve(tx.result !== undefined ? tx.result : fallback); };
          tx.onerror = function () { resolve(fallback); };
        });
      } catch (e) {
        try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
        catch (e2) { return fallback; }
      }
    },
    async set(key, value) {
      try {
        const db = await openDb();
        await new Promise(function (resolve, reject) {
          const tx = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(value, key);
          tx.onsuccess = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      } catch (e) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e2) { /* storage disabled */ }
      }
    }
  };
  window.bs4kSettingsStore = settingsStore;

  /* ---------------------------------------------------------------------
   * Boot
   * ------------------------------------------------------------------- */
  registerServiceWorker();
  setupInstallBanner();
  setupUpdateChecker();
})();
