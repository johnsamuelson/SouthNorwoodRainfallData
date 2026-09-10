#!/usr/bin/env python3
"""
Fetches rainfall readings for the Norwood Reservoir gauge (station 288092TP)
from the Environment Agency's Hydrology API, stores them in a local SQLite
database, and rebuilds the JSON files the website's charts read from.

Safe to run over and over: on the very first run it pulls the full history
(back to 2003); every run after that it only asks the API for readings
newer than what's already stored, so it stays fast and cheap.
"""

import calendar
import csv
import io
import json
import sqlite3
import sys
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta

# A month needs at least this fraction of its expected 15-minute readings
# present to be treated as "complete" for averaging purposes. Months below
# this (e.g. the 2007-2009 gap on this gauge) are shown in the data but
# excluded from average/record calculations so they don't bias them low.
COMPLETENESS_THRESHOLD = 0.90

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


def month_range(start_month, end_month):
    """Yield 'YYYY-MM' strings from start_month to end_month inclusive."""
    y, m = int(start_month[:4]), int(start_month[5:7])
    ey, em = int(end_month[:4]), int(end_month[5:7])
    while (y, m) <= (ey, em):
        yield f"{y:04d}-{m:02d}"
        m += 1
        if m > 12:
            m = 1
            y += 1


def build_aggregates(conn):
    """Compute daily / monthly / yearly totals and write JSON files for the site."""
    # Reading counts (non-null values) per day and per month, used both for
    # totals and for judging how complete each month's record is.
    cur = conn.execute(
        "SELECT timestamp, value_mm FROM readings WHERE value_mm IS NOT NULL ORDER BY timestamp"
    )

    daily = defaultdict(float)
    daily_counts = defaultdict(int)
    hourly_recent = defaultdict(float)
    cutoff_recent = (datetime.utcnow() - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%S")

    first_ts, last_ts = None, None
    for ts, value in cur:
        if first_ts is None:
            first_ts = ts
        last_ts = ts
        day = ts[:10]
        daily[day] += value
        daily_counts[day] += 1
        if ts >= cutoff_recent:
            hour_key = ts[:13] + ":00:00"
            hourly_recent[hour_key] += value

    if first_ts is None:
        print("No readings in database yet — skipping aggregate build.")
        return

    today = date.today()
    this_month = today.isoformat()[:7]
    this_year = str(today.year)

    # Build every month in range so wholly-missing months show up as 0%
    # coverage rather than silently vanishing from the table.
    all_months = list(month_range(first_ts[:7], last_ts[:7]))

    monthly_total = defaultdict(float)
    monthly_reading_count = defaultdict(int)
    for day, total in daily.items():
        monthly_total[day[:7]] += total
        monthly_reading_count[day[:7]] += daily_counts[day]

    monthly_complete = {}
    monthly_coverage = {}
    for m in all_months:
        y, mo = int(m[:4]), int(m[5:7])
        expected = calendar.monthrange(y, mo)[1] * 96  # 96 readings/day at 15-min resolution
        actual = monthly_reading_count.get(m, 0)
        coverage = actual / expected if expected else 0
        monthly_coverage[m] = round(coverage * 100, 1)
        # The current, still-in-progress month is real but naturally "incomplete" —
        # track that separately rather than flagging it as a data gap.
        monthly_complete[m] = coverage >= COMPLETENESS_THRESHOLD

    # Climatology: average total for each calendar month (Jan..Dec), built only
    # from complete months in past years, so gaps like 2007-2009 don't drag it down.
    climatology_samples = defaultdict(list)
    for m in all_months:
        if m[:4] == this_year:
            continue  # exclude the current, still-running year
        if monthly_complete[m]:
            climatology_samples[m[5:7]].append(monthly_total.get(m, 0.0))

    climatology = {}
    for mo in [f"{i:02d}" for i in range(1, 13)]:
        samples = climatology_samples.get(mo, [])
        climatology[mo] = {
            "avg_mm": round(sum(samples) / len(samples), 2) if samples else None,
            "years_used": len(samples),
        }

    monthly_list = []
    for m in sorted(all_months):
        total = round(monthly_total.get(m, 0.0), 2)
        avg = climatology[m[5:7]]["avg_mm"]
        pct = round(total / avg * 100) if avg else None
        monthly_list.append(
            {
                "month": m,
                "total_mm": total,
                "complete": monthly_complete[m],
                "coverage_pct": monthly_coverage[m],
                "pct_of_avg": pct,
            }
        )

    yearly_total = defaultdict(float)
    yearly_all_complete = defaultdict(lambda: True)
    for m in all_months:
        y = m[:4]
        yearly_total[y] += monthly_total.get(m, 0.0)
        if not monthly_complete[m]:
            yearly_all_complete[y] = False

    avg_year_mm = sum(c["avg_mm"] for c in climatology.values() if c["avg_mm"] is not None)
    avg_year_mm = round(avg_year_mm, 2) if avg_year_mm else None

    yearly_list = []
    for y in sorted(yearly_total.keys()):
        total = round(yearly_total[y], 2)
        pct = round(total / avg_year_mm * 100) if avg_year_mm and yearly_all_complete[y] else None
        yearly_list.append(
            {
                "year": int(y),
                "total_mm": total,
                "complete": yearly_all_complete[y],
                "pct_of_avg": pct,
            }
        )

    daily_list = [{"date": d, "total_mm": round(v, 2)} for d, v in sorted(daily.items())]
    hourly_list = [{"hour": h, "total_mm": round(v, 2)} for h, v in sorted(hourly_recent.items())]
    climatology_list = [{"month_num": mo, **c} for mo, c in sorted(climatology.items())]

    this_month_avg = climatology[this_month[5:7]]["avg_mm"]
    this_month_total = round(monthly_total.get(this_month, 0.0), 2)

    last_24h_cutoff = (datetime.utcnow() - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S")
    cur2 = conn.execute(
        "SELECT COALESCE(SUM(value_mm), 0) FROM readings WHERE timestamp >= ? AND value_mm IS NOT NULL",
        (last_24h_cutoff,),
    )
    last_24h = round(cur2.fetchone()[0], 2)

    summary = {
        "last_updated_utc": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "last_24h_mm": last_24h,
        "this_month_mm": this_month_total,
        "this_month_avg_mm": this_month_avg,
        "this_year_mm": round(yearly_total.get(this_year, 0.0), 2),
        "avg_year_mm": avg_year_mm,
        "record_years": len({y for y in yearly_total if yearly_all_complete[y]}),
    }

    import os

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(f"{OUT_DIR}/daily.json", "w") as f:
        json.dump(daily_list, f)
    with open(f"{OUT_DIR}/monthly.json", "w") as f:
        json.dump(monthly_list, f)
    with open(f"{OUT_DIR}/yearly.json", "w") as f:
        json.dump(yearly_list, f)
    with open(f"{OUT_DIR}/climatology.json", "w") as f:
        json.dump(climatology_list, f)
    with open(f"{OUT_DIR}/recent_hourly.json", "w") as f:
        json.dump(hourly_list, f)
    with open(f"{OUT_DIR}/summary.json", "w") as f:
        json.dump(summary, f)

    print("Wrote JSON files:", ", ".join(["daily", "monthly", "yearly", "climatology", "recent_hourly", "summary"]))


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
