#!/bin/bash

# --- הגדרת נתיבים ושם הפרויקט ---
DESKTOP_DIR="$HOME/Desktop"
# קובע את שם הפרויקט לפי התיקייה הנוכחית
PROJECT_NAME=$(basename "$PWD") 
PROJECT_HISTORY_DIR=""

echo "🔍 מחפש היסטוריית צ'אט עבור פרויקט בשם: $PROJECT_NAME..."

# --- קביעת נתיב האחסון של Cursor ---
CURSOR_STORAGE_DIR="$HOME/Library/Application Support/Cursor/User/workspaceStorage"

if [ ! -d "$CURSOR_STORAGE_DIR" ]; then
    echo "❌ לא נמצאה תיקיית האחסון של Cursor."
    exit 1
fi

# --- מעבר על כל תיקיות ההיסטוריה ---
for dir in "$CURSOR_STORAGE_DIR"/*; do
    if [ -d "$dir" ]; then
        json_file="$dir/workspace.json"
        if [ -f "$json_file" ]; then
            # בודק אם הנתיב בקובץ מכיל את שם הפרויקט
            if grep -q "\"folder\":\".*${PROJECT_NAME}\"" "$json_file"; then
                PROJECT_HISTORY_DIR="$dir"
                echo "✅ נמצאה התיקייה המתאימה!"
                break
            fi
        fi
    fi
done

# --- העתקת התיקייה לשולחן העבודה ---
if [ -n "$PROJECT_HISTORY_DIR" ]; then
    DEST_DIR="$DESKTOP_DIR/Cursor_Chat_History_${PROJECT_NAME}"
    echo "העתקת התיקייה אל: $DEST_DIR"
    cp -R "$PROJECT_HISTORY_DIR" "$DEST_DIR"
    echo "✨ ההעתקה הושלמה בהצלחה\!"
else
    echo "❌ לא נמצאה היסטוריית צ'אט תואמת."
fi
