# Switcheroo

A Windows 11 app for people with two Wi-Fi networks (for example a 5G and a 2.4G one). It keeps testing both in the background and switches to the faster one.

The interface is a web UI inside Electron, in the style of Discord: a network rail, a live stats panel, a quality chart and an activity feed. It lives in the system tray and can start with Windows.

## Install

Download `Switcheroo-Setup-<version>.exe` from the Releases page, run it, pick your two saved networks and press Start switching. Tick "Start with Windows" and it will launch hidden at login and carry on by itself.

Both networks must already be saved in Windows (connect to each one once).

## How it decides

- Every 30 seconds it measures the active network: latency, packet loss and download speed, combined into one score.
- Every 4 minutes it hops to the other network, measures it, and stays only if it scores at least 25 percent better.
- If the active network suddenly drops below 60 percent of its recent average, it tests the other one right away.
- If the internet dies completely, it jumps to the other network.

Each trial hop causes a few seconds of interruption, since one adapter can only be on one network at a time. Speed checks use roughly 2 MB each from Cloudflare.

## Run from source

```
npm install
npm start
npm test
npm run dist
```

Tune the timings in `engine.js` (`DEFAULTS`).
