#!/bin/bash
# Script to restore accounts and sessions to B2

echo "🔍 Please provide your B2 credentials:"
echo ""

read -p "B2_APPLICATION_KEY_ID: " B2_KEY_ID
read -p "B2_APPLICATION_KEY: " B2_KEY
read -p "B2_BUCKET_NAME: " B2_BUCKET

export B2_APPLICATION_KEY_ID="$B2_KEY_ID"
export B2_APPLICATION_KEY="$B2_KEY"
export B2_BUCKET_NAME="$B2_BUCKET"

echo ""
echo "📦 Starting backup to B2..."
python3 backup_to_b2.py
