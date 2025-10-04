#!/usr/bin/env python3
"""
Script to restore conversation history from backup files for the last two months
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
        
    def find_recent_backups(self):
        """Find backup files from the last two months"""
        recent_backups = {
            'checkpoints': [],
            'scan_data': []
        }
        
        if not self.cloud_backups_dir.exists():
            logger.error(f"Cloud backups directory not found: {self.cloud_backups_dir}")
            return recent_backups
            
        for backup_file in self.cloud_backups_dir.glob("*.json"):
            try:
                # Parse timestamp from filename
                parts = backup_file.stem.split('_')
                if len(parts) >= 4:
                    date_part = parts[-2]  # YYYYMMDD
                    time_part = parts[-1]  # HHMMSS
                    
                    # Convert to datetime
                    backup_time = datetime.strptime(f"{date_part}_{time_part}", "%Y%m%d_%H%M%S")
                    
                    if backup_time >= self.two_months_ago:
                        if 'checkpoints' in backup_file.name:
                            recent_backups['checkpoints'].append((backup_file, backup_time))
                        elif 'scan_data' in backup_file.name:
                            recent_backups['scan_data'].append((backup_file, backup_time))
                            
            except Exception as e:
                logger.warning(f"Could not parse timestamp from {backup_file.name}: {e}")
                
        # Sort by timestamp (newest first)
        for backup_type in recent_backups:
            recent_backups[backup_type].sort(key=lambda x: x[1], reverse=True)
            
        return recent_backups
    
    def restore_checkpoints(self, account_id, backup_file):
        """Restore checkpoint data for an account"""
        try:
            with open(backup_file, 'r', encoding='utf-8') as f:
                backup_data = json.load(f)
                
            if 'data' not in backup_data:
                logger.error(f"No data found in backup file: {backup_file}")
                return False
                
            # Create sessions directory if it doesn't exist
            self.sessions_dir.mkdir(exist_ok=True)
            
            # Determine checkpoint file name
            if account_id.startswith('acc_'):
                checkpoint_file = self.sessions_dir / f"checkpoints_{account_id}.json"
            else:
                checkpoint_file = self.sessions_dir / f"checkpoints_{account_id}.json"
                
            # Write checkpoint data
            with open(checkpoint_file, 'w', encoding='utf-8') as f:
                json.dump(backup_data['data'], f, indent=2, ensure_ascii=False)
                
            logger.info(f"✅ Restored checkpoints for account {account_id} from {backup_file.name}")
            return True
            
        except Exception as e:
            logger.error(f"Error restoring checkpoints for account {account_id}: {e}")
            return False
    
    def restore_scan_data(self, account_id, backup_file):
        """Restore scan data for an account"""
        try:
            with open(backup_file, 'r', encoding='utf-8') as f:
                backup_data = json.load(f)
                
            if 'data' not in backup_data:
                logger.error(f"No data found in backup file: {backup_file}")
                return False
                
            # Create sessions directory if it doesn't exist
            self.sessions_dir.mkdir(exist_ok=True)
            
            # Determine scan data file name
            if account_id.startswith('acc_'):
                scan_data_file = self.sessions_dir / f"scan_data_{account_id}.json"
            else:
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
        """Restore conversation history from all recent backups"""
        logger.info("🔄 Starting conversation history restoration...")
        
        # Find recent backups
        recent_backups = self.find_recent_backups()
        
        if not recent_backups['checkpoints'] and not recent_backups['scan_data']:
            logger.warning("No recent backups found from the last two months")
            return False
            
        # Group backups by account
        account_backups = {}
        
        # Process checkpoint backups
        for backup_file, backup_time in recent_backups['checkpoints']:
            account_id = self.extract_account_id(backup_file)
            if account_id not in account_backups:
                account_backups[account_id] = {'checkpoints': None, 'scan_data': None}
            account_backups[account_id]['checkpoints'] = (backup_file, backup_time)
            
        # Process scan data backups
        for backup_file, backup_time in recent_backups['scan_data']:
            account_id = self.extract_account_id(backup_file)
            if account_id not in account_backups:
                account_backups[account_id] = {'checkpoints': None, 'scan_data': None}
            account_backups[account_id]['scan_data'] = (backup_file, backup_time)
            
        # Restore data for each account
        restored_accounts = []
        for account_id, backups in account_backups.items():
            logger.info(f"📱 Processing account: {account_id}")
            
            # Restore checkpoints
            if backups['checkpoints']:
                backup_file, backup_time = backups['checkpoints']
                if self.restore_checkpoints(account_id, backup_file):
                    restored_accounts.append(account_id)
                    
            # Restore scan data
            if backups['scan_data']:
                backup_file, backup_time = backups['scan_data']
                self.restore_scan_data(account_id, backup_file)
                
        logger.info(f"✅ Successfully restored conversation history for {len(restored_accounts)} accounts")
        logger.info(f"📊 Restored accounts: {', '.join(restored_accounts)}")
        
        return True
    
    def create_backup_summary(self):
        """Create a summary of restored data"""
        summary_file = self.project_root / "restoration_summary.json"
        
        recent_backups = self.find_recent_backups()
        
        summary = {
            "restoration_date": datetime.now().isoformat(),
            "two_months_ago": self.two_months_ago.isoformat(),
            "total_checkpoint_backups": len(recent_backups['checkpoints']),
            "total_scan_data_backups": len(recent_backups['scan_data']),
            "checkpoint_files": [str(f) for f, _ in recent_backups['checkpoints']],
            "scan_data_files": [str(f) for f, _ in recent_backups['scan_data']]
        }
        
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
            
        logger.info(f"📄 Restoration summary saved to: {summary_file}")

def main():
    """Main function to restore conversation history"""
    restorer = ConversationHistoryRestorer()
    
    print("🚀 Starting conversation history restoration from the last two months...")
    print(f"📅 Looking for backups from: {restorer.two_months_ago.strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Restore conversation history
    success = restorer.restore_all_conversation_history()
    
    if success:
        # Create summary
        restorer.create_backup_summary()
        print("\n✅ Conversation history restoration completed successfully!")
        print("📁 Check the 'sessions' directory for restored data")
        print("📄 Check 'restoration_summary.json' for detailed information")
    else:
        print("\n❌ Conversation history restoration failed!")
        print("Please check the logs for more information")

if __name__ == "__main__":
    main()
