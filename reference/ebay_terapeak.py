#!/usr/bin/env python3
"""
eBay Terapeak "Product Research" — internal API client (cookie replay).

This hits the same private endpoint the Seller Hub research page uses:
    GET https://www.ebay.com/sh/research/api/search

It is NOT an official/supported API. It works by replaying your logged-in
browser session cookie. It will break when:
  - the cookie goes stale (bot-manager cookies rotate in minutes/hours), or
  - eBay changes the endpoint/response shape, or
  - eBay's bot detection (Akamai + perfdrive) flags the traffic.

--------------------------------------------------------------------------
SETUP
--------------------------------------------------------------------------
1. Log into eBay in your browser and open the research page:
   https://www.ebay.com/sh/research?marketplace=EBAY-US&tabName=SOLD
2. Open DevTools > Network, run any search, click the request to
   `/sh/research/api/search`, right-click > Copy > "Copy as cURL", and grab
   the value of the `cookie:` header (the whole string).
3. Export it:
       export EBAY_COOKIE='__uzmb=...; ebaysid=...; shs=...; (entire cookie)'
4. Run:
       python3 ebay_terapeak.py "nintendo switch oled" --days 90

--------------------------------------------------------------------------
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Iterator

import requests  # pip install requests

BASE = "https://www.ebay.com/sh/research/api/search"


def _iter_json_objects(text: str) -> Iterator[dict]:
    """The endpoint returns several JSON objects concatenated / newline-
    separated. Decode them one after another."""
    decoder = json.JSONDecoder()
    idx = 0
    n = len(text)
    while idx < n:
        # skip whitespace between objects
        while idx < n and text[idx] in " \t\r\n":
            idx += 1
        if idx >= n:
            break
        obj, end = decoder.raw_decode(text, idx)
        yield obj
        idx = end


def _text(node: Any) -> str:
    """Pull plain text out of eBay's TextualDisplay/TextSpan wrapper."""
    if not isinstance(node, dict):
        return ""
    spans = node.get("textSpans") or []
    return "".join(s.get("text", "") for s in spans if isinstance(s, dict))


def search(
    keywords: str,
    *,
    days: int = 90,
    tab: str = "SOLD",
    category_id: int = 0,
    limit: int = 50,
    offset: int = 0,
    marketplace: str = "EBAY-US",
    tz: str = "Asia/Jakarta",
    cookie: str | None = None,
) -> dict[str, dict]:
    """Call the research endpoint and return {module_name: module_json}."""
    cookie = cookie or os.environ.get("EBAY_COOKIE")
    if not cookie:
        raise SystemExit("Set EBAY_COOKIE (see setup notes at top of file).")

    end_ms = int(time.time() * 1000)
    start_ms = end_ms - days * 86_400_000

    params = [
        ("marketplace", marketplace),
        ("keywords", keywords),
        ("dayRange", str(days)),
        ("startDate", str(start_ms)),
        ("endDate", str(end_ms)),
        ("categoryId", str(category_id)),
        ("offset", str(offset)),
        ("limit", str(limit)),
        ("tabName", tab),
        ("tz", tz),
        # request the useful data modules
        ("modules", "aggregates"),
        ("modules", "searchResults"),
        ("modules", "resultsHeader"),
    ]

    headers = {
        "x-requested-with": "XMLHttpRequest",  # REQUIRED or you get HTML
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "referer": (
            "https://www.ebay.com/sh/research?marketplace="
            f"{marketplace}&keywords={keywords}&tabName={tab}"
        ),
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
        ),
        "cookie": cookie,
    }

    resp = requests.get(BASE, params=params, headers=headers, timeout=30)
    ctype = resp.headers.get("content-type", "")
    if "application/json" not in ctype:
        raise SystemExit(
            f"Expected JSON, got {ctype!r} (HTTP {resp.status_code}). "
            "Your cookie is probably stale or bot detection triggered. "
            "Re-copy a fresh cookie from the browser."
        )

    modules: dict[str, dict] = {}
    for obj in _iter_json_objects(resp.text):
        name = (obj.get("meta") or {}).get("name") or obj.get("_type", "unknown")
        modules[name] = obj
    return modules


def summarize(modules: dict[str, dict]) -> dict[str, str]:
    """Flatten the aggregate stats into a simple {label: value} dict."""
    agg = modules.get("aggregates") or {}
    out: dict[str, str] = {}
    for section in agg.get("sections", []):
        for item in section.get("dataItems", []):
            out[_text(item.get("header"))] = _text(item.get("value"))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Query eBay Terapeak sold listings.")
    ap.add_argument("keywords")
    ap.add_argument("--days", type=int, default=90, help="lookback window (default 90)")
    ap.add_argument("--tab", default="SOLD", choices=["SOLD", "ACTIVE"])
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--json", action="store_true", help="dump raw module JSON")
    args = ap.parse_args()

    modules = search(args.keywords, days=args.days, tab=args.tab, limit=args.limit)

    if args.json:
        json.dump(modules, sys.stdout, indent=2)
        return

    print(f"\n=== {args.keywords!r}  ({args.tab}, last {args.days} days) ===\n")
    for label, value in summarize(modules).items():
        print(f"  {label:<18} {value}")
    print()


if __name__ == "__main__":
    main()
