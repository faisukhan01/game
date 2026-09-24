"""Telemetry ETL: JSONL match events → pandas KPIs → CSV + markdown report."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import pandas as pd


def ingest(jsonl_path: str) -> pd.DataFrame:
    rows = []
    with open(jsonl_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    if not rows:
        raise ValueError("no events found in file")
    df = pd.DataFrame(rows)
    if "ts" in df.columns:
        df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df


def kpis(df: pd.DataFrame) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if "callsign" in df.columns:
        out["unique_callsigns"] = int(df["callsign"].nunique())
    if "ts" in df.columns:
        out["dai_estimate"] = int(df.groupby(df["ts"].dt.date)["callsign"].nunique().mean())
        span = (df["ts"].max() - df["ts"].min()).total_seconds()
        out["avg_session_sec"] = round(float(df.groupby("callsign")["ts"].agg(["min", "max"])
                                             .pipe(lambda g: (g["max"] - g["min"]).dt.total_seconds()).mean()), 1)
        out["window_days"] = max(1, round(span / 86400))
    if "wave" in df.columns:
        curve = df.groupby(pd.cut(df["wave"], bins=[0, 2, 4, 6, 8, 10, 100],
                                  labels=["1-2", "3-4", "5-6", "7-8", "9-10", "11+"]))
        counts = curve.size()
        out["wave_difficulty_curve"] = {str(k): int(v) for k, v in counts.items()}
    if "ability" in df.columns:
        out["ability_usage"] = {str(k): int(v) for k, v in df["ability"].value_counts().head(6).items()}
    if "score" in df.columns:
        out["median_score"] = float(df["score"].median())
        out["p95_score"] = float(df["score"].quantile(0.95))
    if "callsign" in df.columns and "score" in df.columns:
        top = df.groupby("callsign")["score"].sum().sort_values(ascending=False).head(5)
        out["top_callsigns"] = {str(k): int(v) for k, v in top.items()}
    return out


def report(df: pd.DataFrame, out_dir: str = "reports") -> dict[str, Any]:
    os.makedirs(out_dir, exist_ok=True)
    k = kpis(df)
    df.to_csv(os.path.join(out_dir, "kpis.csv"), index=False)
    lines = [
        "# VOIDSTRIKE Telemetry Report",
        "",
        f"_Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · "
        f"{len(df)} events_",
        "",
    ]
    for key, val in k.items():
        lines.append(f"## {key.replace('_', ' ').title()}")
        lines.append("```json")
        lines.append(json.dumps(val, indent=2, default=str))
        lines.append("```")
        lines.append("")
    with open(os.path.join(out_dir, "summary.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return k


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(prog="botlab")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_ing = sub.add_parser("ingest")
    p_ing.add_argument("path")
    p_rep = sub.add_parser("report")
    p_rep.add_argument("--out", default="reports")
    args = ap.parse_args()

    if args.cmd == "ingest":
        df = ingest(args.path)
        print(json.dumps(kpis(df), indent=2, default=str))
    elif args.cmd == "report":
        df = ingest("sample_data/matches_sample.jsonl")
        print(json.dumps(report(df, args.out), indent=2, default=str))


if __name__ == "__main__":
    main()
