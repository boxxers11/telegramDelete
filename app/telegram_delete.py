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
        self.logs = []
        self.status_callback = None
        self._session_lock = session_lock
        # Extract account ID from session name for checkpoint manager
        account_id = session_name.split('_')[-1] if '_' in session_name else 'default'
        self.logs = [] # Initialize logs list
        self.checkpoint_manager = CheckpointManager(account_id)

    def set_status_callback(self, callback):
        """Set callback function for status updates"""
        self.status_callback = callback

    def update_status(self, status: str, data: Dict = None):
        """Update status and call callback if set"""
        self.log(status)
        if self.status_callback:
            self.status_callback(status, data or {})

    def log(self, message: str):
        """Update status and call callback if set"""
        self.log(status)
        if self.status_callback:
            self.status_callback(status, data or {})

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
                        self.update_status(f"Database locked, retrying in {wait_time} seconds... (attempt {attempt + 1}/{max_retries})")
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
        """Scan messages with visual feedback"""
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
                    logs=["Error: Not authenticated"]
                )
            
            self.update_status("Getting chat list...")
            chats = []
            total_candidates = 0
            processed_count = 0
            skipped_count = 0
            
            # Get me info once
            me = await self.safe_api_call(self.client.get_me)
            my_id = me.id
            
            # Get all dialogs and send initial list
            all_dialogs = []
            async for dialog in self.client.iter_dialogs():
                all_dialogs.append(dialog)
                # Only limit in test mode if explicitly requested
                if filters.test_mode and not filters.full_scan and len(all_dialogs) >= 5:
                    break
            
            total_dialogs = len(all_dialogs)
            
            # Send initial chat list
            chat_list_data = []
            for dialog in all_dialogs:
                checkpoint = self.checkpoint_manager.get_checkpoint(dialog.id)
                chat_list_data.append({
                    'id': dialog.id,
                    'title': dialog.name or "Unknown",
                    'type': "User" if dialog.is_user else "Group",
                    'last_scan_date': checkpoint.last_scan_date if checkpoint else None,
                    'last_deleted_count': checkpoint.messages_deleted if checkpoint else 0,
                    'status': 'pending'
                })
            
            self.update_status("Chat list loaded", {
                'type': 'chat_list',
                'chats': chat_list_data,
                'total': total_dialogs
            })
            
            # Process each dialog
            for i, dialog in enumerate(all_dialogs):
                
                chat_name = dialog.name or "Unknown"
                
                # Update chat status to scanning
                self.update_status(f"Scanning chat: {chat_name} ({i+1}/{total_dialogs})", {
                    'type': 'chat_scanning',
                    'chat_id': dialog.id,
                    'chat_name': chat_name,
                    'current_index': i,
                    'total': total_dialogs,
                    'status': 'scanning'
                })
                
                # Apply filters
                if not filters.include_private and dialog.is_user:
                    self.update_status(f"Skipping private chat: {chat_name}")
                    self.update_status("Chat skipped", {
                        'type': 'chat_completed',
                        'chat_id': dialog.id,
                        'status': 'skipped',
                        'reason': 'Private chat excluded'
                    })
                    skipped_count += 1
                    continue
                
                if filters.chat_name_filters:
                    if not any(filter_term.lower() in chat_name.lower() for filter_term in filters.chat_name_filters):
                        self.update_status(f"Skipping filtered chat: {chat_name}")
                        self.update_status("Chat skipped", {
                            'type': 'chat_completed',
                            'chat_id': dialog.id,
                            'status': 'skipped',
                            'reason': 'Name filter excluded'
                        })
                        skipped_count += 1
                        continue
                
                # Get checkpoint for this chat
                checkpoint = self.checkpoint_manager.get_checkpoint(dialog.id, only_if_deleted=True)
                start_from_id = checkpoint.last_message_id if checkpoint else None
                
                # Count messages with progress updates
                message_count = 0
                last_message_id = None
                messages_data = []
                
                try:
                    # Start from checkpoint if available
                    iter_kwargs = {'limit': filters.limit_per_chat or 1000}
                    if start_from_id:
                        iter_kwargs['min_id'] = start_from_id
                        self.update_status(f"Resuming from checkpoint in {chat_name} (message ID: {start_from_id})")
                    
                    async for message in self.client.iter_messages(dialog, **iter_kwargs):
                        if message.sender_id == my_id:
                            if filters.after and message.date.date() < filters.after:
                                continue
                            if filters.before and message.date.date() > filters.before:
                                continue
                            message_count += 1
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
                                    message_data['media_url'] = f"data:image/jpeg;base64,{message.photo}"
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
                            
                            # Update progress every 10 messages
                            if message_count % 10 == 0:
                                self.update_status(f"Found {message_count} messages in {chat_name}...")
                                self.update_status("Scanning progress", {
                                    'type': 'chat_progress',
                                    'chat_id': dialog.id,
                                    'messages_found': message_count
                                })
                
                except Exception as e:
                    self.log(f"Error scanning {chat_name}: {e}")
                    self.update_status("Chat error", {
                        'type': 'chat_completed',
                        'chat_id': dialog.id,
                        'status': 'error',
                        'error': str(e)
                    })
                    chats.append(ChatResult(
                        id=dialog.id,
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
                    dialog.id, 
                    chat_name, 
                    last_message_id,
                    0,  # No messages deleted in scan mode
                    message_count
                )
                
                total_candidates += message_count
                processed_count += 1
                
                chat_result = ChatResult(
                    id=dialog.id,
                    title=chat_name,
                    type="User" if dialog.is_user else "Group",
                    participants_count=1 if dialog.is_user else 0,
                    candidates_found=message_count,
                    deleted=0
                )
                
                # Add messages data to the result
                chat_result.messages = messages_data
                chats.append(chat_result)
                
                self.update_status(f"✅ Found {message_count} messages in {chat_name}")
                
                # Update chat status to completed
                self.update_status("Chat completed", {
                    'type': 'chat_completed',
                    'chat_id': dialog.id,
                    'status': 'completed',
                    'messages_found': message_count,
                    'messages': messages_data
                })
            
            self.update_status(f"🎉 Scan complete! Found {total_candidates} messages across {processed_count} chats")
            
            return OperationResult(
                chats=chats,
                total_chats_processed=processed_count,
                total_chats_skipped=skipped_count,
                total_candidates=total_candidates,
                total_deleted=0,
                logs=self.logs
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
                logs=[error_msg]
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
                    logs=["Error: Not authenticated"]
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
                        if filters.limit_per_chat and message_count >= filters.limit_per_chat:
                            break
                
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
                    logs=["Error: Not authenticated"]
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
                checkpoint = self.checkpoint_manager.get_checkpoint(dialog.id)
                chat_list_data.append({
                    'id': dialog.id,
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
                if filters.test_mode and processed_count >= 5:
                    break
                
                chat_name = dialog.name or "Unknown"
                
                # Update chat status to processing
                self.update_status(f"Processing chat: {chat_name}", {
                    'type': 'chat_scanning',
                    'chat_id': dialog.id,
                    'chat_name': chat_name,
                    'status': 'processing'
                })
                
                self.update_status(f"Processing chat: {chat_name}")
                
                # Apply filters
                if not filters.include_private and dialog.is_user:
                    self.update_status("Chat skipped", {
                        'type': 'chat_completed',
                        'chat_id': dialog.id,
                        'status': 'skipped',
                        'reason': 'Private chat excluded'
                    })
                    skipped_count += 1
                    continue
                
                if filters.chat_name_filters:
                    if not any(filter_term.lower() in chat_name.lower() for filter_term in filters.chat_name_filters):
                        self.update_status("Chat skipped", {
                            'type': 'chat_completed',
                            'chat_id': dialog.id,
                            'status': 'skipped',
                            'reason': 'Name filter excluded'
                        })
                        skipped_count += 1
                        continue
                
                # Get checkpoint for this chat
                checkpoint = self.checkpoint_manager.get_checkpoint(dialog.id, only_if_deleted=True)
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
                                    'chat_id': dialog.id,
                                    'messages_deleted': deleted_count,
                                    'total_to_delete': len(messages_to_delete)
                                })
                            
                            await asyncio.sleep(0.1)  # Small delay to avoid rate limits
                        except Exception as e:
                            self.log(f"Failed to delete message {message.id}: {e}")
                
                # Update checkpoint with deletion results
                self.checkpoint_manager.update_checkpoint(
                    dialog.id, 
                    chat_name, 
                    last_message_id,
                    deleted_count,
                    message_count
                )
                
                total_candidates += message_count
                total_deleted += deleted_count
                processed_count += 1
                
                chats.append(ChatResult(
                    id=dialog.id,
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
                    'chat_id': dialog.id,
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
                logs=self.logs
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
                logs=[error_msg]
            )
    # ... שאר שיטות מחלקה TelegramDeleter ללא שינוי (כפי ששלחת)

# שאר הקוד נותר כפי שהיה בלי שינוי
