@echo off
rem Builds WifiSwitcher.exe. Needs Python 3.9 or newer installed on Windows.
cd /d "%~dp0"
python -m pip install pystray pillow pyinstaller
python -m PyInstaller --onefile --windowed --name WifiSwitcher wifi_switcher.py
echo.
echo Done. Your program is dist\WifiSwitcher.exe
echo Run it once, pick your two networks, press Start, then right click the
echo tray icon and tick "Start with Windows".
pause
