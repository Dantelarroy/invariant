"""Command line: `invariant-data docile export|stats <dataset_dir> <split>`."""

import argparse
import json
from pathlib import Path

from invariant_data.docile import export_jsonl, iter_split, summarize


def main() -> None:
    parser = argparse.ArgumentParser(prog="invariant-data")
    sub = parser.add_subparsers(dest="command", required=True)

    export = sub.add_parser("docile-export", help="Write a DocILE split as common-format JSONL")
    export.add_argument("dataset_dir", type=Path)
    export.add_argument("split")
    export.add_argument("--out", type=Path, required=True)

    stats = sub.add_parser("docile-stats", help="Print counts for a DocILE split")
    stats.add_argument("dataset_dir", type=Path)
    stats.add_argument("split")

    args = parser.parse_args()
    if args.command == "docile-export":
        count = export_jsonl(args.dataset_dir, args.split, args.out)
        print(f"wrote {count} documents to {args.out}")
    else:
        print(json.dumps(summarize(iter_split(args.dataset_dir, args.split)), indent=2))


if __name__ == "__main__":
    main()
