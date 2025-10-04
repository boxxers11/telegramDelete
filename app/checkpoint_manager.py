import json
import os
from datetime import datetime
from typing import Dict, Optional
from dataclasses import dataclass, asdict
import logging
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

class CheckpointManager:
    def __init__(self, account_id: str):
        self.account_id = account_id
        self.checkpoints_file = f"sessions/checkpoints_{account_id}.json"
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
        
        # Initialize cloud storage (lazy loading)
        self.cloud_storage = None
        
        # Load checkpoints first, then try to restore from cloud only if no local data
        self.load_checkpoints()
        # Only restore from cloud if we have no local data
        if len(self.checkpoints) == 0 and len(self.current_progress.get('scanned_chats', [])) == 0:
            self.restore_from_cloud()
    
    def _get_cloud_storage(self):
        """Get cloud storage instance (lazy loading)"""
        if not self.cloud_storage:
            try:
                # Lazy import to avoid loading heavy modules on startup
                from .cloud_storage import CloudStorageManager, LocalCloudStorage
                self.cloud_storage = CloudStorageManager()
                if not self._get_cloud_storage().backup_enabled:
                    self.cloud_storage = LocalCloudStorage()
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
                           last_scan_date: str = None, messages: list = None):
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
                'member_count': existing_chat.get('member_count', 0) if existing_chat else 0
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
            
            logger.info(f"Successfully backed up data for account {self.account_id}")
            
        except Exception as e:
            logger.error(f"Error backing up to cloud: {e}")
    
    def restore_from_cloud(self):
        """Restore data from cloud storage if local data is empty or outdated"""
        try:
            # Check if we have local data
            has_local_data = len(self.checkpoints) > 0 or len(self.current_progress.get('scanned_chats', [])) > 0
            
            if has_local_data:
                logger.info(f"Local data exists for account {self.account_id}, skipping cloud restore")
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
                
        except Exception as e:
            logger.error(f"Error restoring from cloud: {e}")
    
    def force_sync_to_cloud(self):
        """Force sync all current data to cloud storage"""
        try:
            self.backup_to_cloud()
            logger.info(f"Force sync completed for account {self.account_id}")
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