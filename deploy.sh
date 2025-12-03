#!/bin/bash
# Script for deploying and running the scraper on server

echo "🚀 Starting deployment..."

# Update system packages
echo "📦 Updating system packages..."
apt-get update -y

# Install Node.js if not installed
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# Install required system dependencies for Puppeteer
echo "📦 Installing system dependencies for Puppeteer..."
apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils

# Clone or update repository
if [ -d "maps-scrapper" ]; then
    echo "📥 Updating repository..."
    cd maps-scrapper
    git pull origin main
else
    echo "📥 Cloning repository..."
    git clone https://github.com/webmasterbartar/maps-scrapper.git
    cd maps-scrapper
fi

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Create output directory
echo "📁 Creating output directory..."
mkdir -p output/temp

# Make scripts executable
chmod +x run.sh
chmod +x start-scraper.sh

echo "✅ Deployment complete!"
echo ""
echo "To run the scraper, use:"
echo "  ./run.sh"
echo "  or"
echo "  ./start-scraper.sh"

