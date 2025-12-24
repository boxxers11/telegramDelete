#!/usr/bin/env python3
"""
Script to backup all critical data to Backblaze B2 before removing from git.
This ensures all accounts, sessions, and checkpoints are safely stored in B2.
"""
import os
import sys
import json
from pathlib import Path

# Add app directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.cloud_storage import BackblazeB2Storage
from app.accounts import account_store

def main():
    print("🔍 Checking B2 configuration...")
    
    # Check if B2 is configured
    b2_storage = BackblazeB2Storage()
    if not b2_storage.backup_enabled:
        print("❌ B2 not configured!")
        print("Please set environment variables:")
        print("  - B2_APPLICATION_KEY_ID")
        print("  - B2_APPLICATION_KEY")
        print("  - B2_BUCKET_NAME")
        return False
    
    print("✅ B2 configured successfully")
    print(f"   Bucket: {b2_storage.bucket_name}")
    
    # Backup accounts.json
    print("\n📦 Backing up accounts.json...")
    if os.path.exists("accounts.json"):
        with open("accounts.json", 'r') as f:
            accounts_data = json.load(f)
        
        if b2_storage.backup_accounts(accounts_data):
            print("   ✅ accounts.json backed up successfully")
        else:
            print("   ❌ Failed to backup accounts.json")
            return False
    else:
        print("   ⚠️  accounts.json not found (no accounts yet)")
    
    # Backup sessions
    print("\n📦 Backing up session files...")
    sessions_dir = Path("sessions")
    if sessions_dir.exists():
        session_files = list(sessions_dir.glob("*.session"))
        if session_files:
            print(f"   Found {len(session_files)} session files")
            
            # Get account IDs from accounts.json
            accounts = account_store.get_all_accounts()
            account_ids = {acc.id for acc in accounts}
            
            backed_up = 0
            for session_file in session_files:
                # Try to find account ID from filename
                # Format: tg_ui_session_acc_X.session
                filename = session_file.name
                if "acc_" in filename:
                    try:
                        # Extract account ID (e.g., "acc_1" from "tg_ui_session_acc_1.session")
                        parts = filename.replace("tg_ui_session_", "").replace(".session", "").split("_")
                        if len(parts) >= 2 and parts[0] == "acc":
                            account_id = f"acc_{parts[1]}"
                        else:
                            account_id = filename.replace("tg_ui_session_", "").replace(".session", "")
                        
                        if b2_storage.backup_session(account_id, str(session_file)):
                            backed_up += 1
                            print(f"   ✅ Backed up {filename} for {account_id}")
                        else:
                            print(f"   ⚠️  Failed to backup {filename}")
                    except Exception as e:
                        print(f"   ⚠️  Error backing up {filename}: {e}")
                else:
                    print(f"   ⚠️  Skipping {filename} (unknown format)")
            
            print(f"   ✅ Backed up {backed_up}/{len(session_files)} session files")
        else:
            print("   ℹ️  No session files found")
    else:
        print("   ℹ️  sessions/ directory not found")
    
    # Backup checkpoints for each account
    print("\n📦 Backing up checkpoints...")
    accounts = account_store.get_all_accounts()
    if accounts:
        for account in accounts:
            account_id = account.id
            checkpoints_file = Path(f"sessions/checkpoints_{account_id}.json")
            
            if checkpoints_file.exists():
                try:
                    with open(checkpoints_file, 'r') as f:
                        checkpoints = json.load(f)
                    
                    if b2_storage.backup_checkpoints(account_id, checkpoints):
                        print(f"   ✅ Backed up checkpoints for {account_id}")
                    else:
                        print(f"   ⚠️  Failed to backup checkpoints for {account_id}")
                except Exception as e:
                    print(f"   ⚠️  Error backing up checkpoints for {account_id}: {e}")
            else:
                print(f"   ℹ️  No checkpoints found for {account_id}")
    else:
        print("   ℹ️  No accounts found")
    
    print("\n✅ Backup completed!")
    print("\n📋 Summary:")
    print("   - accounts.json: ✅ Backed up")
    print("   - sessions: ✅ Backed up")
    print("   - checkpoints: ✅ Backed up")
    print("\n💡 You can now safely remove these files from git.")
    print("   They will be restored from B2 when the app starts on Render.")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
