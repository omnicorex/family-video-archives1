#!/usr/bin/env python3
"""
Script 05 — Grist → playlists.json for the Website
====================================================
Reads your curated Grist table and produces site/data/playlists.json —
the file the website uses to render playlists and video pages.

Field priority:
  title       → custom_title  if set, else title
  description → custom_description  if set, else description

Videos are grouped by the 'playlist' column.
Videos with no playlist assigned go into an "Ungrouped" playlist.

Video URLs are constructed from media_id — they do not need to be stored
in Grist:
  Watch URL:  https://tube.tbg2.cloud/view?m={media_id}
  Embed URL:  https://tube.tbg2.cloud/embed/{media_id}/

A backup of the existing playlists.json is saved to data/backups/ first.

Usage:
    python scripts/05_grist_to_json.py
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime

# ── Configuration ──────────────────────────────────────────────────────────────
GRIST_URL      = "https://sheets.tbg2.cloud"
GRIST_API_KEY  = os.environ.get("GRIST_API_KEY", "116a9a5168d500eb44d787de5179337f9744766b")
GRIST_DOC_ID   = "1pEArZCQEChq"
GRIST_TABLE_ID = "Table1"

MEDIACMS_URL = "https://tube.tbg2.cloud"  # for constructing video URLs

BASE_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(BASE_DIR, "data", "backups")
OUTPUT     = os.path.join(BASE_DIR, "site", "data", "playlists.json")


# ── Grist API helper ───────────────────────────────────────────────────────────

def grist_get(path):
    url = f"{GRIST_URL}/api/{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {GRIST_API_KEY}",
        "Accept":        "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  Grist API error: HTTP {e.code} - {body[:400]}")
        sys.exit(1)


# ── Helpers ────────────────────────────────────────────────────────────────────

def slugify(text):
    text = str(text).lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text or "untitled"


def normalise_date(raw):
    """Accept yyyy-mm-dd, M/D/YYYY, yyyy-mm, or bare yyyy.  Return as-is if unrecognised."""
    if not raw:
        return ""
    raw = str(raw).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", raw)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return raw  # yyyy-mm or yyyy passed through unchanged


def backup_existing_json():
    """Copy the current playlists.json to a timestamped backup."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(BACKUP_DIR, f"playlists_{ts}.json")
    if os.path.exists(OUTPUT):
        with open(OUTPUT, "r", encoding="utf-8") as src:
            content = src.read()
        with open(path, "w", encoding="utf-8") as dst:
            dst.write(content)
        return path
    return None


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("=== Script 05 - Grist -> playlists.json ===\n")

    # Fetch records from Grist
    print("Fetching Grist records …")
    data    = grist_get(f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/records")
    records = data.get("records", [])
    print(f"  {len(records)} record(s) fetched.\n")

    if not records:
        print("No records found in Grist.  Run 03_grist_sync.py first.")
        sys.exit(1)

    # Backup existing output
    bak = backup_existing_json()
    if bak:
        print(f"Backed up existing playlists.json -> {bak}\n")

    # Build video objects grouped by playlist
    buckets = {}   # playlist_name → [video_dict, ...]
    skipped = 0

    for rec in records:
        f = rec["fields"]

        media_id = str(f.get("media_id") or "").strip()
        if not media_id:
            skipped += 1
            continue

        # Merge: prefer custom fields, fall back to synced MediaCMS fields
        title = (
            str(f.get("custom_title") or "").strip()
            or str(f.get("title") or "Untitled").strip()
        )
        description = (
            str(f.get("custom_description") or "").strip()
            or str(f.get("description") or "").strip()
        )
        playlist_name = str(f.get("playlist") or "").strip() or "Ungrouped"

        try:
            sort_order = int(f.get("order") or 0)
        except (ValueError, TypeError):
            sort_order = 0

        video = {
            "id":          media_id,
            "title":       title,
            "date":        normalise_date(f.get("date")),
            "url":         f"{MEDIACMS_URL}/view?m={media_id}",
            "hls_url":     str(f.get("hls_url") or "").strip(),
            "thumbnail":   str(f.get("thumbnail_url") or "").strip(),
            "description": description,
            "_order":      sort_order,
        }

        buckets.setdefault(playlist_name, []).append(video)

    if not buckets:
        print("No usable records (all rows were missing media_id).")
        sys.exit(1)

    # Build playlist objects
    playlists = []
    for name, videos in buckets.items():
        videos.sort(key=lambda v: (v["_order"] == 0, v["_order"], v["title"]))
        for v in videos:
            del v["_order"]
        thumb = next((v["thumbnail"] for v in videos if v["thumbnail"]), "")
        playlists.append({
            "id":          slugify(name),
            "name":        name,
            "description": "",
            "thumbnail":   thumb,
            "video_count": len(videos),
            "videos":      videos,
        })

    # Sort: alphabetical, "Ungrouped" always last
    playlists.sort(key=lambda p: (p["name"] == "Ungrouped", p["name"].lower()))

    total_videos    = sum(p["video_count"] for p in playlists)
    total_playlists = len(playlists)

    output = {
        "meta": {
            "last_updated":    datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "total_videos":    total_videos,
            "total_playlists": total_playlists,
            "source":          "grist",
        },
        "playlists": playlists,
    }

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Done!  {total_playlists} playlist(s), {total_videos} video(s).")
    print(f"Saved: {OUTPUT}")
    if skipped:
        print(f"Skipped {skipped} row(s) with no media_id.")
    print()
    print("Playlists:")
    for p in playlists:
        marker = "  [ungrouped]" if p["name"] == "Ungrouped" else ""
        print(f"  {p['name']:<44} {p['video_count']:>3} video(s){marker}")


if __name__ == "__main__":
    main()
