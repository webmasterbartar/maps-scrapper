#!/bin/bash
# Simple script to run the scraper

cd "$(dirname "$0")"

echo "🚀 Starting Google Maps Scraper..."
echo ""

# Run with default settings (all Iran provinces, keyword: کافه)
node src/index.js --keywords="کافه"

