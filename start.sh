#!/data/data/com.termux/files/usr/bin/bash

cd "$(dirname "$0")"

termux-wake-lock 2>/dev/null || true

if pgrep -f "python.*monitor.py" >/dev/null 2>&1; then
    echo "FB Monitor is already running."
    exit 0
fi

nohup python -u monitor.py >> monitor.log 2>&1 &

echo $! > monitor.pid

echo "FB Monitor started."
echo "View log: tail -f monitor.log"
