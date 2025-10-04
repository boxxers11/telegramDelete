#!/bin/bash

echo "🔧 Setting up Notion integration..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file..."
    touch .env
fi

echo "📋 Please provide your Notion credentials:"
echo ""

# Get API Key
read -p "🔑 Enter your Notion API Key: " notion_api_key
if [ -n "$notion_api_key" ]; then
    echo "NOTION_API_KEY=$notion_api_key" >> .env
    echo "✅ API Key saved to .env"
fi

echo ""

# Get Database ID
read -p "🗄️  Enter your Notion Database ID: " notion_database_id
if [ -n "$notion_database_id" ]; then
    echo "NOTION_DATABASE_ID=$notion_database_id" >> .env
    echo "✅ Database ID saved to .env"
fi

echo ""
echo "🎉 Setup complete! You can now run:"
echo "   source .env && ./push_content.sh"
echo ""
echo "Or set the environment variables manually:"
echo "   export NOTION_API_KEY='your_key_here'"
echo "   export NOTION_DATABASE_ID='your_db_id_here'"
echo "   ./push_content.sh"
