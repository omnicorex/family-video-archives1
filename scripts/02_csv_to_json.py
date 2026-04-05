#!/usr/bin/env python3
"""
Script 02 — Videos (CSV or JSON) → playlists.json for the Website
==================================================================
Reads your edited data file and produces site/data/playlists.json
which the website uses to build playlist pages.

Accepts either format — whichever exists in data/:
  • data/videos.json   (flat array exported from Excel/Sheets)   ← checked first
  • data/videos.csv    (CSV with the standard columns)

Usage:
    python scripts/02_csv_to_json.py

Output:
    site/data/playlists.json
"""

import csv
import json
import os
import re
import sys
from datetime import datetime

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_INPUT     = os.path.join(BASE_DIR, "data", "videos.json")
CSV_INPUT      = os.path.join(BASE_DIR, "data", "videos.csv")
OUTPUT_FILE    = os.path.join(BASE_DIR, "site", "data", "playlists.json")

# ── Helpers ────────────────────────────────────────────────────────────────────

def slugify(text):
    text = str(text).lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text or "untitled"


def seconds_to_display(raw):
    """Int seconds → M:SS or H:MM:SS display string."""
    try:
        secs = int(float(str(raw).strip()))
    except (ValueError, TypeError):
        return ""
    if secs <= 0:
        return ""
    h = secs // 3600
    m = (secs % 3600) // 60
    s = secs % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def safe_int(val, default=9999):
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return default


def normalise_date(raw):
    """
    Accept multiple date formats and normalise to yyyy-mm-dd.
    Handles: yyyy-mm-dd, M/D/YYYY, MM/DD/YYYY, blank.
    """
    if not raw:
        return ""
    raw = str(raw).strip()
    if not raw:
        return ""
    # Already yyyy-mm-dd
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw
    # M/D/YYYY or MM/DD/YYYY
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", raw)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    # Partial — just return as-is so nothing is lost
    return raw


def row_to_video(row):
    """
    Convert a dict (from either JSON or CSV row) to a normalised video dict.
    Returns None if the row has no usable video ID.
    """
    video_id = str(row.get("id") or "").strip()
    if not video_id:
        return None

    description = (
        str(row.get("custom_description") or "").strip()
        or str(row.get("original_description") or "").strip()
        or str(row.get("description") or "").strip()
    )

    return {
        "id":          video_id,
        "title":       str(row.get("title") or "Untitled").strip(),
        "date":        normalise_date(row.get("date")),
        "url":         str(row.get("url") or "").strip(),
        "hls_url":     str(row.get("hls_url") or "").strip(),
        "video_url":   str(row.get("video_url") or "").strip(),
        "thumbnail":   str(row.get("thumbnail") or "").strip(),
        "duration":    seconds_to_display(row.get("duration_seconds")),
        "date_added":  normalise_date(row.get("date_added")),
        "description": description,
        "_order":      safe_int(row.get("order")),
        "_playlist":   str(row.get("playlist") or "").strip() or "Ungrouped",
    }


# ── Readers ────────────────────────────────────────────────────────────────────

def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        print(f"Error: {path} must contain a JSON array at the top level.")
        sys.exit(1)
    return data


def read_csv(path):
    with open(path, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    # Prefer JSON input, fall back to CSV
    if os.path.exists(JSON_INPUT):
        print(f"Reading {JSON_INPUT} …")
        raw_rows = read_json(JSON_INPUT)
        source   = JSON_INPUT
    elif os.path.exists(CSV_INPUT):
        print(f"Reading {CSV_INPUT} …")
        raw_rows = read_csv(CSV_INPUT)
        source   = CSV_INPUT
    else:
        print("Error: no input file found. Expected one of:")
        print(f"  {JSON_INPUT}")
        print(f"  {CSV_INPUT}")
        sys.exit(1)

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    # Normalise all rows and group by playlist
    buckets = {}   # playlist_name → [video, …]
    skipped = 0

    for raw in raw_rows:
        video = row_to_video(raw)
        if video is None:
            skipped += 1
            continue
        name = video.pop("_playlist")
        buckets.setdefault(name, []).append(video)

    if not buckets:
        print("No videos found in the input file.")
        sys.exit(1)

    # Build playlist objects
    playlists = []
    for name, videos in buckets.items():
        videos_sorted = sorted(videos, key=lambda v: (v["_order"], v["title"]))
        for v in videos_sorted:
            del v["_order"]

        thumb = next((v["thumbnail"] for v in videos_sorted if v["thumbnail"]), "")

        playlists.append({
            "id":          slugify(name),
            "name":        name,
            "description": "",
            "thumbnail":   thumb,
            "video_count": len(videos_sorted),
            "videos":      videos_sorted,
        })

    # Sort: alphabetical, Ungrouped always last
    playlists.sort(key=lambda p: (p["name"] == "Ungrouped", p["name"].lower()))

    total_videos    = sum(p["video_count"] for p in playlists)
    total_playlists = len(playlists)

    output = {
        "meta": {
            "last_updated":    datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "total_videos":    total_videos,
            "total_playlists": total_playlists,
            "source":          os.path.basename(source),
        },
        "playlists": playlists,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Done!  {total_playlists} playlist(s), {total_videos} video(s).")
    print(f"Saved: {OUTPUT_FILE}")
    if skipped:
        print(f"Skipped {skipped} row(s) with no video ID.")
    print()
    print("Playlists:")
    for p in playlists:
        marker = "  [ungrouped]" if p["name"] == "Ungrouped" else ""
        print(f"  {p['name']:<42} {p['video_count']:>3} video(s){marker}")
    print()
    print("Tip: add descriptions in site/branding/config.json under 'playlist_descriptions'.")


if __name__ == "__main__":
    main()
