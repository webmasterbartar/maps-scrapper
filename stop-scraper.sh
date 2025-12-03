#!/bin/bash
# Script to stop the running scraper

cd "$(dirname "$0")"

if [ -f "scraper.pid" ]; then
    PID=$(cat scraper.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo "🛑 Stopping scraper (PID: ${PID})..."
        kill $PID
        rm scraper.pid
        echo "✅ Scraper stopped."
    else
        echo "⚠️  Process ${PID} not found. Removing stale PID file."
        rm scraper.pid
    fi
else
    echo "⚠️  No PID file found. Searching for running processes..."
    pkill -f "node src/index.js"
    echo "✅ Done."
fi

