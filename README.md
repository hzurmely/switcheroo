# Wifi Switcher

A Windows 11 tray app for people with two Wi-Fi networks (for example a 5G and a 2.4G one). It keeps testing them in the background and switches to the faster one.

## How it works

- Every 30 seconds it measures the network you are on: latency, packet loss and download speed, combined into one score.
- Every 4 minutes it briefly hops to the other network, measures it, and stays only if it scores at least 25 percent better.
- If the current network suddenly drops well below its recent average, it tests the other one right away.
- If the internet dies completely, it jumps to the other network.
- It lives in the system tray and can start with Windows.

## Build the exe

1. Install Python 3.9 or newer on Windows.
2. Put `wifi_switcher.py` and `build.bat` in one folder and double click `build.bat`.
3. Run `dist\WifiSwitcher.exe`, pick your two saved networks, press Start.
4. Right click the tray icon and tick "Start with Windows".

Both networks must already be saved in Windows. Each trial hop causes a few seconds of interruption, since one adapter can only be on one network at a time.

## Settings

Tune the constants at the top of `wifi_switcher.py`: `CHECK_INTERVAL`, `TRIAL_INTERVAL`, `TRIAL_COOLDOWN`, `STAY_MARGIN`, `DEGRADE_RATIO`.
