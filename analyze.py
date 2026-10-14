# Switcheroo data cleaning: reads the raw CSV, fixes oversampling, writes clean CSVs, a summary and graphs.
# Usage: python analyze.py raw-samples.csv output_folder
# Needs only pandas, numpy and matplotlib.
import sys
import os
import json
import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

entrada = sys.argv[1]
saida = sys.argv[2]
JANELA = "5min"  # size of the time window used to balance the networks
os.makedirs(saida, exist_ok=True)
passos = []  # what each step did, shown in the app


def passo(titulo, texto):
    passos.append({"step": titulo, "text": texto})


# ---------------------------------------------------------------- load
bruto = pd.read_csv(entrada, encoding="utf-8-sig")
casa = sys.argv[4] if len(sys.argv) > 4 else ""
if casa and (bruto["household"] == casa).any():
    bruto = bruto[bruto["household"] == casa]  # only the household on screen
eventos = bruto[bruto["event"].notna()].copy()
df = bruto[bruto["event"].isna()].drop(columns=["event"]).copy()
if df.empty:
    print(json.dumps({"ok": False, "error": "There are no measurements to clean yet."}))
    sys.exit(0)

NUM = ["unix_ms", "mbps", "latency_ms", "max_latency_ms", "jitter_ms", "packet_loss", "score", "signal_pct", "rx_mbps", "tx_mbps", "channel"]
bruto_linhas = len(df)

# ---------------------------------------------------------------- 1 types
antes = df[NUM].isna().sum().sum()
for c in NUM:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df["time_utc"] = pd.to_datetime(df["time_utc"], utc=True, errors="coerce")
df = df.dropna(subset=["time_utc", "network"]).copy()
passo("1. Types", f"Numbers read as numbers and times as dates. {int(df[NUM].isna().sum().sum() - antes)} unreadable values became empty.")

# ---------------------------------------------------------------- 2 formats
df["network"] = df["network"].astype(str).str.strip()
df["mode"] = df["mode"].fillna("normal").astype(str).str.strip().str.lower()
df["radio"] = df["radio"].fillna("").astype(str).str.strip()
passo("2. Formats", "Spaces trimmed from names, modes and radio types.")

# ---------------------------------------------------------------- 4 duplicates (before filling, so copies do not count twice)
dup = int(df.duplicated(subset=["unix_ms", "household", "network"]).sum())
df = df.drop_duplicates(subset=["unix_ms", "household", "network"]).reset_index(drop=True)
passo("3. Duplicates", f"{dup} repeated measurements removed.")

# ---------------------------------------------------------------- 3 missing values
# Speed is empty on purpose while gaming (ping only), so speed statistics use normal mode rows only.
ping_only = int(((df["mode"] != "normal") | df["mbps"].isna()).sum())
for c in ["signal_pct", "rx_mbps", "tx_mbps", "channel"]:
    df[c] = df[c].fillna(df.groupby("network")[c].transform("median"))
df["radio"] = df["radio"].replace("", "Desconhecido")
passo("4. Missing values", f"Signal, link speed and channel gaps filled with the median of each network. Unknown radio types labelled Desconhecido. {ping_only} rows have no speed (game mode or failed download), so they count for latency but not for speed.")

# ---------------------------------------------------------------- 5 inconsistencies
zero = int((df["mbps"] <= 0).sum())
df.loc[df["mbps"] <= 0, "mbps"] = np.nan  # a download of 0 is a failed test, not a speed
df["band_ghz"] = np.where(df["channel"] > 14, 5.0, 2.4)  # the channel decides the band
df.loc[df["channel"].isna(), "band_ghz"] = np.nan
perda_com_lat = int(((df["packet_loss"] >= 1) & df["latency_ms"].notna()).sum())
df.loc[df["packet_loss"] >= 1, "latency_ms"] = np.nan
passo("5. Inconsistencies", f"{zero} speeds of 0 turned into empty (failed download). Band recalculated from the channel. {perda_com_lat} rows with total packet loss but a latency had the latency cleared.")

# ---------------------------------------------------------------- 6 outliers
impossivel = (df["mbps"] > 5000) | (df["latency_ms"] <= 0) | (df["latency_ms"] > 5000)
n_imp = int(impossivel.sum())
df = df[~impossivel].reset_index(drop=True)
limitados = 0
for c in ["mbps", "latency_ms", "max_latency_ms", "jitter_ms"]:
    for rede, g in df.groupby("network"):
        q1, q3 = np.percentile(g[c].dropna(), [25, 75]) if g[c].notna().any() else (0, 0)
        teto = q3 + 1.5 * (q3 - q1)
        acima = (df["network"] == rede) & (df[c] > teto)
        limitados += int(acima.sum())
        df.loc[acima, c] = teto
passo("6. Outliers", f"{n_imp} impossible rows removed. {limitados} high but possible values capped at Q3 plus 1.5 times IQR of their network, so real slow and fast moments are kept.")

# ---------------------------------------------------------------- 7 encoding
df["mode_game"] = (df["mode"] == "game").astype(int)
redes = sorted(df["network"].unique())
primeira = sys.argv[3] if len(sys.argv) > 3 else ""
if primeira in redes:
    redes = [primeira] + [r for r in redes if r != primeira]  # network A first, so colors match the app
df["network_id"] = df["network"].map({r: i for i, r in enumerate(redes)})
df = pd.concat([df, pd.get_dummies(df["radio"], prefix="radio", dtype="int")], axis=1)
passo("7. Encoding", "Mode became 0 or 1, networks got an id, radio types became One Hot columns.")

# ---------------------------------------------------------------- 8 normalization
for c in ["mbps", "latency_ms", "jitter_ms", "signal_pct", "rx_mbps"]:
    lo, hi = df[c].min(), df[c].max()
    df[c + "_norm"] = (df[c] - lo) / (hi - lo) if hi > lo else 0.0
passo("8. Normalization", "Min Max scaled copies (columns ending in _norm) for speed, latency, jitter, signal and link speed.")
limpo_linhas = df.sort_values("time_utc")
limpo_linhas.to_csv(os.path.join(saida, "clean-rows.csv"), index=False)

# ---------------------------------------------------------------- 9 balancing (the oversampling fix)
# Switcheroo measures the network you are on every 30 s and the other one every 4 min, so the active
# network ends up with many more rows. One row per network per time window gives both the same weight.
df["janela"] = df["time_utc"].dt.floor(JANELA)
cols = [c for c in df.columns if c not in ("time_utc", "janela", "household", "network", "mode", "radio")]
bal = df.groupby(["network", "janela"], as_index=False)[cols].median()
bal["samples_in_window"] = df.groupby(["network", "janela"]).size().values
bal = bal.rename(columns={"janela": "time_utc"}).sort_values("time_utc")
bal["mode_game"] = (bal["mode_game"] >= 0.5).astype(int)  # a window counts as game mode when half or more of its rows were
bal["network_id"] = bal["network_id"].astype(int)
bal["unix_ms"] = bal["unix_ms"].astype("int64")
for c in [c for c in bal.columns if c.startswith("radio_")]:
    bal[c] = (bal[c] >= 0.5).astype(int)
bal.to_csv(os.path.join(saida, "clean-samples.csv"), index=False)
passo("9. Balancing", f"Rows grouped into {JANELA} windows, one median row per network per window, so the network you stay on no longer dominates the averages. Saved as clean-samples.csv.")


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
bruto_df = bruto[bruto["event"].isna()].copy()
for c in ["mbps", "latency_ms", "jitter_ms", "packet_loss", "signal_pct"]:
    bruto_df[c] = pd.to_numeric(bruto_df[c], errors="coerce")
bruto_df.loc[bruto_df["mbps"] <= 0, "mbps"] = np.nan
resumo = {"raw": {}, "clean": {}}
for r in redes:
    resumo["raw"][r] = metricas(bruto_df[bruto_df["network"] == r], falhas.get(r, 0))
    resumo["clean"][r] = metricas(bal[bal["network"] == r], falhas.get(r, 0))

# ---------------------------------------------------------------- graphs
FUNDO, TEXTO, GRADE = "#2b2d31", "#dbdee1", "#3f4147"
CORES = ["#5865f2", "#23a559"]
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
ax.bar(x - 0.2, [resumo["raw"][r]["n"] for r in redes], 0.38, color="#80848e", label="Raw")
barras = ax.bar(x + 0.2, [resumo["clean"][r]["n"] for r in redes], 0.38, color=[cor[r] for r in redes], label="Clean")
for b in ax.patches:
    ax.annotate(int(b.get_height()), (b.get_x() + b.get_width() / 2, b.get_height()), ha="center", va="bottom", fontsize=9)
ax.set_xticks(x)
ax.set_xticklabels(redes)
ax.set_title("Samples per network, raw and clean", loc="left", fontsize=12)
ax.legend(frameon=False)
ax.grid(axis="y", alpha=.4)
salvar(fig, "samples.png")

# 2 speed over time
fig, ax = plt.subplots(figsize=(9, 3.8))
for r in redes:
    b = bal[bal["network"] == r]
    ax.plot(b["time_utc"], b["mbps"], color=cor[r], lw=1.6, label=r)
ax.set_ylabel("Mbps")
ax.set_title(f"Download speed over time ({JANELA} medians)", loc="left", fontsize=12)
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
ax.set_ylabel("Windows")
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
    "window": JANELA,
    "rawRows": int(bruto_linhas),
    "cleanRows": int(len(bal)),
    "networks": redes,
    "files": ["clean-samples.csv", "clean-rows.csv", "summary.json"],
    "graphs": ["samples.png", "speed_time.png", "speed_box.png", "latency_hist.png", "speed_hour.png"],
})
with open(os.path.join(saida, "summary.json"), "w", encoding="utf-8") as f:
    json.dump(resumo, f)
print(json.dumps(resumo))
