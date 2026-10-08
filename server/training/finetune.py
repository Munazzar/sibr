"""Fine-tune Laya on training/data/train.jsonl and save a checkpoint Sibr can load.

    python -m training.finetune                    # 2 epochs, auto device
    python -m training.finetune --epochs 4 --device cuda

Then set SIBR_LAYA_CHECKPOINT=training/checkpoints/sibr-laya (in server/.env) and restart.
Extra flags are passed straight to `laya-train` (see `laya-train --help`).
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="convaiinnovations/laya")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--out", default=str(HERE / "checkpoints" / "sibr-laya"))
    a, rest = ap.parse_known_args(argv)
    data, ev = HERE / "data" / "train.jsonl", HERE / "data" / "eval.jsonl"
    if not data.exists():
        raise SystemExit("No training data yet: run python -m training.make_dataset first.")
    from laya.train_cli import main as laya_train
    args = ["--data", str(data), "--base", a.base, "--out", a.out, "--epochs", str(a.epochs)]
    if ev.exists():
        args += ["--eval", str(ev)]
    sys.exit(laya_train(args + rest))


if __name__ == "__main__":
    main()
