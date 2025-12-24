import json
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Any, List
from dataclasses import dataclass, asdict
import logging
from .group_store import GroupStore
# Lazy import for cloud storage to avoid loading heavy modules on startup
# from .cloud_storage import CloudStorageManager, LocalCloudStorage

logger = logging.getLogger(__name__)

@dataclass
class ChatCheckpoint:
    chat_id: int
    chat_title: str
    last_message_id: Optional[int]
    last_scan_date: str
    messages_deleted: int
    total_messages_found: int
    # New fields for enhanced scan logic
    member_count: int = 0
    user_joined_at: Optional[str] = None
    scan_state: str = 'idle'  # 'idle'|'queued'|'running'|'partial'|'done'|'error'
    total_estimate: Optional[int] = None
    scanned_count: int = 0
    has_unscanned_dates: bool = False
    group_rules: str = ''
    last_sent_at: Optional[str] = None
    send_status: Optional[str] = None
    send_error: Optional[str] = None

class CheckpointManager:
    def __init__(self, account_id: str):
        self.account_id = account_id
        self.checkpoints_file = f"sessions/checkpoints_{account_id}.json"
        self.groups_cache_file = f"sessions/groups_{account_id}.json"
        # Also try the old format for backward compatibility
        self.groups_cache_file_alt = f"sessions/groups_{account_id.replace('acc_', '')}.json"
        self.meta_file = f"sessions/account_meta_{account_id}.json"
        self.checkpoints: Dict[int, ChatCheckpoint] = {}
        self.current_progress = {
            'current_chat': '',
            'chat_id': 0,
            'status': 'idle',
            'total_chats': 0,
            'current_index': 0,
            'completed': 0,
            'skipped': 0,
            'errors': 0,
            'total_messages': 0,
            'scanned_chats': []
        }
        self.backup_retention_days = int(os.getenv('CLOUD_BACKUP_RETENTION_DAYS', '7'))
        self.groups_cache = {
            'groups': [],
            'updated_at': None,
            'owner_id': None
        }
        self.group_store = GroupStore(account_id)
        self.meta: Dict[str, Any] = {
            'owner_id': None,
            'updated_at': None
        }
        self.temporary_messages_file = f"sessions/temporary_messages_{account_id}.json"
        self.temporary_messages: Dict[str, Dict[str, Any]] = {}
        
        # Initialize cloud storage (lazy loading)
        self.cloud_storage = None
        
        # Load checkpoints first, then try to restore from cloud only if no local data
        self.load_checkpoints()
        self._load_meta()
        self.load_groups_cache()
        self.load_temporary_messages()
        # Only restore from cloud if we have no local data (non-blocking, don't fail startup)
        if len(self.checkpoints) == 0 and len(self.current_progress.get('scanned_chats', [])) == 0:
            try:
                self.restore_from_cloud()
            except Exception as restore_error:
                # Don't fail startup if cloud restore fails (network issues, etc.)
                logger.debug(f"Cloud restore failed during initialization (non-critical): {restore_error}")
    
    def _get_cloud_storage(self):
        """Get cloud storage instance (lazy loading) - prioritize Backblaze B2, then GitHub Gists, fallback to local"""
        if not self.cloud_storage:
            try:
                # Lazy import to avoid loading heavy modules on startup
                from .cloud_storage import BackblazeB2Storage, GitHubGistsStorage, LocalCloudStorage
                
                # Try Backblaze B2 first (if configured)
                b2_storage = BackblazeB2Storage()
                if b2_storage.backup_enabled:
                    self.cloud_storage = b2_storage
                    logger.info(f"Using Backblaze B2 for cloud storage for account {self.account_id}")
                else:
                    # Try GitHub Gists second (free and reliable)
                    github_storage = GitHubGistsStorage()
                    if github_storage.backup_enabled:
                        self.cloud_storage = github_storage
                        logger.info(f"Using GitHub Gists for cloud storage for account {self.account_id}")
                    else:
                        # Fallback to local storage
                        self.cloud_storage = LocalCloudStorage()
                        logger.info(f"Using local storage for account {self.account_id}")
            except Exception as e:
                logger.warning(f"Failed to initialize cloud storage, using local fallback: {e}")
                from .cloud_storage import LocalCloudStorage
                self.cloud_storage = LocalCloudStorage()
        return self.cloud_storage
    
    def load_checkpoints(self):
        """Load checkpoints from file"""
        if os.path.exists(self.checkpoints_file):
            try:
                with open(self.checkpoints_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.checkpoints = {
                        int(chat_id): ChatCheckpoint(**checkpoint_data)
                        for chat_id, checkpoint_data in data.items()
                    }
                logger.info(f"Loaded {len(self.checkpoints)} checkpoints for account {self.account_id}")
            except Exception as e:
                logger.error(f"Error loading checkpoints: {e}")
                self.checkpoints = {}
    
    def save_checkpoints(self):
        """Save checkpoints to file and backup to cloud"""
        try:
            os.makedirs(os.path.dirname(self.checkpoints_file), exist_ok=True)
            
            # Convert datetime objects to strings for JSON serialization
            def convert_datetime(obj):
                if hasattr(obj, 'isoformat'):
                    return obj.isoformat()
                return obj
            
            data = {}
            for chat_id, checkpoint in self.checkpoints.items():
                checkpoint_dict = asdict(checkpoint)
                # Convert any datetime fields to strings
                for field, value in checkpoint_dict.items():
                    if hasattr(value, 'isoformat'):
                        checkpoint_dict[field] = value.isoformat()
                data[str(chat_id)] = checkpoint_dict
            
            # Save locally
            with open(self.checkpoints_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=convert_datetime)
            logger.info(f"Saved {len(self.checkpoints)} checkpoints for account {self.account_id}")
            
            # Backup to cloud
            self.backup_to_cloud()
            
        except Exception as e:
            logger.error(f"Error saving checkpoints: {e}")

    def load_groups_cache(self):
        """Load cached group list from disk"""
        # Try the new format first
        if os.path.exists(self.groups_cache_file):
            try:
                with open(self.groups_cache_file, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                    if isinstance(data, dict):
                        self.groups_cache = {
                            'groups': data.get('groups', []),
                            'updated_at': data.get('updated_at'),
                            'owner_id': data.get('owner_id')
                        }
                logger.info(f"Loaded cached group list for account {self.account_id} ({len(self.groups_cache.get('groups', []))} groups)")
                return
            except Exception as exc:
                logger.error(f"Error loading group cache for {self.account_id}: {exc}")
        
        # Try the old format
        if os.path.exists(self.groups_cache_file_alt):
            try:
                with open(self.groups_cache_file_alt, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                    if isinstance(data, dict):
                        self.groups_cache = {
                            'groups': data.get('groups', []),
                            'updated_at': data.get('updated_at'),
                            'owner_id': data.get('owner_id')
                        }
                logger.info(f"Loaded cached group list for account {self.account_id} from old format ({len(self.groups_cache.get('groups', []))} groups)")
                return
            except Exception as exc:
                logger.error(f"Error loading group cache for {self.account_id} from old format: {exc}")
        
        # If neither file exists or both failed, initialize empty cache
        self.groups_cache = {
            'groups': [],
            'updated_at': None,
            'owner_id': None
        }

    def save_groups_cache(self):
        """Persist cached group list to disk"""
        try:
            os.makedirs(os.path.dirname(self.groups_cache_file), exist_ok=True)
            with open(self.groups_cache_file, 'w', encoding='utf-8') as fh:
                json.dump(self.groups_cache, fh, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.error(f"Error saving group cache for {self.account_id}: {exc}")

    def get_groups_cache(self):
        return {
            'groups': self.groups_cache.get('groups', []),
            'updated_at': self.groups_cache.get('updated_at'),
            'owner_id': self.groups_cache.get('owner_id')
        }

    def _load_meta(self):
        if os.path.exists(self.meta_file):
            try:
                with open(self.meta_file, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                    if isinstance(data, dict):
                        self.meta.update(data)
            except Exception as exc:
                logger.error(f"Error loading account meta for {self.account_id}: {exc}")

    def _save_meta(self):
        try:
            os.makedirs(os.path.dirname(self.meta_file), exist_ok=True)
            with open(self.meta_file, 'w', encoding='utf-8') as fh:
                json.dump(self.meta, fh, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.error(f"Error saving account meta for {self.account_id}: {exc}")

    def ensure_owner(self, owner_id: Optional[int]) -> bool:
        if owner_id is None:
            return False
        current_owner = self.meta.get('owner_id')
        if current_owner == owner_id:
            return False
        self._reset_for_new_owner(owner_id)
        return True

    def _reset_for_new_owner(self, owner_id: int):
        logger.info(f"Owner change detected for {self.account_id}. Resetting local state.")
        self.meta['owner_id'] = owner_id
        self.meta['updated_at'] = datetime.utcnow().isoformat()
        self._save_meta()

        self.checkpoints = {}
        self.current_progress = {
            'status': 'idle',
            'total': 0,
            'current_index': 0,
            'scanned_chats': []
        }
        self.save_checkpoints()

        self.groups_cache = {
            'groups': [],
            'updated_at': None,
            'owner_id': owner_id
        }
        self.save_groups_cache()

        try:
            self.group_store.reset()
        except Exception as exc:
            logger.warning(f"Failed to reset group store for {self.account_id}: {exc}")

        try:
            storage = self._get_cloud_storage()
            if storage and getattr(storage, 'backup_enabled', False):
                storage.backup_groups(self.account_id, self.groups_cache)
        except Exception as exc:
            logger.warning(f"Failed to backup group cache after owner reset for {self.account_id}: {exc}")

    def list_persisted_groups(self):
        try:
            return {
                'groups': self.group_store.list_groups(),
                'synced_at': self.group_store.synced_at
            }
        except Exception as exc:
            logger.error(f"Error listing persisted groups for {self.account_id}: {exc}")
            return {
                'groups': [],
                'synced_at': self.group_store.synced_at
            }

    def mark_group_joined(self, chat_id: str, metadata: Optional[Dict[str, Any]] = None):
        self.group_store.mark_joined(chat_id, metadata)

    def mark_group_status(self, chat_id: str, status: str, metadata: Optional[Dict[str, Any]] = None):
        self.group_store.mark_status(chat_id, status, metadata)

    def mark_group_left(self, chat_id: str):
        self.group_store.mark_left(chat_id)

    def increment_group_sent(self, chat_id: str, count: int = 1):
        self.group_store.increment_sent(chat_id, count)

    def increment_group_deleted(self, chat_id: str, count: int = 1):
        self.group_store.increment_deleted(chat_id, count)

    def update_groups_cache(self, groups, owner_id: Optional[int] = None):
        try:
            updated_at = datetime.utcnow().isoformat()
            self.groups_cache = {
                'groups': groups,
                'updated_at': updated_at,
                'owner_id': owner_id if owner_id is not None else self.groups_cache.get('owner_id')
            }
            self.save_groups_cache()
            try:
                self.group_store.upsert_from_scan(groups)
                self.group_store.set_synced_at(updated_at)
            except Exception as exc:
                logger.error(f"Failed to sync group store for {self.account_id}: {exc}")
            storage = self._get_cloud_storage()
            if storage and getattr(storage, 'backup_enabled', False):
                storage.backup_groups(self.account_id, self.groups_cache)
        except Exception as exc:
            logger.error(f"Error updating group cache for {self.account_id}: {exc}")
    
    def get_checkpoint(self, chat_id: int, only_if_deleted: bool = False) -> Optional[ChatCheckpoint]:
        """Get checkpoint for a specific chat, optionally only if messages were deleted"""
        checkpoint = self.checkpoints.get(chat_id)
        if only_if_deleted and checkpoint and checkpoint.messages_deleted == 0:
            # If no messages were deleted, don't use checkpoint (scan from beginning)
            return None
        return checkpoint
    
    def update_checkpoint(self, chat_id: int, chat_title: str, last_message_id: Optional[int], 
                         messages_deleted: int, total_messages_found: int):
        """Update checkpoint for a chat"""
        self.checkpoints[chat_id] = ChatCheckpoint(
            chat_id=chat_id,
            chat_title=chat_title,
            last_message_id=last_message_id,
            last_scan_date=datetime.now().isoformat(),
            messages_deleted=messages_deleted,
            total_messages_found=total_messages_found
        )
        self.save_checkpoints()
    
    def get_all_checkpoints(self) -> Dict[int, ChatCheckpoint]:
        """Get all checkpoints"""
        return self.checkpoints.copy()
    
    def update_progress(self, **kwargs):
        """Update current scan progress"""
        if 'scanned_chats' in kwargs:
            # Append to existing scanned_chats instead of replacing
            existing_chats = self.current_progress.get('scanned_chats', [])
            new_chats = kwargs['scanned_chats']
            if isinstance(new_chats, list):
                # Merge new chats with existing ones, avoiding duplicates
                existing_ids = {chat.get('id') for chat in existing_chats}
                for chat in new_chats:
                    if chat.get('id') not in existing_ids:
                        existing_chats.append(chat)
                kwargs['scanned_chats'] = existing_chats
        
        # Update current_chat_id if current_chat is provided
        if 'current_chat' in kwargs and 'current_chat_id' not in kwargs:
            # Try to find chat_id from scanned_chats
            scanned_chats = self.current_progress.get('scanned_chats', [])
            for chat in scanned_chats:
                if chat.get('title') == kwargs['current_chat']:
                    kwargs['current_chat_id'] = chat.get('id')
                    break
        
        # Update messages_found if provided
        if 'messages_found' in kwargs:
            self.current_progress['messages_found'] = kwargs['messages_found']
        
        self.current_progress.update(kwargs)
    
    def get_progress(self) -> Dict:
        """Get current scan progress"""
        return self.current_progress.copy()
    
    def reset_all_data(self):
        """Reset all scan data and checkpoints but keep findings"""
        # Reset scan memory but keep findings (History)
        for chat_id, checkpoint in self.checkpoints.items():
            checkpoint.last_scan_date = None
            checkpoint.last_message_id = None
            checkpoint.scan_state = 'idle'
            checkpoint.total_estimate = None
            checkpoint.scanned_count = 0
            checkpoint.has_unscanned_dates = False
            # Keep: messages_deleted, total_messages_found (History)
        
        # שמירה על הממצאים הקיימים - לא למחוק את scanned_chats!
        existing_scanned_chats = self.current_progress.get('scanned_chats', [])
        
        self.current_progress = {
            'status': 'idle',
            'total': 0,
            'current_index': 0,
            'progress_percent': 0,
            'scanned_chats': existing_scanned_chats  # שמירה על הממצאים!
        }
        self.save_checkpoints()
    
    def clear_scan_cache(self):
        """Clear all scan cache and checkpoints but keep session/auth data"""
        # Clear checkpoints
        self.checkpoints = {}
        
        # Clear scan progress
        self.current_progress = {
            'current_chat': '',
            'current_chat_id': 0,
            'chat_id': 0,
            'status': 'idle',
            'total_chats': 0,
            'current_index': 0,
            'completed': 0,
            'skipped': 0,
            'errors': 0,
            'total_messages': 0,
            'scanned_chats': []
        }
        
        # Delete checkpoint files
        try:
            if os.path.exists(self.checkpoints_file):
                os.remove(self.checkpoints_file)
                logger.info(f"Deleted checkpoints file: {self.checkpoints_file}")
        except Exception as e:
            logger.error(f"Error deleting checkpoints file: {e}")
        
        # Clear groups cache scan data but keep groups list
        # Keep groups list but reset scan-related fields
        if self.groups_cache.get('groups'):
            for group in self.groups_cache['groups']:
                if isinstance(group, dict):
                    # Remove scan-related fields but keep group info
                    group.pop('last_scan_date', None)
                    group.pop('messages_found', None)
                    group.pop('messages_deleted', None)
                    group.pop('progress_percent', None)
                    group.pop('has_unscanned_dates', None)
            self.save_groups_cache()
        
        # Clear group store scan data
        try:
            self.group_store.clear_scan_data()
        except Exception as e:
            logger.error(f"Error clearing group store scan data: {e}")
        
        logger.info(f"Cleared scan cache for account {self.account_id}")
    
    def start_scan(self, total_chats: int):
        """Initialize scan progress"""
        self.current_progress = {
            'current_chat': '',
            'current_chat_id': 0,
            'chat_id': 0,
            'status': 'scanning',
            'total_chats': total_chats,
            'current_index': 0,
            'completed': 0,
            'skipped': 0,
            'errors': 0,
            'total_messages': 0,
            'scanned_chats': []
        }
    
    def update_chat_progress(self, chat_id: int, chat_title: str, status: str, 
                           messages_found: int = 0, error: str = None, skipped_reason: str = None, 
                           last_scan_date: str = None, messages: list = None,
                           group_rules: str = '', last_sent_at: Optional[str] = None,
                           send_status: Optional[str] = None, send_error: Optional[str] = None):
        """Update progress for current chat"""
        self.current_progress['current_chat'] = chat_title
        self.current_progress['chat_id'] = chat_id
        self.current_progress['status'] = status
        
        # Add to scanned chats if completed
        if status in ['completed', 'skipped', 'error']:
            # Find existing chat to preserve messages if they exist
            existing_chat = None
            for chat in self.current_progress['scanned_chats']:
                if chat['id'] == chat_id:
                    existing_chat = chat
                    break
            
            scanned_chat = {
                'id': chat_id,
                'title': chat_title,
                'status': status,
                'messages_found': messages_found,
                'error': error,
                'skipped_reason': skipped_reason,
                'messages': messages or (existing_chat.get('messages', []) if existing_chat else []),
                'messages_deleted': existing_chat.get('messages_deleted', 0) if existing_chat else 0,
                'last_scan_date': last_scan_date or (existing_chat.get('last_scan_date') if existing_chat else None),
                'member_count': existing_chat.get('member_count', 0) if existing_chat else 0,
                'group_rules': group_rules or (existing_chat.get('group_rules') if existing_chat else ''),
                'last_sent_at': last_sent_at or (existing_chat.get('last_sent_at') if existing_chat else None),
                'send_status': send_status or (existing_chat.get('send_status') if existing_chat else None),
                'send_error': send_error or (existing_chat.get('send_error') if existing_chat else None)
            }
            
            # Remove existing entry if exists
            self.current_progress['scanned_chats'] = [
                chat for chat in self.current_progress['scanned_chats'] 
                if chat['id'] != chat_id
            ]
            
            # Add new entry
            self.current_progress['scanned_chats'].append(scanned_chat)
            
            # Update counters
            if status == 'completed':
                self.current_progress['completed'] += 1
                self.current_progress['total_messages'] += messages_found
            elif status == 'skipped':
                self.current_progress['skipped'] += 1
            elif status == 'error':
                self.current_progress['errors'] += 1
            
            self.current_progress['current_index'] += 1
            
            # Update checkpoint with last scan date if provided
            if last_scan_date and status == 'completed':
                if chat_id in self.checkpoints:
                    self.checkpoints[chat_id].last_scan_date = last_scan_date
                else:
                    self.checkpoints[chat_id] = ChatCheckpoint(
                        chat_id=chat_id,
                        chat_title=chat_title,
                        last_message_id=None,
                        last_scan_date=last_scan_date,
                        messages_deleted=0,
                        total_messages_found=messages_found
                    )
                self.save_checkpoints()
    
    def finish_scan(self):
        """Mark scan as finished"""
        self.current_progress['status'] = 'completed'
        self.auto_backup()
    
    def get_current_progress(self):
        """Get current scan progress"""
        return self.current_progress.copy()
    
    def backup_to_cloud(self):
        """Backup current data to cloud storage"""
        try:
            # Convert checkpoints to serializable format
            checkpoints_data = {}
            for chat_id, checkpoint in self.checkpoints.items():
                checkpoint_dict = asdict(checkpoint)
                # Convert datetime fields to strings
                for field, value in checkpoint_dict.items():
                    if hasattr(value, 'isoformat'):
                        checkpoint_dict[field] = value.isoformat()
                checkpoints_data[str(chat_id)] = checkpoint_dict
            
            # Backup checkpoints
            self._get_cloud_storage().backup_checkpoints(self.account_id, checkpoints_data)
            
            # Backup scan progress
            self._get_cloud_storage().backup_scan_data(self.account_id, self.current_progress)

            # Backup cached group list
            self._get_cloud_storage().backup_groups(self.account_id, self.groups_cache)
            
            logger.info(f"Successfully backed up data for account {self.account_id}")
            
        except Exception as e:
            logger.error(f"Error backing up to cloud: {e}")
    
    def auto_backup(self) -> bool:
        """Ensure scan data is synced to cloud and prune old backups"""
        try:
            storage = self._get_cloud_storage()
            if not storage or not storage.backup_enabled:
                logger.debug("Cloud backup not enabled; skipping auto backup")
                return False
            
            self.backup_to_cloud()
            retention_days = max(1, self.backup_retention_days)
            storage.prune_old_backups(self.account_id, retention_days)
            return True
        except Exception as e:
            logger.error(f"Error during automatic backup: {e}")
            return False
    
    def restore_from_cloud(self):
        """Restore data from cloud storage if local data is empty or outdated"""
        try:
            # Check if we have local data
            has_checkpoints = len(self.checkpoints) > 0
            has_scanned_chats = len(self.current_progress.get('scanned_chats', [])) > 0
            
            if has_checkpoints and has_scanned_chats:
                logger.info(f"Local checkpoints and scanned chats exist for account {self.account_id}, skipping cloud restore")
                return
            
            # Try to restore checkpoints from cloud
            cloud_checkpoints = self._get_cloud_storage().restore_latest_data(self.account_id, 'checkpoints')
            if cloud_checkpoints:
                # Convert back to ChatCheckpoint objects
                restored_checkpoints = {}
                for chat_id_str, checkpoint_data in cloud_checkpoints.items():
                    try:
                        chat_id = int(chat_id_str)
                        restored_checkpoints[chat_id] = ChatCheckpoint(**checkpoint_data)
                    except Exception as e:
                        logger.warning(f"Failed to restore checkpoint for chat {chat_id_str}: {e}")
                
                if restored_checkpoints:
                    self.checkpoints = restored_checkpoints
                    logger.info(f"Restored {len(restored_checkpoints)} checkpoints from cloud for account {self.account_id}")
            
            # Try to restore scan data from cloud
            cloud_scan_data = self._get_cloud_storage().restore_latest_data(self.account_id, 'scan_data')
            if cloud_scan_data:
                # Merge with current progress, preserving scanned_chats
                existing_scanned_chats = self.current_progress.get('scanned_chats', [])
                cloud_scanned_chats = cloud_scan_data.get('scanned_chats', [])
                
                # Merge scanned chats, avoiding duplicates
                existing_ids = {chat.get('id') for chat in existing_scanned_chats}
                for chat in cloud_scanned_chats:
                    if chat.get('id') not in existing_ids:
                        existing_scanned_chats.append(chat)
                
                self.current_progress.update(cloud_scan_data)
                self.current_progress['scanned_chats'] = existing_scanned_chats
                
                logger.info(f"Restored scan data from cloud for account {self.account_id}")
            
            # Save restored data locally
            if cloud_checkpoints or cloud_scan_data:
                self.save_checkpoints()
            
            # Restore cached group list if we don't have one locally
            if not self.groups_cache.get('groups'):
                cloud_groups = self._get_cloud_storage().restore_latest_data(self.account_id, 'groups')
                if isinstance(cloud_groups, dict) and cloud_groups.get('groups') is not None:
                    self.groups_cache = {
                        'groups': cloud_groups.get('groups', []),
                        'updated_at': cloud_groups.get('updated_at')
                    }
                    self.save_groups_cache()
                    logger.info(f"Restored group cache from cloud for account {self.account_id} ({len(self.groups_cache.get('groups', []))} groups)")
                
        except Exception as e:
            logger.error(f"Error restoring from cloud: {e}")
    
    def force_sync_to_cloud(self):
        """Force sync all current data to cloud storage"""
        try:
            success = self.auto_backup()
            if success:
                logger.info(f"Force sync completed for account {self.account_id}")
            else:
                logger.warning(f"Cloud backup skipped for account {self.account_id}")
        except Exception as e:
            logger.error(f"Error in force sync: {e}")
    
    def get_cloud_backup_info(self):
        """Get information about cloud backups"""
        try:
            backups = self._get_cloud_storage().list_backups(self.account_id)
            return {
                'backup_count': len(backups),
                'latest_backup': backups[0] if backups else None,
                'all_backups': backups
            }
        except Exception as e:
            logger.error(f"Error getting backup info: {e}")
            return {'backup_count': 0, 'latest_backup': None, 'all_backups': []}
    
    def load_temporary_messages(self):
        """Load temporary messages from file"""
        if os.path.exists(self.temporary_messages_file):
            try:
                with open(self.temporary_messages_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.temporary_messages = data if isinstance(data, dict) else {}
                logger.info(f"Loaded {len(self.temporary_messages)} temporary messages for account {self.account_id}")
            except Exception as e:
                logger.error(f"Error loading temporary messages: {e}")
                self.temporary_messages = {}
        else:
            self.temporary_messages = {}
    
    def save_temporary_messages(self):
        """Save temporary messages to file"""
        try:
            os.makedirs(os.path.dirname(self.temporary_messages_file), exist_ok=True)
            with open(self.temporary_messages_file, 'w', encoding='utf-8') as f:
                json.dump(self.temporary_messages, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Error saving temporary messages: {e}")
    
    def add_temporary_message(self, chat_id: int, chat_title: str, message_id: int, sent_at: str):
        """Add a temporary message that should be deleted after 1 hour"""
        message_key = f"{chat_id}_{message_id}"
        deletes_at = (datetime.fromisoformat(sent_at.replace('Z', '+00:00')) + timedelta(hours=1)).isoformat()
        
        self.temporary_messages[message_key] = {
            'account_id': self.account_id,
            'chat_id': chat_id,
            'chat_title': chat_title,
            'message_id': message_id,
            'sent_at': sent_at,
            'deletes_at': deletes_at,
            'deleted': False
        }
        self.save_temporary_messages()
        logger.info(f"Added temporary message {message_id} in chat {chat_id} ({chat_title}), will delete at {deletes_at}")
    
    def get_expired_temporary_messages(self) -> list:
        """Get list of temporary messages that should be deleted (expired more than 1 hour ago)"""
        now = datetime.now(timezone.utc)
        expired = []
        for message_key, msg_data in self.temporary_messages.items():
            if msg_data.get('deleted', False):
                continue
            try:
                deletes_at_str = msg_data.get('deletes_at')
                if not deletes_at_str:
                    continue
                # Handle both with and without timezone
                deletes_at = datetime.fromisoformat(deletes_at_str.replace('Z', '+00:00'))
                if deletes_at.tzinfo is None:
                    deletes_at = deletes_at.replace(tzinfo=timezone.utc)
                else:
                    deletes_at = deletes_at.astimezone(timezone.utc)
                
                if deletes_at <= now:
                    expired.append({
                        'key': message_key,
                        **msg_data
                    })
            except Exception as e:
                logger.warning(f"Error checking expiration for temporary message {message_key}: {e}")
        return expired
    
    def get_active_temporary_messages(self) -> list:
        """Get list of all active temporary messages with time remaining"""
        now = datetime.now(timezone.utc)
        active = []
        for message_key, msg_data in self.temporary_messages.items():
            if msg_data.get('deleted', False):
                continue
            try:
                deletes_at_str = msg_data.get('deletes_at')
                if not deletes_at_str:
                    continue
                deletes_at = datetime.fromisoformat(deletes_at_str.replace('Z', '+00:00'))
                if deletes_at.tzinfo is None:
                    deletes_at = deletes_at.replace(tzinfo=timezone.utc)
                else:
                    deletes_at = deletes_at.astimezone(timezone.utc)
                
                if deletes_at > now:
                    time_remaining = deletes_at - now
                    minutes_remaining = int(time_remaining.total_seconds() / 60)
                    active.append({
                        'key': message_key,
                        'minutes_remaining': minutes_remaining,
                        **msg_data
                    })
            except Exception as e:
                logger.warning(f"Error calculating time remaining for temporary message {message_key}: {e}")
        return active
    
    def mark_temporary_message_deleted(self, message_key: str):
        """Mark a temporary message as deleted"""
        if message_key in self.temporary_messages:
            self.temporary_messages[message_key]['deleted'] = True
            self.save_temporary_messages()
    
    def remove_temporary_message(self, message_key: str):
        """Remove a temporary message from storage"""
        if message_key in self.temporary_messages:
            del self.temporary_messages[message_key]
            self.save_temporary_messages()
