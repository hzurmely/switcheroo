<p align="center"><img src="logo.png" width="128" alt="Switcheroo logo"></p>

# Switcheroo

A Windows 10 and 11 app for people with two Wi-Fi networks (for example a 5G and a 2.4G one). It keeps testing both in the background and switches to the faster one.

The interface is a web UI inside Electron, in the style of Discord: a network rail, a live stats panel, a quality chart and an activity feed. It lives in the system tray and can start with Windows.

## Install

Download `Switcheroo-Setup-<version>.exe` from the Releases page, run it, pick your two saved networks and press Start switching. Tick "Start with Windows" and it will launch hidden at login and carry on by itself.

Both networks must already be saved in Windows (connect to each one once).

Or with Windows Package Manager: `winget install hzurmely.Switcheroo`

## Updates

The installed app checks GitHub for a new release every few hours, downloads it quietly and installs it the next time you quit. The tray menu also has Check for updates and, once one is ready, Restart to update.

## Households

Add a household for each place you live, each with its own pair of networks (the + button in the left rail). When your PC joins a network that belongs to another household, Switcheroo follows it automatically.

## Averages

The Averages tab shows the average speed, latency and packet loss of each network, over the last 24 hours, 7 days or everything saved.

## Game mode

When a known game is running (or any exe you add in Settings), Switcheroo switches once to the network with the better averages, ranked mostly by latency and packet loss. While you play it only pings, so tests never add lag, and it never hops networks mid match. When the game closes it goes back to normal switching.

## Saved data

Every measurement is saved to `Documents/Switcheroo Data` (you can change the folder). When the folder passes the size limit (50 MB by default), the oldest days are deleted until it is under 80 percent, and their totals are kept so averages stay correct.

## How it decides

- Every 30 seconds it measures the active network: latency, packet loss and download speed, combined into one score.
- Every 4 minutes it hops to the other network, measures it, and stays only if it scores at least 25 percent better.
- If the active network suddenly drops below 60 percent of its recent average, it tests the other one right away.
- If the internet dies completely, it jumps to the other network.

Each trial hop causes a few seconds of interruption, since one adapter can only be on one network at a time. Speed checks use roughly 2 MB each from Cloudflare.

## Privacy

Switcheroo sends pings to Cloudflare (1.1.1.1) and Google DNS (8.8.8.8), downloads a 2 MB test file from Cloudflare to measure speed, and asks GitHub for new versions. Your measurements stay in the data folder on your PC. Nothing else leaves it. To uninstall, use Windows Settings, Apps, Installed apps. The installer changes nothing outside its own folder, a Start menu shortcut, and the optional Start with Windows entry.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org). Once signing is active, releases are built from this repository by GitHub Actions and every signing request is approved by the maintainer, hzurmely, who is the only author, reviewer and approver.

## Run from source

```
npm install
npm start
npm test
npm run dist
```

Tune the timings in `engine.js` (`DEFAULTS`).
