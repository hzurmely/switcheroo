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

1. Fixes types and formats.
2. Removes duplicates.
3. Fills missing values.
4. Fixes inconsistencies.
5. Drops impossible values and caps outliers (IQR).
6. Encodes and normalizes columns.
7. Balances the networks with one median row per 5 minute window, because the network you stay on is measured far more often than the other.

Outputs: `clean-samples.csv` (balanced), `clean-rows.csv`, `summary.json`, and 5 PNG graphs.
