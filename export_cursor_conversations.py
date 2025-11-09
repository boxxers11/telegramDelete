#!/usr/bin/env python3
"""
סקריפט לייצוא שיחות מ-Cursor דרך ממשק MCP
"""

import json
import os
from datetime import datetime
from pathlib import Path

class CursorConversationExporter:
    def __init__(self, project_root="/Users/haimrep/telegramDelete"):
        self.project_root = Path(project_root)
        self.export_dir = self.project_root / "exported_conversations"
        self.export_dir.mkdir(exist_ok=True)
    
    def export_conversation_history(self):
        """מייצא את היסטוריית השיחות הנוכחית"""
        export_data = {
            "export_date": datetime.now().isoformat(),
            "project": "telegramDelete",
            "conversations": []
        }
        
        # מחפש קבצי שיחות קיימים בפרויקט
        conversation_files = [
            "OUR_AI_CONVERSATIONS_SUMMARY.md",
            "OUR_CONVERSATIONS_SUMMARY.md", 
            "conversation_history_restoration_report.json",
            "restoration_summary.json"
        ]
        
        for file_name in conversation_files:
            file_path = self.project_root / file_name
            if file_path.exists():
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    export_data["conversations"].append({
                        "file_name": file_name,
                        "content": content,
                        "file_size": file_path.stat().st_size,
                        "last_modified": datetime.fromtimestamp(file_path.stat().st_mtime).isoformat()
                    })
                    
                    print(f"✅ יוצא: {file_name}")
                    
                except Exception as e:
                    print(f"❌ שגיאה בייצוא {file_name}: {e}")
        
        # שומר את כל הנתונים
        export_file = self.export_dir / f"conversations_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        with open(export_file, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)
        
        print(f"\n📁 הייצוא נשמר ב: {export_file}")
        print(f"📊 יוצאו {len(export_data['conversations'])} קבצי שיחות")
        
        return export_file

def main():
    print("📤 מתחיל ייצוא שיחות מ-Cursor...")
    
    exporter = CursorConversationExporter()
    export_file = exporter.export_conversation_history()
    
    print(f"\n🎉 הייצוא הושלם!")
    print(f"📁 קובץ הייצוא: {export_file}")
    print("\n💡 עכשיו תוכל להעביר את הקובץ הזה לכל מקום שתרצה!")

if __name__ == "__main__":
    main()
