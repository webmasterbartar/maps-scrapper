#!/bin/bash
# Simple script to run the scraper

cd "$(dirname "$0")"

echo "🚀 Starting Google Maps Scraper..."
echo "📋 Using furniture keywords from config with all Iran provinces"
echo ""

# Run with default settings (all Iran provinces, furniture keywords from config)
node src/index.js

