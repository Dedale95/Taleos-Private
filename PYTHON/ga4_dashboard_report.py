#!/usr/bin/env python3
"""
Génère un dashboard HTML (graphiques) à partir de l'API Google Analytics Data.
Évite le montage manuel des explorations GA4.

Usage:
  export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
  python3 ga4_dashboard_report.py

  ou:
  python3 ga4_dashboard_report.py --key /chemin/vers.json --property 519219314 --days 30

Sortie par défaut: ../HTML/ga4_taleos_dashboard.html
"""

from __future__ import annotations

import argparse
import html as html_escape
import json
import os
import sys
from datetime import datetime
from pathlib import Path

HTML_DIR = Path(__file__).resolve().parent.parent / "HTML"
DEFAULT_OUTPUT = HTML_DIR / "ga4_taleos_dashboard.html"

# Événements Taleos (extension)
TALEOS_EVENTS = ("apply_start", "apply_success", "apply_error", "apply_expired")


def main():
    parser = argparse.ArgumentParser(description="Génère un dashboard HTML GA4 Taleos")
    parser.add_argument("--key", help="Chemin vers le JSON compte de service")
    parser.add_argument("--property", default=os.environ.get("GA4_PROPERTY_ID", "519219314"))
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if args.key:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(Path(args.key).expanduser().resolve())

    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        print(
            "Définissez GOOGLE_APPLICATION_CREDENTIALS ou passez --key chemin/vers.json",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import (
            DateRange,
            Dimension,
            Filter,
            FilterExpression,
            Metric,
            RunReportRequest,
        )
    except ImportError as e:
        print(
            "Installez: pip install google-analytics-data google-auth",
            file=sys.stderr,
        )
        raise SystemExit(1) from e

    client = BetaAnalyticsDataClient()

    # 1) Série temporelle par jour + event
    req1 = RunReportRequest(
        property=f"properties/{args.property}",
        date_ranges=[DateRange(start_date=f"{args.days}daysAgo", end_date="today")],
        dimensions=[Dimension(name="date"), Dimension(name="eventName")],
        metrics=[Metric(name="eventCount")],
        dimension_filter=FilterExpression(
            filter=Filter(
                field_name="eventName",
                string_filter=Filter.StringFilter(
                    match_type=Filter.StringFilter.MatchType.FULL_REGEXP,
                    value="|".join(TALEOS_EVENTS),
                ),
            )
        ),
    )
    r1 = client.run_report(req1)

    # 2) Site x event (si dimension custom disponible)
    rows_site = []
    try:
        req2 = RunReportRequest(
            property=f"properties/{args.property}",
            date_ranges=[DateRange(start_date=f"{args.days}daysAgo", end_date="today")],
            dimensions=[Dimension(name="customEvent:site"), Dimension(name="eventName")],
            metrics=[Metric(name="eventCount")],
            dimension_filter=FilterExpression(
                filter=Filter(
                    field_name="eventName",
                    string_filter=Filter.StringFilter(
                        match_type=Filter.StringFilter.MatchType.FULL_REGEXP,
                        value="|".join(TALEOS_EVENTS),
                    ),
                )
            ),
        )
        r2 = client.run_report(req2)
        for row in r2.rows or []:
            d0 = row.dimension_values[0].value if row.dimension_values else ""
            d1 = row.dimension_values[1].value if len(row.dimension_values) > 1 else ""
            v = int(row.metric_values[0].value) if row.metric_values else 0
            rows_site.append({"site": d0 or "(not set)", "event": d1, "count": v})
    except Exception as e:
        rows_site = []
        site_error = str(e)
    else:
        site_error = ""

    # Pivot date -> { event: count } pour chaque jour
    from collections import defaultdict

    by_date = defaultdict(lambda: defaultdict(int))
    dates_sorted = []
    for row in r1.rows or []:
        d = row.dimension_values[0].value if row.dimension_values else ""
        ev = row.dimension_values[1].value if len(row.dimension_values) > 1 else ""
        cnt = int(row.metric_values[0].value) if row.metric_values else 0
        if d and len(d) == 8:
            d_fmt = f"{d[0:4]}-{d[4:6]}-{d[6:8]}"
        else:
            d_fmt = d
        by_date[d_fmt][ev] += cnt
        if d_fmt not in dates_sorted:
            dates_sorted.append(d_fmt)
    dates_sorted.sort()

    chart_labels = json.dumps(dates_sorted)
    datasets = []
    colors = {
        "apply_start": "rgba(102, 126, 234, 0.8)",
        "apply_success": "rgba(34, 197, 94, 0.8)",
        "apply_error": "rgba(239, 68, 68, 0.8)",
        "apply_expired": "rgba(234, 179, 8, 0.8)",
    }
    for ev in TALEOS_EVENTS:
        data = [by_date[d].get(ev, 0) for d in dates_sorted]
        datasets.append(
            {
                "label": ev,
                "data": data,
                "borderColor": colors.get(ev, "#666"),
                "backgroundColor": colors.get(ev, "#666"),
                "fill": False,
                "tension": 0.2,
            }
        )
    chart_datasets = json.dumps(datasets)

    site_table_html = ""
    if rows_site:
        site_table_html = "<table><thead><tr><th>Site</th><th>Événement</th><th>Nombre</th></tr></thead><tbody>"
        for r in sorted(rows_site, key=lambda x: (-x["count"], x["site"], x["event"])):
            site_table_html += f"<tr><td>{r['site']}</td><td>{r['event']}</td><td>{r['count']}</td></tr>"
        site_table_html += "</tbody></table>"
    elif site_error:
        site_table_html = (
            f"<p class='muted'>Tableau par site indisponible: "
            f"{html_escape.escape(site_error)}</p>"
        )
    else:
        site_table_html = "<p class='muted'>Aucune donnée par site.</p>"

    generated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Taleos — Dashboard GA4</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 24px; background: #f8fafc; color: #1e293b; }}
    h1 {{ font-size: 1.25rem; }}
    .meta {{ color: #64748b; font-size: 0.875rem; margin-bottom: 24px; }}
    canvas {{ max-height: 420px; background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
    table {{ width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
    th, td {{ padding: 10px 14px; text-align: left; border-bottom: 1px solid #e2e8f0; }}
    th {{ background: #f1f5f9; font-weight: 600; }}
    .muted {{ color: #64748b; }}
  </style>
</head>
<body>
  <h1>Dashboard Taleos (GA4)</h1>
  <p class="meta">Propriété: {args.property} · Derniers {args.days} jours · Généré: {generated}</p>
  <p class="muted">Événements: apply_start, apply_success, apply_error, apply_expired</p>
  <canvas id="chart"></canvas>
  <h2 style="margin-top:32px;font-size:1rem;">Répartition par site (si disponible)</h2>
  {site_table_html}
  <script>
    const labels = {chart_labels};
    const datasets = {chart_datasets};
    new Chart(document.getElementById('chart'), {{
      type: 'line',
      data: {{ labels, datasets }},
      options: {{
        responsive: true,
        plugins: {{
          legend: {{ position: 'bottom' }},
          title: {{ display: true, text: 'Événements par jour' }}
        }},
        scales: {{
          y: {{ beginAtZero: true }}
        }}
      }}
    }});
  </script>
</body>
</html>
"""

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(html, encoding="utf-8")
    print(f"OK — Dashboard écrit: {args.output}")
    print(f"Ouvrez ce fichier dans le navigateur: file://{args.output}")


if __name__ == "__main__":
    main()
