#!/bin/bash

echo "🚀 Pushing content to Notion..."

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
    echo "📄 Loading environment variables from .env file..."
    source .env
fi

# Check if content_payload.json exists
if [ ! -f "content_payload.json" ]; then
    echo "❌ Error: content_payload.json file not found"
    exit 1
fi

# Check if we have the required environment variables
if [ -z "$NOTION_API_KEY" ] || [ -z "$NOTION_DATABASE_ID" ]; then
    echo "❌ Error: Please set NOTION_API_KEY and NOTION_DATABASE_ID environment variables"
    echo ""
    echo "Run setup first:"
    echo "   ./setup_notion.sh"
    echo ""
    echo "Or set manually:"
    echo "   export NOTION_API_KEY='your_api_key_here'"
    echo "   export NOTION_DATABASE_ID='your_database_id_here'"
    exit 1
fi

echo "📝 Reading content from content_payload.json..."

# Use curl to push to Notion API
curl -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Notion-Version: 2022-06-28" \
  -d @content_payload.json

if [ $? -eq 0 ]; then
    echo "✅ Content pushed to Notion successfully!"
else
    echo "❌ Failed to push content to Notion"
    exit 1
fi
