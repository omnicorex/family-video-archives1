#!/usr/bin/env python3
"""
Script 03 — Sync MediaCMS metadata → Grist
===========================================
Fetches id, title, description, thumbnail_url, hls_url from MediaCMS and writes
them to your Grist table.  Only those fields are ever written; your custom
fields (date, playlist, custom_title, custom_description, suggested_date)
are NEVER overwritten.

On first run this script also creates all required columns in Grist.

Backups are saved to data/backups/ before any writes:
  • grist_YYYYMMDD_HHMMSS.csv   — snapshot of the Grist table
  • playlists_YYYYMMDD_HHMMSS.json — snapshot of site/data/playlists.json

Usage:
    python scripts/03_grist_sync.py
"""

import csv
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

# ── Configuration ──────────────────────────────────────────────────────────────
MEDIACMS_URL  = "https://tube.tbg2.cloud"
MEDIACMS_USER = "family"
PAGE_SIZE     = 100

GRIST_URL      = "https://sheets.tbg2.cloud"
GRIST_API_KEY  = os.environ.get("GRIST_API_KEY", "116a9a5168d500eb44d787de5179337f9744766b")
GRIST_DOC_ID   = "1pEArZCQEChq"
GRIST_TABLE_ID = "Table1"   # Grist internal table ID — visible in the URL when
                             # the table tab is selected in the Grist UI.
                             # If you rename the table, update this value.

BASE_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(BASE_DIR, "data", "backups")
SITE_JSON  = os.path.join(BASE_DIR, "site", "data", "playlists.json")

BATCH_SIZE = 100  # records per Grist API call

# Columns written/updated by this script (synced from MediaCMS)
SYNC_COLS = ["title", "description", "thumbnail_url", "hls_url"]

# All columns this script creates on first run (custom cols are never overwritten)
ALL_COLUMNS = [
    ("media_id",           "Text"),   # MediaCMS friendly_token — master key
    ("title",              "Text"),   # synced from MediaCMS
    ("description",        "Text"),   # synced from MediaCMS
    ("thumbnail_url",      "Text"),   # synced from MediaCMS
    ("hls_url",            "Text"),   # synced from MediaCMS — HLS stream URL for playback
    ("date",               "Text"),   # YOUR custom field — manually edited
    ("playlist",           "Text"),   # YOUR custom field — manually edited
    ("order",              "Int"),    # YOUR custom field — sort order within playlist
    ("custom_title",       "Text"),   # YOUR custom field — manually edited
    ("custom_description", "Text"),   # YOUR custom field — manually edited
    ("suggested_date",     "Text"),   # written by 04_extract_dates.py
]


# ── Grist API helpers ──────────────────────────────────────────────────────────

def _grist_request(method, path, body=None):
    url  = f"{GRIST_URL}/api/{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "Authorization": f"Bearer {GRIST_API_KEY}",
        "Accept":        "application/json",
    }
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        print(f"  Grist API error ({method} /{path}): HTTP {e.code}")
        print(f"  {body_text[:400]}")
        sys.exit(1)


def grist_get(path):
    return _grist_request("GET", path)

def grist_post(path, body):
    return _grist_request("POST", path, body)

def grist_patch(path, body):
    return _grist_request("PATCH", path, body)


# ── Column setup ───────────────────────────────────────────────────────────────

def ensure_columns():
    """Create any missing columns in the Grist table (idempotent)."""
    existing     = grist_get(f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/columns")
    existing_ids = {col["id"] for col in existing["columns"]}

    to_create = [
        {"id": col_id, "fields": {"label": col_id, "type": col_type}}
        for col_id, col_type in ALL_COLUMNS
        if col_id not in existing_ids
    ]

    if to_create:
        grist_post(
            f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/columns",
            {"columns": to_create},
        )
        print(f"  Created columns: {[c['id'] for c in to_create]}")
    else:
        print("  All required columns already exist.")


# ── Grist record helpers ───────────────────────────────────────────────────────

def fetch_grist_records():
    """Returns dict:  media_id → {'row_id': int, 'fields': dict}"""
    data   = grist_get(f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/records")
    result = {}
    for rec in data.get("records", []):
        mid = str(rec["fields"].get("media_id") or "").strip()
        if mid:
            result[mid] = {"row_id": rec["id"], "fields": rec["fields"]}
    return result


def backup_grist_csv(records):
    """Write current Grist records to a timestamped CSV file."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(BACKUP_DIR, f"grist_{ts}.csv")

    if not records:
        with open(path, "w", newline="", encoding="utf-8") as f:
            f.write("(table is empty)\n")
        return path

    all_fields = sorted({k for rec in records.values() for k in rec["fields"]})
    fieldnames = ["grist_row_id"] + all_fields

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for rec in records.values():
            row = {"grist_row_id": rec["row_id"]}
            row.update(rec["fields"])
            writer.writerow(row)

    return path


def backup_site_json():
    """Copy site/data/playlists.json to a timestamped backup file."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(BACKUP_DIR, f"playlists_{ts}.json")

    if os.path.exists(SITE_JSON):
        with open(SITE_JSON, "r", encoding="utf-8") as src:
            content = src.read()
        with open(path, "w", encoding="utf-8") as dst:
            dst.write(content)
    else:
        with open(path, "w", encoding="utf-8") as f:
            f.write("(no existing playlists.json)\n")

    return path


# ── MediaCMS helpers ───────────────────────────────────────────────────────────

def mediacms_login(password):
    url  = f"{MEDIACMS_URL}/api/v1/login"
    body = urllib.parse.urlencode(
        {"username": MEDIACMS_USER, "password": password}
    ).encode()
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
        print(f"  Login failed (HTTP {e.code}): {e.read().decode()[:300]}")
        sys.exit(1)


def fetch_hls_url(auth_token, friendly_token):
    """Fetch the HLS master playlist URL for a single video."""
    url = f"{MEDIACMS_URL}/api/v1/media/{friendly_token}"
    req = urllib.request.Request(url, headers={
        "Accept":        "application/json",
        "User-Agent":    "FamilyArchivesBot/1.0",
        "Authorization": f"Token {auth_token}",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            detail = json.loads(resp.read().decode("utf-8"))
        master = detail.get("hls_info", {}).get("master_file", "")
        if master:
            return MEDIACMS_URL + master if master.startswith("/") else master
    except Exception:
        pass
    return ""


def fetch_mediacms_videos(auth_token):
    """Return list of {id, title, description, thumbnail_url, hls_url} for all videos."""
    videos = []
    page   = 1

    while True:
        params = urllib.parse.urlencode({
            "author":    MEDIACMS_USER,
            "page":      page,
            "page_size": PAGE_SIZE,
        })
        url = f"{MEDIACMS_URL}/api/v1/media/?{params}"
        req = urllib.request.Request(url, headers={
            "Accept":        "application/json",
            "User-Agent":    "FamilyArchivesBot/1.0",
            "Authorization": f"Token {auth_token}",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"  Error fetching page {page}: {e}")
            sys.exit(1)

        results = data.get("results", [])
        if not results:
            break

        if page == 1:
            total = data.get('count', '?')
            print(f"  API reports {total} total video(s). Fetching HLS URLs …")

        print(f"  Page {page}: {len(results)} video(s) …")

        for item in results:
            if item.get("user", "").lower() != MEDIACMS_USER.lower():
                continue
            tok   = item.get("friendly_token", "")
            thumb = item.get("thumbnail_url", "") or item.get("poster_url", "")
            if thumb and thumb.startswith("/"):
                thumb = MEDIACMS_URL + thumb
            desc = (item.get("description") or "").replace("\r", "").replace("\n", " ").strip()
            hls  = fetch_hls_url(auth_token, tok)
            videos.append({
                "id":            tok,
                "title":         item.get("title", "Untitled"),
                "description":   desc,
                "thumbnail_url": thumb,
                "hls_url":       hls,
            })

        if not data.get("next"):
            break
        page += 1

    return videos


# ── Utility ────────────────────────────────────────────────────────────────────

def batched(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i : i + n]


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("=== Script 03 - Sync MediaCMS -> Grist ===\n")

    # 1. Authenticate with MediaCMS
    print(f"Connecting to MediaCMS ({MEDIACMS_URL}) …")
    password   = getpass.getpass(f"  Password for '{MEDIACMS_USER}': ")
    auth_token = mediacms_login(password)
    print("  Authenticated.\n")

    # 2. Fetch MediaCMS videos
    print("Fetching videos from MediaCMS …")
    mediacms_videos = fetch_mediacms_videos(auth_token)
    print(f"  {len(mediacms_videos)} video(s) fetched.\n")

    if not mediacms_videos:
        print("No videos found. Check username/password.")
        sys.exit(1)

    # 3. Ensure Grist columns exist
    print("Checking Grist columns …")
    ensure_columns()
    print()

    # 4. Fetch current Grist records
    print("Fetching current Grist records …")
    grist_records = fetch_grist_records()
    print(f"  {len(grist_records)} record(s) currently in Grist.\n")

    # 5. Backups (before any writes)
    print("Creating backups …")
    csv_path  = backup_grist_csv(grist_records)
    json_path = backup_site_json()
    print(f"  Grist CSV  : {csv_path}")
    print(f"  Site JSON  : {json_path}\n")

    # 6. Diff MediaCMS vs Grist
    to_add    = []
    to_update = []

    for video in mediacms_videos:
        mid = video["id"]
        if not mid:
            continue

        if mid not in grist_records:
            to_add.append({
                "fields": {
                    "media_id":      mid,
                    "title":         video["title"],
                    "description":   video["description"],
                    "thumbnail_url": video["thumbnail_url"],
                    "hls_url":       video["hls_url"],
                }
            })
        else:
            existing = grist_records[mid]["fields"]
            has_change = any(
                str(existing.get(col) or "") != str(video.get(col) or "")
                for col in SYNC_COLS
            )
            if has_change:
                # Always send ALL sync cols in every update record so that
                # every record in the batch has identical fields (Grist requirement)
                to_update.append({
                    "id":     grist_records[mid]["row_id"],
                    "fields": {col: video[col] for col in SYNC_COLS},
                })

    unchanged = len(mediacms_videos) - len(to_add) - len(to_update)
    print(f"Sync:  {len(to_add)} new  |  {len(to_update)} changed  |  {unchanged} unchanged\n")

    # 7. Write to Grist
    if to_add:
        print(f"Adding {len(to_add)} new record(s) …")
        for batch in batched(to_add, BATCH_SIZE):
            grist_post(
                f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/records",
                {"records": batch},
            )
        print("  Done.")

    if to_update:
        print(f"Updating {len(to_update)} changed record(s) …")
        for batch in batched(to_update, BATCH_SIZE):
            grist_patch(
                f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/records",
                {"records": batch},
            )
        print("  Done.")

    if not to_add and not to_update:
        print("Grist is already up to date - nothing to write.")

    print("\nFinished.")


if __name__ == "__main__":
    main()
