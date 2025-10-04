#!/usr/bin/env python3
"""
Improved script to restore conversation history from backup files with actual data
"""

import json
import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ConversationHistoryRestorer:
    def __init__(self, project_root="/Users/haimrep/telegramDelete"):
        self.project_root = Path(project_root)
        self.cloud_backups_dir = self.project_root / "cloud_backups"
        self.sessions_dir = self.project_root / "sessions"
        self.two_months_ago = datetime.now() - timedelta(days=60)
        
    def find_backups_with_data(self):
        """Find backup files with actual data from the last two months"""
        backups_with_data = {
            'checkpoints': [],
            'scan_data': []
        }
        
        if not self.cloud_backups_dir.exists():
            logger.error(f"Cloud backups directory not found: {self.cloud_backups_dir}")
            return backups_with_data
            
        for backup_file in self.cloud_backups_dir.glob("*.json"):
            try:
                # Check file size (must be > 1KB to have actual data)
                if backup_file.stat().st_size < 1024:
                    continue
                    
                # Parse timestamp from filename
                parts = backup_file.stem.split('_')
                if len(parts) >= 4:
                    date_part = parts[-2]  # YYYYMMDD
                    time_part = parts[-1]  # HHMMSS
                    
                    # Convert to datetime
                    backup_time = datetime.strptime(f"{date_part}_{time_part}", "%Y%m%d_%H%M%S")
                    
                    if backup_time >= self.two_months_ago:
                        # Verify the backup has actual data
                        with open(backup_file, 'r', encoding='utf-8') as f:
                            backup_data = json.load(f)
                            
                        if 'data' in backup_data and backup_data['data']:
                            if 'checkpoints' in backup_file.name:
                                backups_with_data['checkpoints'].append((backup_file, backup_time, backup_data))
                            elif 'scan_data' in backup_file.name:
                                backups_with_data['scan_data'].append((backup_file, backup_time, backup_data))
                            
            except Exception as e:
                logger.warning(f"Could not process {backup_file.name}: {e}")
                
        # Sort by timestamp (newest first)
        for backup_type in backups_with_data:
            backups_with_data[backup_type].sort(key=lambda x: x[1], reverse=True)
            
        return backups_with_data
    
    def restore_checkpoints(self, account_id, backup_file, backup_data):
        """Restore checkpoint data for an account"""
        try:
            # Create sessions directory if it doesn't exist
            self.sessions_dir.mkdir(exist_ok=True)
            
            # Determine checkpoint file name
            checkpoint_file = self.sessions_dir / f"checkpoints_{account_id}.json"
                
            # Write checkpoint data
            with open(checkpoint_file, 'w', encoding='utf-8') as f:
                json.dump(backup_data['data'], f, indent=2, ensure_ascii=False)
                
            # Count conversations
            conversation_count = len(backup_data['data']) if isinstance(backup_data['data'], dict) else 0
            logger.info(f"✅ Restored {conversation_count} conversations for account {account_id} from {backup_file.name}")
            return True
            
        except Exception as e:
            logger.error(f"Error restoring checkpoints for account {account_id}: {e}")
            return False
    
    def restore_scan_data(self, account_id, backup_file, backup_data):
        """Restore scan data for an account"""
        try:
            # Create sessions directory if it doesn't exist
            self.sessions_dir.mkdir(exist_ok=True)
            
            # Determine scan data file name
            scan_data_file = self.sessions_dir / f"scan_data_{account_id}.json"
                
            # Write scan data
            with open(scan_data_file, 'w', encoding='utf-8') as f:
                json.dump(backup_data['data'], f, indent=2, ensure_ascii=False)
                
            logger.info(f"✅ Restored scan data for account {account_id} from {backup_file.name}")
            return True
            
        except Exception as e:
            logger.error(f"Error restoring scan data for account {account_id}: {e}")
            return False
    
    def extract_account_id(self, backup_file):
        """Extract account ID from backup filename"""
        filename = backup_file.name
        parts = filename.split('_')
        
        # Look for account ID patterns
        for i, part in enumerate(parts):
            if part in ['1', '2', '3'] or part.startswith('acc_'):
                return part
                
        return 'default'
    
    def restore_all_conversation_history(self):
        """Restore conversation history from all recent backups with actual data"""
        logger.info("🔄 Starting conversation history restoration from backups with actual data...")
        
        # Find backups with actual data
        backups_with_data = self.find_backups_with_data()
        
        if not backups_with_data['checkpoints'] and not backups_with_data['scan_data']:
            logger.warning("No recent backups with actual data found from the last two months")
            return False
            
        # Group backups by account
        account_backups = {}
        
        # Process checkpoint backups
        for backup_file, backup_time, backup_data in backups_with_data['checkpoints']:
            account_id = self.extract_account_id(backup_file)
            if account_id not in account_backups:
                account_backups[account_id] = {'checkpoints': None, 'scan_data': None}
            account_backups[account_id]['checkpoints'] = (backup_file, backup_time, backup_data)
            
        # Process scan data backups
        for backup_file, backup_time, backup_data in backups_with_data['scan_data']:
            account_id = self.extract_account_id(backup_file)
            if account_id not in account_backups:
                account_backups[account_id] = {'checkpoints': None, 'scan_data': None}
            account_backups[account_id]['scan_data'] = (backup_file, backup_time, backup_data)
            
        # Restore data for each account
        restored_accounts = []
        total_conversations = 0
        
        for account_id, backups in account_backups.items():
            logger.info(f"📱 Processing account: {account_id}")
            
            # Restore checkpoints
            if backups['checkpoints']:
                backup_file, backup_time, backup_data = backups['checkpoints']
                if self.restore_checkpoints(account_id, backup_file, backup_data):
                    restored_accounts.append(account_id)
                    # Count conversations
                    if isinstance(backup_data['data'], dict):
                        total_conversations += len(backup_data['data'])
                    
            # Restore scan data
            if backups['scan_data']:
                backup_file, backup_time, backup_data = backups['scan_data']
                self.restore_scan_data(account_id, backup_file, backup_data)
                
        logger.info(f"✅ Successfully restored conversation history for {len(restored_accounts)} accounts")
        logger.info(f"📊 Total conversations restored: {total_conversations}")
        logger.info(f"📱 Restored accounts: {', '.join(restored_accounts)}")
        
        return True
    
    def create_restoration_report(self):
        """Create a detailed restoration report"""
        report_file = self.project_root / "conversation_history_restoration_report.json"
        
        backups_with_data = self.find_backups_with_data()
        
        # Count conversations in each backup
        checkpoint_summary = []
        for backup_file, backup_time, backup_data in backups_with_data['checkpoints']:
            account_id = self.extract_account_id(backup_file)
            conversation_count = len(backup_data['data']) if isinstance(backup_data['data'], dict) else 0
            checkpoint_summary.append({
                "account_id": account_id,
                "backup_file": str(backup_file),
                "backup_time": backup_time.isoformat(),
                "conversation_count": conversation_count
            })
        
        report = {
            "restoration_date": datetime.now().isoformat(),
            "two_months_ago": self.two_months_ago.isoformat(),
            "total_checkpoint_backups_with_data": len(backups_with_data['checkpoints']),
            "total_scan_data_backups_with_data": len(backups_with_data['scan_data']),
            "checkpoint_summary": checkpoint_summary,
            "total_conversations_restored": sum(item['conversation_count'] for item in checkpoint_summary)
        }
        
        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
            
        logger.info(f"📄 Detailed restoration report saved to: {report_file}")

def main():
    """Main function to restore conversation history"""
    restorer = ConversationHistoryRestorer()
    
    print("🚀 Starting improved conversation history restoration from the last two months...")
    print(f"📅 Looking for backups with actual data from: {restorer.two_months_ago.strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Restore conversation history
    success = restorer.restore_all_conversation_history()
    
    if success:
        # Create detailed report
        restorer.create_restoration_report()
        print("\n✅ Conversation history restoration completed successfully!")
        print("📁 Check the 'sessions' directory for restored data")
        print("📄 Check 'conversation_history_restoration_report.json' for detailed information")
    else:
        print("\n❌ Conversation history restoration failed!")
        print("Please check the logs for more information")

if __name__ == "__main__":
    main()
