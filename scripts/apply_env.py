#!/usr/bin/env python3
"""
apply_env.py — Sync .env values → site/branding/config.json
=============================================================
Run this whenever you change a frontend value in your .env file.
It reads the mapped keys from .env and writes them into config.json
so the website picks them up on next load.

Usage:
    python scripts/apply_env.py

Mapped variables:
    DONATE_URL  →  config.json "donateUrl"
"""

import json
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # fall back to real environment variables

BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "site", "branding", "config.json")

# .env key → config.json key
ENV_TO_CONFIG = {
    "DONATE_URL": "donateUrl",
}


def main():
    print("=== apply_env.py -- .env -> config.json ===\n")

    # Load existing config
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

    changed = []
    for env_key, config_key in ENV_TO_CONFIG.items():
        value = os.environ.get(env_key, "").strip()
        if value and config.get(config_key) != value:
            config[config_key] = value
            changed.append(f"  {config_key} = {value}")

    if not changed:
        print("Nothing to update - config.json already matches .env.")
        return

    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print("Updated config.json:")
    for line in changed:
        print(line)
    print("\nDone.")


if __name__ == "__main__":
    main()
