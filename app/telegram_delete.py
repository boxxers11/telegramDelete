import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, date, timedelta, timezone
from typing import List, Optional, AsyncIterator, Dict, Any
from telethon import TelegramClient, errors
from telethon.tl.types import Chat, Channel, User, Message, MessageEntityMentionName
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest
from telethon.tl.functions.contacts import GetBlockedRequest
from telethon.errors import (
    FloodWaitError,
    RpcCallFailError,
    SessionPasswordNeededError,
    ChatWriteForbiddenError,
    UserBannedInChannelError,
    ChatAdminRequiredError,
)
import sqlite3
import time
import os
import threading
from .checkpoint_manager import CheckpointManager
from .found_messages_store import FoundMessagesStore

logger = logging.getLogger(__name__)


def ensure_timezone_aware(dt: datetime) -> datetime:
    """
    Normalize datetime values so comparisons work with Telethon's timezone-aware dates.
    Telethon returns UTC-aware datetimes; if we receive naive datetimes we assume UTC.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

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
    group_rules: Optional[str] = ''
    last_sent_at: Optional[str] = None
    send_status: Optional[str] = None
    send_error: Optional[str] = None

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
        self.status_callbacks: List[Any] = []
        self._session_lock = session_lock
        self.is_paused = False
        self.scanned_chats = []  # Initialize scanned_chats list
        self.scan_state = {}  # Store current scan state
        self.group_rules_cache: Dict[int, str] = {}
        self.last_sent_log: Dict[int, str] = {}
        self.blocked_chats: set[int] = set()
        self.semantic_cache: Dict[str, List[Dict[str, Any]]] = {}
        self._cached_me: Optional[User] = None  # Cache for get_me to avoid repeated API calls
        # Extract account ID from session name for checkpoint manager
        account_id = session_name.split('_')[-1] if '_' in session_name else 'default'
        self.account_id = account_id
        self.checkpoint_manager = CheckpointManager(account_id)
        self.found_messages_store = FoundMessagesStore(account_id)
        self.telegram_user_id: Optional[int] = None

    def _format_display_name(self, entity: Optional[User]) -> str:
        if not entity:
            return 'משתמש לא ידוע'
        first = (getattr(entity, 'first_name', '') or '').strip()
        last = (getattr(entity, 'last_name', '') or '').strip()
        if first or last:
            return ' '.join(part for part in [first, last] if part)
        username = getattr(entity, 'username', None)
        if username:
            return f"@{username}"
        return 'משתמש לא ידוע'

    def _message_mentions_user(self, message: Message, me_user: User, username: Optional[str]) -> bool:
        if getattr(message, 'mentioned', False):
            return True
        text = (getattr(message, 'message', '') or '').lower()
        if username:
            mention_token = f"@{username.lower()}"
            if mention_token in text:
                return True
        entities = getattr(message, 'entities', []) or []
        for entity in entities:
            user_id = getattr(entity, 'user_id', None)
            if user_id and user_id == getattr(me_user, 'id', None):
                return True
            if isinstance(entity, MessageEntityMentionName) and getattr(entity, 'user_id', None) == getattr(me_user, 'id', None):
                return True
        return False

    def _message_to_text(self, message: Message) -> str:
        text = getattr(message, 'message', None) or getattr(message, 'raw_text', '') or ''
        text = text.strip()
        if text:
            return text
        if getattr(message, 'media', None):
            return '[מדיה]'
        if getattr(message, 'action', None):
            return '[פעולת מערכת]'
        return '[ללא טקסט]'

    def add_status_callback(self, callback):
        """Register callback for status updates and return it for later removal"""
        if callback and callback not in self.status_callbacks:
            self.status_callbacks.append(callback)
        return callback

    def remove_status_callback(self, callback):
        """Remove a previously registered status callback"""
        if callback in self.status_callbacks:
            self.status_callbacks.remove(callback)

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

    def ensure_owner_context(self, owner_id: Optional[int]):
        if owner_id is None:
            return
        owner_changed = self.checkpoint_manager.ensure_owner(owner_id)
        found_changed = self.found_messages_store.ensure_owner(owner_id)
        self.telegram_user_id = owner_id
        if owner_changed or found_changed:
            self.scanned_chats = []
            self.blocked_chats.clear()
            self.last_sent_log.clear()

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
            await asyncio.sleep(0.2)  # Delay before get_entity
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
                    
                    # Small delay to respect rate limits (safety margin above 0.033s minimum)
                    await asyncio.sleep(0.15)
                    
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
        payload = data or {}
        for callback in list(self.status_callbacks):
            try:
                callback(status_message, payload)
            except Exception as callback_error:
                logger.debug(f"Status callback failed: {callback_error}")

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

    async def get_group_rules(self, dialog) -> str:
        """Fetch and cache group rules/description for a dialog"""
        dialog_id = getattr(dialog, 'id', None)
        if dialog_id in self.group_rules_cache:
            return self.group_rules_cache[dialog_id]

        rules_text = ''

        try:
            if isinstance(dialog.entity, Channel):
                try:
                    full = await self.client(GetFullChannelRequest(dialog.entity))
                    rules_text = getattr(full.full_chat, 'about', '') or ''
                    # Fallback to pinned message if available and about is empty
                    if not rules_text and getattr(full.full_chat, 'pinned_msg_id', None):
                        try:
                            pinned = await self.safe_api_call(self.client.get_messages, dialog, ids=full.full_chat.pinned_msg_id)
                            if pinned and pinned.message:
                                rules_text = pinned.message
                        except Exception as pinned_error:
                            logger.debug(f"Pinned message fetch failed for {dialog_id}: {pinned_error}")
                except FloodWaitError as e:
                    wait_time = e.seconds
                    self.log(f"⚠️ FloodWait in get_group_rules for {dialog_id}: waiting {wait_time} seconds...")
                    await asyncio.sleep(wait_time + 1)
                    # Retry after flood wait
                    full = await self.client(GetFullChannelRequest(dialog.entity))
                    rules_text = getattr(full.full_chat, 'about', '') or ''
            elif isinstance(dialog.entity, Chat):
                try:
                    full = await self.client(GetFullChatRequest(dialog.entity.id))
                    rules_text = getattr(full.full_chat, 'about', '') or ''
                except FloodWaitError as e:
                    wait_time = e.seconds
                    self.log(f"⚠️ FloodWait in get_group_rules (Chat) for {dialog_id}: waiting {wait_time} seconds...")
                    await asyncio.sleep(wait_time + 1)
                    # Retry after flood wait
                    full = await self.client(GetFullChatRequest(dialog.entity.id))
                    rules_text = getattr(full.full_chat, 'about', '') or ''
            else:
                # For other dialog types we attempt generic get_entity
                try:
                    entity = await self.safe_api_call(self.client.get_entity, dialog_id)
                    if isinstance(entity, Channel):
                        try:
                            full = await self.client(GetFullChannelRequest(entity))
                            rules_text = getattr(full.full_chat, 'about', '') or ''
                        except FloodWaitError as e:
                            wait_time = e.seconds
                            self.log(f"⚠️ FloodWait in get_group_rules (entity) for {dialog_id}: waiting {wait_time} seconds...")
                            await asyncio.sleep(wait_time + 1)
                            # Retry after flood wait
                            full = await self.client(GetFullChannelRequest(entity))
                            rules_text = getattr(full.full_chat, 'about', '') or ''
                except FloodWaitError as e:
                    wait_time = e.seconds
                    self.log(f"⚠️ FloodWait in get_entity for {dialog_id}: waiting {wait_time} seconds...")
                    await asyncio.sleep(wait_time + 1)
                    # Retry after flood wait
                    entity = await self.safe_api_call(self.client.get_entity, dialog_id)
                    if isinstance(entity, Channel):
                        full = await self.client(GetFullChannelRequest(entity))
                        rules_text = getattr(full.full_chat, 'about', '') or ''
            
        except Exception as rules_error:
            logger.debug(f"Could not fetch rules for dialog {dialog_id}: {rules_error}")
            rules_text = ''

        # Normalize whitespace and keep concise text
        if isinstance(rules_text, str):
            cleaned = rules_text.strip()
            rules_text = cleaned
        else:
            rules_text = ''

        self.group_rules_cache[dialog_id] = rules_text
        return rules_text

    async def get_group_rules_by_id(self, chat_id: int, entity: Any = None) -> str:
        if chat_id in self.group_rules_cache:
            return self.group_rules_cache[chat_id]
        try:
            if not entity:
                await asyncio.sleep(0.2)  # Delay before get_entity
            dialog = entity or await self.client.get_entity(chat_id)
            return await self.get_group_rules(dialog)
        except Exception as fetch_error:
            logger.debug(f"Failed to resolve dialog for rules ({chat_id}): {fetch_error}")
            self.group_rules_cache[chat_id] = ''
            return ''

    @staticmethod
    def evaluate_message_against_rules(message: str, rules: str) -> Dict[str, Any]:
        if not rules or not rules.strip():
            return {'compliant': True, 'reasons': []}

        lower_rules = rules.lower()
        lower_message = (message or '').lower()
        reasons: List[str] = []

        def contains_any(text: str, keywords: List[str]) -> bool:
            return any(keyword in text for keyword in keywords)

        has_link = contains_any(lower_message, ['http://', 'https://', 'www.', '.com', '.co.il', '.net'])
        has_mention = '@' in lower_message

        link_keywords = ['אסור קישור', 'אסור קישורים', 'ללא קישורים', 'no links', 'no link']
        promo_keywords = ['אסור פרסום', 'אסור לפרסם', 'ללא פרסום', 'no ads', 'no advertising', 'no promotion']
        bot_keywords = ['אסור בוט', 'no bots', 'bot messages']

        if contains_any(lower_rules, link_keywords) and has_link:
            reasons.append('ההודעה כוללת קישור בניגוד לחוקי הקבוצה')

        if contains_any(lower_rules, promo_keywords) and (has_link or has_mention):
            reasons.append('ההודעה עשויה להיתפס כפרסומית בניגוד לחוקי הקבוצה')

        if contains_any(lower_rules, bot_keywords) and ('bot' in lower_message or 'בוט' in lower_message):
            reasons.append('חוקי הקבוצה מגבילים שימוש בבוטים')

        return {
            'compliant': len(reasons) == 0,
            'reasons': reasons
        }

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
            except (sqlite3.OperationalError, Exception) as e:  # Catch database locked and other exceptions
                error_str = str(e).lower()
                # Special handling for database locked errors
                if "database is locked" in error_str:
                    wait_time = min((attempt + 1) * 3, 15)  # Max 15 seconds wait
                    if attempt == 0:  # Only log on first attempt to avoid spam
                        self.update_status(f"Database locked, retrying in {wait_time} seconds... (attempt {attempt + 1}/{max_retries})", {
                            'type': 'database_locked',
                            'wait_time': wait_time,
                            'attempt': attempt + 1,
                            'max_retries': max_retries
                        })
                    self.log(f"Database locked, retrying in {wait_time} seconds... (attempt {attempt + 1}/{max_retries})")
                    await asyncio.sleep(wait_time)
                    continue
                elif attempt >= max_retries - 1:
                    raise
                else:
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
            await asyncio.sleep(0.2)  # Delay before get_me to respect API rate limits
            me = await self.safe_api_call(self.client.get_me)
            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            self.ensure_owner_context(getattr(me, 'id', None))
            
            self.log(f"Connected as @{username}")
            self.update_status(f"Successfully connected as @{username}")
            connected_at = datetime.utcnow().replace(tzinfo=timezone.utc).isoformat()
            
            return {
                "success": True, 
                "status": "AUTHENTICATED",
                "username": username,
                "user_id": me.id,
                "last_connected_at": connected_at
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
            await asyncio.sleep(0.2)  # Delay before get_me to respect API rate limits
            me = await self.safe_api_call(self.client.get_me)
            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            self.ensure_owner_context(getattr(me, 'id', None))
            
            self.log(f"Successfully authenticated as @{username}")
            self.update_status(f"Successfully authenticated as @{username}")
            connected_at = datetime.utcnow().replace(tzinfo=timezone.utc).isoformat()
            
            return {
                "success": True,
                "status": "AUTHENTICATED", 
                "username": username,
                "user_id": me.id,
                "last_connected_at": connected_at
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
            if hasattr(self, 'semantic_cache'):
                self.semantic_cache.clear()
            
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
            
            # Initialize scan progress early - before Phase 1
            # We'll update total_chats after Phase 1 completes
            self.checkpoint_manager.start_scan(0)  # Start with 0, will update after Phase 1
            
            # PHASE 1: Quick scan - Get all group names and member counts
            self.update_status("Phase 1: Quick scanning all groups...")
            chats = []
            total_candidates = 0
            processed_count = 0
            skipped_count = 0
            
            # Get me info once (cache it to avoid repeated calls)
            if not hasattr(self, '_cached_me') or not self._cached_me:
                await asyncio.sleep(0.2)  # Delay before get_me to respect API rate limits
                me = await self.safe_api_call(self.client.get_me)
                self._cached_me = me
            else:
                me = self._cached_me
            my_id = me.id
            
            # Get all dialogs quickly - Phase 1
            all_dialogs = []
            valid_groups = []  # Only count groups with >20 members
            self.log("🔍 Phase 1: Quick scan - Getting all group names...")
            
            # Wrap iter_dialogs in try-except to handle FloodWait
            # Add delay before iter_dialogs (heavy operation)
            await asyncio.sleep(0.3)
            try:
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
                    
                    # Delay to respect Telegram API rate limits (minimum 0.033s between requests)
                    # Using 0.2s for safety margin above the 0.033s minimum
                    await asyncio.sleep(0.2)  # Increased delay to prevent FloodWait
            except FloodWaitError as e:
                wait_time = e.seconds
                self.log(f"⚠️ FloodWait in iter_dialogs: waiting {wait_time} seconds...")
                self.update_status(f"Rate limited. Waiting {wait_time} seconds...", {
                    'type': 'flood_wait',
                    'wait_time': wait_time,
                    'phase': 1,
                    'message': f'FloodWait: waiting {wait_time} seconds before continuing scan'
                })
                await asyncio.sleep(wait_time + 1)  # Add 1 second buffer
                # Retry iter_dialogs after flood wait
                self.log("🔄 Retrying iter_dialogs after FloodWait...")
                async for dialog in self.client.iter_dialogs():
                    # Skip if already processed
                    dialog_id = getattr(dialog, 'id', None)
                    if any(d.id == dialog_id for d in all_dialogs):
                        continue
                    
                    all_dialogs.append(dialog)
                    
                    # Get dialog ID safely
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
                            'total_discovered': len(valid_groups)
                        })
                    else:
                        chat_type = "private chat" if dialog.is_user else f"small group ({member_count} members)"
                        self.log(f"Skipping {chat_type}: {dialog.name}")
                    
                    await asyncio.sleep(0.2)  # Increased delay to prevent FloodWait
            except Exception as e:
                self.log(f"❌ Error in iter_dialogs: {e}")
                self.update_status(f"Error getting dialogs: {str(e)}", {
                    'type': 'error',
                    'phase': 1,
                    'error': str(e)
                })
                # Continue with what we have so far
                self.log(f"⚠️ Continuing with {len(all_dialogs)} dialogs found so far...")
            
            total_dialogs = len(all_dialogs)
            total_valid_groups = len(valid_groups)
            self.log(f"✅ Phase 1 complete: Found {total_dialogs} total dialogs, {total_valid_groups} valid groups (>20 members)")
            
            # Send phase 1 completion
            self.update_status(f"Phase 1 complete: {total_valid_groups} groups found", {
                'type': 'phase1_complete',
                'total_groups': total_valid_groups
            })
            
            # Update scan progress with actual total_chats after Phase 1
            self.checkpoint_manager.update_progress(
                total_chats=total_valid_groups,
                status='scanning'
            )
            
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
            
            self.log(f"🚀 Starting Phase 2 loop: {len(dialogs_to_process)} groups to process")
            for i, dialog in enumerate(dialogs_to_process):
                self.log(f"📍 Phase 2 iteration {i+1}/{len(dialogs_to_process)}: Processing dialog...")
                # Check if scan is paused
                while self.is_paused:
                    await asyncio.sleep(1)  # Wait while paused
                
                # Add delay between groups to avoid FloodWait
                # Telegram API limits: max 30 requests/second, so we need at least 0.033s between requests
                # For safety, we use 1 second between groups (iter_messages is a heavy operation)
                if i > 0:  # Don't delay before first group
                    self.log(f"⏳ Waiting 1 second before scanning group {i+1}/{len(dialogs_to_process)}...")
                    await asyncio.sleep(1.0)  # 1 second delay between groups to prevent FloodWait
                
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
                
                # Delay before starting to scan this group (respects API rate limits)
                await asyncio.sleep(0.2)  # 200ms delay before starting group scan
                
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
                logger.info(f"Starting scan of group {i+1}/{len(dialogs_to_process)}: {chat_name} (ID: {dialog_id})")
                
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
                
                # Get checkpoint for this chat - IMPORTANT: Don't use only_if_deleted for scans!
                # We need scan checkpoints even if no messages were deleted
                checkpoint = self.checkpoint_manager.get_checkpoint(dialog_id, only_if_deleted=False)
                start_from_id = checkpoint.last_message_id if checkpoint else None
                
                # Smart date management - scan intelligently based on last scan date
                # Always scan at least 1 month back if no scan data exists
                today = date.today()
                one_month_ago = today - timedelta(days=30)
                min_scan_date = one_month_ago  # Minimum scan depth: 1 month
                
                scan_start_date = None
                if checkpoint and checkpoint.last_scan_date:
                    try:
                        # Parse the stored date string (ISO format)
                        if isinstance(checkpoint.last_scan_date, str):
                            parsed_date = datetime.fromisoformat(checkpoint.last_scan_date.replace('Z', '+00:00')).date()
                        elif isinstance(checkpoint.last_scan_date, date):
                            parsed_date = checkpoint.last_scan_date
                        elif isinstance(checkpoint.last_scan_date, datetime):
                            parsed_date = checkpoint.last_scan_date.date()
                        else:
                            parsed_date = None
                        
                        if parsed_date:
                            # Check if last scan was recent (within 1 month)
                            days_since_scan = (today - parsed_date).days
                            if days_since_scan < 30:
                                # Recent scan - only scan new messages since last scan
                                scan_start_date = parsed_date
                                self.log(f"📅 Recent scan found ({days_since_scan} days ago) for {chat_name} - scanning only new messages since {scan_start_date}")
                            else:
                                # Old scan (>1 month) - scan at least 1 month back to catch up
                                scan_start_date = max(parsed_date, min_scan_date)
                                self.log(f"📅 Old scan found ({days_since_scan} days ago) for {chat_name} - scanning from {scan_start_date} (at least 1 month back)")
                    except Exception as date_error:
                        self.log(f"⚠️ Error parsing last_scan_date for {chat_name}: {date_error}")
                        # Fall back to 1 month ago if date parsing fails
                        scan_start_date = min_scan_date
                        self.log(f"Using fallback date: {scan_start_date}")
                else:
                    # No checkpoint found - first time scanning or no scan history
                    # Always scan at least 1 month back, or use filter date if provided
                    if filters.after:
                        scan_start_date = max(filters.after, min_scan_date) if filters.after else min_scan_date
                        self.log(f"🆕 First time scanning {chat_name} - starting from filter date: {scan_start_date} (minimum: {min_scan_date})")
                    else:
                        # Default: scan 1 month back (not 5 years - too slow!)
                        scan_start_date = min_scan_date
                        self.log(f"🆕 First time scanning {chat_name} - starting from {scan_start_date} (1 month back)")
                
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
                    
                    # Get me info for this iteration (cache it to avoid repeated API calls)
                    if not hasattr(self, '_cached_me') or not self._cached_me:
                        await asyncio.sleep(0.2)  # Delay before get_me to respect rate limits
                        me = await self.safe_api_call(self.client.get_me)
                        self._cached_me = me
                    else:
                        me = self._cached_me
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
                    
                    # Apply date filter to skip already scanned messages
                    if scan_start_date:
                        # Only scan messages after the last scan date
                        # iter_messages goes from newest to oldest, so we stop when we reach scanned messages
                        iter_kwargs.setdefault('offset_date', None)  # Will be set dynamically
                    
                    # Track if we've found any messages in the scan window
                    found_messages_in_window = False
                    messages_before_window = 0
                    
                    # Wrap iter_messages in try-except to handle FloodWait
                    # Note: iter_messages internally calls GetFullChannelRequest which is rate-limited
                    # We add a delay before starting to reduce FloodWait risk
                    # Increased delay to 1 second to give Telegram API time to recover from previous requests
                    await asyncio.sleep(1.0)  # Increased delay before iter_messages (heavy API call)
                    self.log(f"🔍 Starting iter_messages for {chat_name} with kwargs: {iter_kwargs}")
                    try:
                        # Wrap iter_messages call itself in try-except to catch FloodWait during generator creation
                        try:
                            message_iterator = self.client.iter_messages(dialog, **iter_kwargs)
                        except FloodWaitError as e:
                            wait_time = e.seconds
                            self.log(f"⚠️ FloodWait during iter_messages initialization for {chat_name}: waiting {wait_time} seconds...")
                            self.update_status(f"Rate limited while initializing scan of {chat_name}. Waiting {wait_time} seconds...", {
                                'type': 'flood_wait',
                                'wait_time': wait_time,
                                'chat_id': dialog_id,
                                'chat_name': chat_name,
                                'message': f'FloodWait: waiting {wait_time} seconds before starting scan of {chat_name}'
                            })
                            await asyncio.sleep(wait_time + 2)  # Add 2 second buffer for safety
                            # Retry after waiting
                            message_iterator = self.client.iter_messages(dialog, **iter_kwargs)
                        
                        async for message in message_iterator:
                            message_date = message.date.date()
                            
                            # Skip messages that are older than our scan start date
                            if scan_start_date and message_date < scan_start_date:
                                messages_before_window += 1
                                # Only break if we've checked enough messages and found none in window
                                # This prevents stopping too early if there are gaps in message history
                                if messages_before_window > 50 and not found_messages_in_window:
                                    self.log(f"⏭️ Reached scanned messages boundary in {chat_name} (checked {messages_before_window} old messages)")
                                    break
                                continue  # Skip old messages but keep checking
                            
                            # We're in the scan window
                            found_messages_in_window = True
                            total_messages_checked += 1
                            
                            # Update progress every 50 messages
                            # Add small delay every 20 messages to respect API rate limits
                            # Using 0.15s for safety margin above the 0.033s minimum
                            if total_messages_checked % 20 == 0:
                                await asyncio.sleep(0.15)  # Increased delay every 20 messages
                            
                            if total_messages_checked % 50 == 0:
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

                                found_at_iso = datetime.utcnow().isoformat()

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
                                    'media_url': None,
                                    'found_at': found_at_iso,
                                    'sender': getattr(message, 'sender_id', None) or me.id,
                                    'metadata': {
                                        'is_out': getattr(message, 'out', False)
                                    }
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
                                
                        # Update progress periodically (reduced frequency for better performance)
                        if message_count > 0 and message_count % 20 == 0:
                            self.update_status(f"Found {message_count} messages in {chat_name}...")
                            # Minimal delay - API handles rate limiting
                            self.update_status("Scanning progress", {
                                'type': 'chat_progress',
                                'chat_id': dialog_id,
                                'messages_found': message_count
                            })
                    except FloodWaitError as e:
                        wait_time = e.seconds
                        self.log(f"⚠️ FloodWait in iter_messages for {chat_name}: waiting {wait_time} seconds...")
                        self.update_status(f"Rate limited while scanning {chat_name}. Waiting {wait_time} seconds...", {
                            'type': 'flood_wait',
                            'wait_time': wait_time,
                            'chat_id': dialog_id,
                            'chat_name': chat_name,
                            'message': f'FloodWait: waiting {wait_time} seconds before continuing scan of {chat_name}'
                        })
                        await asyncio.sleep(wait_time + 2)  # Add 2 second buffer for safety
                        # Skip this group and continue to next one to avoid getting stuck
                        # We'll retry this group in the next scan
                        self.log(f"⏭️ Skipping {chat_name} due to FloodWait - will retry in next scan")
                        message_count = 0  # Reset count since we didn't complete the scan
                        # Mark this chat as skipped due to FloodWait
                        self.checkpoint_manager.update_chat_progress(
                            dialog_id, chat_name, 'skipped', skipped_reason=f'FloodWait: {wait_time}s'
                        )
                        chats.append(ChatResult(
                            id=dialog_id,
                            title=chat_name,
                            type="User" if dialog.is_user else "Group",
                            participants_count=1 if dialog.is_user else 0,
                            candidates_found=0,
                            deleted=0,
                            skipped_reason=f'FloodWait: {wait_time}s'
                        ))
                        skipped_count += 1
                        # Skip the rest of the processing for this group and continue to next
                        continue  # Continue to next group in the outer loop
                
                except Exception as e:
                    error_type = type(e).__name__
                    error_msg = str(e)
                    self.log(f"❌ Error scanning {chat_name}: {error_type}: {error_msg}")
                    logger.error(f"Error scanning {chat_name} (ID: {dialog_id}): {error_type}: {error_msg}", exc_info=True)
                    # Update progress in checkpoint manager
                    self.checkpoint_manager.update_chat_progress(
                        dialog_id, chat_name, 'error', error=f"{error_type}: {error_msg}"
                    )
                    self.update_status(f"Error scanning {chat_name}: {error_type}", {
                        'type': 'chat_completed',
                        'chat_id': dialog_id,
                        'status': 'error',
                        'error': f"{error_type}: {error_msg}"
                    })
                    chats.append(ChatResult(
                        id=dialog_id,
                        title=chat_name,
                        type="User" if dialog.is_user else "Group",
                        participants_count=1 if dialog.is_user else 0,
                        candidates_found=0,
                        deleted=0,
                        error=f"{error_type}: {error_msg}"
                    ))
                    # Continue to next group instead of stopping the entire scan
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
                
                # Get group rules (OPTIONAL - skip if not cached to avoid FloodWait)
                # Only get rules if already cached, otherwise skip to avoid rate limits
                group_rules = ''
                dialog_id_for_rules = getattr(dialog, 'id', None)
                if dialog_id_for_rules and dialog_id_for_rules in self.group_rules_cache:
                    # Use cached rules if available
                    group_rules = self.group_rules_cache[dialog_id_for_rules]
                    self.log(f"📋 Using cached rules for {chat_name}")
                else:
                    # Skip getting rules during scan to avoid FloodWait
                    # Rules can be fetched later when viewing group details
                    group_rules = ''
                    self.log(f"⏭️ Skipping group rules for {chat_name} to avoid rate limits (will fetch later if needed)")

                chat_result = ChatResult(
                    id=dialog_id,
                    title=chat_name,
                    type="User" if dialog.is_user else "Group",
                    participants_count=1 if dialog.is_user else 0,
                    candidates_found=message_count,
                    deleted=0,
                    messages=messages_data,
                    group_rules=group_rules
                )
                
                # Persist results for later viewing/deletion
                if messages_data:
                    try:
                        self.found_messages_store.replace_chat_messages(dialog_id, chat_name, messages_data)
                    except Exception as store_error:
                        self.log(f"Failed to persist found messages for chat {dialog_id}: {store_error}")

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
                        'has_unscanned_dates': False,  # Will be calculated based on date coverage
                        'group_rules': group_rules
                    }],
                    messages_found=message_count
                )
                
                self.log(f"✅ COMPLETED GROUP {i+1}/{len(dialogs_to_process)}: {chat_name} - Found {message_count} messages")
                self.log(f"📊 Group Stats: ID={dialog_id}, Messages={message_count}, Participants={getattr(dialog.entity, 'participants_count', 'Unknown') if hasattr(dialog, 'entity') else 'Unknown'}")
                self.update_status(f"✅ Group {i+1}/{len(dialogs_to_process)} completed: {chat_name} - {message_count} messages found")
                
                # Smart date management - update last scan date
                # Always update scan date to current time, regardless of whether messages were found
                # This ensures we don't rescan the same period unnecessarily
                current_scan_date = datetime.now().isoformat()
                self.checkpoint_manager.update_chat_progress(
                    dialog_id, chat_name, 'completed', message_count, 
                    last_scan_date=current_scan_date, messages=messages_data,
                    group_rules=group_rules
                )
                
                # Also update checkpoint directly to ensure it's saved
                self.checkpoint_manager.update_checkpoint(
                    dialog_id, chat_name, last_message_id, 0, message_count
                )
                
                if message_count > 0:
                    self.log(f"✅ Updated last scan date to {current_scan_date} for {chat_name} (found {message_count} messages)")
                else:
                    self.log(f"✅ Updated last scan date to {current_scan_date} for {chat_name} (no messages found, but scan completed)")
                
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
            
            # Finish scan progress and save final state
            self.checkpoint_manager.finish_scan()
            
            # Ensure all progress is saved
            self.checkpoint_manager.save_checkpoints()
            
            self.log(f"✅ Scan completed successfully: {processed_count} chats processed, {total_candidates} messages found, {skipped_count} skipped")
            
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
            error_type = type(e).__name__
            error_msg = f"Scan failed: {error_type}: {str(e)}"
            self.log(f"❌ Scan error: {error_msg}")
            logger.error(f"Scan error for account: {error_type}: {str(e)}", exc_info=True)
            self.update_status(error_msg, {
                'type': 'error',
                'error': error_msg,
                'error_type': error_type
            })
            
            # Save error state to checkpoint manager
            try:
                progress = self.checkpoint_manager.get_progress()
                progress['status'] = 'error'
                progress['error'] = error_msg
                self.checkpoint_manager.save_checkpoints()
            except Exception as save_error:
                logger.error(f"Failed to save error state: {save_error}")
            
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
            
            # Cache get_me to avoid repeated API calls
            if not hasattr(self, '_cached_me') or not self._cached_me:
                await asyncio.sleep(0.2)  # Delay before get_me to respect API rate limits
                me = await self.safe_api_call(self.client.get_me)
                self._cached_me = me
            else:
                me = self._cached_me
            my_id = me.id

            # Add delay before iter_dialogs (heavy operation)
            await asyncio.sleep(0.3)
            async for dialog in self.client.iter_dialogs():
                if len(found_messages) >= limit:
                    break
                
                # Delay to respect Telegram API rate limits (minimum 0.033s between requests)
                # Using 0.2s for safety margin above the 0.033s minimum
                await asyncio.sleep(0.2)
                
                chat_name = dialog.name or "Unknown"
                self.update_status(f"Searching in: {chat_name}")
                processed_chats += 1
                
                try:
                    # Add delay before iter_messages (heavy operation)
                    await asyncio.sleep(0.3)
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
                # Delay to respect Telegram API rate limits (minimum 0.033s between requests)
                # Using 0.2s for safety margin above the 0.033s minimum
                await asyncio.sleep(0.2)
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
                
                # Cache get_me to avoid repeated API calls
                if not hasattr(self, '_cached_me') or not self._cached_me:
                    await asyncio.sleep(0.2)
                    self._cached_me = await self.client.get_me()
                
                async for message in self.client.iter_messages(dialog, **iter_kwargs):
                    if message.sender_id == self._cached_me.id:
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
                            
                            await asyncio.sleep(0.15)  # Increased delay to avoid rate limits (safety margin above 0.033s minimum)
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
                await asyncio.sleep(0.2)  # Delay before get_entity
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
            results: List[Dict[str, Any]] = []
            
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
                    
                    if result is not None:
                        deleted_count += len(batch)
                        self.log(f"Successfully deleted {len(batch)} messages")
                        results.extend({"message_id": mid, "status": "deleted"} for mid in batch)
                    else:
                        failed_count += len(batch)
                        self.log(f"Failed to delete {len(batch)} messages - result was falsy")
                        results.extend({"message_id": mid, "status": "failed", "error": "Empty response"} for mid in batch)

                except Exception as e:
                    self.log(f"Error deleting batch: {str(e)}")
                    failed_count += len(batch)
                    results.extend({"message_id": mid, "status": "failed", "error": str(e)} for mid in batch)
                
                # Smart delay based on batch size and rate limits
                delay = min(1.0 + (len(batch) * 0.2), 3.0)  # Longer delays for better reliability
                await asyncio.sleep(delay)
            
            return {
                'success': True,
                'deleted_count': deleted_count,
                'failed_count': failed_count,
                'total_requested': len(message_ids),
                'results': results
            }
            
        except Exception as e:
            self.log(f"Error deleting messages: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'message': 'Failed to delete messages',
                'results': []
            }

    async def delete_messages_before(
        self,
        chat_id: int,
        before_date: Optional[datetime],
        revoke: bool = True,
        max_messages: Optional[int] = None,
    ) -> dict:
        """
        Delete messages from a chat that were sent before the specified datetime.
        If before_date is None, all messages (up to max_messages if provided) will be deleted.
        """
        try:
            if not self.client or not self.client.is_connected():
                return {
                    'success': False,
                    'error': 'Client not connected',
                    'message': 'Telegram client is not connected'
                }

            # Resolve entity first
            try:
                await asyncio.sleep(0.2)  # Delay before get_entity
                entity = await self.safe_api_call(self.client.get_entity, chat_id)
                if not entity:
                    return {
                        'success': False,
                        'error': 'Chat not found',
                        'message': f'Could not find chat with ID {chat_id}'
                    }
            except Exception as exc:
                self.log(f"Error resolving entity for chat {chat_id}: {exc}")
                return {
                    'success': False,
                    'error': 'Chat not found',
                    'message': f'Could not access chat {chat_id}: {exc}'
                }

            cutoff = ensure_timezone_aware(before_date) if before_date else None
            total_examined = 0
            total_deleted = 0
            total_failed = 0
            collected_ids: List[int] = []

            async def flush_pending():
                nonlocal total_deleted, total_failed, collected_ids
                if not collected_ids:
                    return
                # Reuse deletion logic with small sub-batches for reliability
                batch_size = 5
                for i in range(0, len(collected_ids), batch_size):
                    batch = collected_ids[i:i + batch_size]
                    try:
                        self.log(f"Deleting batch of {len(batch)} messages (before-date op)")
                        result = await self.safe_api_call(
                            self.client.delete_messages,
                            entity=entity,
                            message_ids=batch,
                            revoke=revoke
                        )
                        if result is not None:
                            total_deleted += len(batch)
                        else:
                            self.log("delete_messages returned falsy result, counting as failure")
                            total_failed += len(batch)
                    except Exception as batch_error:
                        self.log(f"Error deleting batch {batch}: {batch_error}")
                        total_failed += len(batch)
                    await asyncio.sleep(min(1.0 + (len(batch) * 0.2), 3.0))
                collected_ids = []

            self.log(
                f"Collecting messages before {cutoff.isoformat() if cutoff else 'now'} "
                f"for chat {chat_id} (max={max_messages or '∞'})"
            )

            # Iterate from oldest to newest so we can break once we reach recent messages
            # Add delay before iter_messages (heavy operation)
            await asyncio.sleep(0.3)
            async for message in self.client.iter_messages(
                entity,
                limit=max_messages,
                reverse=True
            ):
                msg_date = message.date
                if cutoff:
                    if msg_date is None:
                        # Messages without a date (shouldn't happen) are treated as old
                        pass
                    else:
                        normalized = ensure_timezone_aware(msg_date)
                        # Stop once we reached messages on/after cutoff (i.e., too recent)
                        if normalized >= cutoff:
                            break

                if message.id is None:
                    continue

                collected_ids.append(message.id)
                total_examined += 1

                # Flush periodically to avoid large memory usage
                if len(collected_ids) >= 50:
                    await flush_pending()

            # Flush remaining ids
            await flush_pending()

            return {
                'success': True,
                'deleted_count': total_deleted,
                'failed_count': total_failed,
                'scanned_count': total_examined,
                'cutoff': cutoff.isoformat() if cutoff else None
            }

        except Exception as e:
            self.log(f"Error deleting messages before date: {e}")
            return {
                'success': False,
                'error': str(e),
                'message': 'Failed to delete messages by date'
            }

    async def verify_messages_deleted(self, chat_id: int, deleted_message_ids: List[int], 
                                    start_time: datetime, end_time: datetime) -> dict:
        """Verify that messages were actually deleted by scanning the chat in the time range"""
        try:
            self.log(f"Verifying deletion of {len(deleted_message_ids)} messages in chat {chat_id}")

            start_time = ensure_timezone_aware(start_time)
            end_time = ensure_timezone_aware(end_time)
            
            if not self.client or not self.client.is_connected():
                return {
                    'success': False,
                    'error': 'Client not connected',
                    'message': 'Telegram client is not connected'
                }
            
            # Get the chat entity
            await asyncio.sleep(0.2)  # Delay before get_entity
            entity = await self.safe_api_call(self.client.get_entity, chat_id)
            if not entity:
                return {"success": False, "error": "Chat not found"}
            
            # Get me info for this verification (cache it)
            if not hasattr(self, '_cached_me') or not self._cached_me:
                await asyncio.sleep(0.2)  # Delay before get_me to respect API rate limits
                me = await self.safe_api_call(self.client.get_me)
                self._cached_me = me
            else:
                me = self._cached_me
            my_id = me.id
            
            # Scan messages in the time range
            found_messages = []
            total_scanned = 0
            
            try:
                # Add delay before iter_messages (heavy operation)
                await asyncio.sleep(0.3)
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

    async def send_batch_message(self, message: str, chat_ids: list, delay_seconds: int = 1, dry_run: bool = True,
                                 force_chat_ids: Optional[List[int]] = None, self_destruct: bool = False) -> dict:
        """Send a message to multiple chats with rule validation and live status updates"""
        force_chat_ids = force_chat_ids or []

        try:
            self.log(f"Sending batch message to {len(chat_ids)} chats")
            sent_count = 0
            failed_count = 0
            skipped_count = 0
            results = []

            # Ensure client is connected
            try:
                if self.client and not self.client.is_connected():
                    await self.client.connect()
                await asyncio.sleep(1)
            except Exception as e:
                self.log(f"Error connecting client: {str(e)}")
                failure_result = {
                    'sent_count': 0,
                    'failed_count': len(chat_ids),
                    'results': [{'chat_id': chat_id, 'status': 'failed', 'error': f'Connection error: {str(e)}'} for chat_id in chat_ids]
                }
                for chat_id in chat_ids:
                    self.update_status("Connection error while preparing batch send", {
                        'type': 'message_send_status',
                        'chat_id': chat_id,
                        'status': 'failed',
                        'error': f'Connection error: {str(e)}',
                        'timestamp': datetime.utcnow().isoformat()
                    })
                return failure_result

            if not self.client or not hasattr(self.client, 'get_entity'):
                error_text = 'Client is not available'
                self.log(error_text)
                failure_result = {
                    'sent_count': 0,
                    'failed_count': len(chat_ids),
                    'results': [{'chat_id': chat_id, 'status': 'failed', 'error': error_text} for chat_id in chat_ids]
                }
                for chat_id in chat_ids:
                    self.update_status("Client unavailable", {
                        'type': 'message_send_status',
                        'chat_id': chat_id,
                        'status': 'failed',
                        'error': error_text,
                        'timestamp': datetime.utcnow().isoformat()
                    })
                return failure_result

            for index, chat_id in enumerate(chat_ids):
                started_at = datetime.utcnow()
                status_payload = {
                    'type': 'message_send_status',
                    'chat_id': chat_id,
                    'status': 'pending',
                    'timestamp': started_at.isoformat(),
                    'dry_run': dry_run
                }

                try:
                    await asyncio.sleep(0.2)  # Delay before get_entity
                    chat_entity = await self.client.get_entity(chat_id)
                    chat_title = getattr(chat_entity, 'title', None) or getattr(chat_entity, 'first_name', '') or str(chat_id)
                    status_payload['chat_title'] = chat_title
                except Exception as resolve_error:
                    chat_entity = None
                    chat_title = str(chat_id)
                    status_payload['chat_title'] = chat_title
                    self.log(f"Failed to resolve chat entity for {chat_id}: {resolve_error}")

                self.update_status(f"Preparing to send message to {chat_title}", status_payload)

                # Rule validation
                rules_text = await self.get_group_rules_by_id(chat_id, chat_entity)
                evaluation = self.evaluate_message_against_rules(message, rules_text)

                if not evaluation['compliant'] and chat_id not in force_chat_ids:
                    skipped_count += 1
                    result_entry = {
                        'chat_id': chat_id,
                        'status': 'skipped_rules',
                        'chat_title': chat_title,
                        'group_rules': rules_text,
                        'rules_reasons': evaluation['reasons'],
                        'timestamp': started_at.isoformat()
                    }
                    results.append(result_entry)
                    self.update_status(f"Message skipped for {chat_title} due to rules", {
                        **status_payload,
                        'status': 'skipped_rules',
                        'group_rules': rules_text,
                        'rules_reasons': evaluation['reasons']
                    })
                    self.checkpoint_manager.update_chat_progress(
                        chat_id,
                        chat_title,
                        'completed',
                        messages_found=0,
                        group_rules=rules_text,
                        send_status='skipped_rules',
                        send_error='; '.join(evaluation['reasons'])
                    )
                    continue

                try:
                    if dry_run:
                        self.log(f"[DRY RUN] Would send message to chat {chat_title}: {message[:80]}...")
                        result_entry = {
                            'chat_id': chat_id,
                            'status': 'dry_run',
                            'chat_title': chat_title,
                            'message': 'Message would be sent (dry run)',
                            'group_rules': rules_text,
                            'timestamp': started_at.isoformat()
                        }
                        sent_count += 1
                    else:
                        sent_message = await self.client.send_message(chat_entity or chat_id, message)
                        finished_at = datetime.utcnow()
                        message_id = sent_message.id if sent_message else None
                        self.log(f"Sent message to chat {chat_title}")
                        self.last_sent_log[chat_id] = finished_at.isoformat()
                        result_entry = {
                            'chat_id': chat_id,
                            'status': 'sent',
                            'chat_title': chat_title,
                            'message': 'Message sent successfully',
                            'group_rules': rules_text,
                            'timestamp': finished_at.isoformat(),
                            'duration_ms': int((finished_at - started_at).total_seconds() * 1000),
                            'message_id': message_id
                        }
                        sent_count += 1
                        self.checkpoint_manager.update_chat_progress(
                            chat_id,
                            chat_title,
                            'completed',
                            messages_found=0,
                            group_rules=rules_text,
                            last_sent_at=finished_at.isoformat(),
                            send_status='sent'
                        )
                        
                        # If self-destruct, save temporary message for deletion
                        if self_destruct and message_id:
                            self.checkpoint_manager.add_temporary_message(
                                chat_id=chat_id,
                                chat_title=chat_title,
                                message_id=message_id,
                                sent_at=finished_at.isoformat()
                            )
                            result_entry['self_destruct'] = True
                            result_entry['deletes_at'] = (finished_at + timedelta(hours=1)).isoformat()

                    results.append(result_entry)
                    self.update_status(f"Message status for {chat_title}: {result_entry['status']}", {
                        **status_payload,
                        'status': result_entry['status'],
                        'timestamp': result_entry['timestamp'],
                        'duration_ms': result_entry.get('duration_ms'),
                        'group_rules': rules_text,
                        'rules_reasons': evaluation['reasons'],
                        'forced': chat_id in force_chat_ids
                    })

                    if index < len(chat_ids) - 1 and not dry_run:
                        await asyncio.sleep(max(0, delay_seconds))

                except FloodWaitError as flood_error:
                    wait_time = getattr(flood_error, 'seconds', delay_seconds * 2)
                    self.update_status(f"Flood wait for {wait_time} seconds while sending to {chat_title}", {
                        **status_payload,
                        'status': 'flood_wait',
                        'wait_time': wait_time,
                        'error': str(flood_error)
                    })
                    await asyncio.sleep(wait_time)
                    failed_count += 1
                    results.append({
                        'chat_id': chat_id,
                        'status': 'failed',
                        'chat_title': chat_title,
                        'error': f'Flood wait: {wait_time} seconds',
                        'group_rules': rules_text,
                        'timestamp': datetime.utcnow().isoformat()
                    })

                except (ChatWriteForbiddenError, UserBannedInChannelError, ChatAdminRequiredError) as blocked_error:
                    self.blocked_chats.add(chat_id)
                    failed_count += 1
                    error_text = str(blocked_error)
                    blocked_result = {
                        'chat_id': chat_id,
                        'status': 'blocked',
                        'chat_title': chat_title,
                        'error': error_text,
                        'group_rules': rules_text,
                        'timestamp': datetime.utcnow().isoformat()
                    }
                    results.append(blocked_result)
                    self.update_status(f"Blocked from sending to {chat_title}", {
                        **status_payload,
                        'status': 'blocked',
                        'error': error_text
                    })
                    self.checkpoint_manager.update_chat_progress(
                        chat_id,
                        chat_title,
                        'completed',
                        messages_found=0,
                        group_rules=rules_text,
                        send_status='blocked',
                        send_error=error_text
                    )

                except Exception as e:
                    error_text = str(e)
                    failed_count += 1
                    failure_entry = {
                        'chat_id': chat_id,
                        'status': 'failed',
                        'chat_title': chat_title,
                        'error': error_text,
                        'group_rules': rules_text,
                        'timestamp': datetime.utcnow().isoformat()
                    }
                    results.append(failure_entry)
                    self.update_status(f"Error sending to {chat_title}: {error_text}", {
                        **status_payload,
                        'status': 'failed',
                        'error': error_text
                    })
                    self.checkpoint_manager.update_chat_progress(
                        chat_id,
                        chat_title,
                        'completed',
                        messages_found=0,
                        group_rules=rules_text,
                        send_status='failed',
                        send_error=error_text
                    )

            self.log(f"Batch message completed: {sent_count} sent, {failed_count} failed, {skipped_count} skipped")
            return {
                'sent_count': sent_count,
                'failed_count': failed_count,
                'skipped_count': skipped_count,
                'results': results
            }

        except Exception as e:
            self.log(f"Error in batch message sending: {str(e)}")
            return {
                'sent_count': 0,
                'failed_count': len(chat_ids),
                'skipped_count': 0,
                'results': [{'chat_id': chat_id, 'status': 'failed', 'error': str(e)} for chat_id in chat_ids]
            }
    
    async def get_folder_dialogs(self, folder_id: Optional[int] = None) -> List[Any]:
        # Delay before get_dialogs to respect API rate limits
        await asyncio.sleep(0.2)
        dialogs = await self.client.get_dialogs()
        if folder_id is None:
            return [d for d in dialogs if isinstance(d.entity, (Chat, Channel)) and not d.is_user]
        return [d for d in dialogs if isinstance(d.entity, (Chat, Channel)) and not d.is_user and getattr(d, 'folder_id', None) == folder_id]

    async def get_messages_from_dialog(self, dialog, time_frame_hours: int = 24, include_all_users: bool = False) -> List[Dict[str, Any]]:
        messages = []
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=time_frame_hours)

        try:
            me_user = None
            message_count = 0
            # Add delay before iter_messages (heavy operation)
            await asyncio.sleep(0.3)
            async for message in self.client.iter_messages(dialog, limit=None):
                message_count += 1
                # Add small delay every 50 messages to respect API rate limits
                # Using 0.15s for safety margin above the 0.033s minimum
                if message_count % 50 == 0:
                    await asyncio.sleep(0.15)
                if message.date < cutoff_time:
                    break

                text_content = message.text or ''
                if not text_content:
                    continue

                if me_user is None:
                    await asyncio.sleep(0.2)  # Delay before get_me
                    me_user = await self.client.get_me()

                if include_all_users and message.sender_id == me_user.id:
                    continue
                if not include_all_users and message.sender_id != me_user.id:
                    continue

                message_data = {
                    'id': message.id,
                    'chat_id': getattr(dialog, 'id', None),
                    'chat_name': getattr(dialog, 'title', None) or getattr(dialog, 'name', ''),
                    'text': text_content,
                    'date': message.date,
                    'sender_id': message.sender_id,
                    'is_forwarded': message.forward is not None,
                    'is_reply': message.reply_to is not None
                }

                messages.append(message_data)

        except Exception as e:
            self.log(f"Error iterating messages from {getattr(dialog, 'title', 'unknown')}: {str(e)}")

        return messages

    async def get_user_mentions(self, days: int = 1) -> List[Dict[str, Any]]:
        """Collect mentions of the current user within the specified time window (in days)."""
        cutoff_time = datetime.now(timezone.utc) - timedelta(days=days)
        mentions: List[Dict[str, Any]] = []

        if not self.client:
            raise RuntimeError("Telegram client is not initialized")

        await asyncio.sleep(0.2)  # Delay before get_me to respect API rate limits
        me_user = await self.client.get_me()
        if not me_user:
            return mentions
        username = getattr(me_user, 'username', None)

        # Add delay before iter_dialogs (heavy operation)
        await asyncio.sleep(0.3)
        async for dialog in self.client.iter_dialogs():
            # Delay to respect Telegram API rate limits (minimum 0.033s between requests)
            # Using 0.2s for safety margin above the 0.033s minimum
            await asyncio.sleep(0.2)
            
            entity = getattr(dialog, 'entity', None)
            if not isinstance(entity, (Chat, Channel)):
                continue

            chat_id = getattr(entity, 'id', None)
            chat_name = getattr(entity, 'title', None) or getattr(entity, 'name', '')

            # Add delay before iter_messages (heavy operation)
            await asyncio.sleep(0.3)
            async for message in self.client.iter_messages(entity, limit=None):
                message_date = getattr(message, 'date', None)
                if not message_date or message_date < cutoff_time:
                    break

                if getattr(message, 'out', False):
                    continue

                if not self._message_mentions_user(message, me_user, username):
                    continue

                sender = await message.get_sender()
                sender_display = self._format_display_name(sender)

                reply_text = None
                reply_timestamp = None
                reply_message_id = None
                reply_from_me = False

                if message.is_reply:
                    try:
                        reply_message = await message.get_reply_message()
                    except Exception:
                        reply_message = None

                    if reply_message:
                        reply_message_id = reply_message.id
                        reply_timestamp = reply_message.date.isoformat() if reply_message.date else None
                        reply_text = self._message_to_text(reply_message)
                        reply_from_me = getattr(reply_message, 'sender_id', None) == getattr(me_user, 'id', None)

                if not reply_text:
                    try:
                        await asyncio.sleep(0.2)  # Delay before get_messages
                        previous_messages = await self.client.get_messages(
                            entity,
                            limit=1,
                            from_user='me',
                            offset_date=message.date
                        )
                        if previous_messages:
                            prev_message = previous_messages[0]
                            reply_text = self._message_to_text(prev_message)
                            reply_timestamp = prev_message.date.isoformat() if prev_message.date else None
                            reply_message_id = prev_message.id
                            reply_from_me = True
                    except Exception as prev_error:
                        logger.debug(f"Failed to retrieve previous outgoing message: {prev_error}")

                mentions.append({
                    'id': f"{chat_id}_{message.id}",
                    'chat_id': chat_id,
                    'chat_name': chat_name,
                    'mention_message_id': message.id,
                    'mention_text': self._message_to_text(message),
                    'mention_timestamp': message_date.isoformat(),
                    'sender_id': getattr(sender, 'id', None) if sender else None,
                    'sender_username': getattr(sender, 'username', None) if sender else None,
                    'sender_display': sender_display,
                    'reply_message_id': reply_message_id,
                    'reply_text': reply_text,
                    'reply_timestamp': reply_timestamp,
                    'reply_from_me': reply_from_me,
                    'was_direct_reply': bool(message.is_reply),
                    'days_window': days
                })

        mentions.sort(key=lambda item: item['mention_timestamp'], reverse=True)
        return mentions

    async def send_mention_reply(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Send a direct message reply to a user who mentioned us."""
        if not self.client:
            raise RuntimeError("Telegram client is not initialized")

        reply_text = (payload.get('reply_text') or '').strip()
        if not reply_text:
            return {"success": False, "error": "Reply text cannot be empty"}

        target_user = None
        user_id = payload.get('user_id')
        username = payload.get('username')

        try:
            if user_id:
                await asyncio.sleep(0.2)  # Delay before get_entity
                target_user = await self.client.get_entity(int(user_id))
        except Exception as id_error:
            logger.debug(f"Failed to resolve user by ID {user_id}: {id_error}")

        if not target_user and username:
            try:
                lookup = username if username.startswith('@') else f"@{username}"
                await asyncio.sleep(0.2)  # Delay before get_entity
                target_user = await self.client.get_entity(lookup)
            except Exception as username_error:
                logger.debug(f"Failed to resolve user by username {username}: {username_error}")

        if not target_user:
            return {"success": False, "error": "המשתמש לא נמצא. בדוק את ה-username או user id"}

        chat_name = payload.get('chat_name')
        mention_text = (payload.get('mention_text') or '').strip()
        original_text = (payload.get('original_text') or '').strip()

        sections: List[str] = []
        if chat_name:
            sections.append(f"📍 בקבוצה: {chat_name}")
        if mention_text:
            sections.append("🗨️ ההודעה שלך:")
            sections.append(mention_text)
        if original_text:
            sections.append("")
            sections.append("↩️ ההודעה שעליה הגפת:")
            sections.append(original_text)
        if sections:
            sections.append("")
        sections.append("✍️ התגובה שלי:")
        sections.append(reply_text)

        message_body = "\n".join(sections).strip()

        sent_message = await self.client.send_message(target_user, message_body, link_preview=False)
        sent_time = getattr(sent_message, 'date', datetime.utcnow()).isoformat()

        return {
            "success": True,
            "sent_at": sent_time,
            "user_id": getattr(target_user, 'id', None),
            "username": getattr(target_user, 'username', None),
            "display_name": self._format_display_name(target_user)
        }

    async def get_blocked_contacts(self) -> Dict[str, Any]:
        """Get list of all blocked contacts/users with pagination"""
        blocked_users = []
        total_count = 0
        
        if not self.client:
            raise RuntimeError("Telegram client is not initialized")
        
        if not await self.client.is_user_authorized():
            raise RuntimeError("Not authenticated")
        
        try:
            offset = 0
            limit = 50  # Reduced limit to avoid timeouts
            processed_user_ids = set()  # Track processed users to avoid duplicates
            total_count = 0
            
            # Paginate through all blocked users
            max_iterations = 200  # Safety limit to prevent infinite loop (200 * 50 = 10,000 max)
            iteration = 0
            
            while iteration < max_iterations:
                iteration += 1
                self.log(f"Fetching blocked contacts: offset={offset}, limit={limit}, iteration={iteration}, loaded so far: {len(blocked_users)}")
                
                try:
                    # Add delay before GetBlockedRequest to respect API rate limits
                    await asyncio.sleep(0.2)
                    # Add timeout to prevent hanging
                    result = await asyncio.wait_for(
                        self.client(GetBlockedRequest(offset=offset, limit=limit)),
                        timeout=20.0  # 20 second timeout per request
                    )
                except asyncio.TimeoutError:
                    self.log(f"Timeout fetching blocked contacts at offset {offset}")
                    break
                except Exception as e:
                    self.log(f"Error fetching blocked contacts at offset {offset}: {e}")
                    break
                
                # Get total count from first request
                if offset == 0:
                    if hasattr(result, 'count'):
                        total_count = result.count
                        self.log(f"Total blocked contacts: {total_count}")
                    else:
                        self.log(f"No 'count' field in result, available fields: {[f for f in dir(result) if not f.startswith('_')]}")
                
                # Process blocked peers
                blocked_count_this_page = 0
                if hasattr(result, 'blocked') and result.blocked:
                    blocked_count_this_page = len(result.blocked)
                    self.log(f"Found {blocked_count_this_page} blocked peers in this page")
                    for peer_blocked in result.blocked:
                        if hasattr(peer_blocked, 'peer_id'):
                            peer_id = peer_blocked.peer_id
                            
                            # Extract user ID from peer_id (could be PeerUser or int)
                            user_id = None
                            if isinstance(peer_id, int):
                                user_id = peer_id
                            elif hasattr(peer_id, 'user_id'):
                                user_id = peer_id.user_id
                            elif hasattr(peer_id, 'id'):
                                user_id = peer_id.id
                            
                            if user_id is None:
                                self.log(f"Could not extract user_id from peer_id: {type(peer_id)}")
                                continue
                            
                            # Skip if already processed
                            if user_id in processed_user_ids:
                                continue
                            
                            processed_user_ids.add(user_id)
                            
                            # Get user entity
                            try:
                                await asyncio.sleep(0.2)  # Delay before get_entity to respect API rate limits
                                user = await self.safe_api_call(self.client.get_entity, peer_id)
                                if isinstance(user, User):
                                    blocked_date = None
                                    if hasattr(peer_blocked, 'date'):
                                        blocked_date = peer_blocked.date
                                    
                                    user_data = {
                                        'user_id': user.id,
                                        'username': getattr(user, 'username', None),
                                        'first_name': getattr(user, 'first_name', ''),
                                        'last_name': getattr(user, 'last_name', ''),
                                        'phone': getattr(user, 'phone', None),
                                        'display_name': self._format_display_name(user),
                                        'blocked_date': blocked_date.isoformat() if blocked_date else None,
                                        'is_bot': getattr(user, 'bot', False)
                                    }
                                    blocked_users.append(user_data)
                            except Exception as e:
                                self.log(f"Error getting user info for blocked contact {peer_id}: {e}")
                                # Add basic info even if we can't get full user details
                                blocked_users.append({
                                    'user_id': user_id,
                                    'error': str(e)
                                })
                
                # Process users from result
                users_count_this_page = 0
                if hasattr(result, 'users') and result.users:
                    users_count_this_page = len(result.users)
                    self.log(f"Found {users_count_this_page} users in result")
                    for user in result.users:
                        if isinstance(user, User) and user.id not in processed_user_ids:
                            processed_user_ids.add(user.id)
                            user_data = {
                                'user_id': user.id,
                                'username': getattr(user, 'username', None),
                                'first_name': getattr(user, 'first_name', ''),
                                'last_name': getattr(user, 'last_name', ''),
                                'phone': getattr(user, 'phone', None),
                                'display_name': self._format_display_name(user),
                                'is_bot': getattr(user, 'bot', False)
                            }
                            blocked_users.append(user_data)
                
                # Check if there are more results
                # Stop if no blocked peers returned
                if blocked_count_this_page == 0:
                    self.log("No more blocked peers, stopping pagination")
                    break
                
                # Stop if we got fewer than limit (last page)
                if blocked_count_this_page < limit:
                    self.log(f"Got {blocked_count_this_page} < {limit}, stopping pagination")
                    break
                
                # Safety check: if we've processed more than total_count (if available), stop
                if total_count > 0 and len(blocked_users) >= total_count:
                    self.log(f"Processed {len(blocked_users)} >= {total_count}, stopping pagination")
                    break
                
                # Move to next page
                offset += limit
                await asyncio.sleep(0.15)  # Increased delay to avoid rate limiting (safety margin above 0.033s minimum)
            
            if iteration >= max_iterations:
                self.log(f"WARNING: Reached max iterations ({max_iterations}), stopping pagination")
                                
        except Exception as e:
            self.log(f"Error getting blocked contacts: {e}")
            raise
        
        # Use total_count if available, otherwise use actual count
        final_total = total_count if total_count > 0 else len(blocked_users)
        
        return {
            'blocked_contacts': blocked_users,
            'total': final_total,
            'loaded': len(blocked_users)
        }
