import json
import os
import requests
import logging
from datetime import datetime
from typing import Dict, Optional, Any
from dataclasses import asdict
import hashlib

logger = logging.getLogger(__name__)

class CloudStorageManager:
    """Manages cloud backup and restore of scan data and checkpoints"""
    
    def __init__(self, cloud_endpoint: str = None, api_key: str = None):
        self.cloud_endpoint = cloud_endpoint or os.getenv('CLOUD_STORAGE_ENDPOINT')
        self.api_key = api_key or os.getenv('CLOUD_STORAGE_API_KEY')
        self.backup_enabled = bool(self.cloud_endpoint and self.api_key)
        
        if not self.backup_enabled:
            logger.warning("Cloud storage not configured. Data will only be stored locally.")
    
    def _get_backup_filename(self, account_id: str, data_type: str) -> str:
        """Generate backup filename for cloud storage"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"telegram_delete_backup_{account_id}_{data_type}_{timestamp}.json"
    
    def _calculate_hash(self, data: Dict) -> str:
        """Calculate hash of data for integrity checking"""
        data_str = json.dumps(data, sort_keys=True, ensure_ascii=False)
        return hashlib.md5(data_str.encode('utf-8')).hexdigest()
    
    def backup_checkpoints(self, account_id: str, checkpoints: Dict) -> bool:
        """Backup checkpoints to cloud storage"""
        if not self.backup_enabled:
            return False
            
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'checkpoints',
                'timestamp': datetime.now().isoformat(),
                'data': checkpoints,
                'hash': self._calculate_hash(checkpoints)
            }
            
            filename = self._get_backup_filename(account_id, 'checkpoints')
            
            # Upload to cloud storage
            response = requests.post(
                f"{self.cloud_endpoint}/upload",
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json'
                },
                json={
                    'filename': filename,
                    'data': backup_data
                },
                timeout=30
            )
            
            if response.status_code == 200:
                logger.info(f"Successfully backed up checkpoints for account {account_id}")
                return True
            else:
                logger.error(f"Failed to backup checkpoints: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"Error backing up checkpoints: {e}")
            return False
    
    def backup_scan_data(self, account_id: str, scan_data: Dict) -> bool:
        """Backup scan data to cloud storage"""
        if not self.backup_enabled:
            return False
            
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'scan_data',
                'timestamp': datetime.now().isoformat(),
                'data': scan_data,
                'hash': self._calculate_hash(scan_data)
            }
            
            filename = self._get_backup_filename(account_id, 'scan_data')
            
            # Upload to cloud storage
            response = requests.post(
                f"{self.cloud_endpoint}/upload",
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json'
                },
                json={
                    'filename': filename,
                    'data': backup_data
                },
                timeout=30
            )
            
            if response.status_code == 200:
                logger.info(f"Successfully backed up scan data for account {account_id}")
                return True
            else:
                logger.error(f"Failed to backup scan data: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"Error backing up scan data: {e}")
            return False
    
    def restore_latest_data(self, account_id: str, data_type: str) -> Optional[Dict]:
        """Restore latest data from cloud storage"""
        if not self.backup_enabled:
            return None
            
        try:
            response = requests.get(
                f"{self.cloud_endpoint}/latest/{account_id}/{data_type}",
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json'
                },
                timeout=30
            )
            
            if response.status_code == 200:
                backup_data = response.json()
                
                # Verify data integrity
                if 'data' in backup_data and 'hash' in backup_data:
                    calculated_hash = self._calculate_hash(backup_data['data'])
                    if calculated_hash == backup_data['hash']:
                        logger.info(f"Successfully restored {data_type} for account {account_id}")
                        return backup_data['data']
                    else:
                        logger.error(f"Data integrity check failed for {data_type}")
                        return None
                else:
                    logger.error(f"Invalid backup data format for {data_type}")
                    return None
            else:
                logger.warning(f"No backup found for {data_type} (status: {response.status_code})")
                return None
                
        except Exception as e:
            logger.error(f"Error restoring {data_type}: {e}")
            return None
    
    def list_backups(self, account_id: str) -> list:
        """List available backups for an account"""
        if not self.backup_enabled:
            return []
            
        try:
            response = requests.get(
                f"{self.cloud_endpoint}/list/{account_id}",
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json'
                },
                timeout=30
            )
            
            if response.status_code == 200:
                return response.json().get('backups', [])
            else:
                logger.error(f"Failed to list backups: {response.status_code}")
                return []
                
        except Exception as e:
            logger.error(f"Error listing backups: {e}")
            return []
    
    def sync_all_data(self, account_id: str, checkpoints: Dict, scan_data: Dict) -> Dict[str, bool]:
        """Sync all data to cloud storage"""
        results = {
            'checkpoints': self.backup_checkpoints(account_id, checkpoints),
            'scan_data': self.backup_scan_data(account_id, scan_data)
        }
        
        if all(results.values()):
            logger.info(f"Successfully synced all data for account {account_id}")
        else:
            logger.warning(f"Partial sync failure for account {account_id}: {results}")
            
        return results

# Fallback cloud storage using local file system (for development/testing)
class LocalCloudStorage(CloudStorageManager):
    """Local file-based cloud storage for development/testing"""
    
    def __init__(self, local_backup_dir: str = "cloud_backups"):
        self.local_backup_dir = local_backup_dir
        os.makedirs(local_backup_dir, exist_ok=True)
        self.backup_enabled = True
        logger.info(f"Using local cloud storage at: {local_backup_dir}")
    
    def _get_backup_path(self, account_id: str, data_type: str) -> str:
        """Get local backup file path"""
        filename = self._get_backup_filename(account_id, data_type)
        return os.path.join(self.local_backup_dir, filename)
    
    def backup_checkpoints(self, account_id: str, checkpoints: Dict) -> bool:
        """Backup checkpoints to local file"""
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'checkpoints',
                'timestamp': datetime.now().isoformat(),
                'data': checkpoints,
                'hash': self._calculate_hash(checkpoints)
            }
            
            backup_path = self._get_backup_path(account_id, 'checkpoints')
            
            with open(backup_path, 'w', encoding='utf-8') as f:
                json.dump(backup_data, f, ensure_ascii=False, indent=2)
            
            logger.info(f"Successfully backed up checkpoints to {backup_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error backing up checkpoints locally: {e}")
            return False
    
    def backup_scan_data(self, account_id: str, scan_data: Dict) -> bool:
        """Backup scan data to local file"""
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'scan_data',
                'timestamp': datetime.now().isoformat(),
                'data': scan_data,
                'hash': self._calculate_hash(scan_data)
            }
            
            backup_path = self._get_backup_path(account_id, 'scan_data')
            
            with open(backup_path, 'w', encoding='utf-8') as f:
                json.dump(backup_data, f, ensure_ascii=False, indent=2)
            
            logger.info(f"Successfully backed up scan data to {backup_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error backing up scan data locally: {e}")
            return False
    
    def restore_latest_data(self, account_id: str, data_type: str) -> Optional[Dict]:
        """Restore latest data from local files"""
        try:
            # Find the latest backup file
            backup_files = []
            for filename in os.listdir(self.local_backup_dir):
                if filename.startswith(f"telegram_delete_backup_{account_id}_{data_type}_"):
                    backup_files.append(filename)
            
            if not backup_files:
                logger.warning(f"No local backup found for {data_type}")
                return None
            
            # Sort by timestamp (newest first)
            backup_files.sort(reverse=True)
            latest_file = backup_files[0]
            backup_path = os.path.join(self.local_backup_dir, latest_file)
            
            with open(backup_path, 'r', encoding='utf-8') as f:
                backup_data = json.load(f)
            
            # Verify data integrity
            if 'data' in backup_data and 'hash' in backup_data:
                calculated_hash = self._calculate_hash(backup_data['data'])
                if calculated_hash == backup_data['hash']:
                    logger.info(f"Successfully restored {data_type} from {latest_file}")
                    return backup_data['data']
                else:
                    logger.error(f"Data integrity check failed for {data_type}")
                    return None
            else:
                logger.error(f"Invalid backup data format for {data_type}")
                return None
                
        except Exception as e:
            logger.error(f"Error restoring {data_type} locally: {e}")
            return None
    
    def list_backups(self, account_id: str) -> list:
        """List available local backups for an account"""
        try:
            backups = []
            for filename in os.listdir(self.local_backup_dir):
                if filename.startswith(f"telegram_delete_backup_{account_id}_"):
                    file_path = os.path.join(self.local_backup_dir, filename)
                    stat = os.stat(file_path)
                    backups.append({
                        'filename': filename,
                        'size': stat.st_size,
                        'modified': datetime.fromtimestamp(stat.st_mtime).isoformat()
                    })
            
            return sorted(backups, key=lambda x: x['modified'], reverse=True)
            
        except Exception as e:
            logger.error(f"Error listing local backups: {e}")
            return []

