import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, date, timedelta
from typing import List, Optional, AsyncIterator, Dict, Any
from telethon import TelegramClient, errors
from telethon.tl.types import Chat, Channel, User, Message
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest
from telethon.errors import FloodWaitError, RpcCallFailError, SessionPasswordNeededError
import sqlite3
import time
import os
import threading
from .checkpoint_manager import CheckpointManager

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
    full_scan: bool = False
    batch_size: Optional[int] = None

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
    messages: Optional[List[Dict]] = None

@dataclass
class OperationResult:
    chats: List[ChatResult]
    total_chats_processed: int
    total_chats_skipped: int
    total_candidates: int
    total_deleted: int
    logs: List[str]
    messages: Optional[List[Dict]] = None
    user_created_groups: Optional[List[Dict]] = None

@dataclass
class SmartSearchResult:
    messages: List[Dict[str, Any]]
    total_found: int
    logs: List[str]

class TelegramDeleter:
    def __init__(self, session_name: str, api_id: int, api_hash: str, session_lock: threading.Lock):
        self.session_name = session_name
        self.api_id = api_id
        self.api_hash = api_hash
        self.client = None
        self.logs = [] # Initialize logs list
        self.status_callback = None
        self._session_lock = session_lock
        self.is_paused = False
        self.scanned_chats = []  # Initialize scanned_chats list
        self.scan_state = {}  # Store current scan state
        # Extract account ID from session name for checkpoint manager
        account_id = session_name.split('_')[-1] if '_' in session_name else 'default'
        self.checkpoint_manager = CheckpointManager(account_id)

    def set_status_callback(self, callback):
        """Set callback function for status updates"""
        self.status_callback = callback

    def get_scan_state(self):
        """Get current scan state for pausing/resuming"""
        return {
            'scanned_chats': self.scanned_chats.copy(),
            'scan_progress': self.scan_progress.copy(),
            'is_paused': self.is_paused,
            'current_chat_index': getattr(self, 'current_chat_index', 0),
            'total_chats': getattr(self, 'total_chats', 0)
        }

    def restore_scan_state(self, scan_state):
        """Restore scan state from saved state"""
        if scan_state:
            self.scanned_chats = scan_state.get('scanned_chats', [])
            self.scan_progress = scan_state.get('scan_progress', {})
            self.is_paused = scan_state.get('is_paused', False)
            self.current_chat_index = scan_state.get('current_chat_index', 0)
            self.total_chats = scan_state.get('total_chats', 0)
            self.log(f"📂 מצב סריקה שוחזר: {len(self.scanned_chats)} קבוצות נסרקו")

    async def continue_scan(self):
        """המשך סריקה מהמקום שעצרנו"""
        try:
            self.log("🔄 ממשיך סריקה מהמקום שעצרנו")
            
            # בדוק אם יש מצב סריקה שמור
            if hasattr(self, 'scan_state') and self.scan_state:
                self.restore_scan_state(self.scan_state)
            
            # המשך את הסריקה
            if hasattr(self, 'current_scan_filters'):
                await self.scan(self.current_scan_filters)
            else:
                self.log("❌ אין מסנני סריקה שמורים - לא ניתן להמשיך")
                
        except Exception as e:
            self.log(f"❌ שגיאה בהמשכת סריקה: {e}")

    def log(self, message: str):
        """Log messages to internal list and console"""
        self.logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")
        logger.info(message)

    def pause_scan(self):
        """Pause the current scan"""
        self.is_paused = True
        self.log("Scan paused by user")

    def resume_scan(self):
        """Resume the paused scan"""
        self.is_paused = False
        self.log("Scan resumed by user")

    async def delete_specific_messages(self, chat_id: int, message_ids: list, revoke: bool = True) -> bool:
        """Delete specific messages from a chat"""
        try:
            self.log(f"Deleting {len(message_ids)} messages from chat {chat_id}")
            
            # Get the chat entity
            chat = await self.client.get_entity(chat_id)
            
            # Delete messages in batches to avoid rate limits
            batch_size = 100
            deleted_count = 0
            
            for i in range(0, len(message_ids), batch_size):
                batch = message_ids[i:i + batch_size]
                
                try:
                    await self.client.delete_messages(chat, batch, revoke=revoke)
                    deleted_count += len(batch)
                    self.log(f"Deleted batch {i//batch_size + 1}: {len(batch)} messages")
                    
                    # Small delay to respect rate limits
                    await asyncio.sleep(0.1)
                    
                except Exception as e:
                    self.log(f"Error deleting batch {i//batch_size + 1}: {str(e)}")
                    continue
            
            self.log(f"Successfully deleted {deleted_count}/{len(message_ids)} messages from chat {chat_id}")
            return deleted_count > 0
            
        except Exception as e:
            self.log(f"Error deleting messages from chat {chat_id}: {str(e)}")
            return False

    def update_status(self, status_message: str, data: Dict = None):
        """Update status and call callback if set"""
        self.log(status_message) # Use the corrected log method
        if self.status_callback:
            self.status_callback(status_message, data or {})

    async def safe_client_connect(self, max_retries=3):
        """Safely connect to Telegram with database lock handling"""
        with self._session_lock:
            for attempt in range(max_retries):
                try:
                    # Close any existing client first
                    if self.client:
                        try:
                            await self.client.disconnect()
                        except:
                            pass
                    
                    # Create new client
                    self.client = TelegramClient(
                        self.session_name,
                        self.api_id,
                        self.api_hash
                    )
                    
                    # Connect to Telegram
                    await self.client.connect()
                    return
                    
                except sqlite3.OperationalError as e:
                    if "database is locked" in str(e).lower():
                        wait_time = (attempt + 1) * 3
                        self.update_status(f"Database locked, retrying in {wait_time} seconds... (attempt {attempt + 1}/{max_retries})", {
                            'type': 'flood_wait',
                            'wait_time': wait_time,
                            'attempt': attempt + 1,
                            'max_retries': max_retries
                        })
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        raise
                except Exception as e:
                    if attempt >= max_retries - 1:
                        raise
                    await asyncio.sleep(3)
            
            raise Exception("Failed to connect after multiple attempts")

    async def safe_api_call(self, method, *args, max_retries=5, **kwargs):
        """Safely call Telegram API with flood wait handling and retries."""
        for attempt in range(max_retries):
            try:
                result = await method(*args, **kwargs)
                return result
            except FloodWaitError as e:
                wait_time = e.seconds
                self.update_status(f"Rate limited. Waiting {wait_time} seconds... (attempt {attempt + 1}/{max_retries})", {
                    'type': 'flood_wait',
                    'wait_time': wait_time,
                    'attempt': attempt + 1,
                    'max_retries': max_retries
                })
                await asyncio.sleep(wait_time + 1)  # Add 1 second buffer
            except Exception as e: # Catch other exceptions for retry
                if attempt >= max_retries - 1:
                    raise
                self.log(f"API call failed (attempt {attempt + 1}): {e}")
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
        raise Exception(f"Failed after {max_retries} attempts")

    async def connect(self, phone: str = None) -> Dict[str, Any]:
        """Connect to Telegram"""
        try:
            self.update_status("Initializing Telegram connection...")
            await self.safe_client_connect()
            self.log("Client connected to Telegram")
            
            if not await self.client.is_user_authorized():
                if phone:
                    # Send code request and get phone_code_hash
                    self.update_status(f"Sending verification code to {phone}...")
                    self.log(f"Sending verification code to {phone}")
                    sent_code = await self.safe_api_call(self.client.send_code_request, phone)
                    self.log("Verification code sent successfully")
                    self.update_status("Verification code sent! Check your Telegram app.")
                    return {
                        "success": True, 
                        "status": "CODE_SENT",
                        "phone_code_hash": sent_code.phone_code_hash,
                        "message": "Verification code sent to your Telegram app"
                    }
                else:
                    return {"success": False, "error": "Phone number required"}
            
            self.update_status("Checking authentication status...")
            me = await self.safe_api_call(self.client.get_me)
            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            
            self.log(f"Connected as @{username}")
            self.update_status(f"Successfully connected as @{username}")
            
            return {
                "success": True, 
                "status": "AUTHENTICATED",
                "username": username,
                "user_id": me.id
            }
            
        except Exception as e:
            error_msg = f"Connection failed: {str(e)}"
            self.log(error_msg)
            self.update_status(f"Connection failed: {str(e)}")
            return {"success": False, "error": error_msg}

    async def sign_in_with_code(self, phone: str, code: str, phone_code_hash: str = None, password: str = None) -> Dict[str, Any]:
        """Sign in with verification code and optional 2FA password"""
        try:
            self.update_status("Verifying code...")
            if not self.client:
                await self.safe_client_connect()
                if not self.client:
                    return {"success": False, "error": "Client not connected"}
            
            # Clean the code - remove spaces and ensure it's exactly 5 digits
            clean_code = ''.join(filter(str.isdigit, code))
            if len(clean_code) != 5:
                return {"success": False, "error": f"Invalid code format. Expected 5 digits, got {len(clean_code)}"}
            
            try:
                self.log(f"Signing in with code: {clean_code}")
                self.update_status("Authenticating with Telegram...")
                await self.safe_api_call(self.client.sign_in, phone=phone, code=clean_code, phone_code_hash=phone_code_hash)
                self.log("Sign in with code successful")
                self.update_status("Code verified successfully!")
            except SessionPasswordNeededError:
                self.log("2FA password required")
                self.update_status("2FA password required")
                if not password:
                    return {
                        "success": False, 
                        "error": "2FA_REQUIRED",
                        "message": "Two-factor authentication password required"
                    }
                self.log("Attempting sign in with 2FA password")
                self.update_status("Verifying 2FA password...")
                await self.safe_api_call(self.client.sign_in, password=password)
                self.log("2FA sign in successful")
                self.update_status("2FA authentication successful!")
            except errors.PhoneCodeInvalidError:
                self.log("Invalid verification code")
                self.update_status("Invalid verification code")
                return {"success": False, "error": "Invalid verification code. Please check the code from your Telegram app and try again."}
            except errors.PhoneCodeExpiredError:
                self.log("Verification code expired")
                self.update_status("Verification code expired")
                return {"success": False, "error": "Verification code expired. Please connect again to get a new code."}
            except errors.PasswordHashInvalidError:
                self.log("Invalid 2FA password")
                self.update_status("Invalid 2FA password")
                return {"success": False, "error": "Invalid 2FA password. Please try again."}
            
            self.update_status("Getting user information...")
            me = await self.safe_api_call(self.client.get_me)
            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            
            self.log(f"Successfully authenticated as @{username}")
            self.update_status(f"Successfully authenticated as @{username}")
            
            return {
                "success": True,
                "status": "AUTHENTICATED", 
                "username": username,
                "user_id": me.id
            }
            
        except Exception as e:
            error_msg = f"Sign in failed: {str(e)}"
            self.log(error_msg)
            self.update_status(f"Sign in failed: {str(e)}")
            return {"success": False, "error": error_msg}

    async def scan(self, filters: Filters) -> OperationResult:
        """Scan messages with visual feedback - Two phase approach"""
        try:
            self.update_status("Starting message scan...")
            
            if not self.client:
                await self.safe_client_connect()
            
            if not await self.client.is_user_authorized():
                return OperationResult(
                    chats=[],
                    total_chats_processed=0,
                    total_chats_skipped=0,
                    total_candidates=0,
                    total_deleted=0,
                    logs=["Error: Not authenticated"],
                    user_created_groups=[]
                )
            
            # PHASE 1: Quick scan - Get all group names and member counts
            self.update_status("Phase 1: Quick scanning all groups...")
            chats = []
            total_candidates = 0
            processed_count = 0
            skipped_count = 0
            
            # Get me info once
            me = await self.safe_api_call(self.client.get_me)
            my_id = me.id
            
            # Get all dialogs quickly - Phase 1
            all_dialogs = []
            valid_groups = []  # Only count groups with >20 members
            self.log("🔍 Phase 1: Quick scan - Getting all group names...")
            async for dialog in self.client.iter_dialogs():
                all_dialogs.append(dialog)
                
                # Get dialog ID safely
                dialog_id = getattr(dialog, 'id', None)
                if not dialog_id or not isinstance(dialog_id, (int, str)):
                    continue
                
                # Get member count if it's a group
                member_count = 0
                if hasattr(dialog, 'entity') and hasattr(dialog.entity, 'participants_count'):
                    member_count = dialog.entity.participants_count or 0
                
                # Only count as valid group if it has >20 members and is not a user
                is_valid_group = not dialog.is_user and member_count > 20
                if is_valid_group:
                    valid_groups.append(dialog)
                    # Send only valid groups as discovered
                    self.update_status(f"Found group: {dialog.name}", {
                        'type': 'group_discovered',
                        'chat_id': dialog_id,
                        'chat_name': dialog.name or "Unknown",
                        'member_count': member_count,
                        'is_user': dialog.is_user,
                        'phase': 1,
                        'total_discovered': len(valid_groups)  # Count only valid groups
                    })
                else:
                    # Log private chats or small groups but don't send as discovered
                    chat_type = "private chat" if dialog.is_user else f"small group ({member_count} members)"
                    self.log(f"Skipping {chat_type}: {dialog.name}")
                
                # Small delay to allow frontend to update
                await asyncio.sleep(0.05)
            
            total_dialogs = len(all_dialogs)
            total_valid_groups = len(valid_groups)
            self.log(f"✅ Phase 1 complete: Found {total_dialogs} total dialogs, {total_valid_groups} valid groups (>20 members)")
            
            # Send phase 1 completion
            self.update_status(f"Phase 1 complete: {total_valid_groups} groups found", {
                'type': 'phase1_complete',
                'total_groups': total_valid_groups
            })
            
            # Initialize scan progress for Phase 2
            self.checkpoint_manager.start_scan(total_valid_groups)
            
            # PHASE 2: Deep scan - Check for messages in each group
            self.log("🔍 Phase 2: Deep scan - Checking messages in each group...")
            self.update_status("Phase 2: Starting deep scan of messages...", {
                'type': 'phase2_start',
                'total_groups': total_valid_groups
            })
            
            # Use only the pre-filtered valid groups from Phase 1 (no private chats)
            filtered_dialogs = valid_groups.copy()
            user_created_groups = []
            
            # Note: Private chats are excluded from scanning by default
            # Only scan groups with >20 members
            self.log(f"Phase 2 dialogs: {len(filtered_dialogs)} groups to scan (all with >20 members, no private chats)")
            
            # Process each dialog
            dialogs_to_process = filtered_dialogs
            if filters.batch_size and filters.batch_size > 0:
                dialogs_to_process = filtered_dialogs[:filters.batch_size]
                self.log(f"Batch mode: Processing {len(dialogs_to_process)} out of {len(filtered_dialogs)} groups")
            else:
                self.log(f"Continuous mode: Processing all {len(dialogs_to_process)} groups")
            
            for i, dialog in enumerate(dialogs_to_process):
                # Check if scan is paused
                while self.is_paused:
                    await asyncio.sleep(1)  # Wait while paused
                
                chat_name = dialog.name or "Unknown"
                progress_percent = int((i / len(dialogs_to_process)) * 100)
                
                # Get dialog ID safely
                dialog_id = getattr(dialog, 'id', None)
                if not dialog_id or not isinstance(dialog_id, (int, str)):
                    self.log(f"Skipping dialog with invalid ID: {dialog}")
                    continue
                
                # Update chat status to scanning with clear progress
                self.update_status(f"Scanning group {i+1} of {len(dialogs_to_process)}: {chat_name}", {
                    'type': 'chat_scanning',
                    'chat_id': dialog_id,
                    'current_chat_id': dialog_id,
                    'chat_name': chat_name,
                    'current_index': i + 1,
                    'total': len(dialogs_to_process),
                    'progress_percent': progress_percent,
                    'messages_found': 0,  # Initialize at 0
                    'status': 'scanning'
                })
                
                # Give UI time to update
                await asyncio.sleep(0.5)
                
                # Initialize message_count before using it
                message_count = 0
                
                # Update progress in checkpoint manager
                self.checkpoint_manager.update_progress(
                    current_chat=chat_name,
                    current_chat_id=dialog_id,
                    current_index=i + 1,
                    total_chats=len(dialogs_to_process),
                    progress_percent=progress_percent,
                    messages_found=message_count
                )
                
                self.log(f"=== SCANNING GROUP {i+1}/{len(dialogs_to_process)}: {chat_name} ===")
                self.log(f"Dialog ID: {dialog_id}, Type: {'User' if dialog.is_user else 'Group'}")
                
                # Apply filters
                if not filters.include_private and dialog.is_user:
                    self.update_status(f"Skipping private chat: {chat_name}")
                    self.update_status("Chat skipped", {
                        'type': 'chat_completed',
                        'chat_id': dialog_id,
                        'status': 'skipped',
                        'reason': 'Private chat excluded'
                    })
                    # Update progress
                    self.checkpoint_manager.update_chat_progress(
                        dialog_id, chat_name, 'skipped', skipped_reason='Private chat excluded'
                    )
                    skipped_count += 1
                    continue
                
                if filters.chat_name_filters:
                    if not any(filter_term.lower() in chat_name.lower() for filter_term in filters.chat_name_filters):
                        self.update_status(f"Skipping filtered chat: {chat_name}")
                        self.update_status("Chat skipped", {
                            'type': 'chat_completed',
                            'chat_id': dialog_id,
                            'status': 'skipped',
                            'reason': 'Name filter excluded'
                        })
                        # Update progress
                        self.checkpoint_manager.update_chat_progress(
                            dialog_id, chat_name, 'skipped', skipped_reason='Name filter excluded'
                        )
                        skipped_count += 1
                        continue
                
                # Get checkpoint for this chat
                checkpoint = self.checkpoint_manager.get_checkpoint(dialog_id, only_if_deleted=True)
                start_from_id = checkpoint.last_message_id if checkpoint else None
                
                # Smart date management - only scan from last successful scan date
                scan_start_date = None
                if checkpoint and checkpoint.last_scan_date:
                    # Resume from last successful scan date
                    scan_start_date = checkpoint.last_scan_date
                    self.log(f"Resuming scan from {scan_start_date} for {chat_name}")
                else:
                    # First time scanning - start from 5 years ago
                    scan_start_date = date.today().replace(year=date.today().year - 5)
                    self.log(f"First time scanning {chat_name} - starting from {scan_start_date}")
                
                # Count messages with progress updates
                message_count = 0
                last_message_id = None
                messages_data = []
                total_messages_checked = 0
                
                try:
                    # Start from checkpoint if available
                    iter_kwargs = {'limit': filters.limit_per_chat or 1000}
                    if start_from_id:
                        iter_kwargs['min_id'] = start_from_id
                        self.update_status(f"Resuming from checkpoint in {chat_name} (message ID: {start_from_id})")
                    
                    # Get me info for this iteration
                    me = await self.safe_api_call(self.client.get_me)
                    my_id = me.id
                    
                    # Update status to show we're scanning this chat
                    self.update_status(f"Scanning {chat_name}...", {
                        'type': 'chat_scanning',
                        'chat_id': dialog_id,
                        'current_chat_id': dialog_id,
                        'chat_name': chat_name,
                        'current_index': i + 1,
                        'total': len(dialogs_to_process),
                        'progress_percent': 0,
                        'messages_found': 0,
                        'status': 'scanning'
                    })
                    
                    async for message in self.client.iter_messages(dialog, **iter_kwargs):
                        total_messages_checked += 1
                        
                        # Update progress every 10 messages
                        if total_messages_checked % 10 == 0:
                            progress_percent = min(100, (total_messages_checked / (filters.limit_per_chat or 1000)) * 100)
                            self.update_status(f"Scanning {chat_name}... ({total_messages_checked} messages checked)", {
                                'type': 'chat_scanning',
                                'chat_id': dialog_id,
                                'current_chat_id': dialog_id,
                                'chat_name': chat_name,
                                'current_index': i + 1,
                                'total': len(dialogs_to_process),
                                'progress_percent': progress_percent,
                                'messages_found': message_count,
                                'status': 'scanning'
                            })
                        
                        if message.sender_id == my_id:
                            self.log(f"✅ Found my message in {chat_name}: {message.text[:50] if message.text else '[Media]'}")
                            message_count += 1
                            
                            # Update UI immediately when finding a message
                            self.update_status(f"Found message in {chat_name}! (Total: {message_count})", {
                                'type': 'message_found',
                                'chat_id': dialog_id,
                                'current_chat_id': dialog_id,
                                'chat_name': chat_name,
                                'current_index': i + 1,
                                'total': len(dialogs_to_process),
                                'progress_percent': progress_percent,
                                'messages_found': message_count,
                                'status': 'scanning',
                                'message_text': message.text or '[Media/File]'
                            })
                            
                            if filters.after and message.date.date() < filters.after:
                                message_count -= 1  # Don't count filtered messages
                                continue
                            if filters.before and message.date.date() > filters.before:
                                message_count -= 1  # Don't count filtered messages
                                continue
                            last_message_id = message.id
                            
                            # Collect message data
                            message_data = {
                                'id': message.id,
                                'content': message.text or '[Media/File]',
                                'date': message.date.isoformat(),
                                'media_type': None,
                                'media_url': None
                            }
                            
                            # Handle media
                            if message.photo:
                                message_data['media_type'] = 'photo'
                                try:
                                    # Get photo URL (this is a simplified approach)
                                    # This part is complex and usually requires downloading the photo
                                    # For now, we'll just indicate it's a photo
                                    message_data['media_url'] = None # Cannot directly get URL from message.photo object
                                except:
                                    message_data['media_url'] = None
                            elif message.video:
                                message_data['media_type'] = 'video'
                            elif message.document:
                                message_data['media_type'] = 'document'
                            elif message.sticker:
                                message_data['media_type'] = 'sticker'
                            elif message.voice:
                                message_data['media_type'] = 'voice'
                            
                            messages_data.append(message_data)
                            
                    # Update progress every 10 messages with smart rate limiting
                    if message_count % 10 == 0:
                        self.update_status(f"Found {message_count} messages in {chat_name}...")
                        # Smart delay based on message count to avoid rate limits
                        if message_count > 50:
                            await asyncio.sleep(0.2)  # Longer delay for large groups
                        self.update_status("Scanning progress", {
                            'type': 'chat_progress',
                            'chat_id': dialog_id,
                            'messages_found': message_count
                        })
                
                except Exception as e:
                    self.log(f"Error scanning {chat_name}: {e}")
                    # Update progress in checkpoint manager
                    self.checkpoint_manager.update_chat_progress(
                        dialog_id, chat_name, 'error', error=str(e)
                    )
                    self.update_status("Chat error", {
                        'type': 'chat_completed',
                        'chat_id': dialog_id,
                        'status': 'error',
                        'error': str(e)
                    })
                    chats.append(ChatResult(
                        id=dialog_id,
                        title=chat_name,
                        type="User" if dialog.is_user else "Group",
                        participants_count=1 if dialog.is_user else 0,
                        candidates_found=0,
                        deleted=0,
                        error=str(e)
                    ))
                    continue
                
                # Update checkpoint
                self.checkpoint_manager.update_checkpoint(
                    dialog_id, 
                    chat_name, 
                    last_message_id,
                    0,  # No messages deleted in scan mode
                    message_count
                )
                
                # Update status to show chat completion
                self.update_status(f"Completed {chat_name} - {message_count} messages found", {
                    'type': 'chat_completed',
                    'chat_id': dialog_id,
                    'current_chat_id': dialog_id,
                    'chat_name': chat_name,
                    'current_index': i + 1,
                    'total': len(dialogs_to_process),
                    'progress_percent': 100,
                    'messages_found': message_count,
                    'status': 'completed'
                })
                
                total_candidates += message_count
                processed_count += 1
                
                chat_result = ChatResult(
                    id=dialog_id,
                    title=chat_name,
                    type="User" if dialog.is_user else "Group",
                    participants_count=1 if dialog.is_user else 0,
                    candidates_found=message_count,
                    deleted=0,
                    messages=messages_data
                )
                
                # Add to scanned chats with messages
                if message_count > 0:
                    self.scanned_chats.append(chat_result)
                chats.append(chat_result)
                
                # Update scanned chats in progress with enhanced data
                self.checkpoint_manager.update_progress(
                    scanned_chats=[{
                        'id': dialog_id,
                        'title': chat_name,
                        'status': 'completed',
                        'messages': messages_data,
                        'messages_found': message_count,
                        'member_count': getattr(dialog.entity, 'participants_count', 0) if hasattr(dialog, 'entity') else 0,
                        'user_joined_at': None,  # Will be filled later
                        'progress_percent': min(100, int((message_count / max(1, message_count)) * 100)),
                        'has_unscanned_dates': False  # Will be calculated based on date coverage
                    }],
                    messages_found=message_count
                )
                
                self.log(f"✅ COMPLETED GROUP {i+1}/{len(dialogs_to_process)}: {chat_name} - Found {message_count} messages")
                self.log(f"📊 Group Stats: ID={dialog_id}, Messages={message_count}, Participants={getattr(dialog.entity, 'participants_count', 'Unknown') if hasattr(dialog, 'entity') else 'Unknown'}")
                self.update_status(f"✅ Group {i+1}/{len(dialogs_to_process)} completed: {chat_name} - {message_count} messages found")
                
                # Smart date management - update last scan date
                if message_count > 0:
                    # Found messages - update to current date
                    self.checkpoint_manager.update_chat_progress(
                        dialog_id, chat_name, 'completed', message_count, 
                        last_scan_date=datetime.now().isoformat(), messages=messages_data
                    )
                    self.log(f"Updated last scan date to {datetime.now()} for {chat_name} (found {message_count} messages)")
                else:
                    # No messages found - still update scan date to avoid rescanning
                    self.checkpoint_manager.update_chat_progress(
                        dialog_id, chat_name, 'completed', message_count,
                        last_scan_date=datetime.now().isoformat(), messages=[]
                    )
                    self.log(f"Updated last scan date to {datetime.now()} for {chat_name} (no messages found)")
                
                # Update chat status to completed with progress
                self.update_status("Group completed", {
                    'type': 'chat_completed',
                    'chat_id': dialog_id,
                    'chat_name': chat_name,
                    'current_index': i + 1,
                    'total': len(dialogs_to_process),
                    'progress_percent': int(((i + 1) / len(dialogs_to_process)) * 100),
                    'status': 'completed',
                    'messages_found': message_count,
                    'messages': messages_data
                })
            
            self.update_status(f"🎉 Scan complete! Found {total_candidates} messages across {processed_count} chats")
            
            # Finish scan progress
            self.checkpoint_manager.finish_scan()
            
            return OperationResult(
                chats=chats,
                total_chats_processed=processed_count,
                total_chats_skipped=skipped_count,
                total_candidates=total_candidates,
                total_deleted=0,
                logs=self.logs,
                user_created_groups=user_created_groups
            )
            
        except Exception as e:
            error_msg = f"Scan failed: {str(e)}"
            self.update_status(error_msg)
            return OperationResult(
                chats=[],
                total_chats_processed=0,
                total_chats_skipped=0,
                total_candidates=0,
                total_deleted=0,
                logs=[error_msg],
                user_created_groups=[]
            )
    
    async def smart_search(self, keywords: List[str], limit: int = 100) -> SmartSearchResult:
        """Smart search for messages based on keywords"""
        try:
            self.update_status("Starting smart search...")
            
            if not self.client:
                await self.safe_client_connect()
            
            if not await self.client.is_user_authorized():
                return SmartSearchResult(
                    messages=[],
                    total_found=0,
                    logs=["Error: Not authenticated"],
                    user_created_groups=[]
                )
            
            self.update_status("Searching through messages...")
            found_messages = []
            processed_chats = 0
            
            me = await self.safe_api_call(self.client.get_me)
            my_id = me.id
            
            async for dialog in self.client.iter_dialogs():
                if len(found_messages) >= limit:
                    break
                
                chat_name = dialog.name or "Unknown"
                self.update_status(f"Searching in: {chat_name}")
                processed_chats += 1
                
                try:
                    async for message in self.client.iter_messages(dialog, limit=500):
                        if len(found_messages) >= limit:
                            break
                        
                        # Only search in my messages
                        if message.sender_id != my_id:
                            continue
                        
                        if not message.text:
                            continue
                        
                        # Check if message contains any keywords
                        message_text = message.text.lower()
                        if any(keyword in message_text for keyword in keywords):
                            # Create message link
                            if dialog.is_user:
                                message_link = f"https://t.me/c/{dialog.id}/{message.id}"
                            else:
                                # For groups/channels
                                username = getattr(dialog.entity, 'username', None)
                                if username:
                                    message_link = f"https://t.me/{username}/{message.id}"
                                else:
                                    message_link = f"https://t.me/c/{dialog.id}/{message.id}"
                            
                            found_messages.append({
                                "id": message.id,
                                "chat_id": dialog.id,
                                "chat_title": chat_name,
                                "chat_type": "User" if dialog.is_user else "Group",
                                "date": message.date.isoformat(),
                                "content": message.text,
                                "link": message_link,
                                "matched_keywords": [kw for kw in keywords if kw in message_text]
                            })
                        
                        # Stop early if we hit the limit to prevent hanging
                        # This condition was incorrect, it should be based on total found messages, not message_count
                        # if filters.limit_per_chat and message_count >= filters.limit_per_chat:
                        #     break
                
                except Exception as e:
                    self.log(f"Error searching in {chat_name}: {e}")
                    continue
            
            self.update_status(f"Search complete! Found {len(found_messages)} messages in {processed_chats} chats")
            
            return SmartSearchResult(
                messages=found_messages,
                total_found=len(found_messages),
                logs=self.logs
            )
            
        except Exception as e:
            error_msg = f"Smart search failed: {str(e)}"
            self.update_status(error_msg)
            return SmartSearchResult(
                messages=[],
                total_found=0,
                logs=[error_msg]
            )
    
    async def delete(self, filters: Filters) -> OperationResult:
        """Delete messages with visual feedback"""
        try:
            self.update_status("Starting message deletion...")
            
            if not self.client:
                await self.safe_client_connect()
            
            if not await self.client.is_user_authorized():
                return OperationResult(
                    chats=[],
                    total_chats_processed=0,
                    total_chats_skipped=0,
                    total_candidates=0,
                    total_deleted=0,
                    logs=["Error: Not authenticated"],
                    user_created_groups=[]
                )
            
            self.update_status("Getting chat list...")
            chats = []
            total_candidates = 0
            total_deleted = 0
            processed_count = 0
            skipped_count = 0
            
            # Get all dialogs first
            all_dialogs = []
            async for dialog in self.client.iter_dialogs():
                all_dialogs.append(dialog)
                if filters.test_mode and processed_count >= 5:
                    break
            
            # Send initial chat list with checkpoints
            chat_list_data = []
            for dialog in all_dialogs:
                # Get dialog ID safely
                dialog_id = getattr(dialog, 'id', None)
                if not dialog_id or not isinstance(dialog_id, (int, str)):
                    self.log(f"Skipping dialog with invalid ID: {dialog}")
                    continue
                    
                checkpoint = self.checkpoint_manager.get_checkpoint(dialog_id)
                chat_list_data.append({
                    'id': dialog_id,
                    'title': dialog.name or "Unknown",
                    'type': "User" if dialog.is_user else "Group",
                    'last_scan_date': checkpoint.last_scan_date if checkpoint else None,
                    'last_deleted_count': checkpoint.messages_deleted if checkpoint else 0,
                    'status': 'pending'
                })
            
            self.update_status("Chat list loaded", {
                'type': 'chat_list',
                'chats': chat_list_data,
                'total': len(all_dialogs)
            })
            
            for dialog in all_dialogs:
                # Get dialog ID safely
                dialog_id = getattr(dialog, 'id', None)
                if not dialog_id or not isinstance(dialog_id, (int, str)):
                    self.log(f"Skipping dialog with invalid ID: {dialog}")
                    continue
                
                chat_name = dialog.name or "Unknown"
                
                # Update chat status to processing
                self.update_status(f"Processing chat: {chat_name}", {
                    'type': 'chat_scanning',
                    'chat_id': dialog_id,
                    'chat_name': chat_name,
                    'status': 'processing'
                })
                
                self.update_status(f"Processing chat: {chat_name}")
                
                # Apply filters
                if not filters.include_private and dialog.is_user:
                    self.update_status("Chat skipped", {
                        'type': 'chat_completed',
                        'chat_id': dialog_id,
                        'status': 'skipped',
                        'reason': 'Private chat excluded'
                    })
                    skipped_count += 1
                    continue
                
                if filters.chat_name_filters:
                    if not any(filter_term.lower() in chat_name.lower() for filter_term in filters.chat_name_filters):
                        self.update_status("Chat skipped", {
                            'type': 'chat_completed',
                            'chat_id': dialog_id,
                            'status': 'skipped',
                            'reason': 'Name filter excluded'
                        })
                        skipped_count += 1
                        continue
                
                # Get checkpoint for this chat
                checkpoint = self.checkpoint_manager.get_checkpoint(dialog_id, only_if_deleted=True)
                start_from_id = checkpoint.last_message_id if checkpoint else None
                
                # Delete messages
                message_count = 0
                deleted_count = 0
                messages_to_delete = []
                last_message_id = None
                
                # Start from checkpoint if available
                iter_kwargs = {'limit': filters.limit_per_chat or 1000}
                if start_from_id:
                    iter_kwargs['min_id'] = start_from_id
                    self.update_status(f"Resuming deletion from checkpoint in {chat_name} (message ID: {start_from_id})")
                
                async for message in self.client.iter_messages(dialog, **iter_kwargs):
                    if message.sender_id == (await self.client.get_me()).id:
                        if filters.after and message.date.date() < filters.after:
                            continue
                        if filters.before and message.date.date() > filters.before:
                            continue
                        message_count += 1
                        last_message_id = message.id
                        messages_to_delete.append(message)
                
                if messages_to_delete:
                    self.update_status(f"Deleting {len(messages_to_delete)} messages from {chat_name}")
                    for message in messages_to_delete:
                        try:
                            await self.safe_api_call(message.delete, revoke=filters.revoke)
                            deleted_count += 1
                            
                            # Update progress every 5 deletions
                            if deleted_count % 5 == 0:
                                self.update_status("Deletion progress", {
                                    'type': 'chat_progress',
                                    'chat_id': dialog_id,
                                    'messages_deleted': deleted_count,
                                    'total_to_delete': len(messages_to_delete)
                                })
                            
                            await asyncio.sleep(0.1)  # Small delay to avoid rate limits
                        except Exception as e:
                            self.log(f"Failed to delete message {message.id}: {e}")
                
                # Update checkpoint with deletion results
                self.checkpoint_manager.update_checkpoint(
                    dialog_id, 
                    chat_name, 
                    last_message_id,
                    deleted_count,
                    message_count
                )
                
                total_candidates += message_count
                total_deleted += deleted_count
                processed_count += 1
                
                chats.append(ChatResult(
                    id=dialog_id,
                    title=chat_name,
                    type="User" if dialog.is_user else "Group",
                    participants_count=1 if dialog.is_user else 0,
                    candidates_found=message_count,
                    deleted=deleted_count
                ))
                
                self.update_status(f"Deleted {deleted_count}/{message_count} messages from {chat_name}")
                
                # Update chat status to completed
                self.update_status("Chat completed", {
                    'type': 'chat_completed',
                    'chat_id': dialog_id,
                    'status': 'completed',
                    'messages_deleted': deleted_count,
                    'messages_found': message_count
                })
            
            self.update_status(f"Deletion complete! Deleted {total_deleted} messages across {processed_count} chats")
            
            return OperationResult(
                chats=chats,
                total_chats_processed=processed_count,
                total_chats_skipped=skipped_count,
                total_candidates=total_candidates,
                total_deleted=total_deleted,
                logs=self.logs,
                user_created_groups=[]
            )
            
        except Exception as e:
            error_msg = f"Delete failed: {str(e)}"
            self.update_status(error_msg)
            return OperationResult(
                chats=[],
                total_chats_processed=0,
                total_chats_skipped=0,
                total_candidates=0,
                total_deleted=0,
                logs=[error_msg],
                user_created_groups=[]
            )

    def get_scan_progress(self) -> Dict[str, Any]:
        """Get current scan progress for real-time updates"""
        try:
            # Get progress from checkpoint manager
            progress = self.checkpoint_manager.get_progress()

            return {
                'current_chat': progress.get('current_chat', ''),
                'chat_id': progress.get('chat_id', 0),
                'status': progress.get('status', 'idle'),
                'total_chats': progress.get('total_chats', 0),
                'current_index': progress.get('current_index', 0),
                'completed': progress.get('completed', 0),
                'skipped': progress.get('skipped', 0),
                'errors': progress.get('errors', 0),
                'total_messages': progress.get('total_messages', 0),
                'scanned_chats': progress.get('scanned_chats', [])
            }
        except Exception as e:
            logger.error(f"Error getting scan progress: {e}")
            return {
                'current_chat': '',
                'chat_id': 0,
                'status': 'error',
                'total_chats': 0,
                'current_index': 0,
                'completed': 0,
                'skipped': 0,
                'errors': 1,
                'total_messages': 0,
                'scanned_chats': []
            }

    def get_rate_limit_status(self) -> Dict[str, Any]:
        """Get current rate limit status"""
        try:
            # Check if we have any active rate limits
            current_time = time.time()
            
            # This is a simplified check - in a real implementation you'd track rate limits
            return {
                'is_rate_limited': False,
                'rate_limit_expires_at': None,
                'can_retry': True,
                'message': 'No active rate limits'
            }
        except Exception as e:
            logger.error(f"Error getting rate limit status: {e}")
            return {
                'is_rate_limited': True,
                'rate_limit_expires_at': None,
                'can_retry': False,
                'message': 'Unable to check rate limit status'
            }

    async def delete_messages(self, chat_id: int, message_ids: List[int], revoke: bool = True) -> dict:
        """Delete messages from a specific chat"""
        try:
            if not self.client or not self.client.is_connected():
                return {
                    'success': False,
                    'error': 'Client not connected',
                    'message': 'Telegram client is not connected'
                }

            self.log(f"Deleting {len(message_ids)} messages from chat {chat_id}")
            
            # Get the entity first to ensure it exists
            try:
                entity = await self.safe_api_call(self.client.get_entity, chat_id)
                if not entity:
                    return {
                        'success': False,
                        'error': 'Chat not found',
                        'message': f'Could not find chat with ID {chat_id}'
                    }
                self.log(f"Found entity: {entity}")
            except Exception as e:
                self.log(f"Error getting entity for chat {chat_id}: {str(e)}")
                return {
                    'success': False,
                    'error': 'Chat not found',
                    'message': f'Could not access chat {chat_id}: {str(e)}'
                }
            
            # Delete messages in batches to avoid rate limits
            batch_size = 5  # Smaller batches for better reliability
            deleted_count = 0
            failed_count = 0
            
            for i in range(0, len(message_ids), batch_size):
                batch = message_ids[i:i + batch_size]
                
                try:
                    self.log(f"Attempting to delete batch of {len(batch)} messages: {batch}")
                    
                    # Delete the batch of messages
                    result = await self.safe_api_call(
                        self.client.delete_messages,
                        entity=entity,
                        message_ids=batch,
                        revoke=revoke
                    )
                    
                    if result:
                        deleted_count += len(batch)
                        self.log(f"Successfully deleted {len(batch)} messages")
                    else:
                        failed_count += len(batch)
                        self.log(f"Failed to delete {len(batch)} messages - result was falsy")
                        
                except Exception as e:
                    self.log(f"Error deleting batch: {str(e)}")
                    failed_count += len(batch)
                
                # Smart delay based on batch size and rate limits
                delay = min(1.0 + (len(batch) * 0.2), 3.0)  # Longer delays for better reliability
                await asyncio.sleep(delay)
            
            return {
                'success': True,
                'deleted_count': deleted_count,
                'failed_count': failed_count,
                'total_requested': len(message_ids)
            }
            
        except Exception as e:
            self.log(f"Error deleting messages: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'message': 'Failed to delete messages'
            }

    async def verify_messages_deleted(self, chat_id: int, deleted_message_ids: List[int], 
                                    start_time: datetime, end_time: datetime) -> dict:
        """Verify that messages were actually deleted by scanning the chat in the time range"""
        try:
            self.log(f"Verifying deletion of {len(deleted_message_ids)} messages in chat {chat_id}")
            
            if not self.client or not self.client.is_connected():
                return {
                    'success': False,
                    'error': 'Client not connected',
                    'message': 'Telegram client is not connected'
                }
            
            # Get the chat entity
            entity = await self.safe_api_call(self.client.get_entity, chat_id)
            if not entity:
                return {"success": False, "error": "Chat not found"}
            
            # Get me info for this verification
            me = await self.safe_api_call(self.client.get_me)
            my_id = me.id
            
            # Scan messages in the time range
            found_messages = []
            total_scanned = 0
            
            try:
                async for message in self.client.iter_messages(entity, offset_date=end_time, reverse=True):
                    total_scanned += 1
                    
                    # Check if we've gone past the start time
                    if message.date < start_time:
                        break
                    
                    # Only check messages from the user
                    if message.sender_id == my_id and message.id in deleted_message_ids:
                        found_messages.append({
                            'id': message.id,
                            'content': message.text or '[Media]',
                            'date': message.date.isoformat()
                        })
                        
            except Exception as e:
                self.log(f"Error scanning messages for verification: {e}")
                return {"success": False, "error": str(e)}
            
            # Determine verification result
            still_exist = len(found_messages)
            actually_deleted = len(deleted_message_ids) - still_exist
            
            verification_result = {
                "success": True,
                "total_deleted": len(deleted_message_ids),
                "actually_deleted": actually_deleted,
                "still_exist": still_exist,
                "found_messages": found_messages,
                "total_scanned": total_scanned,
                "time_range": {
                    "start": start_time.isoformat(),
                    "end": end_time.isoformat()
                }
            }
            
            self.log(f"Verification complete: {actually_deleted} actually deleted, {still_exist} still exist")
            return verification_result
            
        except Exception as e:
            self.log(f"Error verifying deletion: {e}")
            return {"success": False, "error": str(e)}

    async def send_batch_message(self, message: str, chat_ids: list, delay_seconds: int = 1, dry_run: bool = True) -> dict:
        """Send a message to multiple chats"""
        try:
            self.log(f"Sending batch message to {len(chat_ids)} chats")
            sent_count = 0
            failed_count = 0
            results = []
            
            # Ensure client is connected
            try:
                if self.client and not self.client.is_connected():
                    await self.client.connect()
                
                # Wait a moment for connection to establish
                await asyncio.sleep(1)
            except Exception as e:
                self.log(f"Error connecting client: {str(e)}")
                return {
                    'sent_count': 0,
                    'failed_count': len(chat_ids),
                    'results': [{'chat_id': chat_id, 'status': 'failed', 'error': f'Connection error: {str(e)}'} for chat_id in chat_ids]
                }
            
            # Check if client is available
            if not self.client:
                self.log("Client is not available")
                return {
                    'sent_count': 0,
                    'failed_count': len(chat_ids),
                    'results': [{'chat_id': chat_id, 'status': 'failed', 'error': 'Client is not available'} for chat_id in chat_ids]
                }
            
            # Try to initialize client if needed
            if not hasattr(self.client, 'get_entity'):
                self.log("Client is not properly initialized")
                return {
                    'sent_count': 0,
                    'failed_count': len(chat_ids),
                    'results': [{'chat_id': chat_id, 'status': 'failed', 'error': 'Client is not properly initialized'} for chat_id in chat_ids]
                }
            
            for i, chat_id in enumerate(chat_ids):
                try:
                    if dry_run:
                        self.log(f"[DRY RUN] Would send message to chat {chat_id}: {message[:50]}...")
                        results.append({
                            'chat_id': chat_id,
                            'status': 'success',
                            'message': 'Message would be sent (dry run)'
                        })
                        sent_count += 1
                    else:
                        # Get chat entity
                        chat = await self.client.get_entity(chat_id)
                        
                        # Send message
                        await self.client.send_message(chat, message)
                        
                        self.log(f"Sent message to chat {chat_id}")
                        results.append({
                            'chat_id': chat_id,
                            'status': 'success',
                            'message': 'Message sent successfully'
                        })
                        sent_count += 1
                    
                    # Add delay between messages
                    if i < len(chat_ids) - 1:
                        await asyncio.sleep(delay_seconds)
                        
                except Exception as e:
                    self.log(f"Error sending message to chat {chat_id}: {str(e)}")
                    results.append({
                        'chat_id': chat_id,
                        'status': 'failed',
                        'error': str(e)
                    })
                    failed_count += 1
            
            self.log(f"Batch message completed: {sent_count} sent, {failed_count} failed")
            return {
                'sent_count': sent_count,
                'failed_count': failed_count,
                'results': results
            }
            
        except Exception as e:
            self.log(f"Error in batch message sending: {str(e)}")
            return {
                'sent_count': 0,
                'failed_count': len(chat_ids),
                'results': [{'chat_id': chat_id, 'status': 'failed', 'error': str(e)} for chat_id in chat_ids]
            }
    
    async def get_all_messages(self, time_frame_hours: int = 24) -> List[Dict[str, Any]]:
        """Get all messages from all groups within the specified time frame"""
        try:
            self.log(f"Retrieving all messages from last {time_frame_hours} hours...")
            
            messages = []
            cutoff_time = datetime.now() - timedelta(hours=time_frame_hours)
            
            # Get all dialogs
            dialogs = await self.client.get_dialogs()
            
            for dialog in dialogs:
                if isinstance(dialog.entity, (Chat, Channel)) and not dialog.is_user:
                    try:
                        chat_messages = await self._get_messages_from_dialog(dialog, cutoff_time)
                        messages.extend(chat_messages)
                        self.log(f"Retrieved {len(chat_messages)} messages from {dialog.name}")
                    except Exception as e:
                        self.log(f"Error retrieving messages from {dialog.name}: {str(e)}")
                        continue
            
            self.log(f"Total messages retrieved: {len(messages)}")
            return messages
            
        except Exception as e:
            self.log(f"Error retrieving all messages: {str(e)}")
            return []
    
    async def get_messages_from_group(self, group_id: str, time_frame_hours: int = 24) -> List[Dict[str, Any]]:
        """Get messages from a specific group within the specified time frame"""
        try:
            self.log(f"Retrieving messages from group {group_id} from last {time_frame_hours} hours...")
            
            messages = []
            cutoff_time = datetime.now() - timedelta(hours=time_frame_hours)
            
            # Get the specific dialog
            dialog = await self.client.get_entity(int(group_id))
            
            if isinstance(dialog, (Chat, Channel)) and not dialog.is_user:
                chat_messages = await self._get_messages_from_dialog(dialog, cutoff_time)
                messages.extend(chat_messages)
                self.log(f"Retrieved {len(chat_messages)} messages from {dialog.title}")
            
            return messages
            
        except Exception as e:
            self.log(f"Error retrieving messages from group {group_id}: {str(e)}")
            return []
    
    async def _get_messages_from_dialog(self, dialog, cutoff_time: datetime) -> List[Dict[str, Any]]:
        """Helper method to get messages from a specific dialog"""
        messages = []
        
        try:
            async for message in self.client.iter_messages(dialog, limit=None):
                if message.date < cutoff_time:
                    break
                
                if message.text:
                    message_data = {
                        'id': message.id,
                        'chat_id': dialog.id,
                        'chat_name': dialog.title or dialog.name,
                        'text': message.text,
                        'date': message.date,
                        'sender_id': message.sender_id,
                        'is_forwarded': message.forward is not None,
                        'is_reply': message.reply_to is not None
                    }
                    messages.append(message_data)
        
        except Exception as e:
            self.log(f"Error iterating messages from {dialog.title}: {str(e)}")
        
        return messages
