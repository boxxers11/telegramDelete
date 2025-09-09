import json
import os
from datetime import datetime
from typing import Dict, Optional
from dataclasses import dataclass, asdict
import logging

logger = logging.getLogger(__name__)

@dataclass
class ChatCheckpoint:
    chat_id: int
    chat_title: str
    last_message_id: Optional[int]
    last_scan_date: str
    messages_deleted: int
    total_messages_found: int

class CheckpointManager:
    def __init__(self, account_id: str):
        self.account_id = account_id
        self.checkpoints_file = f"sessions/checkpoints_{account_id}.json"
        self.checkpoints: Dict[int, ChatCheckpoint] = {}
        self.load_checkpoints()
    
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
        """Save checkpoints to file"""
        try:
            os.makedirs(os.path.dirname(self.checkpoints_file), exist_ok=True)
            data = {
                str(chat_id): asdict(checkpoint)
                for chat_id, checkpoint in self.checkpoints.items()
            }
            with open(self.checkpoints_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            logger.info(f"Saved {len(self.checkpoints)} checkpoints for account {self.account_id}")
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