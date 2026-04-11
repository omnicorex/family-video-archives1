/* ============================================================
   FAMILY ARCHIVES — main.js
   Loads config + playlist data, renders pages dynamically.
   No build step. No dependencies. Works from a simple server.
   ============================================================ */

"use strict";

// ── State ────────────────────────────────────────────────────
let CONFIG = {};
let DATA   = { playlists: [], meta: {} };

const PAGE = document.body.dataset.page || "index";

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);

async function init() {
  initNav();

  // Load branding config (non-fatal)
  try {
    const r = await fetch("./branding/config.json");
    if (r.ok) CONFIG = await r.json();
  } catch (_) { /* use defaults */ }

  // Load playlist data
  try {
    const r = await fetch("./data/playlists.json");
    if (r.ok) DATA = await r.json();
  } catch (_) { /* keep defaults */ }

  applyBranding();

  if (PAGE === "index")     initHomePage();
  if (PAGE === "playlist")  initPlaylistPage();
  if (PAGE === "playlists") initPlaylistsPage();
  if (PAGE === "timeline")  initTimelinePage();

  initMobileMenu();
  initSearch();
  initHeroVideoFade();
  initFooter();

  // Footer year
  const fy = document.getElementById("footer-year");
  if (fy) fy.textContent = new Date().getFullYear();
}

// ── Nav active state ──────────────────────────────────────────
// Handled via data-page + CSS; no JS needed for static active pills.

// ── Branding ─────────────────────────────────────────────────
function applyBranding() {
  const name = CONFIG.siteName || "Family Archives";
  const tag  = CONFIG.tagline  || "";

  // Site name in nav + footer
  const navName = el("nav-site-name");
  if (navName) navName.textContent = name;
  const footName = el("footer-name");
  if (footName) footName.textContent = name;
  qAll("[data-site-name]").forEach(e => e.textContent = name);

  // <title>
  if (PAGE === "index") document.title = name;

  // Donate links — all elements with data-donate get their href from config
  if (CONFIG.donateUrl) {
    qAll("[data-donate]").forEach(e => e.href = CONFIG.donateUrl);
  }

  // Color overrides from config
  const c = CONFIG.colors || {};
  const root = document.documentElement;
  if (c.red)    root.style.setProperty("--red",    c.red);
  if (c.blue)   root.style.setProperty("--blue",   c.blue);
  if (c.orange) root.style.setProperty("--orange", c.orange);
}

// ── Nav ───────────────────────────────────────────────────────
function initNav() {
  const nav = q(".nav");
  if (!nav) return;
  const update = () => nav.classList.toggle("scrolled", window.scrollY > 10);
  window.addEventListener("scroll", update, { passive: true });
  update();
}

// ============================================================
// HOME PAGE
// ============================================================
function initHomePage() {
  // Site name & tagline in hero
  setInner("hero-title-text", esc(CONFIG.siteName || "Family Archives"));
  setInner("hero-subtitle",   esc(CONFIG.tagline  || "A curated collection of our most treasured memories."));
  setInner("nav-site-name",   esc(CONFIG.siteName || "Family Archives"));
  setInner("footer-name",     esc(CONFIG.siteName || "Family Archives"));

  // Stats
  setInner("stat-videos",    DATA.meta?.total_videos    ?? "—");
  setInner("stat-playlists", DATA.meta?.total_playlists ?? "—");
}

function renderPlaylists(playlists) {
  const grid = q("#playlists-grid");
  if (!grid) return;

  grid.innerHTML = ""; // clear skeletons

  if (!playlists.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="2" y="6" width="20" height="14" rx="2"/>
          <path d="M8 2h8M6 6V2M18 6V2M12 10v6M9 13l3-3 3 3"/>
        </svg>
        <h3>No playlists yet</h3>
        <p>Sync videos from MediaCMS to Grist, fill in your playlists, then generate the JSON.</p>
        <code>python scripts/03_grist_sync.py</code>
      </div>`;
    return;
  }

  // Build cards with playlist descriptions from config
  const descMap = CONFIG.playlist_descriptions || {};

  playlists.forEach((pl, i) => {
    // Prefer description from config.json, then from JSON data
    const desc = descMap[pl.name] || pl.description || "";
    const card = buildPlaylistCard(pl, desc, i);
    grid.appendChild(card);
  });

  // Intersection Observer — staggered reveal
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  qAll(".playlist-card").forEach((card, i) => {
    card.style.transitionDelay = `${i * 70}ms`;
    obs.observe(card);
  });
}

function buildPlaylistCard(pl, desc, index) {
  const card = document.createElement("div");
  card.className = "playlist-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", `Open playlist: ${pl.name}`);

  // Collect up to 4 thumbnails from the playlist's videos
  const thumbs = (pl.videos || [])
    .map(v => v.thumbnail)
    .filter(Boolean)
    .slice(0, 4);

  const count = thumbs.length;
  let thumbAreaHtml;

  if (count === 0) {
    // No thumbnails at all — show placeholder
    thumbAreaHtml = `<div class="card-thumb-placeholder">
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0.6">
        <rect x="2" y="6" width="20" height="14" rx="2"/>
        <path d="M10 9.5l5 2.5-5 2.5V9.5z"/>
      </svg>
    </div>`;
  } else {
    // Build collage cells — NO onerror attributes (handled via JS below)
    const cells = thumbs.map((src, i) =>
      `<div class="collage-cell">
        <img src="${esc(src)}" alt="" loading="lazy" data-cell="${i}">
      </div>`
    ).join("");
    thumbAreaHtml = `<div class="card-collage" data-count="${count}">${cells}</div>`;
  }

  const countLabel = `${pl.video_count} video${pl.video_count !== 1 ? "s" : ""}`;

  card.innerHTML = `
    <div class="card-thumb">
      ${thumbAreaHtml}
      <div class="card-thumb-overlay" aria-hidden="true"></div>
    </div>
    <div class="card-body">
      <div class="card-eyebrow" aria-hidden="true">Playlist</div>
      <h3 class="card-title">${esc(pl.name)}</h3>
      ${desc ? `<p class="card-desc">${esc(desc)}</p>` : `<p class="card-desc"></p>`}
      <div class="card-footer">
        <span class="card-count">${countLabel}</span>
        <span class="card-watch-btn" aria-hidden="true">
          Watch
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </span>
      </div>
    </div>`;

  // Handle broken images via JS (never inline onerror — it breaks with SVG/quote content)
  card.querySelectorAll(".collage-cell img").forEach(img => {
    img.addEventListener("error", function () {
      this.closest(".collage-cell").style.background = "var(--bg-surface)";
      this.remove();
    });
  });

  const go = () => {
    window.location.href = `playlist.html?id=${encodeURIComponent(pl.id)}`;
  };
  card.addEventListener("click", go);
  card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") go(); });

  return card;
}

// ============================================================
// PLAYLIST PAGE
// ============================================================
function initPlaylistPage() {
  const params     = new URLSearchParams(window.location.search);
  const playlistId = params.get("id") || "";

  const playlist = (DATA.playlists || []).find(p => p.id === playlistId);

  if (!playlist) {
    showError(playlistId
      ? `Playlist "${esc(playlistId)}" was not found.`
      : "No playlist ID specified in the URL.");
    return;
  }

  // Page title
  document.title = `${playlist.name} — ${CONFIG.siteName || "Family Archives"}`;

  // Hero
  setInner("playlist-title", esc(playlist.name));
  setInner("nav-site-name",  esc(CONFIG.siteName || "Family Archives"));
  setInner("footer-name",    esc(CONFIG.siteName || "Family Archives"));

  // Description: prefer config.json override
  const descMap = CONFIG.playlist_descriptions || {};
  const desc    = descMap[playlist.name] || playlist.description || "";
  const descEl  = q("#playlist-desc");
  if (descEl) {
    if (desc) { descEl.textContent = desc; }
    else      { descEl.style.display = "none"; }
  }

  // Meta line
  setInner("playlist-meta", `
    <span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="6" width="20" height="14" rx="2"/>
        <path d="M10 9.5l5 2.5-5 2.5V9.5z"/>
      </svg>
      ${playlist.video_count} video${playlist.video_count !== 1 ? "s" : ""}
    </span>
  `);

  if (!playlist.videos || !playlist.videos.length) {
    showError("This playlist has no videos yet.");
    return;
  }

  renderVideoList(playlist.videos);

  // If a specific video was requested via ?video=mediaId, start there
  const videoId    = params.get("video") || "";
  const startIndex = videoId
    ? Math.max(0, playlist.videos.findIndex(v => v.id === videoId))
    : 0;

  loadVideo(playlist.videos[startIndex], startIndex);

  // Scroll the sidebar to the active item when deep-linked
  if (startIndex > 0) {
    setTimeout(() => {
      const activeItem = q(`.video-item[data-index="${startIndex}"]`);
      if (activeItem) activeItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 300);
  }
}

function renderVideoList(videos) {
  const list = q("#video-list");
  if (!list) return;
  list.innerHTML = "";

  videos.forEach((video, i) => {
    const item = document.createElement("div");
    item.className = "video-item";
    item.dataset.index = i;

    const thumbHtml = video.thumbnail
      ? `<img src="${esc(video.thumbnail)}" alt="${esc(video.title)}" loading="lazy">`
      : "";

    const durHtml = video.duration
      ? `<span class="video-item-duration">${esc(video.duration)}</span>`
      : "";

    const dateHtml = (video.date || video.date_added)
      ? `<div class="video-item-date">${formatDate(video.date || video.date_added)}</div>`
      : "";

    item.innerHTML = `
      <div class="video-item-thumb">
        ${thumbHtml}${durHtml}
      </div>
      <div class="video-item-body">
        <div class="video-item-num">${String(i + 1).padStart(2, "0")}</div>
        <div class="video-item-title">${esc(video.title)}</div>
        ${dateHtml}
      </div>`;

    item.addEventListener("click", () => {
      qAll(".video-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      loadVideo(video, i);
      // Scroll item into view within its container
      item.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    list.appendChild(item);
  });
}

let hlsInstance = null; // current HLS instance — destroyed on each switch

function triggerInfoAnimation() {
  const bezel = q(".player-info-bezel");
  if (!bezel) return;
  bezel.classList.remove("is-entering");
  void bezel.offsetWidth; // force reflow to restart the animation
  bezel.classList.add("is-entering");
}

function loadVideo(video, index) {
  const wrap    = q("#player-embed");
  const titleEl = q("#player-title");
  const descEl  = q("#player-desc");
  const dateEl  = q("#player-date");

  // ── Title / description / date ────────────────────────────────
  if (titleEl) titleEl.textContent = video.title || "";
  if (descEl) {
    if (video.description) { descEl.textContent = video.description; descEl.style.display = ""; }
    else                    { descEl.style.display = "none"; }
  }
  if (dateEl) dateEl.textContent = formatDate(video.date) || "";

  // ── Animate info card in ──────────────────────────────────────
  triggerInfoAnimation();

  // ── Mark active in list ───────────────────────────────────────
  qAll(".video-item").forEach((item, i) => item.classList.toggle("active", i === index));

  if (!wrap) return;

  // ── Remove any stale overlay from the previous video ─────────
  const staleOverlay = wrap.querySelector(".whl-loading-overlay");
  if (staleOverlay) staleOverlay.remove();

  // ── Resolve relative URLs ─────────────────────────────────────
  const base     = (CONFIG.mediaBaseUrl || "https://tube.tbg2.cloud").replace(/\/$/, "");
  const resolve  = url => url ? (url.startsWith("http") ? url : base + url) : "";
  const hlsUrl   = resolve(video.hls_url);
  const mp4Url   = resolve(video.video_url);
  const embedUrl = resolve(video.embed_url);
  const thumbUrl = resolve(video.thumbnail || "");

  // ── Destroy previous HLS instance ────────────────────────────
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

  // ── No direct stream URLs — use embed iframe (Grist workflow) ─
  if (!hlsUrl && !mp4Url) {
    if (embedUrl) {
      wrap.innerHTML = `<iframe id="video-player" src="${esc(embedUrl)}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture" frameborder="0"></iframe>`;
    } else {
      wrap.innerHTML = `
        <div class="player-no-url">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p>Video not available.</p>
        </div>`;
    }
    return;
  }

  // Ensure a clean <video> element (not an iframe from a previous load)
  if (!q("#video-player") || q("#video-player").tagName === "IFRAME") {
    wrap.innerHTML = `<video id="video-player" controls playsinline preload="metadata"></video>`;
  }
  const vid = q("#video-player");

  // ── Loading overlay — thumbnail + title + tricolor spinner ────
  // Shown while the video buffers; fades out the moment playback starts.
  const dateStr = formatDate(video.date) || "";
  const overlay = document.createElement("div");
  overlay.className = "whl-loading-overlay";
  if (thumbUrl) overlay.style.backgroundImage = `url('${thumbUrl}')`;
  overlay.innerHTML = `
    <div class="whl-loading-blur"></div>
    <div class="whl-loading-content">
      ${dateStr  ? `<div class="whl-loading-date">${esc(dateStr)}</div>`   : ""}
      ${video.title ? `<div class="whl-loading-title">${esc(video.title)}</div>` : ""}
      <div class="whl-loading-spinner-wrap">
        <div class="whl-loading-spinner"></div>
      </div>
    </div>`;
  wrap.appendChild(overlay);

  function removeOverlay() {
    if (!overlay || overlay._removed) return;
    overlay._removed = true;
    overlay.classList.add("whl-loading-overlay--fade");
    setTimeout(() => overlay.remove(), 480);
  }
  vid.addEventListener("playing", removeOverlay, { once: true });
  vid.addEventListener("error",   removeOverlay, { once: true });

  // ── HLS via hls.js (Chrome, Firefox, Edge) ────────────────────
  if (hlsUrl && window.Hls && window.Hls.isSupported()) {
    hlsInstance = new window.Hls({ startLevel: -1 });
    hlsInstance.loadSource(hlsUrl);
    hlsInstance.attachMedia(vid);
    // Early play() keeps us in the user-gesture stack (user just clicked the list item).
    // hls.js queues it until the manifest is parsed and segments are buffered.
    vid.play().catch(() => {});
    hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
      vid.play().catch(() => {});
    });
    return;
  }

  // ── Native HLS — Safari ───────────────────────────────────────
  if (hlsUrl && vid.canPlayType("application/vnd.apple.mpegurl")) {
    vid.src = hlsUrl;
    vid.play().catch(() => {});
    return;
  }

  // ── Direct MP4 fallback ───────────────────────────────────────
  if (mp4Url) {
    vid.src = mp4Url;
    vid.play().catch(() => {});
  }
}

function showError(msg) {
  const section = q("#player-section");
  if (section) {
    section.innerHTML = `
      <div class="empty-state" style="margin: 4rem auto; max-width: 600px;">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h3>Playlist not found</h3>
        <p>${msg}</p>
        <a href="index.html" style="color: var(--red); font-weight: 600; margin-top: 0.75rem; display: inline-block;">
          Back to home
        </a>
      </div>`;
  }
}

// ============================================================
// FOOTER — tricolor stripe reveal + scroll entry
// ============================================================
function initFooter() {
  const footer     = document.querySelector("footer");
  const donateCard = document.querySelector(".donate-card-bezel");

  // Tricolor stripe reveal when footer enters viewport
  if (footer) {
    const footerObs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        footer.classList.add("in-view");
        footerObs.disconnect();
      }
    }, { threshold: 0.08 });
    footerObs.observe(footer);
  }

  // Donate card fade-up reveal
  if (donateCard) {
    const donateObs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        donateCard.classList.add("revealed");
        donateObs.disconnect();
      }
    }, { threshold: 0.18 });
    donateObs.observe(donateCard);
  }
}

// ============================================================
// HERO VIDEO — seamless fade loop at 60 fps
// ============================================================
function initHeroVideoFade() {
  const vid = document.querySelector(".film-video");
  if (!vid) return;

  const FADE = 0.8; // seconds to fade in / fade out

  // Take over looping so we can control opacity around the seam
  vid.removeAttribute("loop");

  // Restart at end — rAF loop handles the fade-in automatically
  vid.addEventListener("ended", function () {
    vid.currentTime = 0;
    vid.play().catch(() => {});
  });

  // Drive opacity at display refresh rate (60 fps) instead of timeupdate (~4 fps)
  function tick() {
    const t = vid.currentTime;
    const d = vid.duration;

    if (d && !isNaN(d) && !vid.paused) {
      const remaining = d - t;
      let opacity;

      if (remaining < FADE) {
        opacity = Math.max(0, remaining / FADE);       // fade out
      } else if (t < FADE) {
        opacity = Math.min(1, t / FADE);               // fade in
      } else {
        opacity = 1;
      }

      vid.style.opacity = opacity;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ============================================================
// MOBILE MENU
// ============================================================

function initMobileMenu() {
  const btn  = q("#nav-hamburger");
  const menu = q("#mobile-menu");
  if (!btn || !menu) return;

  const openMenu = () => {
    btn.classList.add("is-open");
    menu.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    menu.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };

  const closeMenu = () => {
    btn.classList.remove("is-open");
    menu.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };

  btn.addEventListener("click", () => {
    btn.classList.contains("is-open") ? closeMenu() : openMenu();
  });

  // Close when tapping the backdrop (the overlay itself, not the panel)
  menu.addEventListener("click", e => { if (e.target === menu) closeMenu(); });

  // Close when any link/button with data-close-menu is clicked
  menu.querySelectorAll("[data-close-menu]").forEach(el => {
    el.addEventListener("click", closeMenu);
  });

  // Mobile search button: close menu, then open search after slide-down completes
  const mobileSearchBtn = q("#mobile-search-btn");
  if (mobileSearchBtn) {
    mobileSearchBtn.addEventListener("click", () => {
      closeMenu();
      setTimeout(openSearch, 340);
    });
  }

  // Escape key closes menu
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && btn.classList.contains("is-open")) closeMenu();
  });
}

// ============================================================
// SEARCH
// ============================================================

let fuseInstance  = null;
let searchIndex   = [];
let activeResult  = -1;
let searchDebounce;

function buildSearchIndex() {
  searchIndex = [];
  (DATA.playlists || []).forEach(pl => {
    (pl.videos || []).forEach(v => {
      searchIndex.push({
        media_id:    v.id          || "",
        title:       v.title       || "",
        description: v.description || "",
        date:        v.date        || "",
        playlist:    pl.name       || "",
        playlist_id: pl.id         || "",
        thumbnail:   v.thumbnail   || "",
      });
    });
  });

  if (window.Fuse) {
    fuseInstance = new Fuse(searchIndex, {
      keys: [
        { name: "title",       weight: 0.50 },
        { name: "description", weight: 0.25 },
        { name: "date",        weight: 0.15 },
        { name: "playlist",    weight: 0.10 },
      ],
      threshold:          0.38,
      includeScore:       true,
      includeMatches:     true,
      minMatchCharLength: 2,
    });
  }
}

function initSearch() {
  const overlay = q("#search-overlay");
  const input   = q("#search-input");
  if (!overlay || !input) return;

  // Keyboard shortcut hint — Mac vs Windows
  const isMac = /mac/i.test(navigator.platform);
  qAll(".nav-search-kbd").forEach(k => { k.textContent = isMac ? "\u2318K" : "Ctrl+K"; });

  // Nav + footer search buttons
  const btn = q("#nav-search-btn");
  if (btn) btn.addEventListener("click", openSearch);
  const footerBtn = q("#footer-search-btn");
  if (footerBtn) footerBtn.addEventListener("click", openSearch);
  const dockBtn = q("#dock-search-btn");
  if (dockBtn) dockBtn.addEventListener("click", openSearch);

  // Global shortcuts: Cmd/Ctrl+K or "/" (not in an input)
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openSearch(); return; }
    if (e.key === "/" && !["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) {
      e.preventDefault(); openSearch();
    }
  });

  // Close on backdrop click
  overlay.addEventListener("click", e => { if (e.target === overlay) closeSearch(); });

  // Input events
  input.addEventListener("keydown", e => {
    if (e.key === "Escape")    { closeSearch(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveResult(1);   return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); moveResult(-1);  return; }
    if (e.key === "Enter")     { e.preventDefault(); selectResult();  return; }
  });

  // Debounced live search
  input.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => performSearch(input.value.trim()), 140);
  });
}

function openSearch() {
  buildSearchIndex();
  const overlay = q("#search-overlay");
  const input   = q("#search-input");
  if (!overlay) return;
  overlay.removeAttribute("hidden");
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  document.body.style.overflow = "hidden";
  if (input) { input.value = ""; input.focus(); }
  activeResult = -1;
  renderSearchEmpty("Search across all videos, dates and playlists");
}

function closeSearch() {
  const overlay = q("#search-overlay");
  if (!overlay) return;
  overlay.classList.remove("is-open");
  document.body.style.overflow = "";
  setTimeout(() => overlay.setAttribute("hidden", ""), 300);
}

function performSearch(query) {
  if (!query) { renderSearchEmpty("Search across all videos, dates and playlists"); return; }

  let results;
  if (fuseInstance) {
    results = fuseInstance.search(query, { limit: 14 });
  } else {
    // Fallback: simple case-insensitive substring search
    const lq = query.toLowerCase();
    results = searchIndex
      .filter(v =>
        v.title.toLowerCase().includes(lq)       ||
        v.description.toLowerCase().includes(lq) ||
        v.date.toLowerCase().includes(lq)         ||
        v.playlist.toLowerCase().includes(lq)
      )
      .slice(0, 14)
      .map(item => ({ item, matches: [] }));
  }

  renderSearchResults(results, query);
}

function highlightMatch(text, matches, key) {
  if (!text) return "";
  if (!matches) return esc(text);
  const match = matches.find(m => m.key === key);
  if (!match || !match.indices || !match.indices.length) return esc(text);

  let out = "";
  let last = 0;
  // Sort indices and merge overlapping spans
  const sorted = [...match.indices].sort((a, b) => a[0] - b[0]);
  for (const [s, e] of sorted) {
    if (s < last) continue; // skip overlaps
    out += esc(text.slice(last, s));
    out += `<mark>${esc(text.slice(s, e + 1))}</mark>`;
    last = e + 1;
  }
  out += esc(text.slice(last));
  return out;
}

/**
 * Build a short, highlighted snippet from a description field match.
 * Returns null if the description didn't match (so we show nothing).
 * Extracts a ~60-char context window around the first hit, with "…" padding.
 */
function buildDescriptionSnippet(description, matches) {
  if (!description) return null;
  const match = (matches || []).find(m => m.key === "description");
  if (!match || !match.indices || !match.indices.length) return null;

  const WINDOW = 62; // context characters each side of the match anchor

  // Anchor on the first (highest-ranked) match pair
  const [anchorS, anchorE] = match.indices[0];
  const winStart = Math.max(0, anchorS - WINDOW);
  const winEnd   = Math.min(description.length, anchorE + WINDOW + 1);

  // Collect all match ranges that fall inside the window (clamp to window edges)
  const inWindow = match.indices
    .filter(([s]) => s >= winStart && s < winEnd)
    .sort((a, b) => a[0] - b[0]);

  let out = "";
  let cursor = winStart;
  for (const [s, e] of inWindow) {
    const clampE = Math.min(e, winEnd - 1);
    if (s < cursor) continue; // skip overlap
    out += esc(description.slice(cursor, s));
    out += `<mark class="desc-mark">${esc(description.slice(s, clampE + 1))}</mark>`;
    cursor = clampE + 1;
  }
  out += esc(description.slice(cursor, winEnd));

  const prefix = winStart > 0 ? "\u2026" : "";   // "…"
  const suffix = winEnd < description.length ? "\u2026" : "";
  return prefix + out + suffix;
}

function renderSearchEmpty(msg) {
  const container = q("#search-results");
  if (!container) return;
  activeResult = -1;
  container.innerHTML = `
    <div class="search-empty">
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
      <p>${esc(msg)}</p>
    </div>`;
}

function renderSearchResults(results, query) {
  const container = q("#search-results");
  if (!container) return;
  activeResult = -1;

  if (!results.length) {
    renderSearchEmpty(`No results for "${query}"`);
    return;
  }

  container.innerHTML = results.map((result, i) => {
    const v = result.item;
    const m = result.matches || [];

    const titleHtml   = highlightMatch(v.title, m, "title");
    const thumbHtml   = v.thumbnail
      ? `<img src="${esc(v.thumbnail)}" alt="" loading="lazy">`
      : "";
    const dateHtml = v.date
      ? `<span class="search-result-date">${esc(formatDate(v.date))}</span>` : "";

    // Description snippet — only rendered when the description actually matched
    const snippet     = buildDescriptionSnippet(v.description, m);
    const snippetHtml = snippet
      ? `<div class="search-result-snippet" aria-label="From description">${snippet}</div>`
      : "";

    return `
      <div class="search-result-item${snippet ? " has-snippet" : ""}"
           data-index="${i}"
           data-media-id="${esc(v.media_id)}"
           data-playlist-id="${esc(v.playlist_id)}"
           role="option" tabindex="-1"
           style="animation-delay:${i * 32}ms">
        <div class="search-result-thumb">${thumbHtml}</div>
        <div class="search-result-body">
          <div class="search-result-title">${titleHtml}</div>
          <div class="search-result-meta">
            ${dateHtml}
            <span class="search-result-playlist">${esc(v.playlist)}</span>
          </div>
          ${snippetHtml}
        </div>
        <div class="search-result-arrow" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </div>
      </div>`;
  }).join("");

  // Click handlers
  qAll(".search-result-item").forEach(item => {
    item.addEventListener("click", () => navigateToResult(item));
    item.addEventListener("mouseenter", () => {
      qAll(".search-result-item").forEach(i => i.classList.remove("is-active"));
      activeResult = parseInt(item.dataset.index, 10);
      item.classList.add("is-active");
    });
  });
}

function moveResult(dir) {
  const items = qAll(".search-result-item");
  if (!items.length) return;
  if (activeResult >= 0 && items[activeResult]) items[activeResult].classList.remove("is-active");
  activeResult = Math.max(0, Math.min(activeResult + dir, items.length - 1));
  items[activeResult].classList.add("is-active");
  items[activeResult].scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function selectResult() {
  const items = qAll(".search-result-item");
  if (activeResult >= 0 && items[activeResult]) {
    navigateToResult(items[activeResult]);
  } else if (items.length === 1) {
    navigateToResult(items[0]);
  }
}

function navigateToResult(item) {
  const playlistId = item.dataset.playlistId;
  const mediaId    = item.dataset.mediaId;
  if (!playlistId) return;
  closeSearch();
  window.location.href =
    `playlist.html?id=${encodeURIComponent(playlistId)}&video=${encodeURIComponent(mediaId)}`;
}

// ============================================================
// UTILITIES
// ============================================================

/** XSS-safe HTML escape */
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function q(sel)       { return document.querySelector(sel); }
function qAll(sel)    { return document.querySelectorAll(sel); }
function el(id)       { return document.getElementById(id); }

function setInner(id, html) {
  const e = document.getElementById(id);
  if (e) e.innerHTML = html;
}

function formatDate(str) {
  if (!str) return "";
  try {
    return new Date(str).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch (_) { return str; }
}

function parseWheelDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function formatSeconds(s) {
  if (!s) return "";
  const m   = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${sec}`;
}

// ============================================================
// PLAYLISTS PAGE
// ============================================================
function initPlaylistsPage() {
  setInner("nav-site-name",  esc(CONFIG.siteName || "Family Archives"));
  setInner("footer-name",    esc(CONFIG.siteName || "Family Archives"));
  setInner("stat-videos",    DATA.meta?.total_videos    ?? "—");
  setInner("stat-playlists", DATA.meta?.total_playlists ?? "—");

  const count = DATA.playlists?.length ?? 0;
  setInner("section-count", count ? `${count} collection${count !== 1 ? "s" : ""}` : "");

  renderPlaylists(DATA.playlists || []);
}

// ============================================================
// TIMELINE PAGE — Chronological Wheel Picker
// ============================================================

/* Wheel state — all mutable wheel vars in one object */
const WHL = {
  videos:          [],
  offset:          0,       // current rendered scroll position (px)
  target:          0,       // lerp destination (px)
  velocity:        0,       // momentum from fling/drag (px/frame)
  isDragging:      false,
  dragStartY:      0,
  dragStartOffset: 0,
  lastY:           0,
  lastTime:        0,
  lastVelocity:    0,
  raf:             null,
  activeIndex:     -1,
  hlsInst:         null,    // active HLS.js instance
  currentVideo:    null,    // video currently open in the player screen
};

function wheelItemH() { return window.innerWidth < 900 ? 112 : 150; }
function isMobileWheel() { return window.innerWidth < 900; }

function clampWhl(v) {
  const max = Math.max(0, (WHL.videos.length - 1) * wheelItemH());
  return Math.max(0, Math.min(v, max));
}

function snapWhl() {
  const h = wheelItemH();
  WHL.target   = clampWhl(Math.round(WHL.target / h) * h);
  WHL.velocity = 0;
}

// Project where momentum will coast to, then snap to nearest item boundary.
// impulse = signed px/frame velocity at release.
function projectAndSnap(impulse) {
  const h = wheelItemH();
  // Geometric series sum: total distance = v / (1 - friction)
  const projected = WHL.target + impulse * (1 / (1 - 0.88));
  WHL.target   = clampWhl(Math.round(projected / h) * h);
  WHL.velocity = 0;
}

let whlScrollTimer = null; // debounce snap after mouse-wheel

// ── Boot ─────────────────────────────────────────────────────
function initTimelinePage() {
  setInner("nav-site-name", esc(CONFIG.siteName || "Family Archives"));
  setInner("footer-name",   esc(CONFIG.siteName || "Family Archives"));

  // Gather all videos from all playlists, deduplicated
  const seen = new Set();
  const all  = [];
  (DATA.playlists || []).forEach(pl => {
    (pl.videos || []).forEach(v => {
      if (seen.has(v.id)) return;
      seen.add(v.id);
      all.push({ ...v, playlist_id: pl.id, playlist_name: pl.name });
    });
  });

  // Sort chronologically (undated go to top)
  all.sort((a, b) => {
    const da = a.date ? new Date(a.date) : new Date("1900-01-01");
    const db = b.date ? new Date(b.date) : new Date("1900-01-01");
    return da - db;
  });

  setInner("timeline-count", all.length ? `${all.length} video${all.length !== 1 ? "s" : ""}` : "0 videos");

  if (!all.length) {
    const stage = q("#wheel-stage");
    if (stage) stage.innerHTML = `<div class="empty-state" style="grid-column:1/-1;margin:4rem auto"><p>No videos found.</p></div>`;
    return;
  }

  WHL.videos = all;
  buildWheelItems();
  bindWheelEvents();

  // Wire up the back button on the mobile player screen
  const psBack = q("#whl-ps-back");
  if (psBack) psBack.addEventListener("click", () => history.back());

  // Close player screen when browser back is pressed
  window.addEventListener("popstate", e => {
    if (!e.state || !e.state.whlPlay) closePlayerScreen();
  });

  // Start animation loop
  WHL.raf = requestAnimationFrame(wheelTick);

  // Initialise first item selection after a frame, then handle ?play= param
  setTimeout(() => {
    whlSelectIndex(0, false);
    const playId = new URLSearchParams(location.search).get("play");
    if (playId) {
      const idx = WHL.videos.findIndex(v => v.id === playId);
      if (idx !== -1) {
        whlSelectIndex(idx, false);
        openPlayerScreen(WHL.videos[idx]);
      }
    }
  }, 80);
}

// ── Build DOM items ───────────────────────────────────────────
function buildWheelItems() {
  const list = q("#wheel-list");
  if (!list) return;

  list.innerHTML = WHL.videos.map((v, i) => {
    const d        = parseWheelDate(v.date);
    const monthStr = d ? d.toLocaleString("en-US", { month: "short" }).toUpperCase() : "";
    const dayStr   = d ? String(d.getDate())                                          : "";
    const yearStr  = d ? String(d.getFullYear())                                      : "????";
    const thumb    = v.thumbnail || "";

    return `<div class="wheel-item" data-index="${i}"
                 role="option" aria-label="${esc(v.title)}" tabindex="-1">
      <div class="wheel-item-inner">
        <div class="wheel-item-thumb">
          ${thumb
            ? `<img src="${esc(thumb)}" alt="" loading="lazy" decoding="async">`
            : `<div class="wheel-thumb-blank"></div>`}
          <div class="wheel-thumb-play" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
        <div class="wheel-item-body">
          <div class="wheel-item-date">
            <span class="wid-month-day">${esc(monthStr)}${monthStr && dayStr ? " " + esc(dayStr) : esc(dayStr)}</span>
            <span class="wid-year">${esc(yearStr)}</span>
          </div>
          <div class="wheel-item-title">${esc(v.title)}</div>
          <div class="wheel-item-desc">${esc(v.description || "")}</div>
          <div class="wheel-item-playlist">${esc(v.playlist_name || "")}</div>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ── Event Binding ─────────────────────────────────────────────
function bindWheelEvents() {
  const ctr = q("#wheel-container");
  if (!ctr) return;

  // ── Mouse wheel ────────────────────────────────────────────
  // Accumulate raw delta into target, debounce snap to item boundary.
  ctr.addEventListener("wheel", e => {
    e.preventDefault();
    WHL.velocity = 0;
    WHL.target   = clampWhl(WHL.target + (e.deltaY || e.deltaX) * 0.7);
    // Snap to nearest item ~80 ms after the last scroll event
    clearTimeout(whlScrollTimer);
    whlScrollTimer = setTimeout(snapWhl, 80);
  }, { passive: false });

  // ── Touch ──────────────────────────────────────────────────
  ctr.addEventListener("touchstart", e => {
    clearTimeout(whlScrollTimer);
    WHL.isDragging      = true;
    WHL.dragStartY      = e.touches[0].clientY;
    WHL.dragStartOffset = WHL.offset;   // anchor to current *rendered* position
    WHL.target          = WHL.offset;   // keep target in sync
    WHL.lastY           = e.touches[0].clientY;
    WHL.lastTime        = Date.now();
    WHL.lastVelocity    = 0;
    WHL.velocity        = 0;
  }, { passive: true });

  ctr.addEventListener("touchmove", e => {
    if (!WHL.isDragging) return;
    e.preventDefault();
    const dy = WHL.dragStartY - e.touches[0].clientY;
    WHL.target = clampWhl(WHL.dragStartOffset + dy);

    const now = Date.now();
    const dt  = Math.max(1, now - WHL.lastTime);
    WHL.lastVelocity = (e.touches[0].clientY - WHL.lastY) / dt;
    WHL.lastY        = e.touches[0].clientY;
    WHL.lastTime     = now;
  }, { passive: false });

  ctr.addEventListener("touchend", () => {
    WHL.isDragging = false;
    // Convert touch velocity → projected distance, snap immediately
    projectAndSnap(-WHL.lastVelocity * 120);
  }, { passive: true });

  // ── Mouse drag ─────────────────────────────────────────────
  ctr.addEventListener("mousedown", e => {
    clearTimeout(whlScrollTimer);
    WHL.isDragging      = true;
    WHL.dragStartY      = e.clientY;
    WHL.dragStartOffset = WHL.offset;   // anchor to current *rendered* position
    WHL.target          = WHL.offset;
    WHL.lastY           = e.clientY;
    WHL.lastTime        = Date.now();
    WHL.lastVelocity    = 0;
    WHL.velocity        = 0;
    ctr.style.cursor    = "grabbing";
    e.preventDefault();
  });

  window.addEventListener("mousemove", e => {
    if (!WHL.isDragging) return;
    const dy = WHL.dragStartY - e.clientY;
    WHL.target = clampWhl(WHL.dragStartOffset + dy);
    const now = Date.now();
    const dt  = Math.max(1, now - WHL.lastTime);
    WHL.lastVelocity = (e.clientY - WHL.lastY) / dt;
    WHL.lastY        = e.clientY;
    WHL.lastTime     = now;
  });

  window.addEventListener("mouseup", () => {
    if (!WHL.isDragging) return;
    WHL.isDragging = false;
    const ctrEl = q("#wheel-container");
    if (ctrEl) ctrEl.style.cursor = "";
    // Convert drag velocity → projected distance, snap immediately
    projectAndSnap(-WHL.lastVelocity * 90);
  });

  // ── Keyboard ───────────────────────────────────────────────
  document.addEventListener("keydown", e => {
    if (!q("#wheel-container")) return;
    const h   = wheelItemH();
    const idx = Math.round(WHL.target / h);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      WHL.target = clampWhl((idx + 1) * h);
      WHL.velocity = 0;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      WHL.target = clampWhl((idx - 1) * h);
      WHL.velocity = 0;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const active = Math.round(WHL.offset / h);
      if (WHL.videos[active]) whlPlay(WHL.videos[active]);
    }
  });

  // ── Click ──────────────────────────────────────────────────
  ctr.addEventListener("click", e => {
    const item = e.target.closest(".wheel-item");
    if (!item) return;
    const clickedIdx = parseInt(item.dataset.index, 10);
    const centreIdx  = Math.round(WHL.offset / wheelItemH());
    if (Math.abs(clickedIdx - centreIdx) < 0.8) {
      if (WHL.videos[clickedIdx]) whlPlay(WHL.videos[clickedIdx]);
    } else {
      WHL.velocity = 0;
      WHL.target   = clampWhl(clickedIdx * wheelItemH());
    }
  });
}

// ── Animation Loop ────────────────────────────────────────────
let whlLastActive = -1;

function wheelTick() {
  const h = wheelItemH();

  if (!WHL.isDragging) {
    // Target is always already snapped to an item boundary.
    // Lerp offset toward it — stronger pull when close for a magnetic feel.
    const diff = WHL.target - WHL.offset;
    if (Math.abs(diff) > 0.4) {
      const strength = Math.abs(diff) < h * 0.5 ? 0.28 : 0.20;
      WHL.offset += diff * strength;
    } else {
      WHL.offset = WHL.target; // lock in exactly
    }
  } else {
    WHL.offset = WHL.target; // follow finger/cursor directly during drag
  }

  // Position items
  whlPositionItems(h);

  // Detect active index change
  const newIdx = Math.max(0, Math.min(WHL.videos.length - 1, Math.round(WHL.offset / h)));
  if (newIdx !== whlLastActive) {
    whlLastActive = newIdx;
    whlSelectIndex(newIdx, false);
  }

  WHL.raf = requestAnimationFrame(wheelTick);
}

// ── Position items with 3D drum effect ───────────────────────
function whlPositionItems(h) {
  const ctr = q("#wheel-container");
  if (!ctr) return;
  const ctrH  = ctr.offsetHeight;
  const items = qAll(".wheel-item");

  items.forEach((item, i) => {
    const dist    = i * h - WHL.offset;         // px from centre
    const itemTop = ctrH / 2 - h / 2 + dist;   // absolute top in container

    // Cull items far outside viewport
    if (Math.abs(dist) > ctrH * 0.75) {
      item.style.opacity    = "0";
      item.style.visibility = "hidden";
      item.classList.remove("is-active");
      return;
    }
    item.style.visibility = "visible";

    // Normalised distance: -1 = top edge, +1 = bottom edge
    const t = Math.max(-1, Math.min(1, dist / (ctrH * 0.48)));

    const angle   = t * 44;                            // rotateX degrees
    const scale   = Math.max(0.68, 1 - Math.abs(t) * 0.24);
    const opacity = Math.max(0.06, 1 - Math.abs(t) * 0.84);

    item.style.top       = `${itemTop}px`;
    item.style.transform = `rotateX(${angle}deg) scale(${scale})`;
    item.style.opacity   = String(opacity.toFixed(3));

    const isActive = Math.abs(t) < 0.13;
    item.classList.toggle("is-active", isActive);
  });
}

// ── Selection ─────────────────────────────────────────────────
function whlSelectIndex(index, autoplay) {
  if (index < 0 || index >= WHL.videos.length) return;
  const video = WHL.videos[index];
  WHL.activeIndex = index;

  // Update desktop info panel
  whlUpdateInfoPanel(video);

  // Update mobile info bar
  whlUpdateMobileInfo(video);

  if (autoplay) whlPlay(video);
}

function whlUpdateInfoPanel(video) {
  const panel = q("#wheel-player-info");
  const embed = q("#wheel-player-embed");
  if (!panel) return;

  // ── Show thumbnail unless a video is actively playing ──────────
  // If a video element exists but is paused/ended, treat it as idle and replace.
  const existingVid = embed && embed.querySelector("video");
  if (existingVid && existingVid.paused) {
    if (WHL.hlsInst) { WHL.hlsInst.destroy(); WHL.hlsInst = null; }
    embed.innerHTML = "";
  }

  if (embed && !embed.querySelector("video, iframe")) {
    const thumb = video.thumbnail || "";
    embed.innerHTML = thumb
      ? `<div class="wpl-thumb-wrap" role="button" tabindex="0"
              aria-label="Play ${esc(video.title)}"
              style="background-image:url('${esc(thumb)}')">
           <div class="wpl-thumb-overlay" aria-hidden="true"></div>
           <button class="wpl-thumb-play-btn" tabindex="-1" aria-hidden="true">
             <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
               <path d="M8 5v14l11-7z"/>
             </svg>
           </button>
         </div>`
      : `<div class="wheel-player-idle">
           <div class="wheel-idle-icon" aria-hidden="true">
             <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
               <circle cx="12" cy="12" r="10"/>
               <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/>
             </svg>
           </div>
           <p>Select a video to preview</p>
         </div>`;

    // Clicking the thumbnail area plays the video
    const thumbWrap = embed.querySelector(".wpl-thumb-wrap");
    if (thumbWrap) {
      const play = () => whlPlay(video);
      thumbWrap.addEventListener("click", play);
      thumbWrap.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } });
    }
  }

  const d       = parseWheelDate(video.date);
  const dateStr = d ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";
  const durStr  = video.duration_seconds ? formatSeconds(video.duration_seconds) : (video.duration || "");

  panel.innerHTML = `
    <div class="wpi-date">${esc(dateStr)}</div>
    <h2 class="wpi-title">${esc(video.title)}</h2>
    ${video.description ? `<p class="wpi-desc">${esc(video.description)}</p>` : ""}
    <div class="wpi-meta">
      <span class="wpi-playlist-tag">${esc(video.playlist_name || "")}</span>
      ${durStr ? `<span class="wpi-dur">${esc(durStr)}</span>` : ""}
    </div>
    <div class="wpi-actions">
      <button class="wpi-play-btn" id="wpi-play-btn" aria-label="Play ${esc(video.title)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z"/>
        </svg>
        Play Video
      </button>
      <a class="wpi-playlist-link"
         href="playlist.html?id=${encodeURIComponent(video.playlist_id)}&video=${encodeURIComponent(video.id)}">
        View in Playlist
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M7 17L17 7M7 7h10v10"/>
        </svg>
      </a>
    </div>`;

  const playBtn = q("#wpi-play-btn");
  if (playBtn) playBtn.addEventListener("click", () => whlPlay(video));
}

function whlUpdateMobileInfo(video) {
  const el = q("#wheel-mobile-info");
  if (!el) return;

  const d       = parseWheelDate(video.date);
  const dateStr = d ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";

  el.innerHTML = `
    <div class="wmi-inner">
      <div class="wmi-date">${esc(dateStr)}</div>
      <h3 class="wmi-title">${esc(video.title)}</h3>
      ${video.description ? `<p class="wmi-desc">${esc(video.description)}</p>` : ""}
      <div class="wmi-actions">
        <button class="wmi-play-btn" aria-label="Play ${esc(video.title)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z"/>
          </svg>
          Play
        </button>
        <a class="wmi-playlist-link"
           href="playlist.html?id=${encodeURIComponent(video.playlist_id)}&video=${encodeURIComponent(video.id)}">
          View in Playlist →
        </a>
      </div>
    </div>`;

  const btn = el.querySelector(".wmi-play-btn");
  if (btn) btn.addEventListener("click", () => whlPlay(video));
}

// ── Playback ──────────────────────────────────────────────────
function whlPlay(video) {
  WHL.currentVideo = video;
  if (isMobileWheel()) {
    openPlayerScreen(video);
  } else {
    whlLoadPlayer(video, q("#wheel-player-embed"));
  }
}

function whlLoadPlayer(video, container) {
  if (!container) return;

  // Destroy existing HLS
  if (WHL.hlsInst) { WHL.hlsInst.destroy(); WHL.hlsInst = null; }

  const base     = (CONFIG.mediaBaseUrl || "https://tube.tbg2.cloud").replace(/\/$/, "");
  const resolve  = url => url ? (url.startsWith("http") ? url : base + url) : "";
  const hlsUrl   = resolve(video.hls_url);
  const mp4Url   = resolve(video.video_url);
  const embedUrl = resolve(video.embed_url);
  const thumbUrl = resolve(video.thumbnail || "");

  container.innerHTML = "";

  if (!hlsUrl && !mp4Url) {
    if (embedUrl) {
      container.innerHTML = `<iframe src="${esc(embedUrl)}" allowfullscreen
        allow="autoplay; fullscreen; picture-in-picture" frameborder="0"></iframe>`;
    } else {
      container.innerHTML = `<div class="wheel-player-idle"><p>Video not available.</p></div>`;
    }
    return;
  }

  // Build the loading overlay (thumbnail + title + tricolor spinner).
  // It sits on top of the video and fades out the moment playback starts.
  const d       = parseWheelDate(video.date);
  const dateStr = d ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";
  const bgStyle = thumbUrl ? `style="background-image:url('${esc(thumbUrl)}')"` : "";

  // No autoplay attribute — mobile browsers block unmuted autoplay.
  // We call vid.play() explicitly, which is allowed because we're still
  // inside the user-gesture call stack (tap on play button).
  container.innerHTML = `
    <video id="whl-video" controls playsinline preload="metadata"></video>
    <div class="whl-loading-overlay" id="whl-loading-overlay" ${bgStyle}>
      <div class="whl-loading-blur"></div>
      <div class="whl-loading-content">
        ${dateStr ? `<div class="whl-loading-date">${esc(dateStr)}</div>` : ""}
        ${video.title ? `<div class="whl-loading-title">${esc(video.title)}</div>` : ""}
        <div class="whl-loading-spinner-wrap">
          <div class="whl-loading-spinner"></div>
        </div>
      </div>
    </div>`;

  const vid     = container.querySelector("#whl-video");
  const overlay = container.querySelector("#whl-loading-overlay");

  // Fade and remove the overlay once playback actually starts (or on error)
  function removeOverlay() {
    if (!overlay || overlay._removed) return;
    overlay._removed = true;
    overlay.classList.add("whl-loading-overlay--fade");
    setTimeout(() => overlay.remove(), 480);
  }
  vid.addEventListener("playing", removeOverlay, { once: true });
  vid.addEventListener("error",   removeOverlay, { once: true });

  if (hlsUrl && window.Hls && window.Hls.isSupported()) {
    WHL.hlsInst = new window.Hls({ startLevel: -1 });
    WHL.hlsInst.loadSource(hlsUrl);
    WHL.hlsInst.attachMedia(vid);
    // MANIFEST_PARSED fires async — by then the gesture chain is broken on
    // some mobile browsers, so we also try an early play() here (hls.js
    // queues it internally until enough data is buffered).
    vid.play().catch(() => {});
    WHL.hlsInst.on(window.Hls.Events.MANIFEST_PARSED, () => {
      vid.play().catch(() => {});
    });
    return;
  }
  if (hlsUrl && vid.canPlayType("application/vnd.apple.mpegurl")) {
    // iOS Safari — native HLS; play() here is within the gesture stack.
    vid.src = hlsUrl;
    vid.play().catch(() => {});
    return;
  }
  if (mp4Url) {
    vid.src = mp4Url;
    vid.play().catch(() => {});
  }
}

// ── Mobile player screen (virtual page via History API) ───────
function openPlayerScreen(video) {
  const screen  = q("#whl-player-screen");
  const embedEl = q("#whl-ps-embed");
  const infoEl  = q("#whl-ps-info");
  if (!screen) return;

  whlLoadPlayer(video, embedEl);

  if (infoEl) {
    const d       = parseWheelDate(video.date);
    const dateStr = d ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";
    infoEl.innerHTML = `
      <div class="wps-date">${esc(dateStr)}</div>
      <h3 class="wps-title">${esc(video.title)}</h3>
      ${video.description ? `<p class="wps-desc">${esc(video.description)}</p>` : ""}
      <a class="wps-playlist-link"
         href="playlist.html?id=${encodeURIComponent(video.playlist_id)}&video=${encodeURIComponent(video.id)}">
        View in Playlist →
      </a>`;
  }

  screen.classList.add("is-open");
  screen.removeAttribute("aria-hidden");

  // Push a history entry so the browser back button closes the player
  history.pushState({ whlPlay: video.id }, "", "?play=" + encodeURIComponent(video.id));

  whlStartLandscapeWatcher();
}

function closePlayerScreen() {
  const screen  = q("#whl-player-screen");
  const embedEl = q("#whl-ps-embed");
  if (!screen) return;

  whlStopLandscapeWatcher();

  screen.classList.remove("is-open");
  screen.setAttribute("aria-hidden", "true");

  if (WHL.hlsInst) { WHL.hlsInst.destroy(); WHL.hlsInst = null; }
  if (embedEl) embedEl.innerHTML = "";
  WHL.currentVideo = null;
}

// ── Landscape → auto-fullscreen while player is open ──────────
function whlStartLandscapeWatcher() {
  window.addEventListener("resize", whlLandscapeCheck);
}
function whlStopLandscapeWatcher() {
  window.removeEventListener("resize", whlLandscapeCheck);
}
function whlLandscapeCheck() {
  const screen = q("#whl-player-screen");
  if (!screen || !screen.classList.contains("is-open")) return;
  const vid = screen.querySelector("video");
  if (!vid) return;
  const isLandscape = window.innerWidth > window.innerHeight;
  if (!isLandscape) return;
  // Already in fullscreen?
  if (document.fullscreenElement || vid.webkitDisplayingFullscreen) return;
  // Android / Chrome / Firefox
  if (vid.requestFullscreen) { vid.requestFullscreen().catch(() => {}); return; }
  // iOS Safari
  if (vid.webkitEnterFullscreen) vid.webkitEnterFullscreen();
}
