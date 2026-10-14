# Switcheroo data cleaning (Python)

`analyze.py` cleans the saved measurements with pandas and makes the graphs shown in the app under Averages, Clean.

Install once: `python -m pip install -r requirements.txt`

Run by hand: `python analyze.py raw.csv outfolder [networkA] [householdName]`

## The data keeps changing

Switcheroo adds a measurement every 30 seconds, so nothing here is a fixed dataset.

* The script reads whatever CSV it is given and keeps no state, so every run is a fresh result from the current data.
* The app exports a new `raw.csv` from the saved measurements right before each run, then overwrites `clean-samples.csv`, `clean-rows.csv`, `summary.json` and the graphs.
* Row counts, percentiles and outlier limits are recalculated on every run. Nothing is hard coded, and it works with any number of rows and either network.
* The Clean table in the app is also live. It is calculated in JavaScript (`store.js`, `cleanAverages`) using the same rules, so it updates without running Python, and game mode uses it.

## What it does

The steps live in `switcheroo_clean.py` and follow the Data Mining preprocessing order. `analyze.py` runs them and draws the graphs, and the notebook kernel runs the same code, so the Python tab, the CSVs and the app agree.

1. Types and formats.
2. Duplicates.
3. Missing values: median of each network for numbers, mode for radio type only if one type clearly dominates, otherwise Desconhecido.
4. Inconsistencies: a speed of 0 is a failed test, the band comes from the channel.
5. Outliers: impossible rows are removed, high but possible values are capped at Q3 plus 1.5 times IQR.
6. Encoding: mode 0 or 1, network id, One Hot radio.
7. Normalization: normality test per column, Z score if normal, Min Max if not.
8. Balancing, decided by the gap between the networks:

```
ratio = rows of the smaller network / rows of the bigger one
if ratio >= 0.8:      nothing is done
elif ratio >= 0.4:    SMOTE, the smaller network gets new rows between neighbouring real rows
else:                 SMOTEENN, SMOTE and then ENN (at most 15 percent of a network removed)
```

SMOTE, ENN and SMOTEENN are all tried and their counts are written in the summary, but only the one the rule picks is applied. Real rows are never dropped just to even out the counts.

Outputs: `clean-samples.csv` (final data, the `synthetic` column marks new rows), `clean-rows.csv` (cleaned real rows only), `summary.json`, and 5 PNG graphs.

The same rules also exist in JavaScript (`balance.js` and `store.js`) so the Clean table in the app and game mode do not need Python.
