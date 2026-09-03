#!/data/data/com.termux/files/usr/bin/bash
set -e

pkg update
pkg install -y python nodejs x11-repo termux-api
pkg install -y chromium

cd "$(dirname "$0")"

npm install playwright-core@1.58.2

chmod +x monitor.py start.sh stop.sh

echo
echo "Installation complete"
echo "Chromium path:"
which chromium-browser || which chromium || true
echo
echo "Test: python monitor.py --once"
