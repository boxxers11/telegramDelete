import json
import os
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict
from pathlib import Path

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
        self.load()
    
    def load(self):
        """Load accounts from JSON file"""
        if os.path.exists(self.accounts_file):
            try:
                with open(self.accounts_file, 'r') as f:
                    data = json.load(f)
                    self.accounts = {
                        acc_id: Account(**acc_data) 
                        for acc_id, acc_data in data.items()
                    }
            except Exception as e:
                print(f"Error loading accounts: {e}")
                self.accounts = {}
    
    def save(self):
        """Save accounts to JSON file"""
        try:
            # Ensure the directory exists
            import os
            os.makedirs(os.path.dirname(self.accounts_file) if os.path.dirname(self.accounts_file) else '.', exist_ok=True)
            
            data = {
                acc_id: asdict(account) 
                for acc_id, account in self.accounts.items()
            }
            with open(self.accounts_file, 'w') as f:
                json.dump(data, f, indent=2)
            print(f"Saved {len(self.accounts)} accounts to {self.accounts_file}")
            
            # Verify the file was written correctly
            if os.path.exists(self.accounts_file):
                with open(self.accounts_file, 'r') as f:
                    verify_data = json.load(f)
                    print(f"Verified: {len(verify_data)} accounts in file")
            else:
                print("ERROR: accounts.json file was not created!")
                
        except Exception as e:
            print(f"Error saving accounts: {e}")
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
        print(f"Created account {account_id}: {label}")
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