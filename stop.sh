#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
[ -f monitor.pid ] && kill "$(cat monitor.pid)" 2>/dev/null || true
rm -f monitor.pid
pkill -f "python.*monitor.py" 2>/dev/null || true
pkill -f chromium 2>/dev/null || true
termux-wake-unlock 2>/dev/null || true
echo "FB Monitor stopped."
