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
                    # Send code request and get phone_code_hash
                    self.log(f"Sending verification code to {phone}")
                    sent_code = await self.safe_api_call(self.client.send_code_request, phone)
                    self.log("Verification code sent successfully")
                    return {
                        "success": True, 
                        "status": "CODE_SENT",
                        "phone_code_hash": sent_code.phone_code_hash,
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

    async def sign_in_with_code(self, phone: str, code: str, phone_code_hash: str = None, password: str = None) -> Dict[str, Any]:
        """Sign in with verification code and optional 2FA password"""
        try:
            if not self.client:
                self.client = TelegramClient(
                    self.session_name, 
                    self.api_id, 
                    self.api_hash
                )
                await self.client.connect()
                if not self.client:
                    return {"success": False, "error": "Client not connected"}
            
            # Clean the code - remove spaces and ensure it's exactly 5 digits
            clean_code = ''.join(filter(str.isdigit, code))
            if len(clean_code) != 5:
                return {"success": False, "error": f"Invalid code format. Expected 5 digits, got {len(clean_code)}"}
            
            try:
                self.log(f"Signing in with code: {clean_code}")
                await self.safe_api_call(self.client.sign_in, phone=phone, code=clean_code, phone_code_hash=phone_code_hash)
                self.log("Sign in with code successful")
            except SessionPasswordNeededError:
                self.log("2FA password required")
                if not password:
                    return {
                        "success": False, 
                        "error": "2FA_REQUIRED",
                        "message": "Two-factor authentication password required"
                    }
                self.log("Attempting sign in with 2FA password")
                await self.safe_api_call(self.client.sign_in, password=password)
                self.log("2FA sign in successful")
            except errors.PhoneCodeInvalidError:
                self.log("Invalid verification code")
                return {"success": False, "error": "Invalid verification code. Please check the code from your Telegram app and try again."}
            except errors.PhoneCodeExpiredError:
                self.log("Verification code expired")
                return {"success": False, "error": "Verification code expired. Please connect again to get a new code."}
            except errors.PasswordHashInvalidError:
                self.log("Invalid 2FA password")
                return {"success": False, "error": "Invalid 2FA password. Please try again."}
            
            me = await self.safe_api_call(self.client.get_me)
            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            
            self.log(f"Successfully authenticated as @{username}")
            
            return {
                "success": True,
                "status": "AUTHENTICATED", 
                "username": username,
                "user_id": me.id
            }
            
        except Exception as e:
            error_msg = f"Sign in failed: {str(e)}"
            self.log(error_msg)
            return {"success": False, "error": error_msg}

    # ... שאר שיטות מחלקה TelegramDeleter ללא שינוי (כפי ששלחת)

# שאר הקוד נותר כפי שהיה בלי שינוי
