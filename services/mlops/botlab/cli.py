"""botlab CLI entrypoint."""

from __future__ import annotations

import argparse
import json
import sys


def main() -> None:
    ap = argparse.ArgumentParser(prog="botlab", description="VOIDSTRIKE MLOps toolkit")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_tr = sub.add_parser("train", help="train a combat policy")
    p_tr.add_argument("--timesteps", type=int, default=20000)
    p_tr.add_argument("--seed", type=int, default=1337)
    p_tr.add_argument("--out", required=True)
    p_tr.add_argument("--algo", choices=["auto", "dqn", "tabular"], default="auto")

    p_ev = sub.add_parser("eval", help="evaluate policy vs scripted baseline")
    p_ev.add_argument("--policy", default=None)
    p_ev.add_argument("--episodes", type=int, default=20)

    p_li = sub.add_parser("list", help="list registry policies")
    p_ing = sub.add_parser("ingest", help="telemetry KPIs from JSONL")
    p_ing.add_argument("path")
    p_rep = sub.add_parser("report", help="write KPI report")
    p_rep.add_argument("--out", default="reports")

    args = ap.parse_args()

    if args.cmd == "train":
        from .train import train
        print(json.dumps(train(args.timesteps, args.seed, args.out, args.algo), indent=2))
    elif args.cmd == "eval":
        from .eval import evaluate
        print(json.dumps(evaluate(args.policy, args.episodes), indent=2))
    elif args.cmd == "list":
        from .registry import list_policies
        print(json.dumps(list_policies(), indent=2))
    elif args.cmd == "ingest":
        from .telemetry import ingest, kpis
        print(json.dumps(kpis(ingest(args.path)), indent=2, default=str))
    elif args.cmd == "report":
        from .telemetry import ingest, report
        df = ingest("sample_data/matches_sample.jsonl")
        print(json.dumps(report(df, args.out), indent=2, default=str))
    else:  # pragma: no cover
        sys.exit(1)


if __name__ == "__main__":
    main()
