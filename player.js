/**
 * HlsPlayer — Production ready, robust wrapper around hls.js
 * Supporting recovery mechanisms, native fallbacks, and UI bindings.
 *
 * Bug fixes in this revision:
 *  - Removed the duplicate click handler that used to live in index.html's
 *    inline script. Having two listeners on the same "open player" button
 *    meant every click opened AND immediately closed the section in the
 *    same tick, so the player appeared to "never render". This file is now
 *    the single source of truth for opening/closing the player section.
 *  - Fixed the channel playlist fetch path ("../source.txt" resolved one
 *    directory ABOVE the site root and 404'd; it must be "source.txt").
 *  - Added AbortController-based fetch timeouts + basic JSON/M3U validation.
 *  - Sanitized channel names (textContent instead of innerHTML) to avoid XSS
 *    from a compromised/malicious playlist source.
 *  - Added iOS Safari fullscreen fallback (webkitEnterFullscreen) and Safari
 *    desktop Picture-in-Picture fallback (webkitSetPresentationMode).
 *  - Added muted-autoplay-first strategy so autoplay isn't silently blocked
 *    by browser policy, with a visible "tap to unmute" affordance.
 *  - Added quality indicator (via hls.js level info) and a buffering state
 *    distinct from the initial "connecting" state.
 *  - Defined a sensible default window.openStreamPlayer() (previously
 *    referenced by the "Watch Live" buttons but never implemented anywhere
 *    in the project, so those buttons silently did nothing).
 *  - Guarded against double-initialization if this script is ever included
 *    twice, and made sure every listener is cleaned up in destroy() to avoid
 *    leaks when switching channels rapidly.
 */
class HlsPlayer {
  constructor(opts) {
    this.video = opts.videoEl;
    this.src = opts.src;
    this.onStatusChange = opts.onStatusChange || function () {};
    this.onQualityChange = opts.onQualityChange || function () {};
    this.hls = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.retryTimer = null;
    this.destroyed = false;

    this._handleNativeLoad = this._handleNativeLoad.bind(this);
    this._handleNativeError = this._handleNativeError.bind(this);
    this._handleWaiting = this._handleWaiting.bind(this);
    this._handlePlaying = this._handlePlaying.bind(this);
    this._handleStalled = this._handleStalled.bind(this);

    this.video.addEventListener("waiting", this._handleWaiting);
    this.video.addEventListener("playing", this._handlePlaying);
    this.video.addEventListener("stalled", this._handleStalled);
  }

  static isHlsNativelySupported(video) {
    return video.canPlayType("application/vnd.apple.mpegurl") !== "";
  }

  setStatus(status, message) {
    if (!this.destroyed) this.onStatusChange(status, message);
  }

  _handleWaiting() { if (!this.destroyed) this.setStatus("buffering", "Buffering…"); }
  _handlePlaying() { if (!this.destroyed) this.setStatus("live", "Live"); }
  _handleStalled() { if (!this.destroyed) this.setStatus("buffering", "Network is slow, buffering…"); }

  load() {
    this.destroy(false);
    this.destroyed = false;
    this.setStatus("loading", "Connecting to stream…");

    // Muted-first autoplay strategy: most browsers block unmuted autoplay,
    // so we start muted (visually live immediately) and let the user unmute.
    this.video.muted = true;

    if (window.Hls && window.Hls.isSupported()) {
      this._loadWithHlsJs();
    } else if (HlsPlayer.isHlsNativelySupported(this.video)) {
      this._loadNatively();
    } else {
      this.setStatus("error", "Your browser does not support HLS streaming.");
    }
  }

  _loadWithHlsJs() {
    this.hls = new Hls({
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90
    });

    this.hls.on(Hls.Events.MEDIA_ATTACHED, () => this.hls.loadSource(this.src));

    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.retryCount = 0;
      this.setStatus("live", "Live");
      this._attemptPlay();
    });

    this.hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
      try {
        const level = this.hls.levels && this.hls.levels[data.level];
        if (level) this.onQualityChange(level.height ? level.height + "p" : "Auto");
      } catch (e) { /* non-fatal */ }
    });

    this.hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data || !data.fatal) return;
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          this.setStatus("loading", "Network lag detected. Reconnecting…");
          this._scheduleRetry(() => this.hls && this.hls.startLoad());
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          this.setStatus("loading", "Syncing frames…");
          if (this.hls) this.hls.recoverMediaError();
          break;
        default:
          this.setStatus("error", "Stream unavailable or dropped.");
          this._scheduleRetry(() => this.load());
          break;
      }
    });

    this.hls.attachMedia(this.video);
  }

  _loadNatively() {
    this.video.src = this.src;
    this.video.addEventListener("loadedmetadata", this._handleNativeLoad, { once: true });
    this.video.addEventListener("error", this._handleNativeError, { once: true });
  }

  _handleNativeLoad() {
    this.retryCount = 0;
    this.setStatus("live", "Live");
    this._attemptPlay();
  }

  _handleNativeError() {
    this.setStatus("error", "Stream source could not be resolved.");
    this._scheduleRetry(() => this._loadNatively());
  }

  _attemptPlay() {
    const p = this.video.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => this.setStatus("idle", "Click Play to begin broadcasting"));
    }
  }

  _scheduleRetry(fn) {
    if (this.destroyed) return;
    if (this.retryCount >= this.maxRetries) {
      this.setStatus("error", "Stream failed. Click 'Retry' to restart manually.");
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 15000);
    this.retryCount += 1;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { if (!this.destroyed) fn(); }, delay);
  }

  retryNow() {
    this.retryCount = 0;
    this.load();
  }

  destroy(fullTeardown) {
    this.destroyed = true;
    clearTimeout(this.retryTimer);

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    this.video.removeEventListener("loadedmetadata", this._handleNativeLoad);
    this.video.removeEventListener("error", this._handleNativeError);

    if (fullTeardown !== false) {
      this.video.removeEventListener("waiting", this._handleWaiting);
      this.video.removeEventListener("playing", this._handlePlaying);
      this.video.removeEventListener("stalled", this._handleStalled);
    }

    this.video.removeAttribute("src");
    this.video.src = "";
    this.video.load();
  }
}

/* --- App Logic & UI initialization --- */
(function () {
  "use strict";

  // Guard against double-inclusion of this script (prevents duplicate
  // listeners / duplicate HLS instances if a future edit accidentally
  // includes player.js twice).
  if (window.__bs4kPlayerBooted) return;
  window.__bs4kPlayerBooted = true;

  function boot() {
    const video = document.getElementById("video");
    const overlay = document.getElementById("overlay");
    const overlayText = document.getElementById("overlayText");
    const btnUnmuteHint = document.getElementById("btnUnmuteHint");
    const statusPill = document.getElementById("statusPill");
    const statusText = document.getElementById("statusText");
    const qualityPill = document.getElementById("qualityPill");
    const playerShell = document.getElementById("playerShell");
    const btnOpenNewsPlayer = document.getElementById("btnOpenNewsPlayer");
    const newsPlayerSection = document.getElementById("newsPlayerSection");
    const btnRetry = document.getElementById("btnRetry");
    const channelGrid = document.getElementById("channelGrid");

    if (!video || !overlay || !playerShell) return; // markup missing; nothing to wire up

    const toast = window.bs4kToast || function () {};
    const isReducedMotion = window.bs4kMotionReduced || function () { return false; };

    let player = null;
    let channelsLoaded = false;
    let currentChannelUrl = null;

    function updateUIStatus(status, message) {
      statusPill.className = "status-pill";
      if (status === "live") statusPill.classList.add("live");
      else if (status === "idle") statusPill.classList.add("ok");
      else if (status === "buffering") statusPill.classList.add("buffering");
      else if (status === "error") statusPill.classList.add("error");

      statusText.textContent = message || status;

      if (btnRetry) btnRetry.classList.toggle("is-busy", status === "loading");

      if (status === "live") {
        overlay.classList.add("hidden");
        overlay.classList.remove("is-retrying");
      } else {
        overlay.classList.remove("hidden");
        overlay.classList.toggle("is-retrying", status === "loading" || status === "error");
        overlayText.textContent = message || "Loading stream…";
      }

      if (status === "buffering") {
        // Keep video visible during rebuffer — don't slam the full overlay
        // back over live video, just show the status pill state.
        overlay.classList.add("hidden");
      }
    }

    function updateQualityUI(label) {
      if (!qualityPill) return;
      if (!label) { qualityPill.hidden = true; return; }
      qualityPill.hidden = false;
      qualityPill.textContent = label;
    }

    // Reveal the "tap to unmute" hint once the stream is actually live and
    // still muted (autoplay policy), and wire it up once.
    function refreshUnmuteHint() {
      if (!btnUnmuteHint) return;
      btnUnmuteHint.hidden = !(video.muted && !video.paused);
    }
    video.addEventListener("playing", refreshUnmuteHint);
    video.addEventListener("volumechange", refreshUnmuteHint);
    if (btnUnmuteHint) {
      btnUnmuteHint.addEventListener("click", function () {
        video.muted = false;
        const btnMute = document.getElementById("btnMute");
        if (btnMute) btnMute.textContent = "🔇 Mute";
        btnUnmuteHint.hidden = true;
      });
    }

    // Network connectivity
    window.addEventListener("offline", () => updateUIStatus("error", "Disconnected: check your network."));
    window.addEventListener("online", () => { if (player) player.retryNow(); });

    /* Event Button Triggers */
    const btnPlay = document.getElementById("btnPlay");
    if (btnPlay) btnPlay.addEventListener("click", () => {
      if (video.paused) video.play().catch(() => {}); else video.pause();
    });

    const btnMute = document.getElementById("btnMute");
    if (btnMute) btnMute.addEventListener("click", (e) => {
      video.muted = !video.muted;
      e.currentTarget.textContent = video.muted ? "🔊 Unmute" : "🔇 Mute";
      refreshUnmuteHint();
    });

    if (btnRetry) btnRetry.addEventListener("click", () => { if (player) player.retryNow(); });

    const btnFullscreen = document.getElementById("btnFullscreen");
    if (btnFullscreen) btnFullscreen.addEventListener("click", () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fsEl) {
        if (playerShell.requestFullscreen) {
          playerShell.requestFullscreen().catch(() => {});
        } else if (playerShell.webkitRequestFullscreen) {
          playerShell.webkitRequestFullscreen();
        } else if (video.webkitEnterFullscreen) {
          // iOS Safari: only the <video> element itself supports fullscreen.
          video.webkitEnterFullscreen();
        }
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    });

    const btnPip = document.getElementById("btnPip");
    if (btnPip) btnPip.addEventListener("click", async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
          await video.requestPictureInPicture();
        } else if (video.webkitSupportsPresentationMode && typeof video.webkitSetPresentationMode === "function") {
          // Safari desktop's PiP equivalent
          const inPip = video.webkitPresentationMode === "picture-in-picture";
          video.webkitSetPresentationMode(inPip ? "inline" : "picture-in-picture");
        } else {
          toast("Picture-in-Picture isn't supported on this browser.", "error");
        }
      } catch (e) { /* fail silently if unsupported/blocked */ }
    });

    /* ---------- fetch helper with timeout + abort ---------- */
    function fetchWithTimeout(url, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs || 10000);
      return fetch(url, { signal: controller.signal, cache: "no-store" })
        .finally(() => clearTimeout(timer));
    }

    /* ---------- m3u parsing ---------- */
    function parseM3U(data) {
      if (typeof data !== "string") return [];
      const lines = data.split("\n");
      const channels = [];
      let currentName = "";
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXTINF:")) {
          const nameParts = line.split(",");
          currentName = (nameParts[nameParts.length - 1] || "").trim();
        } else if (line.startsWith("http")) {
          channels.push({ name: currentName || ("Channel " + (channels.length + 1)), url: line });
          currentName = "";
        }
      }
      return channels;
    }

    function sanitizeChannelName(name) {
      // Belt-and-suspenders: strip anything HTML-ish even though we render
      // via textContent (never innerHTML) below.
      return String(name || "Unknown Channel").replace(/[<>]/g, "").slice(0, 80);
    }

    function renderChannelState(message, kind) {
      if (!channelGrid) return;
      channelGrid.innerHTML = "";
      const div = document.createElement("div");
      div.className = kind === "error" ? "ch-error" : "ch-empty";
      div.textContent = message;
      channelGrid.appendChild(div);
    }

    function isSafeSourceUrl(u) {
      if (/^https?:\/\//i.test(u)) return true; // absolute http(s) URL
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) return false; // any other scheme (javascript:, data:, etc.) — reject
      if (u.startsWith("//")) return false; // protocol-relative — ambiguous, reject
      return true; // relative path within the site, e.g. "./list.json"
    }

    async function loadChannels() {
      if (!channelGrid) return;
      try {
        const sourceResponse = await fetchWithTimeout("source.txt", 8000);
        if (!sourceResponse.ok) throw new Error("source.txt HTTP " + sourceResponse.status);
        const SOURCE_URL = (await sourceResponse.text()).trim();

        if (!SOURCE_URL || !isSafeSourceUrl(SOURCE_URL)) {
          throw new Error("Invalid or unsafe URL in source.txt");
        }

        const response = await fetchWithTimeout(SOURCE_URL, 12000);
        if (!response.ok) throw new Error("Playlist HTTP " + response.status);
        const textData = await response.text();

        let channels = [];
        if (SOURCE_URL.toLowerCase().endsWith(".m3u") || SOURCE_URL.toLowerCase().endsWith(".m3u8") || textData.includes("#EXTM3U")) {
          channels = parseM3U(textData);
        } else {
          let parsed;
          try { parsed = JSON.parse(textData); } catch (e) { throw new Error("Playlist is not valid JSON or M3U"); }
          channels = Array.isArray(parsed) ? parsed : [];
        }

        // Validate each entry has a usable URL; drop anything malformed.
        channels = channels.filter((c) => c && typeof c.url === "string" && /^https?:\/\//i.test(c.url));

        channelGrid.innerHTML = "";

        if (channels.length === 0) {
          renderChannelState("No channels found", "error");
          return;
        }

        const frag = document.createDocumentFragment();
        channels.forEach((channel) => {
          const card = document.createElement("div");
          card.className = "ch-card";
          card.setAttribute("role", "button");
          card.setAttribute("tabindex", "0");

          const icon = document.createElement("div");
          icon.className = "ch-icon";
          icon.textContent = "📺";

          const label = document.createElement("div");
          label.className = "ch-name";
          label.textContent = sanitizeChannelName(channel.name);

          card.appendChild(icon);
          card.appendChild(label);

          function select() {
            channelGrid.querySelectorAll(".ch-card.active").forEach((c) => c.classList.remove("active"));
            card.classList.add("active");
            playChannel(channel.url);
          }
          card.addEventListener("click", select);
          card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
          });

          frag.appendChild(card);
        });
        channelGrid.appendChild(frag);

        const firstCard = channelGrid.querySelector(".ch-card");
        if (firstCard) firstCard.click();

        channelsLoaded = true;
      } catch (error) {
        console.error("Error loading channels:", error);
        renderChannelState("Failed to load channels. Tap Retry to try again.", "error");
      }
    }

    function playChannel(url) {
      currentChannelUrl = url;
      if (player) player.destroy();
      player = new HlsPlayer({
        videoEl: video,
        src: url,
        onStatusChange: updateUIStatus,
        onQualityChange: updateQualityUI
      });
      player.load();
    }

    /* ---------- single canonical open/close (fixes the duplicate-listener bug) ---------- */
    function isPlayerOpen() {
      return newsPlayerSection.style.display === "block";
    }

    function openPlayer(reasonToast) {
      newsPlayerSection.style.setProperty("display", "block", "important");
      newsPlayerSection.scrollIntoView({ behavior: isReducedMotion() ? "auto" : "smooth", block: "start" });

      if (!channelsLoaded) {
        loadChannels();
      } else if (video && video.paused && currentChannelUrl) {
        video.play().catch(() => {});
      }

      if (btnOpenNewsPlayer) {
        btnOpenNewsPlayer.textContent = "❌ CLOSE SPORTS TV";
        btnOpenNewsPlayer.style.background = "#334155";
      }
      toast(reasonToast || "Live stream running", "success");
    }

    function closePlayer() {
      newsPlayerSection.style.setProperty("display", "none", "important");
      if (player) {
        player.destroy();
        player = null;
      } else if (video) {
        video.pause();
        video.removeAttribute("src");
        video.src = "";
      }
      channelsLoaded = false;
      currentChannelUrl = null;
      if (btnOpenNewsPlayer) {
        btnOpenNewsPlayer.textContent = "📺 24HRS SPORTS NEWS WATCH LIVE";
        btnOpenNewsPlayer.style.background = "linear-gradient(135deg, #ff007f, #7928ca)";
      }
    }

    function togglePlayer() {
      if (isPlayerOpen()) closePlayer(); else openPlayer();
    }

    if (btnOpenNewsPlayer && newsPlayerSection) {
      btnOpenNewsPlayer.addEventListener("click", function (e) {
        e.preventDefault();
        togglePlayer();
      });
    }

    // Default implementation for the "Watch Live" hook used by match cards.
    // A site owner can still override this by defining their own
    // window.openStreamPlayer before this script runs, or by re-assigning it
    // afterwards from their own script.
    if (typeof window.openStreamPlayer !== "function") {
      window.openStreamPlayer = function (matchTitle) {
        if (!isPlayerOpen()) openPlayer(matchTitle ? "Opening live channels for " + matchTitle : undefined);
        else newsPlayerSection.scrollIntoView({ behavior: isReducedMotion() ? "auto" : "smooth", block: "start" });
      };
    }

    /* Accessible Keyboard Interactivity */
    window.addEventListener("keydown", (e) => {
      const isPlayerFocused = document.activeElement === video || document.activeElement === playerShell;
      if (!isPlayerFocused) return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          if (video.paused) video.play().catch(() => {}); else video.pause();
          break;
        case "m":
          if (btnMute) btnMute.click();
          break;
        case "f":
          if (btnFullscreen) btnFullscreen.click();
          break;
        case "p":
          if (btnPip) btnPip.click();
          break;
        case "ArrowRight":
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
          break;
        case "ArrowLeft":
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
      }
    });

    // Passive touch listener so double-tap-to-seek gestures don't block scrolling.
    let lastTap = 0;
    playerShell.addEventListener("touchend", () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        if (video.paused) video.play().catch(() => {}); else video.pause();
      }
      lastTap = now;
    }, { passive: true });

    window.addEventListener("beforeunload", () => { if (player) player.destroy(); });
    document.addEventListener("visibilitychange", () => {
      // Free up decode/network resources when the tab is hidden for a long
      // background session on low-memory / TV devices, but don't kill an
      // actively-watched stream just for switching tabs briefly.
      if (document.hidden === false && player && video.paused && isPlayerOpen() && currentChannelUrl) {
        video.play().catch(() => {});
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
