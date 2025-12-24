import json
import os
import logging
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict
from pathlib import Path

logger = logging.getLogger(__name__)

@dataclass
class Account:
    id: str
    label: str
    api_id: int
    api_hash: str
    phone: str
    session_path: str

class AccountStore:
    def __init__(self, accounts_file: str = "accounts.json"):
        self.accounts_file = accounts_file
        self.accounts: Dict[str, Account] = {}
        self.cloud_storage = None
        self.load()
    
    def _get_cloud_storage(self):
        """Get cloud storage instance (lazy loading)"""
        if not self.cloud_storage:
            try:
                from .cloud_storage import BackblazeB2Storage
                self.cloud_storage = BackblazeB2Storage()
                if not self.cloud_storage.backup_enabled:
                    self.cloud_storage = None
            except Exception as e:
                logger.debug(f"Cloud storage not available: {e}")
                self.cloud_storage = None
        return self.cloud_storage
    
    def load(self):
        """Load accounts from JSON file, try B2 first if available"""
        # Try to restore from B2 first
        cloud_storage = self._get_cloud_storage()
        if cloud_storage:
            try:
                restored_data = cloud_storage.restore_accounts()
                if restored_data:
                    self.accounts = {
                        acc_id: Account(**acc_data) 
                        for acc_id, acc_data in restored_data.items()
                    }
                    # Save locally for faster access
                    self._save_local()
                    logger.info(f"Loaded {len(self.accounts)} accounts from B2")
                    
                    # Try to restore sessions from B2
                    restored_count = 0
                    for account_id, account in self.accounts.items():
                        logger.info(f"Attempting to restore session for account {account_id} from path: {account.session_path}")
                        if cloud_storage.restore_session(account_id, account.session_path):
                            restored_count += 1
                            logger.info(f"Successfully restored session from B2 for account {account_id}")
                        else:
                            logger.warning(f"Failed to restore session from B2 for account {account_id}")
                    logger.info(f"Restored {restored_count}/{len(self.accounts)} sessions from B2")
                    
                    return
            except Exception as e:
                logger.debug(f"Failed to restore from B2, trying local: {e}")
        
        # Fallback to local file
        if os.path.exists(self.accounts_file):
            try:
                with open(self.accounts_file, 'r') as f:
                    data = json.load(f)
                    self.accounts = {
                        acc_id: Account(**acc_data) 
                        for acc_id, acc_data in data.items()
                    }
                
                # Try to restore sessions from B2 even if accounts loaded locally
                cloud_storage = self._get_cloud_storage()
                if cloud_storage:
                    for account_id, account in self.accounts.items():
                        if not os.path.exists(account.session_path):
                            cloud_storage.restore_session(account_id, account.session_path)
            except Exception as e:
                logger.error(f"Error loading accounts: {e}")
                self.accounts = {}
    
    def _save_local(self):
        """Save accounts to local JSON file"""
        try:
            os.makedirs(os.path.dirname(self.accounts_file) if os.path.dirname(self.accounts_file) else '.', exist_ok=True)
            
            data = {
                acc_id: asdict(account) 
                for acc_id, account in self.accounts.items()
            }
            with open(self.accounts_file, 'w') as f:
                json.dump(data, f, indent=2)
            logger.info(f"Saved {len(self.accounts)} accounts to {self.accounts_file}")
        except Exception as e:
            logger.error(f"Error saving accounts locally: {e}")
    
    def save(self):
        """Save accounts to JSON file and backup to B2"""
        try:
            data = {
                acc_id: asdict(account) 
                for acc_id, account in self.accounts.items()
            }
            
            # Save locally first
            self._save_local()
            
            # Backup to B2 if available
            cloud_storage = self._get_cloud_storage()
            if cloud_storage:
                try:
                    cloud_storage.backup_accounts(data)
                except Exception as e:
                    logger.warning(f"Failed to backup accounts to B2: {e}")
                
        except Exception as e:
            logger.error(f"Error saving accounts: {e}")
            import traceback
            traceback.print_exc()
    
    def create_account(self, label: str, api_id: int, api_hash: str, phone: str) -> Account:
        """Create a new account (max 5 accounts)"""
        if len(self.accounts) >= 5:
            raise ValueError("Limit of 5 accounts reached")
        
        # Generate next account ID
        existing_ids = [int(acc_id.split('_')[1]) for acc_id in self.accounts.keys()]
        next_id = 1
        while next_id in existing_ids:
            next_id += 1
        
        account_id = f"acc_{next_id}"
        session_path = f"sessions/tg_ui_session_{account_id}.session"
        
        # Ensure sessions directory exists
        os.makedirs("sessions", exist_ok=True)
        
        account = Account(
            id=account_id,
            label=label,
            api_id=api_id,
            api_hash=api_hash,
            phone=phone,
            session_path=session_path
        )
        
        self.accounts[account_id] = account
        self.save()
        
        # Backup session file to B2 if available
        cloud_storage = self._get_cloud_storage()
        if cloud_storage and os.path.exists(session_path):
            try:
                cloud_storage.backup_session(account_id, session_path)
            except Exception as e:
                logger.warning(f"Failed to backup session to B2: {e}")
        
        logger.info(f"Created account {account_id}: {label}")
        return account
    
    def get_account(self, account_id: str) -> Optional[Account]:
        """Get account by ID"""
        return self.accounts.get(account_id)
    
    def get_all_accounts(self) -> List[Account]:
        """Get all accounts"""
        return list(self.accounts.values())
    
    def delete_account(self, account_id: str) -> bool:
        """Delete account and its session file"""
        if account_id not in self.accounts:
            return False
        
        account = self.accounts[account_id]
        
        # Remove session file if it exists
        try:
            if os.path.exists(account.session_path):
                os.remove(account.session_path)
        except Exception:
            pass  # Ignore errors silently
        
        del self.accounts[account_id]
        self.save()
        return True

# Global store instance
account_store = AccountStore()