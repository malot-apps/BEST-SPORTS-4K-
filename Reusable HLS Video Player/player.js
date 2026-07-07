/**
 * HlsPlayer — Production ready, robust wrapper around hls.js
 * Supporting recovery mechanisms, native fallbacks, and UI bindings.
 */
class HlsPlayer {
  constructor(opts) {
    this.video = opts.videoEl;
    this.src = opts.src;
    this.onStatusChange = opts.onStatusChange || function () {};
    this.hls = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.retryTimer = null;
    this.destroyed = false;

    // Standard Bindings to prevent listener duplication
    this._handleNativeLoad = this._handleNativeLoad.bind(this);
    this._handleNativeError = this._handleNativeError.bind(this);
  }

  static isHlsNativelySupported(video) {
    return video.canPlayType("application/vnd.apple.mpegurl") !== "";
  }

  setStatus(status, message) {
    if (!this.destroyed) {
      this.onStatusChange(status, message);
    }
  }

  load() {
    this.destroy(); 
    this.destroyed = false;
    this.setStatus("loading", "Connecting to stream…");

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
      this.video.play().catch(() => {
        this.setStatus("idle", "Click Play to begin broadcasting");
      });
    });

    this.hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return;
      
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          this.setStatus("loading", "Network lag detected. Reconnecting…");
          this._scheduleRetry(() => this.hls.startLoad());
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          this.setStatus("loading", "Syncing frames…");
          this.hls.recoverMediaError();
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
    this.video.play().catch(() => this.setStatus("idle", "Click Play to begin"));
  }

  _handleNativeError() {
    this.setStatus("error", "Stream source could not be resolved.");
    this._scheduleRetry(() => this._loadNatively());
  }

  _scheduleRetry(fn) {
    if (this.destroyed) return;
    if (this.retryCount >= this.maxRetries) {
      this.setStatus("error", "Stream failed. Click 'Retry' to restart manually.");
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 15000); // Exponential backoff
    this.retryCount += 1;
    
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.destroyed) fn();
    }, delay);
  }

  retryNow() {
    this.retryCount = 0;
    this.load();
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.retryTimer);
    
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    // Clean listeners for Native HTML5 Elements
    this.video.removeEventListener("loadedmetadata", this._handleNativeLoad);
    this.video.removeEventListener("error", this._handleNativeError);
    this.video.src = "";
    this.video.load();
  }
}

/* --- App Logic & UI initialization --- */
document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("video");
  const overlay = document.getElementById("overlay");
  const overlayText = document.getElementById("overlayText");
  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  const playerShell = document.getElementById("playerShell");

  // Fallback testing URL (Swap this with your live endpoint)
  const STREAM_URL = "https://iptv-org.github.io/iptv/categories/sports.m3u";

  function updateUIStatus(status, message) {
    statusPill.className = "status-pill"; // reset classes
    
    if (status === "live") statusPill.classList.add("live");
    if (status === "idle") statusPill.classList.add("ok");
    
    statusText.textContent = message || status;

    if (status === "live") {
      overlay.classList.add("hidden");
    } else {
      overlay.classList.remove("hidden");
      overlayText.textContent = message || "Loading stream…";
    }
  }

  const player = new HlsPlayer({
    videoEl: video,
    src: STREAM_URL,
    onStatusChange: updateUIStatus
  });

  player.load();

  // Network Connectivity Triggers
  window.addEventListener("offline", () => updateUIStatus("error", "Disconnect: Check your network."));
  window.addEventListener("online", () => player.retryNow());

  /* Event Button Triggers */
  document.getElementById("btnPlay").addEventListener("click", () => {
    video.paused ? video.play() : video.pause();
  });

  document.getElementById("btnMute").addEventListener("click", (e) => {
    video.muted = !video.muted;
    e.target.textContent = video.muted ? "🔊 Unmute" : "🔇 Mute";
  });

  document.getElementById("btnRetry").addEventListener("click", () => player.retryNow());

  document.getElementById("btnFullscreen").addEventListener("click", () => {
    if (!document.fullscreenElement) {
      playerShell.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });

  document.getElementById("btnPip").addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch { /* Fail silently if unsupported */ }
  });

    // --- ২৪ ঘণ্টা স্পোর্টস নিউজ বাটন ও চ্যানেল লোড লজিক ---
  const btnOpenNewsPlayer = document.getElementById("btnOpenNewsPlayer");
  const newsPlayerSection = document.getElementById("newsPlayerSection");
  const channelSelect = document.getElementById("channelSelect");
  let channelsLoaded = false;

  async function loadChannels() {
    try {
      const response = await fetch("./channels/list.json");
      const channels = await response.json();
      
      if (!channelSelect) return;
      channelSelect.innerHTML = "";
      
      if(channels.length === 0) {
        channelSelect.innerHTML = '<option value="">No channels available</option>';
        return;
      }

      channels.forEach((channel) => {
        const option = document.createElement("option");
        option.value = channel.url;
        option.textContent = channel.name;
        channelSelect.appendChild(option);
      });

      // প্রথম চ্যানেলটি লোড করা
      if (typeof playChannel === "function") {
        playChannel(channels[0].url);
      } else if (player) {
        player.destroy();
        player = new HlsPlayer({ videoEl: video, src: channels[0].url, onStatusChange: updateUIStatus });
        player.load();
      }
      channelsLoaded = true;
    } catch (error) {
      console.error("Error loading channels:", error);
      if (channelSelect) channelSelect.innerHTML = '<option value="">Failed to load channels</option>';
    }
  }

  if (btnOpenNewsPlayer && newsPlayerSection) {
    btnOpenNewsPlayer.addEventListener("click", () => {
      if (newsPlayerSection.style.display === "none") {
        newsPlayerSection.style.display = "block";
        newsPlayerSection.scrollIntoView({ behavior: 'smooth' });
        
        if (!channelsLoaded) {
          loadChannels();
        } else if (video && video.paused && video.src) {
          video.play().catch(() => {});
        }
        
        btnOpenNewsPlayer.textContent = "❌ CLOSE SPORTS TV";
        btnOpenNewsPlayer.style.background = "#334155";
      } else {
        newsPlayerSection.style.display = "none";
        if (player) {
          player.destroy();
          channelsLoaded = false;
        } else if (video) {
          video.pause();
          video.src = "";
          channelsLoaded = false;
        }
        btnOpenNewsPlayer.textContent = "📺 24HRS SPORTS NEWS WATCH LIVE";
        btnOpenNewsPlayer.style.background = "linear-gradient(135deg, #ff007f, #7928ca)";
      }
    });
  }

  if (channelSelect) {
    channelSelect.addEventListener("change", (e) => {
      if (e.target.value) {
        if (player) player.destroy();
        player = new HlsPlayer({ videoEl: video, src: e.target.value, onStatusChange: updateUIStatus });
        player.load();
      }
    });
  }

  
  /* Accessible Keyboard Interactivity */
  window.addEventListener("keydown", (e) => {
    const isPlayerFocused = document.activeElement === video || document.activeElement === playerShell;
    if (!isPlayerFocused) return;

    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault(); // Stop webpage from jumping down
        video.paused ? video.play() : video.pause();
        break;
      case "m":
        document.getElementById("btnMute").click();
        break;
      case "f":
        document.getElementById("btnFullscreen").click();
        break;
      case "p":
        document.getElementById("btnPip").click();
        break;
      case "ArrowRight":
        video.currentTime = Math.min(video.duration, video.currentTime + 5);
        break;
      case "ArrowLeft":
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;
    }
  });

  // Final garbage disposal
  window.addEventListener("beforeunload", () => player.destroy());
});

