#!/usr/bin/env python3
"""
Script to upload accounts.json and session files to Backblaze B2.
This will restore all accounts on Render without requiring re-authentication.
"""
import os
import sys
import json
from pathlib import Path

# Add app directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.cloud_storage import BackblazeB2Storage

def main():
    print("🔍 Uploading accounts and sessions to B2...")
    print("")
    
    # Get B2 credentials from environment or user input
    key_id = os.getenv('B2_APPLICATION_KEY_ID')
    key = os.getenv('B2_APPLICATION_KEY')
    bucket = os.getenv('B2_BUCKET_NAME')
    
    if not key_id:
        key_id = input("B2_APPLICATION_KEY_ID: ").strip()
    if not key:
        key = input("B2_APPLICATION_KEY: ").strip()
    if not bucket:
        bucket = input("B2_BUCKET_NAME: ").strip()
    
    # Initialize B2 storage
    b2_storage = BackblazeB2Storage(
        application_key_id=key_id,
        application_key=key,
        bucket_name=bucket
    )
    
    if not b2_storage.backup_enabled:
        print("❌ Failed to initialize B2!")
        return False
    
    print(f"✅ Connected to B2 bucket: {b2_storage.bucket_name}")
    print("")
    
    # Load and upload accounts.json
    print("📦 Uploading accounts.json...")
    if os.path.exists("accounts.json"):
        with open("accounts.json", 'r') as f:
            accounts_data = json.load(f)
        
        if b2_storage.backup_accounts(accounts_data):
            print(f"   ✅ Uploaded {len(accounts_data)} accounts")
        else:
            print("   ❌ Failed to upload accounts.json")
            return False
    else:
        print("   ⚠️  accounts.json not found")
        return False
    
    # Upload session files
    print("\n📦 Uploading session files...")
    sessions_dir = Path("sessions")
    uploaded_sessions = 0
    
    if sessions_dir.exists():
        for acc_id, acc_data in accounts_data.items():
            session_path = acc_data.get('session_path', f"sessions/tg_ui_session_{acc_id}.session")
            
            if os.path.exists(session_path):
                if b2_storage.backup_session(acc_id, session_path):
                    uploaded_sessions += 1
                    print(f"   ✅ Uploaded session for {acc_id} ({acc_data.get('label', 'N/A')})")
                else:
                    print(f"   ⚠️  Failed to upload session for {acc_id}")
            else:
                print(f"   ⚠️  Session file not found: {session_path}")
    
    print(f"\n✅ Upload complete!")
    print(f"   - Accounts: {len(accounts_data)}")
    print(f"   - Sessions: {uploaded_sessions}/{len(accounts_data)}")
    print("\n💡 Render will automatically restore these accounts on next deployment/restart.")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
