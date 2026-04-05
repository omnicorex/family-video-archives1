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

  if (PAGE === "index")    initHomePage();
  if (PAGE === "playlist") initPlaylistPage();

  initHeroVideoFade();
  initFooter();

  // Footer year
  const fy = document.getElementById("footer-year");
  if (fy) fy.textContent = new Date().getFullYear();
}

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

  // Section count
  const count = DATA.playlists?.length ?? 0;
  setInner("section-count", count ? `${count} collection${count !== 1 ? "s" : ""}` : "");

  // Render grid
  renderPlaylists(DATA.playlists || []);
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
        <p>Run the scripts to fetch your videos from MediaCMS, edit the CSV, then generate the JSON.</p>
        <code>python scripts/01_fetch_videos.py</code>
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
  loadVideo(playlist.videos[0], 0);
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

    const dateHtml = video.date_added
      ? `<div class="video-item-date">${formatDate(video.date_added)}</div>`
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

function loadVideo(video, index) {
  const wrap     = q("#player-embed");
  const titleEl  = q("#player-title");
  const descEl   = q("#player-desc");

  // ── Title / description ───────────────────────────────────────
  if (titleEl) titleEl.textContent = video.title || "";
  if (descEl) {
    if (video.description) { descEl.textContent = video.description; descEl.style.display = ""; }
    else                    { descEl.style.display = "none"; }
  }

  // ── Mark active in list ───────────────────────────────────────
  qAll(".video-item").forEach((item, i) => item.classList.toggle("active", i === index));

  if (!wrap) return;

  // ── Resolve relative URLs ─────────────────────────────────────
  const base    = (CONFIG.mediaBaseUrl || "https://tube.tbg2.cloud").replace(/\/$/, "");
  const resolve = url => url ? (url.startsWith("http") ? url : base + url) : "";
  const hlsUrl  = resolve(video.hls_url);
  const mp4Url  = resolve(video.video_url);

  // ── Destroy previous HLS instance ────────────────────────────
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

  // ── No URLs yet — show hint ───────────────────────────────────
  if (!hlsUrl && !mp4Url) {
    wrap.innerHTML = `
      <div class="player-no-url">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Video URL not available.</p>
        <code>python scripts/00_enrich_urls.py</code>
      </div>`;
    return;
  }

  // Ensure a clean video element exists
  if (!q("#video-player")) {
    wrap.innerHTML = `<video id="video-player" controls playsinline preload="metadata"></video>`;
  }
  const vid = q("#video-player");

  // ── HLS via hls.js (Chrome, Firefox, Edge) ────────────────────
  if (hlsUrl && window.Hls && window.Hls.isSupported()) {
    hlsInstance = new window.Hls({ startLevel: -1 });
    hlsInstance.loadSource(hlsUrl);
    hlsInstance.attachMedia(vid);
    return;
  }

  // ── Native HLS — Safari ───────────────────────────────────────
  if (hlsUrl && vid.canPlayType("application/vnd.apple.mpegurl")) {
    vid.src = hlsUrl;
    return;
  }

  // ── Direct MP4 fallback ───────────────────────────────────────
  if (mp4Url) { vid.src = mp4Url; }
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
  const footer = document.querySelector("footer");
  if (!footer) return;

  // Trigger the tricolor scaleX reveal when footer enters viewport
  const obs = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) {
      footer.classList.add("in-view");
      obs.disconnect();
    }
  }, { threshold: 0.08 });

  obs.observe(footer);
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
