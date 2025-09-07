import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, date
from typing import List, Optional, AsyncIterator, Dict, Any
from telethon import TelegramClient, errors
from telethon.tl.types import Chat, Channel, User, Message
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest
from telethon.errors import FloodWaitError, RpcCallFailError, SessionPasswordNeededError

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
    messages: Optional[List[Dict]] = None

class TelegramDeleter:
    def __init__(self, session_name: str, api_id: int, api_hash: str):
        self.session_name = session_name
        self.api_id = api_id
        self.api_hash = api_hash
        self.client = None
        self.logs = []
        self.status_callback = None
    
    def set_status_callback(self, callback):
        """Set callback function for status updates"""
        self.status_callback = callback
    
    def update_status(self, status: str, data: Dict = None):
        """Update status and call callback if set"""
        self.log(status)
        if self.status_callback:
            self.status_callback(status, data or {})
    
    async def safe_api_call(self, method, *args, max_retries=3, **kwargs):
        """Safely call Telegram API with flood wait handling"""
        for attempt in range(max_retries):
            try:
                return await method(*args, **kwargs)
            except FloodWaitError as e:
                wait_time = e.seconds
                self.update_status(f"Rate limited. Waiting {wait_time} seconds...", {
                    'type': 'flood_wait',
                    'wait_time': wait_time,
                    'attempt': attempt + 1,
                    'max_retries': max_retries
                })
                await asyncio.sleep(wait_time + 1)  # Add 1 second buffer
            except Exception as e:
                if attempt == max_retries - 1:
                    raise
                self.log(f"API call failed (attempt {attempt + 1}): {e}")
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
        
        raise Exception(f"Failed after {max_retries} attempts")
    
    def log(self, message: str):
        """Add a timestamped log entry"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        self.logs.append(log_entry)
        logger.info(message)
    
    async def connect(self, phone: str = None) -> Dict[str, Any]:
        """Connect to Telegram"""
        try:
            self.client = TelegramClient(
                self.session_name, 
                self.api_id, 
                self.api_hash
            )
            
            await self.client.connect()
            self.log("Client connected to Telegram")
            
            if not await self.client.is_user_authorized():
                if phone:
                    # Send code request
                    self.log(f"Sending verification code to {phone}")
                    await self.safe_api_call(self.client.send_code_request, phone)
                    self.log("Verification code sent successfully")
                    return {
                        "success": True, 
                        "status": "CODE_SENT",
                        "message": "Verification code sent to your Telegram app"
                    }
                else:
                    return {"success": False, "error": "Phone number required"}
            
            me = await self.safe_api_call(self.client.get_me)
            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            
            self.log(f"Connected as @{username}")
            
            return {
                "success": True, 
                "status": "AUTHENTICATED",
                "username": username,
                "user_id": me.id
            }
            
        except Exception as e:
            error_msg = f"Connection failed: {str(e)}"
            self.log(error_msg)
            return {"success": False, "error": error_msg}
    
    async def sign_in_with_code(self, phone: str, code: str, password: str = None) -> Dict[str, Any]:
        """Sign in with verification code and optional 2FA password"""
        try:
            if not self.client:
                await self.connect()
                if not self.client:
                    return {"success": False, "error": "Client not connected"}
            
            try:
                self.log(f"Signing in with code: {code}")
                await self.safe_api_call(self.client.sign_in, phone=phone, code=code)
                self.log("Sign in with code successful")
            except SessionPasswordNeededError:
                self.log("2FA password required")
                if not password:
                    return {
                        "success": False, 
                        "error": "Two-factor authentication password required",
                        "message": "Two-factor authentication password required"
                    }
                self.log("Attempting sign in with 2FA password")
                await self.safe_api_call(self.client.sign_in, password=password)
                self.log("2FA sign in successful")
            except errors.PhoneCodeInvalidError:
                self.log("Invalid verification code")
                return {"success": False, "error": "Invalid verification code. Please try again."}
            except errors.PhoneCodeExpiredError:
                self.log("Verification code expired")
                return {"success": False, "error": "Verification code expired. Please request a new one."}
            except errors.SessionPasswordNeededError:
                self.log("2FA password needed but not provided")
                return {"success": False, "error": "Two-factor authentication password required"}
            
            me = await self.safe_api_call(self.client.get_me)
            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            
            self.log(f"Successfully authenticated as @{username}")
            
            return {
                "success": True,
                "status": "OK", 
                "username": username,
                "user_id": me.id
            }
            
        except Exception as e:
            error_msg = f"Sign in failed: {str(e)}"
            self.log(error_msg)
            return {"success": False, "error": error_msg}
    
    async def get_participants_count(self, entity) -> int:
        """Get participant count for a chat/channel"""
        try:
            if isinstance(entity, Channel):
                if entity.megagroup:
                    try:
                        full = await self.safe_api_call(self.client, GetFullChannelRequest(channel=entity))
                        return getattr(full.full_chat, 'participants_count', 0)
                    except Exception:
                        pass
                else:
                    return 0
            elif isinstance(entity, Chat):
                try:
                    full = await self.safe_api_call(self.client, GetFullChatRequest(chat_id=entity.id))
                    return getattr(full.full_chat, 'participants_count', 0)
                except Exception:
                    pass
            
            count = 0
            async for _ in self.safe_api_call(self.client.iter_participants, entity, limit=15):
                count += 1
                if count > 10:
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
        count = 0
        
        try:
            async for msg in self.safe_api_call(self.client.iter_messages, entity, from_user='me'):
                msg_date = msg.date.replace(tzinfo=None) if msg.date else None
                
                if after and msg_date and msg_date < after:
                    break
                
                if before and msg_date and msg_date > before:
                    continue
                
                yield msg
                count += 1
                
                if limit and count >= limit:
                    break
                    
        except Exception as e:
            self.log(f"Error iterating messages: {e}")
    
    async def _should_process_chat(self, dialog, filters: Filters) -> tuple[bool, Optional[str]]:
        entity = dialog.entity
        
        if isinstance(entity, User):
            if not filters.include_private:
                return False, "Private chat (not included)"
        elif isinstance(entity, Channel):
            if not entity.megagroup:
                return False, "Channel (not a group)"
        elif isinstance(entity, Chat):
            pass
        else:
            return False, "Unknown chat type"
        
        participants_count = await self.get_participants_count(entity)
        if participants_count <= 10:
            return False, f"{participants_count} members (≤10)"
        
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
        self.logs = []
        self.log("Starting scan operation...")
        
        if not self.client:
            return OperationResult([], 0, 0, 0, 0, ["Not connected to Telegram"])
        
        results = []
        total_processed = 0
        total_skipped = 0
        total_candidates = 0
        
        after_dt = datetime.combine(filters.after, datetime.min.time()) if filters.after else None
        before_dt = datetime.combine(filters.before, datetime.min.time()) if filters.before else None
        
        try:
            dialogs_limit = 5 if filters.test_mode else None
            dialog_count = 0
            
            async for dialog in self.safe_api_call(self.client.iter_dialogs):
                if dialogs_limit and dialog_count >= dialogs_limit:
                    break
                
                dialog_count += 1
                entity = dialog.entity
                
                should_process, skip_reason = await self._should_process_chat(dialog, filters)
                
                if not should_process:
                    total_skipped += 1
                    self.log(f"Skipped {getattr(entity, 'title', 'Unknown')}: {skip_reason}")
                    continue
                
                self.update_status(f"Scanning {getattr(entity, 'title', 'Unknown')}...")
                
                candidates = []
                try:
                    participants_count = await self.get_participants_count(entity)
                    async for msg in self.iter_user_messages(entity, after_dt, before_dt, filters.limit_per_chat):
                        candidates.append(msg.id)
                        if not hasattr(self, 'found_messages'):
                            self.found_messages = []
                        
                        self.found_messages.append({
                            'id': msg.id,
                            'chat_id': entity.id,
                            'chat_title': getattr(entity, 'title', getattr(entity, 'first_name', 'Unknown')),
                            'chat_type': "Private" if isinstance(entity, User) else "Group",
                            'date': msg.date.isoformat() if msg.date else '',
                            'content': msg.message or '[Media]',
                            'media_type': 'Media' if msg.media else None,
                            'participants_count': participants_count
                        })
                    
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
                    
                    self.update_status(f"Found {len(candidates)} messages in {result.title}")
                    
                except Exception as e:
                    error_msg = f"Error scanning {getattr(entity, 'title', 'Unknown')}: {str(e)}"
                    self.update_status(error_msg)
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
            
            self.update_status(f"Scan complete: {total_processed} chats processed, {total_skipped} skipped")
            
        except Exception as e:
            self.update_status(f"Scan failed: {str(e)}")
            
        return OperationResult(
            chats=results,
            total_chats_processed=total_processed,
            total_chats_skipped=total_skipped,
            total_candidates=total_candidates,
            total_deleted=0,
            logs=self.logs,
            messages=getattr(self, 'found_messages', [])
        )
    
    async def delete(self, filters: Filters) -> OperationResult:
        if filters.dry_run:
            return await self.scan(filters)
        
        self.logs = []
        self.update_status("Starting deletion operation...")
        
        if not self.client:
            return OperationResult([], 0, 0, 0, 0, ["Not connected to Telegram"])
        
        results = []
        total_processed = 0
        total_skipped = 0
        total_candidates = 0
        total_deleted = 0
        
        after_dt = datetime.combine(filters.after, datetime.min.time()) if filters.after else None
        before_dt = datetime.combine(filters.before, datetime.min.time()) if filters.before else None
        
        try:
            dialogs_limit = 5 if filters.test_mode else None
            dialog_count = 0
            
            async for dialog in self.safe_api_call(self.client.iter_dialogs):
                if dialogs_limit and dialog_count >= dialogs_limit:
                    break
                
                dialog_count += 1
                entity = dialog.entity
                
                should_process, skip_reason = await self._should_process_chat(dialog, filters)
                
                if not should_process:
                    total_skipped += 1
                    self.update_status(f"Skipped {getattr(entity, 'title', 'Unknown')}: {skip_reason}")
                    continue
                
                self.update_status(f"Processing {getattr(entity, 'title', 'Unknown')}...")
                
                candidates = []
                try:
                    async for msg in self.iter_user_messages(entity, after_dt, before_dt, filters.limit_per_chat):
                        candidates.append(msg.id)
                    
                    deleted_count = 0
                    if candidates:
                        self.update_status(f"Deleting {len(candidates)} messages from {getattr(entity, 'title', 'Unknown')}...")
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
                    
                    self.update_status(f"Deleted {deleted_count}/{len(candidates)} messages in {result.title}")
                    
                except Exception as e:
                    error_msg = f"Error processing {getattr(entity, 'title', 'Unknown')}: {str(e)}"
                    self.update_status(error_msg)
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
            
            self.update_status(f"Operation complete: {total_deleted} messages deleted from {total_processed} chats")
            
        except Exception as e:
            self.update_status(f"Delete operation failed: {str(e)}")
            
        return OperationResult(
            chats=results,
            total_chats_processed=total_processed,
            total_chats_skipped=total_skipped,
            total_candidates=total_candidates,
            total_deleted=total_deleted,
            logs=self.logs,
            messages=None
        )
    
    async def _delete_batches(self, entity, message_ids: List[int], revoke: bool = True) -> int:
        BATCH_SIZE = 100
        deleted = 0
        
        for i in range(0, len(message_ids), BATCH_SIZE):
            batch = message_ids[i:i + BATCH_SIZE]
            
            while True:
                try:
                    await self.safe_api_call(self.client.delete_messages, entity, batch, revoke=revoke)
                    deleted += len(batch)
                    break
                except FloodWaitError as e:
                    wait_seconds = getattr(e, 'seconds', 30)
                    self.update_status(f"Rate limited, waiting {wait_seconds} seconds...")
                    await asyncio.sleep(wait_seconds + 1)
                except RpcCallFailError as e:
                    self.update_status(f"RPC error deleting batch: {e}")
                    break
                except Exception as e:
                    self.update_status(f"Error deleting batch: {e}")
                    break
        
        return deleted
    
    async def disconnect(self):
        if self.client:
            await self.client.disconnect()
    
    async def check_authorization_status(self) -> Dict[str, Any]:
        """Check if user is authorized using existing session without sending new code"""
        try:
            if not self.client:
                self.client = TelegramClient(
                    self.session_name, 
                    self.api_id, 
                    self.api_hash
                )
            
            await self.client.connect()
            
            if await self.client.is_user_authorized():
                me = await self.safe_api_call(self.client.get_me)
                username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
                await self.client.disconnect()
                return {
                    "is_authenticated": True,
                    "username": username,
                    "user_id": me.id
                }
            else:
                await self.client.disconnect()
                return {"is_authenticated": False}
                
        except Exception as e:
            if self.client:
                try:
                    await self.client.disconnect()
                except:
                    pass
            return {"is_authenticated": False, "error": str(e)}
