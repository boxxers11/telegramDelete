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

    async def safe_client_connect(self, max_retries=3):
        """Safely connect to Telegram with database lock handling"""
        for attempt in range(max_retries):
            try:
                # Close any existing client first
                if self.client:
                    await self.client.disconnect()
                    self.client = None
                    await asyncio.sleep(2)  # Give more time for cleanup
                
                self.client = TelegramClient(
                    self.session_name, 
                    self.api_id, 
                    self.api_hash
                )
                
                await self.client.connect()
                self.log(f"Successfully connected to Telegram (attempt {attempt + 1})")
                return True
                
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e).lower():
                    wait_time = (attempt + 1) * 2
                    self.update_status(f"Database locked, retrying in {wait_time} seconds... (attempt {attempt + 1}/{max_retries})")
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    raise
            except Exception as e:
                if attempt >= max_retries - 1:
                    raise
                await asyncio.sleep(2)
        
        raise Exception("Failed to connect after multiple attempts")
    async def safe_api_call(self, method, *args, max_retries=3, **kwargs):
        """Safely call Telegram API with flood wait handling"""
        for attempt in range(max_retries):
            try:
                result = await method(*args, **kwargs)
                return result
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
                if attempt >= max_retries - 1:
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
            
            async for dialog in self.client.iter_dialogs():
                if filters.test_mode and processed_count >= 5:
                    break
                
                chat_name = dialog.name or "Unknown"
                self.update_status(f"Scanning chat: {chat_name}")
                
                # Apply filters
                if not filters.include_private and dialog.is_user:
                    skipped_count += 1
                    continue
                
                if filters.chat_name_filters:
                    if not any(filter_term.lower() in chat_name.lower() for filter_term in filters.chat_name_filters):
                        skipped_count += 1
                        continue
                
                # Count messages
                message_count = 0
                async for message in self.client.iter_messages(dialog, limit=filters.limit_per_chat or 1000):
                    if message.sender_id == (await self.client.get_me()).id:
                        if filters.after and message.date.date() < filters.after:
                            continue
                        if filters.before and message.date.date() > filters.before:
                            continue
                        message_count += 1
                
                total_candidates += message_count
                processed_count += 1
                
                chats.append(ChatResult(
                    id=dialog.id,
                    title=chat_name,
                    type="User" if dialog.is_user else "Group",
                    participants_count=1 if dialog.is_user else 0,
                    candidates_found=message_count,
                    deleted=0
                ))
                
                self.update_status(f"Found {message_count} messages in {chat_name}")
            
            self.update_status(f"Scan complete! Found {total_candidates} messages across {processed_count} chats")
            
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
            
            async for dialog in self.client.iter_dialogs():
                if filters.test_mode and processed_count >= 5:
                    break
                
                chat_name = dialog.name or "Unknown"
                self.update_status(f"Processing chat: {chat_name}")
                
                # Apply filters
                if not filters.include_private and dialog.is_user:
                    skipped_count += 1
                    continue
                
                if filters.chat_name_filters:
                    if not any(filter_term.lower() in chat_name.lower() for filter_term in filters.chat_name_filters):
                        skipped_count += 1
                        continue
                
                # Delete messages
                message_count = 0
                deleted_count = 0
                messages_to_delete = []
                
                async for message in self.client.iter_messages(dialog, limit=filters.limit_per_chat or 1000):
                    if message.sender_id == (await self.client.get_me()).id:
                        if filters.after and message.date.date() < filters.after:
                            continue
                        if filters.before and message.date.date() > filters.before:
                            continue
                        message_count += 1
                        messages_to_delete.append(message)
                
                if messages_to_delete:
                    self.update_status(f"Deleting {len(messages_to_delete)} messages from {chat_name}")
                    for message in messages_to_delete:
                        try:
                            await self.safe_api_call(message.delete, revoke=filters.revoke)
                            deleted_count += 1
                            await asyncio.sleep(0.1)  # Small delay to avoid rate limits
                        except Exception as e:
                            self.log(f"Failed to delete message {message.id}: {e}")
                
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
