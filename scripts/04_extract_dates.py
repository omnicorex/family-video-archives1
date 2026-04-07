#!/usr/bin/env python3
"""
Script 04 — Extract Dates from Video Titles → Grist (suggested_date)
======================================================================
Scans each video title in your Grist table and tries to recognise a date.
The result is written to the 'suggested_date' column every run (it is always
a suggestion — treat it as read-only output from this script).

The 'date' column (your manually edited column) is NEVER touched.

After running, review 'suggested_date' in Grist.  Copy any dates you want
to keep into the 'date' column by hand.

Date patterns recognised (in order of specificity):
  1. ISO:          1985-07-04
  2. Month D Year: July 4, 1985  /  Jul 4 1985
  3. US numeric:   7/4/1985  /  07/04/1985
  4. Month Year:   July 1985  /  Jul 1985   → 1985-07
  5. Season Year:  Summer 1985              → 1985-07  (approx.)
  6. Year only:    1985                     → 1985

Usage:
    python scripts/04_extract_dates.py
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not installed — fall back to real environment variables

# ── Configuration ──────────────────────────────────────────────────────────────
GRIST_URL      = "https://sheets.tbg2.cloud"
GRIST_API_KEY  = os.environ.get("GRIST_API_KEY", "")
GRIST_DOC_ID   = "1pEArZCQEChq"
GRIST_TABLE_ID = "Table1"

BATCH_SIZE = 100

MONTH_MAP = {
    "january": 1,  "jan": 1,
    "february": 2, "feb": 2,
    "march": 3,    "mar": 3,
    "april": 4,    "apr": 4,
    "may": 5,
    "june": 6,     "jun": 6,
    "july": 7,     "jul": 7,
    "august": 8,   "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10,  "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

SEASON_MONTH = {
    "spring": 4, "summer": 7, "fall": 10, "autumn": 10, "winter": 1,
}


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

def ensure_suggested_date_column():
    """Create the suggested_date column if it doesn't exist yet."""
    existing     = grist_get(f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/columns")
    existing_ids = {col["id"] for col in existing["columns"]}
    if "suggested_date" not in existing_ids:
        grist_post(
            f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/columns",
            {"columns": [{"id": "suggested_date",
                           "fields": {"label": "suggested_date", "type": "Text"}}]},
        )
        print("  Created column: suggested_date")


# ── Date extraction ────────────────────────────────────────────────────────────

# Shared month-name pattern fragment
_MON = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?"
    r"|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?"
    r"|nov(?:ember)?|dec(?:ember)?"
)

# Flexible separator between date components (space, comma, dot, dash, slash)
_SEP = r"[\s,./\-]+"

# Year: 4-digit, NOT immediately adjacent to another digit on either side.
# Using (?<!\d)/(?!\d) instead of \b so that years work whether or not they
# are inside parentheses, next to punctuation, or touching other word chars.
_YEAR = r"(?<!\d)(1[89]\d{2}|20[012]\d)(?!\d)"

# Compiled patterns — evaluated in order; first match wins
_PATTERNS = [
    # 1. ISO: 1985-07-04
    (re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)"),
     lambda m: f"{m.group(1)}-{m.group(2)}-{m.group(3)}"),

    # 2. Month D[ordinal] Year: "July 4, 1985" / "Jul 4th 1985" / "Dec.25,1985"
    (re.compile(
        rf"\b({_MON}){_SEP}(\d{{1,2}})(?:st|nd|rd|th)?{_SEP}(1[89]\d{{2}}|20[012]\d)(?!\d)",
        re.I,
    ),
     lambda m: (
         f"{m.group(3)}-{MONTH_MAP.get(m.group(1).lower(), 0):02d}-{int(m.group(2)):02d}"
         if MONTH_MAP.get(m.group(1).lower()) else ""
     )),

    # 3. US numeric: 7/4/1985  or  7-4-1985
    (re.compile(r"(?<!\d)(\d{1,2})[/\-](\d{1,2})[/\-](1[89]\d{2}|20[012]\d)(?!\d)"),
     lambda m: f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"),

    # 4. Month Year: "July 1985" / "Jul,1985" / "Jul-1985"
    (re.compile(rf"\b({_MON}){_SEP}(1[89]\d{{2}}|20[012]\d)(?!\d)", re.I),
     lambda m: (
         f"{m.group(2)}-{MONTH_MAP.get(m.group(1).lower(), 0):02d}"
         if MONTH_MAP.get(m.group(1).lower()) else ""
     )),

    # 5. Season Year: "Summer 1985" / "Summer,1985"
    (re.compile(rf"\b(spring|summer|fall|autumn|winter){_SEP}(1[89]\d{{2}}|20[012]\d)(?!\d)", re.I),
     lambda m: f"{m.group(2)}-{SEASON_MONTH.get(m.group(1).lower(), 1):02d}"),

    # 6. Year only: any 4-digit year 1900–2029, not part of a longer number
    (re.compile(r"(?<!\d)(1[89]\d{2}|20[012]\d)(?!\d)"),
     lambda m: m.group(1)),
]


def extract_date(title):
    """Return the best date string found in title, or '' if none."""
    for pattern, formatter in _PATTERNS:
        m = pattern.search(title)
        if m:
            result = formatter(m)
            if result:
                return result
    return ""


# ── Utility ────────────────────────────────────────────────────────────────────

def batched(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i : i + n]


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("=== Script 04 - Extract Dates -> suggested_date ===\n")

    if not GRIST_API_KEY:
        print("ERROR: GRIST_API_KEY environment variable is not set.")
        print("  Create a .env file in the project root with:")
        print("    GRIST_API_KEY=your_api_key_here")
        print("  (See .env.example for the template.)")
        sys.exit(1)

    # Ensure the target column exists
    print("Checking Grist columns …")
    ensure_suggested_date_column()
    print()

    # Fetch records
    print("Fetching Grist records …")
    data    = grist_get(f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/records")
    records = data.get("records", [])
    print(f"  {len(records)} record(s) found.\n")

    if not records:
        print("No records to process.")
        return

    # Extract dates and collect updates
    updates     = []
    found_count = 0

    col_w = 58
    print(f"  {'Title':<{col_w}}  Suggested Date")
    print(f"  {'-' * col_w}  --------------")

    for rec in records:
        fields    = rec["fields"]
        title     = str(fields.get("title") or "").strip()
        suggested = extract_date(title)
        existing  = str(fields.get("suggested_date") or "").strip()
        display   = suggested if suggested else "(none)"

        print(f"  {title[:col_w]:<{col_w}}  {display}")

        if suggested:
            found_count += 1

        if suggested != existing:
            updates.append({
                "id":     rec["id"],
                "fields": {"suggested_date": suggested},
            })

    print()
    print(f"Dates found: {found_count} / {len(records)}")
    print(f"Updates needed: {len(updates)}")

    if updates:
        print(f"\nWriting {len(updates)} update(s) to Grist …")
        for batch in batched(updates, BATCH_SIZE):
            grist_patch(
                f"docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/records",
                {"records": batch},
            )
        print("  Done.")
    else:
        print("\nsuggested_date is already up to date - nothing to write.")

    print()
    print("Next step: review 'suggested_date' in Grist.")
    print("Copy any dates you want into the 'date' column by hand.")


if __name__ == "__main__":
    main()
