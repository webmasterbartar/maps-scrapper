#!/bin/bash
# Production script to run scraper with nohup and logging

cd "$(dirname "$0")"

# Create logs directory if it doesn't exist
mkdir -p logs

# Get timestamp for log file
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="logs/scraper_${TIMESTAMP}.log"

echo "🚀 Starting Google Maps Scraper..."
echo "📝 Logs will be saved to: ${LOG_FILE}"
echo ""

# Run with nohup (runs in background, survives SSH disconnect)
# Redirect both stdout and stderr to log file
nohup node src/index.js --keywords="کافه" > "${LOG_FILE}" 2>&1 &

# Get the process ID
PID=$!

echo "✅ Scraper started with PID: ${PID}"
echo "📝 To view logs: tail -f ${LOG_FILE}"
echo "🛑 To stop: kill ${PID}"
echo ""
echo "Process is running in background. You can safely disconnect from SSH."

# Save PID to file for easy management
echo ${PID} > scraper.pid
echo "PID saved to scraper.pid"

