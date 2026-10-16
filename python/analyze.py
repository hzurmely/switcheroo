# Switcheroo data cleaning: reads the raw CSV, preprocesses it, balances the networks only if the gap is big, writes clean CSVs, a summary and graphs.
# Usage: python analyze.py raw-samples.csv output_folder [networkA] [householdName]
# Needs pandas, numpy and matplotlib. The preprocessing itself lives in switcheroo_clean.py.
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from switcheroo_clean import preprocess

entrada = sys.argv[1]
saida = sys.argv[2]
os.makedirs(saida, exist_ok=True)

bruto = pd.read_csv(entrada, encoding="utf-8-sig")
res = preprocess(bruto, sys.argv[3] if len(sys.argv) > 3 else "", sys.argv[4] if len(sys.argv) > 4 else "")
if res is None:
    print(json.dumps({"ok": False, "error": "There are no measurements to clean yet."}))
    sys.exit(0)
eventos, bruto_df, passos, redes, info = res["events"], res["raw"], res["steps"], res["networks"], res["info"]
limpo_linhas, bal = res["rows"], res["final"]
bruto_linhas = len(bruto_df)
limpo_linhas.to_csv(os.path.join(saida, "clean-rows.csv"), index=False)
bal.to_csv(os.path.join(saida, "clean-samples.csv"), index=False)

# ---------------------------------------------------------------- numbers
def metricas(d, falhas):
    n = int(len(d))
    return {
        "n": n,
        "mbps": None if d["mbps"].dropna().empty else float(d["mbps"].mean()),
        "topMbps": None if d["mbps"].dropna().empty else float(d["mbps"].max()),
        "lowMbps": None if d["mbps"].dropna().empty else float(d["mbps"].min()),
        "latency": None if d["latency_ms"].dropna().empty else float(d["latency_ms"].mean()),
        "jitter": None if d["jitter_ms"].dropna().empty else float(d["jitter_ms"].mean()),
        "loss": float(d["packet_loss"].mean() * 100) if n else None,
        "signal": None if d["signal_pct"].dropna().empty else float(d["signal_pct"].mean()),
        "fails": int(falhas),
    }


falhas = eventos.groupby("network").size().to_dict()
resumo = {"raw": {}, "clean": {}}
for r in redes:
    resumo["raw"][r] = metricas(bruto_df[bruto_df["network"] == r], falhas.get(r, 0))
    resumo["clean"][r] = metricas(bal[bal["network"] == r], falhas.get(r, 0))

# ---------------------------------------------------------------- graphs
FUNDO, TEXTO, GRADE = "#2b2d31", "#dbdee1", "#3f4147"
CORES = ["#3d87d6", "#ef4135"]
plt.rcParams.update({
    "figure.facecolor": FUNDO, "axes.facecolor": FUNDO, "savefig.facecolor": FUNDO,
    "text.color": TEXTO, "axes.labelcolor": TEXTO, "xtick.color": TEXTO, "ytick.color": TEXTO,
    "axes.edgecolor": GRADE, "grid.color": GRADE, "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
})
cor = {r: CORES[i % 2] for i, r in enumerate(redes)}


def salvar(fig, nome):
    fig.tight_layout()
    fig.savefig(os.path.join(saida, nome), dpi=130)
    plt.close(fig)


# 1 sample counts before and after balancing
fig, ax = plt.subplots(figsize=(7, 3.6))
x = np.arange(len(redes))
ax.bar(x - 0.27, [resumo["raw"][r]["n"] for r in redes], 0.26, color="#80848e", label="Raw")
ax.bar(x, [info["before"].get(r, 0) for r in redes], 0.26, color="#b5bac1", label="Cleaned, real rows")
ax.bar(x + 0.27, [resumo["clean"][r]["n"] for r in redes], 0.26, color=[cor[r] for r in redes], label="Clean (after balancing)")
for b in ax.patches:
    ax.annotate(int(b.get_height()), (b.get_x() + b.get_width() / 2, b.get_height()), ha="center", va="bottom", fontsize=9)
ax.set_xticks(x)
ax.set_xticklabels(redes)
ax.set_title("Samples per network", loc="left", fontsize=12)
ax.legend(frameon=False)
ax.grid(axis="y", alpha=.4)
salvar(fig, "samples.png")

# 2 speed over time
fig, ax = plt.subplots(figsize=(9, 3.8))
for r in redes:
    b = limpo_linhas[(limpo_linhas["network"] == r) & limpo_linhas["mbps"].notna()]
    ax.plot(b["time_utc"], b["mbps"], color=cor[r], lw=1.2, marker="o", ms=2, label=r)
ax.set_ylabel("Mbps")
ax.set_title("Download speed over time (cleaned real rows)", loc="left", fontsize=12)
ax.legend(frameon=False, ncol=2)
ax.grid(axis="y", alpha=.4)
fig.autofmt_xdate()
salvar(fig, "speed_time.png")

# 3 speed spread raw vs clean
fig, ax = plt.subplots(figsize=(7, 3.8))
dados, rotulos, cores = [], [], []
for r in redes:
    dados.append(bruto_df.loc[bruto_df["network"] == r, "mbps"].dropna())
    rotulos.append(r + "\nraw")
    cores.append("#80848e")
    dados.append(bal.loc[bal["network"] == r, "mbps"].dropna())
    rotulos.append(r + "\nclean")
    cores.append(cor[r])
bp = ax.boxplot(dados, tick_labels=rotulos, patch_artist=True, showfliers=False, widths=0.5)
for caixa, c in zip(bp["boxes"], cores):
    caixa.set(facecolor=c, edgecolor=TEXTO, alpha=.85)
for k in ("whiskers", "caps", "medians"):
    for ln in bp[k]:
        ln.set(color=TEXTO)
ax.set_ylabel("Mbps")
ax.set_title("Speed spread, raw and clean", loc="left", fontsize=12)
ax.grid(axis="y", alpha=.4)
salvar(fig, "speed_box.png")

# 4 latency distribution
fig, ax = plt.subplots(figsize=(7, 3.8))
tudo = bal["latency_ms"].dropna()
faixas = np.linspace(tudo.min(), tudo.max(), 26) if len(tudo) > 1 and tudo.max() > tudo.min() else 10
for r in redes:
    ax.hist(bal.loc[bal["network"] == r, "latency_ms"].dropna(), bins=faixas, color=cor[r], alpha=.6, label=r)
ax.set_xlabel("Latency (ms)")
ax.set_ylabel("Rows")
ax.set_title("Latency distribution", loc="left", fontsize=12)
ax.legend(frameon=False)
ax.grid(axis="y", alpha=.4)
salvar(fig, "latency_hist.png")

# 5 speed by hour of day (local to the machine's UTC offset is not known, so hours are UTC)
fig, ax = plt.subplots(figsize=(9, 3.6))
for r in redes:
    b = bal[bal["network"] == r]
    por_hora = b.groupby(b["time_utc"].dt.hour)["mbps"].mean()
    ax.plot(por_hora.index, por_hora.values, color=cor[r], lw=1.8, marker="o", ms=4, label=r)
ax.set_xlabel("Hour of day (UTC)")
ax.set_ylabel("Mbps")
ax.set_xticks(range(0, 24, 2))
ax.set_title("Average speed by hour", loc="left", fontsize=12)
ax.legend(frameon=False, ncol=2)
ax.grid(axis="y", alpha=.4)
salvar(fig, "speed_hour.png")

resumo.update({
    "ok": True,
    "steps": passos,
    "balance": info,
    "rawRows": int(bruto_linhas),
    "cleanRows": int(len(bal)),
    "realRows": int(len(limpo_linhas)),
    "networks": redes,
    "files": ["clean-samples.csv", "clean-rows.csv", "summary.json"],
    "graphs": ["samples.png", "speed_time.png", "speed_box.png", "latency_hist.png", "speed_hour.png"],
})
with open(os.path.join(saida, "summary.json"), "w", encoding="utf-8") as f:
    json.dump(resumo, f)
print(json.dumps(resumo))
