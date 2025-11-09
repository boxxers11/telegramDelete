#!/usr/bin/env python3
"""
סקריפט להעברת שיחות מ-MCP של קודקס לפרויקט
"""

import os
import shutil
import json
import sqlite3
from datetime import datetime
from pathlib import Path

class MCPConversationImporter:
    def __init__(self, project_root="/Users/haimrep/telegramDelete"):
        self.project_root = Path(project_root)
        self.conversations_dir = self.project_root / "conversations"
        self.conversations_dir.mkdir(exist_ok=True)
        
    def find_cursor_chat_files(self):
        """מחפש קבצי שיחות של Cursor"""
        possible_locations = [
            Path.home() / "Library/Application Support/Cursor/User/workspaceStorage",
            Path.home() / "Desktop/Cursor_Chat_History_telegramDelete_current",
            Path.home() / "Desktop/Cursor_Chat_History_telegramDelete_old1", 
            Path.home() / "Desktop/Cursor_Chat_History_telegramDelete_old2",
        ]
        
        found_files = []
        for location in possible_locations:
            if location.exists():
                for file in location.rglob("state.vscdb"):
                    found_files.append(file)
                for file in location.rglob("*.json"):
                    found_files.append(file)
        
        return found_files
    
    def extract_conversations_from_sqlite(self, db_path):
        """מחלץ שיחות מקובץ SQLite של Cursor"""
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # מחפש טבלאות שיחות
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = cursor.fetchall()
            
            conversations = []
            for table in tables:
                table_name = table[0]
                if 'chat' in table_name.lower() or 'conversation' in table_name.lower():
                    cursor.execute(f"SELECT * FROM {table_name}")
                    rows = cursor.fetchall()
                    conversations.extend(rows)
            
            conn.close()
            return conversations
        except Exception as e:
            print(f"שגיאה בקריאת {db_path}: {e}")
            return []
    
    def import_conversations(self):
        """מייבא את כל השיחות"""
        print("🔍 מחפש קבצי שיחות של Cursor...")
        
        chat_files = self.find_cursor_chat_files()
        print(f"📁 נמצאו {len(chat_files)} קבצים")
        
        imported_count = 0
        
        for i, file_path in enumerate(chat_files):
            print(f"📄 מעבד קובץ {i+1}/{len(chat_files)}: {file_path.name}")
            
            # יוצר תיקייה לכל קובץ
            file_dir = self.conversations_dir / f"conversation_{i+1}_{file_path.stem}"
            file_dir.mkdir(exist_ok=True)
            
            # מעתיק את הקובץ המקורי
            try:
                shutil.copy2(file_path, file_dir / file_path.name)
                
                # אם זה קובץ SQLite, מנסה לחלץ שיחות
                if file_path.suffix == '.vscdb':
                    conversations = self.extract_conversations_from_sqlite(file_path)
                    if conversations:
                        with open(file_dir / "extracted_conversations.json", "w", encoding="utf-8") as f:
                            json.dump(conversations, f, ensure_ascii=False, indent=2)
                
                # יוצר קובץ מידע
                info = {
                    "source_file": str(file_path),
                    "import_date": datetime.now().isoformat(),
                    "file_size": file_path.stat().st_size,
                    "file_type": file_path.suffix
                }
                
                with open(file_dir / "import_info.json", "w", encoding="utf-8") as f:
                    json.dump(info, f, ensure_ascii=False, indent=2)
                
                imported_count += 1
                print(f"✅ יובא בהצלחה: {file_path.name}")
                
            except Exception as e:
                print(f"❌ שגיאה בייבוא {file_path.name}: {e}")
        
        print(f"\n🎉 הושלם! יובאו {imported_count} קבצי שיחות")
        print(f"📁 השיחות נשמרו ב: {self.conversations_dir}")
        
        return imported_count

def main():
    print("🚀 מתחיל ייבוא שיחות מ-MCP של קודקס...")
    
    importer = MCPConversationImporter()
    imported_count = importer.import_conversations()
    
    if imported_count > 0:
        print(f"\n✅ יובאו בהצלחה {imported_count} קבצי שיחות!")
        print("📁 הקבצים נשמרו בתיקיית conversations/")
    else:
        print("\n⚠️ לא נמצאו קבצי שיחות לייבוא")

if __name__ == "__main__":
    main()
