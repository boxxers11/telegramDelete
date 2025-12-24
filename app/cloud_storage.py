import json
import os
import requests
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Any, List
from dataclasses import asdict
import hashlib
import base64

logger = logging.getLogger(__name__)

class CloudStorageManager:
    """Manages cloud backup and restore of scan data and checkpoints"""
    
    def __init__(self, cloud_endpoint: str = None, api_key: str = None):
        self.cloud_endpoint = cloud_endpoint or os.getenv('CLOUD_STORAGE_ENDPOINT')
        self.api_key = api_key or os.getenv('CLOUD_STORAGE_API_KEY')
        self.backup_enabled = bool(self.cloud_endpoint and self.api_key)
        self.retention_days = int(os.getenv('CLOUD_BACKUP_RETENTION_DAYS', '7'))
        
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

    def backup_groups(self, account_id: str, groups_payload: Dict) -> bool:
        """Backup cached group list to cloud storage"""
        if not self.backup_enabled:
            return False

        try:
            payload = groups_payload or {}
            backup_data = {
                'account_id': account_id,
                'data_type': 'groups',
                'timestamp': datetime.now().isoformat(),
                'data': payload,
                'hash': self._calculate_hash(payload)
            }

            filename = self._get_backup_filename(account_id, 'groups')

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
                logger.info(f"Successfully backed up groups for account {account_id}")
                return True
            else:
                logger.error(f"Failed to backup groups: {response.status_code} - {response.text}")
                return False

        except Exception as e:
            logger.error(f"Error backing up groups: {e}")
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

    def delete_backup(self, account_id: str, filename: str) -> bool:
        """Delete a specific backup from cloud storage"""
        if not self.backup_enabled:
            return False

        try:
            response = requests.post(
                f"{self.cloud_endpoint}/delete",
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json'
                },
                json={
                    'account_id': account_id,
                    'filename': filename
                },
                timeout=30
            )
            if response.status_code == 200:
                logger.info(f"Deleted backup {filename} for account {account_id}")
                return True
            else:
                logger.error(f"Failed to delete backup {filename}: {response.status_code} {response.text}")
                return False
        except Exception as e:
            logger.error(f"Error deleting backup {filename}: {e}")
            return False

    def _parse_backup_timestamp(self, backup_entry: Dict[str, Any]) -> Optional[datetime]:
        """Extract datetime from backup metadata"""
        timestamp = backup_entry.get('timestamp')
        if timestamp:
            try:
                if isinstance(timestamp, str):
                    candidate = timestamp.replace('Z', '+00:00') if timestamp.endswith('Z') else timestamp
                    return datetime.fromisoformat(candidate)
                if isinstance(timestamp, (int, float)):
                    return datetime.fromtimestamp(timestamp)
            except Exception:
                pass

        filename = backup_entry.get('filename') or backup_entry.get('name')
        if filename:
            try:
                # Filename format: telegram_delete_backup_{account}_{type}_{timestamp}.json
                ts_part = filename.rstrip('.json').rsplit('_', 1)[-1]
                return datetime.strptime(ts_part, "%Y%m%d_%H%M%S")
            except Exception:
                return None
        return None

    def prune_old_backups(self, account_id: str, retention_days: Optional[int] = None):
        """Remove backups older than retention_days"""
        if not self.backup_enabled:
            return

        try:
            days = retention_days or self.retention_days
            if days <= 0:
                return

            backups = self.list_backups(account_id)
            if not backups:
                return

            cutoff = datetime.utcnow() - timedelta(days=days)
            for backup in backups:
                timestamp = self._parse_backup_timestamp(backup)
                filename = backup.get('filename') or backup.get('name')
                if not filename or not timestamp:
                    continue
                if timestamp < cutoff:
                    if not self.delete_backup(account_id, filename):
                        logger.warning(f"Failed to prune backup {filename} for account {account_id}")
        except Exception as e:
            logger.error(f"Error pruning backups for account {account_id}: {e}")

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
        self.retention_days = int(os.getenv('CLOUD_BACKUP_RETENTION_DAYS', '7'))
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

    def backup_groups(self, account_id: str, groups_payload: Dict) -> bool:
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'groups',
                'timestamp': datetime.now().isoformat(),
                'data': groups_payload,
                'hash': self._calculate_hash(groups_payload or {})
            }

            backup_path = self._get_backup_path(account_id, 'groups')

            with open(backup_path, 'w', encoding='utf-8') as f:
                json.dump(backup_data, f, ensure_ascii=False, indent=2)

            logger.info(f"Successfully backed up groups to {backup_path}")
            return True
        except Exception as e:
            logger.error(f"Error backing up groups locally: {e}")
            return False

    def delete_backup(self, account_id: str, filename: str) -> bool:
        """Delete a local backup file"""
        try:
            path = os.path.join(self.local_backup_dir, filename)
            if os.path.exists(path):
                os.remove(path)
                logger.info(f"Deleted local backup {path}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error deleting local backup {filename}: {e}")
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


# GitHub Gists based cloud storage (free, no API key needed - just personal access token)
class GitHubGistsStorage(CloudStorageManager):
    """GitHub Gists based cloud storage - free and reliable"""
    
    def __init__(self, github_token: str = None):
        self.github_token = github_token or os.getenv('GITHUB_TOKEN')
        self.backup_enabled = bool(self.github_token)
        self.retention_days = int(os.getenv('CLOUD_BACKUP_RETENTION_DAYS', '7'))
        self.api_base = "https://api.github.com"
        self.gist_filename_prefix = "telegram_delete_backup_"
        
        if not self.backup_enabled:
            logger.warning("GitHub token not configured. Using local storage fallback.")
        else:
            logger.info("Using GitHub Gists for cloud storage")
    
    def _get_gist_description(self, account_id: str, data_type: str) -> str:
        """Generate Gist description"""
        return f"Telegram Delete Backup - {account_id} - {data_type}"
    
    def _get_gist_filename(self, account_id: str, data_type: str) -> str:
        """Generate Gist filename"""
        return f"{self.gist_filename_prefix}{account_id}_{data_type}.json"
    
    def _find_existing_gist(self, account_id: str, data_type: str) -> Optional[Dict]:
        """Find existing Gist for this account and data type"""
        if not self.backup_enabled:
            return None
        
        try:
            headers = {
                'Authorization': f'token {self.github_token}',
                'Accept': 'application/vnd.github.v3+json'
            }
            
            # List all user's gists
            response = requests.get(
                f"{self.api_base}/gists",
                headers=headers,
                timeout=10  # Shorter timeout to avoid hanging on startup
            )
            
            if response.status_code != 200:
                logger.warning(f"Failed to list gists: {response.status_code}")
                return None
            
            gists = response.json()
            filename = self._get_gist_filename(account_id, data_type)
            
            # Find matching gist
            for gist in gists:
                files = gist.get('files', {})
                if filename in files:
                    return gist
            
            return None
        except (requests.exceptions.RequestException, OSError, Exception) as e:
            # Handle network errors gracefully (DNS, connection issues, etc.)
            logger.debug(f"Error finding existing gist (non-critical): {e}")
            return None
    
    def backup_checkpoints(self, account_id: str, checkpoints: Dict) -> bool:
        """Backup checkpoints to GitHub Gist"""
        if not self.backup_enabled:
            return False
        
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'checkpoints',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': checkpoints,
                'hash': self._calculate_hash(checkpoints)
            }
            
            return self._backup_to_gist(account_id, 'checkpoints', backup_data)
        except Exception as e:
            logger.error(f"Error backing up checkpoints to GitHub: {e}")
            return False
    
    def backup_scan_data(self, account_id: str, scan_data: Dict) -> bool:
        """Backup scan data to GitHub Gist"""
        if not self.backup_enabled:
            return False
        
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'scan_data',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': scan_data,
                'hash': self._calculate_hash(scan_data)
            }
            
            return self._backup_to_gist(account_id, 'scan_data', backup_data)
        except Exception as e:
            logger.error(f"Error backing up scan data to GitHub: {e}")
            return False
    
    def backup_groups(self, account_id: str, groups_payload: Dict) -> bool:
        """Backup groups to GitHub Gist"""
        if not self.backup_enabled:
            return False
        
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'groups',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': groups_payload or {},
                'hash': self._calculate_hash(groups_payload or {})
            }
            
            return self._backup_to_gist(account_id, 'groups', backup_data)
        except Exception as e:
            logger.error(f"Error backing up groups to GitHub: {e}")
            return False
    
    def _backup_to_gist(self, account_id: str, data_type: str, backup_data: Dict) -> bool:
        """Backup data to GitHub Gist (create or update)"""
        try:
            filename = self._get_gist_filename(account_id, data_type)
            content = json.dumps(backup_data, ensure_ascii=False, indent=2)
            
            headers = {
                'Authorization': f'token {self.github_token}',
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            }
            
            # Check if gist already exists
            existing_gist = self._find_existing_gist(account_id, data_type)
            
            if existing_gist:
                # Update existing gist
                gist_id = existing_gist['id']
                payload = {
                    'description': self._get_gist_description(account_id, data_type),
                    'files': {
                        filename: {
                            'content': content
                        }
                    }
                }
                
                response = requests.patch(
                    f"{self.api_base}/gists/{gist_id}",
                    headers=headers,
                    json=payload,
                    timeout=30
                )
                
                if response.status_code == 200:
                    logger.info(f"Updated GitHub Gist for {account_id}/{data_type}")
                    return True
                else:
                    logger.error(f"Failed to update Gist: {response.status_code} - {response.text}")
                    return False
            else:
                # Create new gist
                payload = {
                    'description': self._get_gist_description(account_id, data_type),
                    'public': False,  # Private gist
                    'files': {
                        filename: {
                            'content': content
                        }
                    }
                }
                
                response = requests.post(
                    f"{self.api_base}/gists",
                    headers=headers,
                    json=payload,
                    timeout=30
                )
                
                if response.status_code == 201:
                    logger.info(f"Created GitHub Gist for {account_id}/{data_type}")
                    return True
                else:
                    logger.error(f"Failed to create Gist: {response.status_code} - {response.text}")
                    return False
                    
        except Exception as e:
            logger.error(f"Error backing up to GitHub Gist: {e}")
            return False
    
    def restore_latest_data(self, account_id: str, data_type: str) -> Optional[Dict]:
        """Restore latest data from GitHub Gist"""
        if not self.backup_enabled:
            return None
        
        try:
            existing_gist = self._find_existing_gist(account_id, data_type)
            if not existing_gist:
                logger.warning(f"No Gist found for {account_id}/{data_type}")
                return None
            
            filename = self._get_gist_filename(account_id, data_type)
            file_data = existing_gist.get('files', {}).get(filename, {})
            
            if not file_data:
                return None
            
            # Get file content (might be in raw_url or need another API call)
            content_url = file_data.get('raw_url')
            if not content_url:
                # Fallback: get gist content directly
                gist_id = existing_gist['id']
                headers = {
                    'Authorization': f'token {self.github_token}',
                    'Accept': 'application/vnd.github.v3+json'
                }
                
                response = requests.get(
                    f"{self.api_base}/gists/{gist_id}",
                    headers=headers,
                    timeout=30
                )
                
                if response.status_code != 200:
                    return None
                
                gist_data = response.json()
                file_data = gist_data.get('files', {}).get(filename, {})
                content = file_data.get('content', '')
            else:
                response = requests.get(content_url, timeout=30)
                if response.status_code != 200:
                    return None
                content = response.text
            
            if not content:
                return None
            
            backup_data = json.loads(content)
            
            # Verify data integrity
            if 'data' in backup_data and 'hash' in backup_data:
                calculated_hash = self._calculate_hash(backup_data['data'])
                if calculated_hash == backup_data['hash']:
                    logger.info(f"Successfully restored {data_type} from GitHub Gist for {account_id}")
                    return backup_data['data']
                else:
                    logger.error(f"Data integrity check failed for {data_type}")
                    return None
            else:
                logger.error(f"Invalid backup data format for {data_type}")
                return None
                
        except Exception as e:
            logger.error(f"Error restoring {data_type} from GitHub: {e}")
            return None
    
    def list_backups(self, account_id: str) -> List[Dict]:
        """List available backups for an account"""
        if not self.backup_enabled:
            return []
        
        try:
            headers = {
                'Authorization': f'token {self.github_token}',
                'Accept': 'application/vnd.github.v3+json'
            }
            
            response = requests.get(
                f"{self.api_base}/gists",
                headers=headers,
                timeout=30
            )
            
            if response.status_code != 200:
                return []
            
            gists = response.json()
            backups = []
            prefix = self.gist_filename_prefix + account_id + "_"
            
            for gist in gists:
                files = gist.get('files', {})
                for filename, file_data in files.items():
                    if filename.startswith(prefix):
                        backups.append({
                            'filename': filename,
                            'gist_id': gist['id'],
                            'description': gist.get('description', ''),
                            'created_at': gist.get('created_at', ''),
                            'updated_at': gist.get('updated_at', ''),
                            'size': file_data.get('size', 0),
                            'modified': gist.get('updated_at', '')
                        })
            
            return sorted(backups, key=lambda x: x.get('updated_at', ''), reverse=True)
            
        except Exception as e:
            logger.error(f"Error listing GitHub backups: {e}")
            return []
    
    def delete_backup(self, account_id: str, filename: str) -> bool:
        """Delete a backup from GitHub Gist"""
        if not self.backup_enabled:
            return False
        
        try:
            # Extract data_type from filename
            if not filename.startswith(self.gist_filename_prefix + account_id + "_"):
                return False
            
            data_type = filename.replace(self.gist_filename_prefix + account_id + "_", "").replace(".json", "")
            existing_gist = self._find_existing_gist(account_id, data_type)
            
            if not existing_gist:
                return False
            
            gist_id = existing_gist['id']
            headers = {
                'Authorization': f'token {self.github_token}',
                'Accept': 'application/vnd.github.v3+json'
            }
            
            response = requests.delete(
                f"{self.api_base}/gists/{gist_id}",
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 204:
                logger.info(f"Deleted GitHub Gist {gist_id} for {account_id}/{data_type}")
                return True
            else:
                logger.error(f"Failed to delete Gist: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"Error deleting GitHub backup: {e}")
            return False


# Backblaze B2 cloud storage
class BackblazeB2Storage(CloudStorageManager):
    """Backblaze B2 cloud storage implementation"""
    
    def __init__(self, application_key_id: str = None, application_key: str = None, bucket_name: str = None):
        self.application_key_id = application_key_id or os.getenv('B2_APPLICATION_KEY_ID')
        self.application_key = application_key or os.getenv('B2_APPLICATION_KEY')
        self.bucket_name = bucket_name or os.getenv('B2_BUCKET_NAME')
        self.backup_enabled = bool(self.application_key_id and self.application_key and self.bucket_name)
        self.retention_days = int(os.getenv('CLOUD_BACKUP_RETENTION_DAYS', '7'))
        self.b2_api = None
        self.bucket = None
        
        if not self.backup_enabled:
            logger.warning("Backblaze B2 not configured. Missing: application_key_id, application_key, or bucket_name")
        else:
            try:
                from b2sdk.v2 import InMemoryAccountInfo, B2Api
                from b2sdk.v1 import DownloadDestBytes
                self.DownloadDestBytes = DownloadDestBytes
                info = InMemoryAccountInfo()
                self.b2_api = B2Api(info)
                self.b2_api.authorize_account('production', self.application_key_id, self.application_key)
                self.bucket = self.b2_api.get_bucket_by_name(self.bucket_name)
                logger.info(f"Backblaze B2 initialized successfully with bucket: {self.bucket_name}")
            except Exception as e:
                logger.error(f"Failed to initialize Backblaze B2: {e}")
                self.backup_enabled = False
    
    def _get_b2_path(self, account_id: str, data_type: str, filename: str = None) -> str:
        """Generate B2 file path"""
        if filename:
            return f"telegram_delete/{account_id}/{filename}"
        return f"telegram_delete/{account_id}/{data_type}/"
    
    def backup_checkpoints(self, account_id: str, checkpoints: Dict) -> bool:
        """Backup checkpoints to Backblaze B2"""
        if not self.backup_enabled:
            return False
        
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'checkpoints',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': checkpoints,
                'hash': self._calculate_hash(checkpoints)
            }
            
            filename = self._get_backup_filename(account_id, 'checkpoints')
            b2_path = self._get_b2_path(account_id, 'checkpoints', filename)
            
            # Convert to JSON string
            content = json.dumps(backup_data, ensure_ascii=False, indent=2).encode('utf-8')
            
            # Upload to B2
            self.bucket.upload_bytes(
                data_bytes=content,
                file_name=b2_path,
                content_type='application/json'
            )
            
            logger.info(f"Successfully backed up checkpoints to B2: {b2_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error backing up checkpoints to B2: {e}")
            return False
    
    def backup_scan_data(self, account_id: str, scan_data: Dict) -> bool:
        """Backup scan data to Backblaze B2"""
        if not self.backup_enabled:
            return False
        
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'scan_data',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': scan_data,
                'hash': self._calculate_hash(scan_data)
            }
            
            filename = self._get_backup_filename(account_id, 'scan_data')
            b2_path = self._get_b2_path(account_id, 'scan_data', filename)
            
            content = json.dumps(backup_data, ensure_ascii=False, indent=2).encode('utf-8')
            
            self.bucket.upload_bytes(
                data_bytes=content,
                file_name=b2_path,
                content_type='application/json'
            )
            
            logger.info(f"Successfully backed up scan data to B2: {b2_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error backing up scan data to B2: {e}")
            return False
    
    def backup_groups(self, account_id: str, groups_payload: Dict) -> bool:
        """Backup groups to Backblaze B2"""
        if not self.backup_enabled:
            return False
        
        try:
            backup_data = {
                'account_id': account_id,
                'data_type': 'groups',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': groups_payload or {},
                'hash': self._calculate_hash(groups_payload or {})
            }
            
            filename = self._get_backup_filename(account_id, 'groups')
            b2_path = self._get_b2_path(account_id, 'groups', filename)
            
            content = json.dumps(backup_data, ensure_ascii=False, indent=2).encode('utf-8')
            
            self.bucket.upload_bytes(
                data_bytes=content,
                file_name=b2_path,
                content_type='application/json'
            )
            
            logger.info(f"Successfully backed up groups to B2: {b2_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error backing up groups to B2: {e}")
            return False
    
    def restore_latest_data(self, account_id: str, data_type: str) -> Optional[Dict]:
        """Restore latest data from Backblaze B2"""
        if not self.backup_enabled:
            return None
        
        try:
            prefix = self._get_b2_path(account_id, data_type)
            
            # List files with this prefix
            files = []
            for file_info, _ in self.bucket.ls(prefix):
                if file_info.file_name.endswith('.json'):
                    files.append(file_info)
            
            if not files:
                logger.warning(f"No B2 backup found for {account_id}/{data_type}")
                return None
            
            # Sort by upload timestamp (newest first)
            files.sort(key=lambda f: f.upload_timestamp, reverse=True)
            latest_file = files[0]
            
            # Download file
            import tempfile
            import os
            with tempfile.NamedTemporaryFile(delete=False, mode='wb') as tmp:
                tmp_path = tmp.name
                downloaded_file = self.bucket.download_file_by_name(latest_file.file_name)
                downloaded_file.save(tmp)
                tmp.flush()
            try:
                with open(tmp_path, 'rb') as f:
                    content = f.read().decode('utf-8')
                backup_data = json.loads(content)
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            
            # Verify data integrity
            if 'data' in backup_data and 'hash' in backup_data:
                calculated_hash = self._calculate_hash(backup_data['data'])
                if calculated_hash == backup_data['hash']:
                    logger.info(f"Successfully restored {data_type} from B2 for {account_id}")
                    return backup_data['data']
                else:
                    logger.error(f"Data integrity check failed for {data_type}")
                    return None
            else:
                logger.error(f"Invalid backup data format for {data_type}")
                return None
                
        except Exception as e:
            logger.error(f"Error restoring {data_type} from B2: {e}")
            return None
    
    def list_backups(self, account_id: str) -> List[Dict]:
        """List available backups for an account"""
        if not self.backup_enabled:
            return []
        
        try:
            prefix = f"telegram_delete/{account_id}/"
            backups = []
            
            for file_info, _ in self.bucket.ls(prefix):
                if file_info.file_name.endswith('.json'):
                    backups.append({
                        'filename': file_info.file_name.split('/')[-1],
                        'size': file_info.size,
                        'modified': datetime.fromtimestamp(file_info.upload_timestamp / 1000).isoformat(),
                        'b2_file_id': file_info.id_
                    })
            
            return sorted(backups, key=lambda x: x['modified'], reverse=True)
            
        except Exception as e:
            logger.error(f"Error listing B2 backups: {e}")
            return []
    
    def delete_backup(self, account_id: str, filename: str) -> bool:
        """Delete a backup from Backblaze B2"""
        if not self.backup_enabled:
            return False
        
        try:
            # Find the file
            prefix = self._get_b2_path(account_id, '', filename)
            
            for file_info, _ in self.bucket.ls(prefix):
                if file_info.file_name.endswith(filename):
                    file_version = self.bucket.get_file_info_by_name(file_info.file_name)
                    self.bucket.delete_file_version(file_version.id_, file_info.file_name)
                    logger.info(f"Deleted B2 backup {file_info.file_name} for account {account_id}")
                    return True
            
            logger.warning(f"Backup file {filename} not found in B2")
            return False
            
        except Exception as e:
            logger.error(f"Error deleting B2 backup {filename}: {e}")
            return False
    
    def backup_accounts(self, accounts_data: Dict) -> bool:
        """Backup accounts.json to Backblaze B2"""
        if not self.backup_enabled:
            return False
        
        try:
            backup_data = {
                'data_type': 'accounts',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': accounts_data,
                'hash': self._calculate_hash(accounts_data)
            }
            
            b2_path = "telegram_delete/accounts.json"
            content = json.dumps(backup_data, ensure_ascii=False, indent=2).encode('utf-8')
            
            self.bucket.upload_bytes(
                data_bytes=content,
                file_name=b2_path,
                content_type='application/json'
            )
            
            logger.info(f"Successfully backed up accounts.json to B2")
            return True
            
        except Exception as e:
            logger.error(f"Error backing up accounts.json to B2: {e}")
            return False
    
    def restore_accounts(self) -> Optional[Dict]:
        """Restore accounts.json from Backblaze B2"""
        if not self.backup_enabled:
            return None
        
        try:
            b2_path = "telegram_delete/accounts.json"
            
            # Try to download the file
            try:
                # Use temp file for v2 API - download_file_by_name returns DownloadedFile
                import tempfile
                import os
                with tempfile.NamedTemporaryFile(delete=False, mode='wb') as tmp:
                    tmp_path = tmp.name
                    downloaded_file = self.bucket.download_file_by_name(b2_path)
                    downloaded_file.save(tmp)
                    tmp.flush()
                try:
                    with open(tmp_path, 'rb') as f:
                        content = f.read().decode('utf-8')
                    backup_data = json.loads(content)
                finally:
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                
                # Verify data integrity
                if 'data' in backup_data and 'hash' in backup_data:
                    calculated_hash = self._calculate_hash(backup_data['data'])
                    if calculated_hash == backup_data['hash']:
                        logger.info("Successfully restored accounts.json from B2")
                        return backup_data['data']
                    else:
                        logger.error("Data integrity check failed for accounts.json")
                        return None
                else:
                    logger.error("Invalid backup data format for accounts.json")
                    return None
            except Exception as e:
                # File doesn't exist yet - that's OK
                logger.debug(f"accounts.json not found in B2 (first run?): {e}")
                return None
                
        except Exception as e:
            logger.error(f"Error restoring accounts.json from B2: {e}")
            return None
    
    def backup_session(self, account_id: str, session_path: str) -> bool:
        """Backup session file to Backblaze B2"""
        if not self.backup_enabled:
            return False
        
        try:
            if not os.path.exists(session_path):
                return False
            
            # Read session file as binary
            with open(session_path, 'rb') as f:
                session_data = f.read()
            
            b2_path = f"telegram_delete/sessions/{account_id}/{os.path.basename(session_path)}"
            
            self.bucket.upload_bytes(
                data_bytes=session_data,
                file_name=b2_path,
                content_type='application/octet-stream'
            )
            
            logger.info(f"Successfully backed up session to B2: {b2_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error backing up session to B2: {e}")
            return False
    
    def restore_session(self, account_id: str, session_path: str) -> bool:
        """Restore session file from Backblaze B2"""
        if not self.backup_enabled:
            return False
        
        try:
            b2_path = f"telegram_delete/sessions/{account_id}/{os.path.basename(session_path)}"
            
            # Try to download the file
            try:
                import tempfile
                import os
                with tempfile.NamedTemporaryFile(delete=False, mode='wb') as tmp:
                    tmp_path = tmp.name
                    downloaded_file = self.bucket.download_file_by_name(b2_path)
                    downloaded_file.save(tmp)
                    tmp.flush()
                try:
                    with open(tmp_path, 'rb') as f:
                        session_data = f.read()
                finally:
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                
                # Ensure directory exists
                os.makedirs(os.path.dirname(session_path), exist_ok=True)
                
                # Write session file
                with open(session_path, 'wb') as f:
                    f.write(session_data)
                
                logger.info(f"Successfully restored session from B2: {session_path}")
                return True
            except Exception as e:
                # File doesn't exist yet - that's OK
                logger.debug(f"Session not found in B2: {e}")
                return False
                
        except Exception as e:
            logger.error(f"Error restoring session from B2: {e}")
            return False
