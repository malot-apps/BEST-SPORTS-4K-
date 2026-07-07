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

   // ১. .m3u প্লেলিস্ট ফাইল ভেঙে নাম ও লিঙ্ক আলাদা করার সহকারী ফাংশন
  function parseM3U(data) {
    const lines = data.split('\n');
    const channels = [];
    let currentName = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXTINF:')) {
        const nameParts = line.split(',');
        currentName = nameParts[nameParts.length - 1].trim();
      } else if (line.startsWith('http')) {
        channels.push({
          name: currentName || `Channel ${channels.length + 1}`,
          url: line
        });
        currentName = '';
      }
    }
    return channels;
  }

  // ২. মেইন ফাংশন: যা ডাটা এনে স্ক্রিনে সুন্দর গ্রিড কার্ড সাজিয়ে দেয়
  async function loadChannels() {
    const SOURCE_URL = "https://iptv-org.github.io/iptv/categories/sports.m3u"; 
    
    try {
      const response = await fetch(SOURCE_URL);
      const textData = await response.text();
      let channels = [];

      const channelGrid = document.getElementById("channelGrid");
      if (!channelGrid) return;

      // লিঙ্ক চেক করে ডাটা পার্স করা (JSON নাকি M3U তা নিজে বুঝবে)
      if (SOURCE_URL.endsWith('.m3u') || textData.includes('#EXTM3U')) {
        channels = parseM3U(textData);
      } else {
        channels = JSON.parse(textData);
      }
      
      channelGrid.innerHTML = "";
      
      if(channels.length === 0) {
        channelGrid.innerHTML = '<div style="color:var(--bad); text-align:center; grid-column:1/-1;">No channels found</div>';
        return;
      }

      // লুপ চালিয়ে প্রতিটা চ্যানেলের জন্য প্রিমিয়াম অ্যাপ স্টাইল কার্ড বানানো
      channels.forEach((channel) => {
        const card = document.createElement("div");
        
        // কার্ডের স্টাইলিং (লুক অ্যান্ড ফিল)
        card.style.background = "rgba(255, 255, 255, 0.04)";
        card.style.border = "1px solid rgba(255, 255, 255, 0.08)";
        card.style.borderRadius = "12px";
        card.style.padding = "12px 8px";
        card.style.textAlign = "center";
        card.style.cursor = "pointer";
        card.style.transition = "transform 0.2s, background 0.2s, border-color 0.2s";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.alignItems = "center";
        card.style.justifyContent = "center";
        card.style.minHeight = "80px";
        
        card.innerHTML = `
          <div style="font-size: 20px; margin-bottom: 6px;">📺</div>
          <div style="font-size: 11px; font-weight: 700; color: #eef2f7; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
            ${channel.name}
          </div>
        `;

        // হোভার ইফেক্টস
        card.addEventListener("mouseenter", () => {
          card.style.background = "rgba(0, 229, 255, 0.1)";
          card.style.borderColor = "var(--accent)";
          card.style.transform = "scale(1.03)";
        });
        card.addEventListener("mouseleave", () => {
          card.style.background = "rgba(255, 255, 255, 0.04)";
          card.style.borderColor = "rgba(255, 255, 255, 0.08)";
          card.style.transform = "scale(1)";
        });

        // ক্লিকে প্লেয়ার লোড করার লজিক
        card.addEventListener("click", () => {
          Array.from(channelGrid.children).forEach(c => {
            c.style.boxShadow = "none";
            c.style.background = "rgba(255, 255, 255, 0.04)";
          });
          
          card.style.background = "rgba(0, 229, 255, 0.15)";
          card.style.boxShadow = "0 0 0 2px var(--accent)";
          
          playChannel(channel.url);
        });

        channelGrid.appendChild(card);
      });

      // প্রথম চ্যানেলটি অটো-প্লে ট্রিগার করা
      if (channelGrid.children.length > 0) {
        channelGrid.children[0].click();
      }
      
      channelsLoaded = true;

    } catch (error) {
      console.error("Error loading channels:", error);
      const channelGrid = document.getElementById("channelGrid");
      if (channelGrid) channelGrid.innerHTML = '<div style="color:var(--bad); text-align:center; grid-column:1/-1;">Failed to load channels</div>';
    }
  }

  // ৩. প্লেয়ার স্টার্ট করার ফাংশন
  function playChannel(url) {
    if (player) player.destroy();
    player = new HlsPlayer({ videoEl: video, src: url, onStatusChange: updateUIStatus });
    player.load();
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

