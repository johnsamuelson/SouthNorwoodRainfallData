#!/usr/bin/env python3
"""
Fetches rainfall readings for the Norwood Reservoir gauge (station 288092TP)
from the Environment Agency's Hydrology API, stores them in a local SQLite
database, and rebuilds the JSON files the website's charts read from.

Safe to run over and over: on the very first run it pulls the full history
(back to 2003); every run after that it only asks the API for readings
newer than what's already stored, so it stays fast and cheap.
"""

import csv
import io
import json
import sqlite3
import sys
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta

MEASURE_ID = "ad5df79a-edad-4a84-bc68-515bca680038-rainfall-t-900-mm-qualified"
BASE_URL = f"https://environment.data.gov.uk/hydrology/id/measures/{MEASURE_ID}/readings.csv"

DB_PATH = "data/rainfall.db"
OUT_DIR = "docs/data"


def fetch_csv(mineq_date):
    """Download all readings from mineq_date onward as CSV text."""
    url = f"{BASE_URL}?mineq-date={mineq_date}&_limit=2000000"
    print(f"Fetching: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "personal-rainfall-chart/1.0"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        raw = resp.read().decode("utf-8")
    return raw


def parse_and_load(csv_text, conn):
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = []
    for row in reader:
        ts = row.get("dateTime")
        if not ts:
            continue
        value = row.get("value")
        value = float(value) if value not in (None, "") else None
        rows.append((ts, value, row.get("completeness"), row.get("quality")))

    if not rows:
        print("No new rows returned.")
        return 0

    conn.executemany(
        "INSERT OR REPLACE INTO readings (timestamp, value_mm, completeness, quality) "
        "VALUES (?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    print(f"Loaded {len(rows)} rows.")
    return len(rows)


def ensure_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS readings (
            timestamp TEXT PRIMARY KEY,
            value_mm REAL,
            completeness TEXT,
            quality TEXT
        )
        """
    )
    conn.commit()


def get_last_timestamp(conn):
    cur = conn.execute("SELECT MAX(timestamp) FROM readings")
    row = cur.fetchone()
    return row[0] if row and row[0] else None


def build_aggregates(conn):
    """Compute daily / monthly / yearly totals and write JSON files for the site."""
    cur = conn.execute(
        "SELECT timestamp, value_mm FROM readings WHERE value_mm IS NOT NULL ORDER BY timestamp"
    )

    daily = defaultdict(float)
    hourly_recent = defaultdict(float)
    cutoff_recent = (datetime.utcnow() - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%S")

    for ts, value in cur:
        day = ts[:10]
        daily[day] += value
        if ts >= cutoff_recent:
            hour_key = ts[:13] + ":00:00"
            hourly_recent[hour_key] += value

    monthly = defaultdict(float)
    yearly = defaultdict(float)
    for day, total in daily.items():
        y, m = day[:4], day[5:7]
        monthly[f"{y}-{m}"] += total
        yearly[y] += total

    daily_list = [{"date": d, "total_mm": round(v, 2)} for d, v in sorted(daily.items())]
    monthly_list = [{"month": m, "total_mm": round(v, 2)} for m, v in sorted(monthly.items())]
    yearly_list = [{"year": int(y), "total_mm": round(v, 2)} for y, v in sorted(yearly.items())]
    hourly_list = [{"hour": h, "total_mm": round(v, 2)} for h, v in sorted(hourly_recent.items())]

    today = date.today().isoformat()
    this_month = today[:7]
    this_year = today[:4]

    # Average total for "this month" (e.g. all Septembers) across prior years, excluding current year
    month_num = today[5:7]
    same_month_totals = [v for m, v in monthly.items() if m[5:7] == month_num and m[:4] != this_year]
    avg_this_month = round(sum(same_month_totals) / len(same_month_totals), 2) if same_month_totals else None

    prior_years = [v for y, v in yearly.items() if y != this_year]
    avg_year = round(sum(prior_years) / len(prior_years), 2) if prior_years else None

    last_24h_cutoff = (datetime.utcnow() - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S")
    cur2 = conn.execute(
        "SELECT COALESCE(SUM(value_mm), 0) FROM readings WHERE timestamp >= ? AND value_mm IS NOT NULL",
        (last_24h_cutoff,),
    )
    last_24h = round(cur2.fetchone()[0], 2)

    summary = {
        "last_updated_utc": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "last_24h_mm": last_24h,
        "this_month_mm": round(monthly.get(this_month, 0), 2),
        "this_month_avg_mm": avg_this_month,
        "this_year_mm": round(yearly.get(this_year, 0), 2),
        "avg_year_mm": avg_year,
        "record_years": len(yearly),
    }

    import os

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(f"{OUT_DIR}/daily.json", "w") as f:
        json.dump(daily_list, f)
    with open(f"{OUT_DIR}/monthly.json", "w") as f:
        json.dump(monthly_list, f)
    with open(f"{OUT_DIR}/yearly.json", "w") as f:
        json.dump(yearly_list, f)
    with open(f"{OUT_DIR}/recent_hourly.json", "w") as f:
        json.dump(hourly_list, f)
    with open(f"{OUT_DIR}/summary.json", "w") as f:
        json.dump(summary, f)

    print("Wrote JSON files:", ", ".join(["daily", "monthly", "yearly", "recent_hourly", "summary"]))


def main():
    import os

    os.makedirs("data", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    ensure_schema(conn)

    last_ts = get_last_timestamp(conn)
    if last_ts is None:
        print("No existing data found — running full historical backfill (this can take a minute).")
        mineq = "2000-01-01"
    else:
        # Re-fetch from the start of the last known day, in case that day was
        # only partially complete when we last ran.
        mineq = last_ts[:10]
        print(f"Existing data found. Fetching new readings from {mineq} onward.")

    try:
        csv_text = fetch_csv(mineq)
    except Exception as e:
        print(f"ERROR fetching data: {e}", file=sys.stderr)
        sys.exit(1)

    parse_and_load(csv_text, conn)
    build_aggregates(conn)
    conn.close()


if __name__ == "__main__":
    main()
