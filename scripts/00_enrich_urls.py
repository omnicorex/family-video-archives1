#!/usr/bin/env python3
"""
Script 00 — Enrich videos.json with real playback URLs
=======================================================
Reads data/videos.json, authenticates with MediaCMS, fetches the
detail API for each video, and adds two new fields:

  hls_url   — HLS master playlist (best for streaming, all browsers via hls.js)
  video_url  — Best quality direct MP4 (fallback if HLS unavailable)

Run this ONCE after you have your videos.json ready, then re-run
script 02 to regenerate playlists.json.

Usage:
    python scripts/00_enrich_urls.py
"""

import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ── Config ─────────────────────────────────────────────────────────────────────
MEDIACMS_URL = "https://tube.tbg2.cloud"
USERNAME      = "family"

BASE_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_FILE  = os.path.join(BASE_DIR, "data", "videos.json")

# Preferred resolution order (highest first)
RESOLUTION_PREFERENCE = [2160, 1440, 1080, 720, 480, 360, 240, 144]

# ── Auth ───────────────────────────────────────────────────────────────────────

def get_token(password):
    url  = f"{MEDIACMS_URL}/api/v1/login"
    body = urllib.parse.urlencode({"username": USERNAME, "password": password}).encode()
    req  = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept":       "application/json",
        "User-Agent":   "FamilyArchivesBot/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            token = data.get("token")
            if not token:
                print(f"  Unexpected login response: {data}")
                sys.exit(1)
            return token
    except urllib.error.HTTPError as e:
        print(f"  Login failed (HTTP {e.code}): {e.read().decode()[:200]}")
        sys.exit(1)


def fetch_json(url, token):
    req = urllib.request.Request(url, headers={
        "Accept":        "application/json",
        "Authorization": f"Token {token}",
        "User-Agent":    "FamilyArchivesBot/1.0",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ── URL extraction ─────────────────────────────────────────────────────────────

def make_absolute(path):
    """Prepend base URL to relative paths."""
    if not path:
        return ""
    if path.startswith("http"):
        return path
    return MEDIACMS_URL + path


def best_mp4(encodings_info):
    """Return the highest-quality successful MP4 URL."""
    for res in RESOLUTION_PREFERENCE:
        res_data = encodings_info.get(str(res), {})
        for codec_data in res_data.values():
            if isinstance(codec_data, dict):
                if codec_data.get("status") == "success":
                    url = codec_data.get("url", "")
                    if url:
                        return make_absolute(url)
    return ""


def hls_master(hls_info):
    """Return the HLS master playlist URL."""
    master = hls_info.get("master_file", "")
    return make_absolute(master) if master else ""


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    if not os.path.exists(JSON_FILE):
        print(f"Error: {JSON_FILE} not found.")
        print("Run script 01 first:  python scripts/01_fetch_videos.py")
        sys.exit(1)

    with open(JSON_FILE, "r", encoding="utf-8") as f:
        videos = json.load(f)

    if not isinstance(videos, list):
        print("Error: videos.json must be a JSON array.")
        sys.exit(1)

    # Skip videos that already have URLs populated
    to_enrich = [v for v in videos if not v.get("hls_url") and not v.get("video_url")]
    already   = len(videos) - len(to_enrich)

    if already:
        print(f"{already} video(s) already have URLs — skipping those.")

    if not to_enrich:
        print("All videos already enriched. Nothing to do.")
        print("Run script 02:  python scripts/02_csv_to_json.py")
        return

    print(f"Authenticating as '{USERNAME}' …")
    password = getpass.getpass(f"  Password for '{USERNAME}': ")
    token    = get_token(password)
    print(f"  Authenticated. Enriching {len(to_enrich)} video(s)…\n")

    success = 0
    failed  = 0

    for i, video in enumerate(to_enrich, 1):
        vid_id = video.get("id", "")
        title  = video.get("title", vid_id)

        if not vid_id:
            print(f"  [{i}/{len(to_enrich)}] Skipping — no ID")
            continue

        url = f"{MEDIACMS_URL}/api/v1/media/{vid_id}"
        try:
            detail = fetch_json(url, token)
        except Exception as e:
            print(f"  [{i}/{len(to_enrich)}] FAILED  {title[:50]}  ({e})")
            failed += 1
            time.sleep(0.5)
            continue

        hls  = hls_master(detail.get("hls_info", {}))
        mp4  = best_mp4(detail.get("encodings_info", {}))

        video["hls_url"]   = hls
        video["video_url"] = mp4

        status = "HLS+MP4" if (hls and mp4) else ("HLS" if hls else ("MP4" if mp4 else "NO URL"))
        print(f"  [{i}/{len(to_enrich)}] {status:<8} {title[:60]}")
        success += 1

        # Be polite to the server
        if i % 10 == 0:
            time.sleep(0.5)

    # Write enriched data back
    with open(JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(videos, f, indent=4, ensure_ascii=False)

    print(f"\nDone! Enriched {success} video(s). {failed} failed.")
    print(f"Updated: {JSON_FILE}")
    print()
    print("Now re-run script 02 to rebuild playlists.json:")
    print("  python scripts/02_csv_to_json.py")


if __name__ == "__main__":
    main()
