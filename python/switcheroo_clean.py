"""Preprocessing of the Switcheroo measurements (pandas), following the Data Mining steps:
types, formats, duplicates, missing values, inconsistencies, outliers, encoding, normalization and balancing.

Balancing is decided by the size of the gap between the networks (if, elif, else):
  small gap     -> nothing is done, the real rows are kept as they are
  moderate gap  -> SMOTE: the smaller network gets new rows between two of its own neighbouring real rows
  large gap     -> SMOTEENN: SMOTE, then ENN removes the rows that sit in the wrong neighbourhood (at most 15 percent of a network)
No real row is thrown away just to make the counts equal.
Neighbours are searched among the 30 rows before and after in time (time is one of the features).
"""
import numpy as np
import pandas as pd

FINO = 0.8  # smaller network has at least 80 percent of the rows of the bigger one: nothing to do
SEVERO = 0.4  # below 40 percent the gap is large
VIZ = 30
NUM = ["unix_ms", "mbps", "latency_ms", "max_latency_ms", "jitter_ms", "packet_loss", "score", "signal_pct", "rx_mbps", "tx_mbps", "channel"]
FEATS = ["unix_ms", "mbps", "latency_ms", "max_latency_ms", "jitter_ms", "packet_loss", "signal_pct", "rx_mbps", "channel"]
NORMALIZAR = ["mbps", "latency_ms", "jitter_ms", "signal_pct", "rx_mbps"]


def decidir(contagens):
    """The if, elif, else that picks what to do about the sample gap."""
    maior, menor = max(contagens.values()), min(contagens.values())
    razao = menor / maior if maior else 1.0
    if razao >= FINO:
        return razao, "nothing", f"The gap is small (the smaller network has {razao:.0%} of the rows of the bigger one, the limit is {FINO:.0%}), so nothing is done."
    elif razao >= SEVERO:
        return razao, "smote", f"The gap is moderate (the smaller network has {razao:.0%} of the rows, between {SEVERO:.0%} and {FINO:.0%}), so SMOTE adds rows to the smaller one. No real row is removed."
    else:
        return razao, "smoteenn", f"The gap is large (the smaller network has only {razao:.0%} of the rows, under {SEVERO:.0%}), so SMOTEENN is used: SMOTE adds rows, then ENN removes the rows that sit in the wrong neighbourhood (never more than 15 percent of a network)."


def _normalizado(d, colunas):
    Z = d[colunas].astype(float)
    Z = Z.fillna(Z.median()).fillna(0.0)
    lo, hi = Z.min(), Z.max()
    return ((Z - lo) / (hi - lo).replace(0, 1)).to_numpy()


def _vizinhos(Z, k, rotulos=None, mesma=False):
    """For each row (already sorted by time) the k closest rows among the VIZ rows before and after."""
    n = len(Z)
    saida = np.full((n, k), -1, dtype=int)
    for i in range(n):
        cand = np.arange(max(0, i - VIZ), min(n, i + VIZ + 1))
        cand = cand[cand != i]
        if mesma:
            cand = cand[rotulos[cand] == rotulos[i]]
        if len(cand) == 0:
            continue
        d = ((Z[cand] - Z[i]) ** 2).sum(axis=1)
        pick = cand[np.argsort(d)[:k]]
        saida[i, : len(pick)] = pick
    return saida


def smote(d, alvo, rng, interp):
    """New rows for one network until it has `alvo` rows: each one lies between a real row and one of its neighbours."""
    d = d.sort_values("unix_ms").reset_index(drop=True)
    falta = alvo - len(d)
    if falta <= 0 or len(d) < 2:
        return d.iloc[0:0]
    viz = _vizinhos(_normalizado(d, FEATS), 5, mesma=False)
    i = rng.integers(0, len(d), falta)
    col = rng.integers(0, 5, falta)
    j = viz[i, col]
    j = np.where(j < 0, i, j)
    lam = rng.random(falta)[:, None]
    A = d[interp].to_numpy(float)
    novo = d.iloc[i].reset_index(drop=True).copy()
    novo[interp] = A[i] + lam * (A[j] - A[i])  # a missing value in either parent stays missing
    novo["unix_ms"] = novo["unix_ms"].round().astype("int64")
    novo["time_utc"] = pd.to_datetime(novo["unix_ms"], unit="ms", utc=True)
    novo["synthetic"] = 1
    return novo


def enn(d, k=3, maximo=0.15):
    """Edited Nearest Neighbours: drops rows whose neighbours mostly belong to another network.
    Safety limit: never more than 15 percent of any network's rows, the most out of place ones go first."""
    d = d.sort_values("unix_ms").reset_index(drop=True)
    if len(d) <= k + 1:
        return d
    rot = d["network_id"].to_numpy()
    viz = _vizinhos(_normalizado(d, FEATS), k, rotulos=rot)
    desacordo = np.zeros(len(d))
    for i in range(len(d)):
        v = viz[i][viz[i] >= 0]
        if len(v):
            desacordo[i] = (rot[v] != rot[i]).mean()
    manter = np.ones(len(d), dtype=bool)
    for r in np.unique(rot):
        idx = np.where((rot == r) & (desacordo > 0.5))[0]
        idx = idx[np.argsort(-desacordo[idx], kind="stable")][: int((rot == r).sum() * maximo)]
        manter[idx] = False
    return d[manter].reset_index(drop=True)


def contagem(d):
    return {k: int(v) for k, v in d.groupby("network").size().items()}


def preprocess(bruto, primeira="", casa="", semente=7):
    passos = []

    def passo(t, txt):
        passos.append({"step": t, "text": txt})

    if casa and (bruto["household"] == casa).any():
        bruto = bruto[bruto["household"] == casa]
    eventos = bruto[bruto["event"].notna()].copy()
    bruto_df = bruto[bruto["event"].isna()].copy()
    df = bruto[bruto["event"].isna()].drop(columns=["event"]).copy()
    if df.empty:
        return None
    for c in NUM:
        bruto_df[c] = pd.to_numeric(bruto_df[c], errors="coerce")
    bruto_df.loc[bruto_df["mbps"] <= 0, "mbps"] = np.nan

    # 1 types
    antes = df[NUM].isna().sum().sum()
    for c in NUM:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["time_utc"] = pd.to_datetime(df["time_utc"], utc=True, errors="coerce")
    df = df.dropna(subset=["time_utc", "network"]).copy()
    passo("1. Types", f"Numbers read as numbers and times as dates. {int(df[NUM].isna().sum().sum() - antes)} unreadable values became empty.")

    # 2 formats
    df["network"] = df["network"].astype(str).str.strip()
    df["mode"] = df["mode"].fillna("normal").astype(str).str.strip().str.lower()
    df["radio"] = df["radio"].fillna("").astype(str).str.strip()
    passo("2. Formats", "Spaces trimmed from names, modes and radio types.")

    # 3 duplicates
    dup = int(df.duplicated(subset=["unix_ms", "household", "network"]).sum())
    df = df.drop_duplicates(subset=["unix_ms", "household", "network"]).reset_index(drop=True)
    passo("3. Duplicates", f"{dup} repeated measurements removed.")

    # 4 missing values
    sem_vel = int(((df["mode"] != "normal") | df["mbps"].isna()).sum())
    for c in ["signal_pct", "rx_mbps", "tx_mbps", "channel"]:
        df[c] = df[c].fillna(df.groupby("network")[c].transform("median"))
    cheios = df.loc[df["radio"] != "", "radio"]
    if len(cheios) and cheios.value_counts(normalize=True).iloc[0] >= 0.6:
        moda = cheios.value_counts().index[0]
        df["radio"] = df["radio"].replace("", moda)
        radio_txt = f"One radio type dominates, so empty radio types became {moda} (the mode)."
    else:
        df["radio"] = df["radio"].replace("", "Desconhecido")
        radio_txt = "Radio types are spread out, so empty ones became Desconhecido instead of guessing the mode."
    passo("4. Missing values", f"Signal, link speed and channel gaps filled with the median of each network. {radio_txt} {sem_vel} rows have no speed (game mode or failed download), so they count for latency but not for speed.")

    # 5 inconsistencies
    zero = int((df["mbps"] <= 0).sum())
    df.loc[df["mbps"] <= 0, "mbps"] = np.nan
    df["band_ghz"] = np.where(df["channel"] > 14, 5.0, 2.4)
    df.loc[df["channel"].isna(), "band_ghz"] = np.nan
    perda = int(((df["packet_loss"] >= 1) & df["latency_ms"].notna()).sum())
    df.loc[df["packet_loss"] >= 1, "latency_ms"] = np.nan
    passo("5. Inconsistencies", f"{zero} speeds of 0 turned into empty (failed download). Band recalculated from the channel. {perda} rows with total packet loss but a latency had the latency cleared.")

    # 6 outliers
    imp = (df["mbps"] > 5000) | (df["latency_ms"] <= 0) | (df["latency_ms"] > 5000)
    n_imp = int(imp.sum())
    df = df[~imp].reset_index(drop=True)
    limitados = 0
    for c in ["mbps", "latency_ms", "max_latency_ms", "jitter_ms"]:
        for rede, g in df.groupby("network"):
            if not g[c].notna().any():
                continue
            q1, q3 = np.percentile(g[c].dropna(), [25, 75])
            teto = q3 + 1.5 * (q3 - q1)
            acima = (df["network"] == rede) & (df[c] > teto)
            limitados += int(acima.sum())
            df.loc[acima, c] = teto
    passo("6. Outliers", f"{n_imp} impossible rows removed. {limitados} high but possible values capped at Q3 plus 1.5 times IQR of their network, so real slow and fast moments are kept.")

    # 7 encoding
    df["mode_game"] = (df["mode"] == "game").astype(int)
    redes = sorted(df["network"].unique())
    if primeira in redes:
        redes = [primeira] + [r for r in redes if r != primeira]
    df["network_id"] = df["network"].map({r: i for i, r in enumerate(redes)})
    df = pd.concat([df, pd.get_dummies(df["radio"], prefix="radio", dtype="int")], axis=1)
    passo("7. Encoding", "Mode became 0 or 1, networks got an id, radio types became One Hot columns.")

    # 8 normalization: Jarque Bera normality test, Z score if normal, Min Max if not
    z_cols, mm_cols, interp = [], [], list(NUM)
    for c in NORMALIZAR:
        x = df[c].dropna()
        normal = False
        if len(x) > 8 and x.std() > 0:
            jb = len(x) / 6 * (x.skew() ** 2 + x.kurt() ** 2 / 4)
            normal = jb < 5.99  # chi square, 2 degrees of freedom, 5 percent
        if normal:
            df[c + "_z"] = (df[c] - x.mean()) / x.std()
            z_cols.append(c)
            interp.append(c + "_z")
        else:
            lo, hi = x.min(), x.max()
            df[c + "_norm"] = (df[c] - lo) / (hi - lo) if hi > lo else 0.0
            mm_cols.append(c)
            interp.append(c + "_norm")
    passo("8. Normalization", f"Normality test per column. Normal columns got a Z score copy (_z): {', '.join(z_cols) or 'none'}. The others got a Min Max copy (_norm): {', '.join(mm_cols) or 'none'}.")
    df["synthetic"] = 0
    limpo = df.sort_values("unix_ms").reset_index(drop=True)

    # 9 balancing
    antes_n = contagem(limpo)
    razao, acao, texto = decidir(antes_n)
    rng = np.random.default_rng(semente)
    alvo = max(antes_n.values())
    novos = [smote(limpo[limpo["network"] == r], alvo, rng, interp) for r in redes if antes_n.get(r, 0) < alvo]
    com_smote = pd.concat([limpo] + novos, ignore_index=True).sort_values("unix_ms").reset_index(drop=True)
    so_enn = enn(limpo)
    smote_enn = enn(com_smote)
    opcoes = {"smote": contagem(com_smote), "enn": contagem(so_enn), "smoteenn": contagem(smote_enn)}
    if acao == "nothing":
        final = limpo.copy()
    elif acao == "smote":
        final = com_smote
    else:
        final = smote_enn
    depois_n = contagem(final)
    sinteticas = int(final["synthetic"].sum())
    antes_txt = ", ".join(f"{r} {antes_n.get(r, 0)}" for r in redes)
    depois_txt = ", ".join(f"{r} {depois_n.get(r, 0)}" for r in redes)
    op_txt = "; ".join(f"{nome.upper()}: " + ", ".join(f"{r} {v.get(r, 0)}" for r in redes) for nome, v in opcoes.items())
    passo("9. Balancing", f"Cleaned rows: {antes_txt}. {texto} Options tested, SMOTE, ENN and SMOTEENN gave: {op_txt}. Result: {depois_txt}, of which {sinteticas} are new rows between real neighbours.")
    info = {"ratio": float(razao), "action": acao, "before": antes_n, "after": depois_n, "synthetic": sinteticas, "options": opcoes, "limitFine": FINO, "limitSevere": SEVERO}

    final = final.sort_values("unix_ms").reset_index(drop=True)
    final["mode_game"] = (final["mode_game"] >= 0.5).astype(int)
    final["network_id"] = final["network_id"].astype(int)
    final["unix_ms"] = final["unix_ms"].astype("int64")
    for c in [c for c in final.columns if c.startswith("radio_")]:
        final[c] = (final[c] >= 0.5).astype(int)
    return {"events": eventos, "raw": bruto_df, "rows": limpo, "final": final, "steps": passos, "networks": redes, "info": info}
