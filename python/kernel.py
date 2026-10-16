"""A tiny Python kernel for the Python tab in Switcheroo.

The app starts this once and keeps it running, so a variable made in one cell is still there in the next.
Protocol: one JSON object per line on stdin, one JSON object per line on stdout.
  in : {"id": 1, "code": "..."}   or   {"id": 2, "cmd": "reload"}
  out: {"id": 1, "out": "...", "err": "...", "images": ["<base64 png>"]}
Usage: python kernel.py <analysis folder with raw.csv>
"""
import ast
import base64
import contextlib
import io
import json
import os
import sys
import traceback

os.environ.setdefault("MPLBACKEND", "Agg")
PROTO = sys.stdout
ns = {"__name__": "__main__"}
FOLDER = sys.argv[1] if len(sys.argv) > 1 else "."
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def load_data():
    """Reads the newest saved measurements. Runs again on reload, because the data keeps changing."""
    import pandas as pd
    from switcheroo_clean import preprocess

    raw_file = os.path.join(FOLDER, "raw.csv")
    ns["data_folder"] = FOLDER
    if not os.path.exists(raw_file):
        ns["raw"] = pd.DataFrame()
        ns["clean"] = pd.DataFrame()
        return "No data saved yet, so raw and clean are empty."
    raw = pd.read_csv(raw_file, encoding="utf-8-sig")
    raw["time"] = pd.to_datetime(raw["time_utc"], utc=True, errors="coerce")
    res = preprocess(raw.drop(columns=["time"]))
    ns["raw"] = raw
    if res is None:
        ns["clean"] = pd.DataFrame()
        return "raw has rows but none are measurements yet, so clean is empty."
    clean = res["final"].copy()
    clean["time"] = clean["time_utc"]
    ns["clean"] = clean
    ns["clean_real"] = res["rows"]  # cleaned rows before balancing
    ns["clean_info"] = res["info"]  # what balancing decided
    ns["clean_steps"] = res["steps"]
    i = res["info"]
    return f"raw: {len(raw)} rows. clean: {len(clean)} rows after preprocessing ({i['action']}, {i['synthetic']} new rows). More in clean_info, clean_real and clean_steps."


def start():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd
    from cycler import cycler

    plt.style.use("dark_background")
    plt.rcParams.update({"figure.facecolor": "#2b2d31", "axes.facecolor": "#2b2d31", "savefig.facecolor": "#2b2d31", "figure.figsize": (8, 3.6),
                         # brand colors only: blue, red, white and tints of blue (the default cycle has green and purple)
                         "axes.prop_cycle": cycler(color=["#3d87d6", "#ef4135", "#e3eef9", "#7aa7d9", "#a6322a", "#c9dcf1"])})
    pd.set_option("display.width", 110)
    pd.set_option("display.max_columns", 30)
    ns.update({"pd": pd, "np": np, "plt": plt})
    return load_data()


def images():
    import matplotlib.pyplot as plt

    out = []
    for n in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(n).savefig(buf, format="png", dpi=110, bbox_inches="tight")
        out.append(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
    return out


def run(code):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            tree = ast.parse(code, "<cell>")
            last = None
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last = ast.Expression(tree.body.pop().value)
            exec(compile(tree, "<cell>", "exec"), ns)
            if last is not None:
                val = eval(compile(last, "<cell>", "eval"), ns)
                if val is not None:
                    ns["_"] = val
                    print(repr(val))
        except SystemExit:
            pass
        except BaseException:
            tb = traceback.format_exc().splitlines()
            err.write("\n".join(tb[:1] + tb[3:]) + "\n")  # hide this file's own frames
    try:
        imgs = images()
    except Exception:
        imgs = []
    return {"out": out.getvalue(), "err": err.getvalue(), "images": imgs}


def main():
    try:
        note = start()
    except Exception as e:
        note = "Setup problem: " + str(e)
    PROTO.write(json.dumps({"id": 0, "out": note, "err": "", "images": []}) + "\n")
    PROTO.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            if msg.get("cmd") == "reload":
                try:
                    res = {"out": load_data(), "err": "", "images": []}
                except Exception as e:
                    res = {"out": "", "err": str(e), "images": []}
            else:
                res = run(msg.get("code", ""))
            res["id"] = msg.get("id")
        except Exception as e:
            res = {"id": None, "out": "", "err": str(e), "images": []}
        PROTO.write(json.dumps(res) + "\n")
        PROTO.flush()


if __name__ == "__main__":
    main()
