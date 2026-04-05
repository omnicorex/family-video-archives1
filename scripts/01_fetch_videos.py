#!/usr/bin/env python3
"""
Script 01 — Fetch Videos from MediaCMS (including unlisted)
============================================================
Logs in with your credentials, fetches ALL video metadata for the
configured user (public + unlisted), and saves to data/videos.csv.

Usage:
    python scripts/01_fetch_videos.py

You will be prompted for your MediaCMS password at runtime.
Your password is never stored anywhere.

Output:
    data/videos.csv  (open in Excel/Sheets and fill in the playlist columns)
"""

import csv
import getpass
import json
import urllib.request
import urllib.parse
import os
import sys

# ── Configuration ──────────────────────────────────────────────────────────────
MEDIACMS_URL = "https://tube.tbg2.cloud"
USERNAME      = "family"   # MediaCMS username (exact, case-sensitive)
PAGE_SIZE     = 100        # Max results per page

BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(BASE_DIR, "data", "videos.csv")

CSV_FIELDS = [
    # ── You fill these in manually ───────────────
    "title",
    "date",                # Date of the event, format yyyy-mm-dd (you fill this in)
    "playlist",            # Group/playlist name, e.g. "Christmas Memories"
    "order",               # Sort order within playlist: 1, 2, 3 …
    "custom_description",  # Your description (overrides original if set)
    # ── Auto-filled by the script ────────────────
    "id",
    "url",
    "embed_url",
    "thumbnail",
    "duration_seconds",
    "date_added",
    "original_description",
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def get_token(password):
    """POST form-encoded credentials to /api/v1/login, returns auth token."""
    url  = f"{MEDIACMS_URL}/api/v1/login"
    body = urllib.parse.urlencode({"username": USERNAME, "password": password}).encode()
    req  = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept":       "application/json",
        "User-Agent":   "FamilyArchivesBot/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data  = json.loads(resp.read().decode("utf-8"))
            token = data.get("token")
            if not token:
                print(f"  Unexpected login response: {data}")
                sys.exit(1)
            return token
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  Login failed (HTTP {e.code}): {body[:300]}")
        sys.exit(1)


def fetch_json(url, token):
    req = urllib.request.Request(url, headers={
        "Accept":        "application/json",
        "User-Agent":    "FamilyArchivesBot/1.0",
        "Authorization": f"Token {token}",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def duration_to_seconds(val):
    """Convert MediaCMS duration (int seconds, or HH:MM:SS string) → int."""
    if not val:
        return 0
    try:
        s = str(val).strip()
        if ":" in s:
            parts = [float(p) for p in s.split(":")]
            if len(parts) == 3:
                return int(parts[0] * 3600 + parts[1] * 60 + parts[2])
            if len(parts) == 2:
                return int(parts[0] * 60 + parts[1])
        return int(float(s))
    except (ValueError, TypeError):
        return 0


def build_embed_url(token):
    return f"{MEDIACMS_URL}/embed/{token}/"


def build_view_url(token):
    return f"{MEDIACMS_URL}/view?m={token}"


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    # ── Authenticate ──────────────────────────────────────────────────────────
    print(f"Connecting to {MEDIACMS_URL} as '{USERNAME}' …")
    password = getpass.getpass(f"  Password for '{USERNAME}': ")
    auth_token = get_token(password)
    print("  Authenticated.\n")

    # ── Fetch all pages ───────────────────────────────────────────────────────
    all_videos     = []
    page           = 1
    total_expected = None

    while True:
        params = urllib.parse.urlencode({
            "author":    USERNAME,
            "page":      page,
            "page_size": PAGE_SIZE,
        })
        url = f"{MEDIACMS_URL}/api/v1/media/?{params}"

        try:
            data = fetch_json(url, auth_token)
        except Exception as e:
            print(f"  Error fetching page {page}: {e}")
            sys.exit(1)

        results = data.get("results", [])

        if total_expected is None:
            total_expected = data.get("count", "?")
            print(f"  Total videos reported by API: {total_expected}")

        if not results:
            break

        print(f"  Page {page}: {len(results)} video(s) …")

        skipped = 0
        for item in results:
            # Client-side safety filter — only this user's videos
            if item.get("user", "").lower() != USERNAME.lower():
                skipped += 1
                continue

            tok      = item.get("friendly_token", "")
            raw_url  = item.get("url", "")
            view_url = raw_url or build_view_url(tok)
            if view_url.startswith("/"):
                view_url = MEDIACMS_URL + view_url

            thumb = item.get("thumbnail_url", "") or item.get("poster_url", "")
            if thumb and thumb.startswith("/"):
                thumb = MEDIACMS_URL + thumb

            raw_desc = (item.get("description") or "").replace("\r", "").replace("\n", " ").strip()

            all_videos.append({
                "id":                   tok,
                "title":                item.get("title", "Untitled"),
                "date":                 "",
                "url":                  view_url,
                "embed_url":            build_embed_url(tok),
                "thumbnail":            thumb,
                "duration_seconds":     duration_to_seconds(item.get("duration", 0)),
                "date_added":           (item.get("add_date") or "")[:10],
                "original_description": raw_desc,
                "playlist":             "",
                "order":                "",
                "custom_description":   "",
            })

        if skipped:
            print(f"    (skipped {skipped} video(s) from other users)")

        next_url = data.get("next")
        if not next_url:
            break
        page += 1

    # ── Write CSV ─────────────────────────────────────────────────────────────
    if not all_videos:
        print("\nNo videos found after authentication.")
        print("Check that the username and password are correct.")
        sys.exit(1)

    # Sort: oldest first (easier to assign order numbers chronologically)
    all_videos.sort(key=lambda v: v["date_added"])

    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(all_videos)

    print(f"\nDone! Fetched {len(all_videos)} videos.")
    print(f"Saved to: {OUTPUT_FILE}")
    print()
    print("Next steps:")
    print("  1. Open  data/videos.csv  in Excel or Google Sheets")
    print("  2. For each video, fill in:")
    print("       playlist           — group name, e.g. 'Christmas 1990s'")
    print("       order              — sort order within playlist (1, 2, 3 …)")
    print("       custom_description — your description (leave blank to use original)")
    print("  3. Save the CSV, then run:  python scripts/02_csv_to_json.py")


if __name__ == "__main__":
    main()
