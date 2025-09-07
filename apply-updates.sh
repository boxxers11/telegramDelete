#!/bin/bash

echo "🔄 Applying Bolt updates to local files..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Apply the patch
if [ -f "bolt-updates.patch" ]; then
    echo "📝 Applying patch file..."
    git apply bolt-updates.patch
    
    if [ $? -eq 0 ]; then
        echo "✅ Updates applied successfully!"
        echo "🚀 Now restart your server with:"
        echo "   ./run.sh (Mac/Linux) or run.bat (Windows)"
        
        # Optional: commit the changes
        read -p "📤 Do you want to commit these changes to git? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git add .
            git commit -m "Apply Bolt updates: Fix login authentication issues"
            echo "✅ Changes committed to git!"
        fi
    else
        echo "❌ Failed to apply patch. You may need to apply changes manually."
    fi
else
    echo "❌ bolt-updates.patch file not found"
fi