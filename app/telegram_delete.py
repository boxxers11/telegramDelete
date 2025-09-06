import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, date
from typing import List, Optional, AsyncIterator, Dict, Any
from telethon import TelegramClient, errors
from telethon.tl.types import Chat, Channel, User, Message
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest
from telethon.errors import FloodWaitError, RpcCallFailError

logger = logging.getLogger(__name__)

@dataclass
class Filters:
    include_private: bool = False
    chat_name_filters: List[str] = None
    after: Optional[date] = None
    before: Optional[date] = None
    limit_per_chat: Optional[int] = None
    revoke: bool = True
    dry_run: bool = True
    test_mode: bool = False
    
    def __post_init__(self):
        if self.chat_name_filters is None:
            self.chat_name_filters = []

@dataclass
class ChatResult:
    id: int
    title: str
    type: str
    participants_count: int
    candidates_found: int
    deleted: int
    error: Optional[str] = None
    skipped_reason: Optional[str] = None

@dataclass
class OperationResult:
    chats: List[ChatResult]
    total_chats_processed: int
    total_chats_skipped: int
    total_candidates: int
    total_deleted: int
    logs: List[str]

class TelegramDeleter:
    def __init__(self, session_name: str, api_id: int, api_hash: str):
        self.session_name = session_name
        self.api_id = api_id
        self.api_hash = api_hash
        self.client = None
        self.logs = []
    
    def log(self, message: str):
        """Add a timestamped log entry"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        self.logs.append(log_entry)
        logger.info(message)
    
    async def connect(self) -> Dict[str, Any]:
        """Connect to Telegram and authenticate"""
        try:
            self.client = TelegramClient(
                self.session_name, 
                self.api_id, 
                self.api_hash
            )
            
            await self.client.start()
            
            if not await self.client.is_user_authorized():
                return {"success": False, "error": "Not authenticated"}
            
            me = await self.client.get_me()
            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            
            self.log(f"Connected as @{username}")
            
            return {
                "success": True, 
                "username": username,
                "user_id": me.id
            }
            
        except Exception as e:
            error_msg = f"Connection failed: {str(e)}"
            self.log(error_msg)
            return {"success": False, "error": error_msg}
    
    async def get_participants_count(self, entity) -> int:
        """Get participant count for a chat/channel"""
        try:
            if isinstance(entity, Channel):
                if entity.megagroup:
                    # Supergroup
                    try:
                        full = await self.client(GetFullChannelRequest(channel=entity))
                        return getattr(full.full_chat, 'participants_count', 0)
                    except Exception:
                        pass
                else:
                    # Channel - not applicable for our use case
                    return 0
            elif isinstance(entity, Chat):
                # Basic group
                try:
                    full = await self.client(GetFullChatRequest(chat_id=entity.id))
                    return getattr(full.full_chat, 'participants_count', 0)
                except Exception:
                    pass
            
            # Fallback: estimate by counting participants (up to 15 for safety)
            count = 0
            async for _ in self.client.iter_participants(entity, limit=15):
                count += 1
                if count > 10:  # If more than 10, we don't need exact count
                    break
            return count
            
        except Exception as e:
            self.log(f"Error getting participant count for {getattr(entity, 'title', 'Unknown')}: {e}")
            return 0
    
    async def iter_user_messages(
        self, 
        entity, 
        after: Optional[datetime], 
        before: Optional[datetime], 
        limit: Optional[int]
    ) -> AsyncIterator[Message]:
        """Iterate user's own messages in a chat with filters"""
        count = 0
        
        try:
            async for msg in self.client.iter_messages(entity, from_user='me'):
                # Check date filters
                msg_date = msg.date.replace(tzinfo=None) if msg.date else None
                
                if after and msg_date and msg_date < after:
                    break  # Messages are in reverse chronological order
                
                if before and msg_date and msg_date > before:
                    continue
                
                yield msg
                count += 1
                
                if limit and count >= limit:
                    break
                    
        except Exception as e:
            self.log(f"Error iterating messages: {e}")
    
    async def _should_process_chat(self, dialog, filters: Filters) -> tuple[bool, Optional[str]]:
        """Check if chat should be processed based on filters"""
        entity = dialog.entity
        
        # Check chat type
        if isinstance(entity, User):
            if not filters.include_private:
                return False, "Private chat (not included)"
        elif isinstance(entity, Channel):
            if not entity.megagroup:
                return False, "Channel (not a group)"
        elif isinstance(entity, Chat):
            # Basic group - OK to process
            pass
        else:
            return False, "Unknown chat type"
        
        # Check participant count
        participants_count = await self.get_participants_count(entity)
        if participants_count <= 10:
            return False, f"{participants_count} members (≤10)"
        
        # Check name filters
        if filters.chat_name_filters:
            chat_title = getattr(entity, 'title', getattr(entity, 'first_name', ''))
            chat_title_lower = chat_title.lower()
            
            matches = any(
                filter_text.strip().lower() in chat_title_lower 
                for filter_text in filters.chat_name_filters
                if filter_text.strip()
            )
            
            if not matches:
                return False, "Name filter doesn't match"
        
        return True, None
    
    async def scan(self, filters: Filters) -> OperationResult:
        """Scan for messages to delete without actually deleting"""
        self.logs = []
        self.log("Starting scan operation...")
        
        if not self.client:
            return OperationResult([], 0, 0, 0, 0, ["Not connected to Telegram"])
        
        results = []
        total_processed = 0
        total_skipped = 0
        total_candidates = 0
        
        # Convert date filters to datetime
        after_dt = datetime.combine(filters.after, datetime.min.time()) if filters.after else None
        before_dt = datetime.combine(filters.before, datetime.min.time()) if filters.before else None
        
        try:
            dialogs_limit = 5 if filters.test_mode else None
            dialog_count = 0
            
            async for dialog in self.client.iter_dialogs():
                if dialogs_limit and dialog_count >= dialogs_limit:
                    break
                
                dialog_count += 1
                entity = dialog.entity
                
                should_process, skip_reason = await self._should_process_chat(dialog, filters)
                
                if not should_process:
                    total_skipped += 1
                    self.log(f"Skipped {getattr(entity, 'title', 'Unknown')}: {skip_reason}")
                    continue
                
                # Count candidate messages
                candidates = []
                try:
                    async for msg in self.iter_user_messages(entity, after_dt, before_dt, filters.limit_per_chat):
                        candidates.append(msg.id)
                    
                    participants_count = await self.get_participants_count(entity)
                    chat_type = "Private" if isinstance(entity, User) else "Group"
                    
                    result = ChatResult(
                        id=entity.id,
                        title=getattr(entity, 'title', getattr(entity, 'first_name', 'Unknown')),
                        type=chat_type,
                        participants_count=participants_count,
                        candidates_found=len(candidates),
                        deleted=0
                    )
                    
                    results.append(result)
                    total_processed += 1
                    total_candidates += len(candidates)
                    
                    self.log(f"Found {len(candidates)} messages in {result.title}")
                    
                except Exception as e:
                    error_msg = f"Error scanning {getattr(entity, 'title', 'Unknown')}: {str(e)}"
                    self.log(error_msg)
                    result = ChatResult(
                        id=entity.id,
                        title=getattr(entity, 'title', 'Unknown'),
                        type="Unknown",
                        participants_count=0,
                        candidates_found=0,
                        deleted=0,
                        error=str(e)
                    )
                    results.append(result)
            
            self.log(f"Scan complete: {total_processed} chats processed, {total_skipped} skipped")
            
        except Exception as e:
            self.log(f"Scan failed: {str(e)}")
            
        return OperationResult(
            chats=results,
            total_chats_processed=total_processed,
            total_chats_skipped=total_skipped,
            total_candidates=total_candidates,
            total_deleted=0,
            logs=self.logs
        )
    
    async def delete(self, filters: Filters) -> OperationResult:
        """Delete messages according to filters"""
        if filters.dry_run:
            return await self.scan(filters)
        
        self.logs = []
        self.log("Starting deletion operation...")
        
        if not self.client:
            return OperationResult([], 0, 0, 0, 0, ["Not connected to Telegram"])
        
        results = []
        total_processed = 0
        total_skipped = 0
        total_candidates = 0
        total_deleted = 0
        
        # Convert date filters to datetime
        after_dt = datetime.combine(filters.after, datetime.min.time()) if filters.after else None
        before_dt = datetime.combine(filters.before, datetime.min.time()) if filters.before else None
        
        try:
            dialogs_limit = 5 if filters.test_mode else None
            dialog_count = 0
            
            async for dialog in self.client.iter_dialogs():
                if dialogs_limit and dialog_count >= dialogs_limit:
                    break
                
                dialog_count += 1
                entity = dialog.entity
                
                should_process, skip_reason = await self._should_process_chat(dialog, filters)
                
                if not should_process:
                    total_skipped += 1
                    self.log(f"Skipped {getattr(entity, 'title', 'Unknown')}: {skip_reason}")
                    continue
                
                # Collect and delete messages
                candidates = []
                try:
                    async for msg in self.iter_user_messages(entity, after_dt, before_dt, filters.limit_per_chat):
                        candidates.append(msg.id)
                    
                    deleted_count = 0
                    if candidates:
                        deleted_count = await self._delete_batches(entity, candidates, filters.revoke)
                    
                    participants_count = await self.get_participants_count(entity)
                    chat_type = "Private" if isinstance(entity, User) else "Group"
                    
                    result = ChatResult(
                        id=entity.id,
                        title=getattr(entity, 'title', getattr(entity, 'first_name', 'Unknown')),
                        type=chat_type,
                        participants_count=participants_count,
                        candidates_found=len(candidates),
                        deleted=deleted_count
                    )
                    
                    results.append(result)
                    total_processed += 1
                    total_candidates += len(candidates)
                    total_deleted += deleted_count
                    
                    self.log(f"Deleted {deleted_count}/{len(candidates)} messages in {result.title}")
                    
                except Exception as e:
                    error_msg = f"Error processing {getattr(entity, 'title', 'Unknown')}: {str(e)}"
                    self.log(error_msg)
                    result = ChatResult(
                        id=entity.id,
                        title=getattr(entity, 'title', 'Unknown'),
                        type="Unknown",
                        participants_count=0,
                        candidates_found=0,
                        deleted=0,
                        error=str(e)
                    )
                    results.append(result)
            
            self.log(f"Operation complete: {total_deleted} messages deleted from {total_processed} chats")
            
        except Exception as e:
            self.log(f"Delete operation failed: {str(e)}")
            
        return OperationResult(
            chats=results,
            total_chats_processed=total_processed,
            total_chats_skipped=total_skipped,
            total_candidates=total_candidates,
            total_deleted=total_deleted,
            logs=self.logs
        )
    
    async def _delete_batches(self, entity, message_ids: List[int], revoke: bool = True) -> int:
        """Delete messages in batches with rate limit handling"""
        BATCH_SIZE = 100
        deleted = 0
        
        for i in range(0, len(message_ids), BATCH_SIZE):
            batch = message_ids[i:i + BATCH_SIZE]
            
            while True:
                try:
                    await self.client.delete_messages(entity, batch, revoke=revoke)
                    deleted += len(batch)
                    break
                except FloodWaitError as e:
                    wait_seconds = getattr(e, 'seconds', 30)
                    self.log(f"Rate limited, waiting {wait_seconds} seconds...")
                    await asyncio.sleep(wait_seconds + 1)
                except RpcCallFailError as e:
                    self.log(f"RPC error deleting batch: {e}")
                    break
                except Exception as e:
                    self.log(f"Error deleting batch: {e}")
                    break
        
        return deleted
    
    async def disconnect(self):
        """Disconnect from Telegram"""
        if self.client:
            await self.client.disconnect()