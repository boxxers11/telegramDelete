from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import logging
import asyncio
import os
from app.accounts import account_store
from app.telegram_client_factory import get_deleter_for_account, clear_deleter_cache
from app.telegram_delete import Filters
# Lazy imports for heavy modules
# from app.semantic_search_models import SemanticSearchQuery, SemanticSearchResponse, SemanticSearchProgress
# from app.semantic_search_engine import semantic_engine
from app.checkpoint_manager import CheckpointManager
import json
from datetime import date, datetime, timedelta

# Create FastAPI app instance
app = FastAPI()

# Cache for checkpoint managers to avoid recreating them
checkpoint_managers = {}
deleter_cache = {}  # Cache for deleter instances

# Priority system for operations
operation_queue = []
current_operation = None
is_scanning = False
paused_scan_state = {}  # Store paused scan state

def get_checkpoint_manager(account_id: str) -> CheckpointManager:
    """Get or create checkpoint manager for account"""
    if account_id not in checkpoint_managers:
        checkpoint_managers[account_id] = CheckpointManager(account_id)
    return checkpoint_managers[account_id]

def clear_all_caches():
    """Clear all caches to free memory"""
    global checkpoint_managers, deleter_cache
    checkpoint_managers.clear()
    deleter_cache.clear()
    clear_deleter_cache()

def add_operation(operation_type: str, priority: int, operation_data: dict):
    """Add operation to priority queue"""
    global operation_queue
    operation = {
        'type': operation_type,
        'priority': priority,
        'data': operation_data,
        'timestamp': datetime.now()
    }
    operation_queue.append(operation)
    operation_queue.sort(key=lambda x: x['priority'], reverse=True)  # Higher priority first

def get_next_operation():
    """Get next operation from queue"""
    global operation_queue, current_operation
    if operation_queue and current_operation is None:
        current_operation = operation_queue.pop(0)
        return current_operation
    return None

def complete_operation():
    """Mark current operation as complete and check for paused scans"""
    global current_operation
    current_operation = None
    
    # בדוק אם יש סריקות מושהות שצריכות להמשיך
    check_and_resume_paused_scans()

def check_and_resume_paused_scans():
    """בדוק אם יש סריקות מושהות שצריכות להמשיך"""
    global paused_scan_state, is_scanning
    
    if is_scanning:
        return  # כבר יש סריקה רצה
    
    # מצא סריקה מושהית שצריכה להמשיך
    for account_id, scan_data in paused_scan_state.items():
        if scan_data.get('state'):
            logger.info(f"🔄 ממשיך סריקה אוטומטית עבור {account_id}")
            
            # הפעל את הסריקה
            resume_scanning()
            
            # מחק את המצב השמור
            clear_scan_state(account_id)
            
            # הפעל את הסריקה בפועל
            asyncio.create_task(resume_scan_for_account(account_id, scan_data['state']))
            break

async def resume_scan_for_account(account_id: str, scan_state: dict):
    """המשך סריקה עבור חשבון ספציפי"""
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            logger.error(f"Account not found: {account_id}")
            return
        
        # שחזר את מצב הסריקה
        deleter.restore_scan_state(scan_state)
        
        # המשך את הסריקה
        await deleter.continue_scan()
        
    except Exception as e:
        logger.error(f"Error resuming scan for {account_id}: {e}")

async def periodic_scan_check():
    """בדיקה תקופתית לסריקות מושהות"""
    while True:
        try:
            # בדוק כל 30 שניות
            await asyncio.sleep(30)
            
            # בדוק אם יש סריקות מושהות
            check_and_resume_paused_scans()
            
        except Exception as e:
            logger.error(f"Error in periodic scan check: {e}")

# הפעל את הבדיקה התקופתית
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(periodic_scan_check())

def pause_scanning():
    """Pause current scanning operation"""
    global is_scanning
    is_scanning = False
    logger.info("🔄 סריקה הופסקה לטובת פעולה מיידית")

def resume_scanning():
    """Resume scanning operation"""
    global is_scanning
    is_scanning = True
    logger.info("▶️ סריקה חודשה לאחר השלמת פעולה מיידית")

def add_operation_with_notification(operation_type: str, priority: int, operation_data: dict):
    """Add operation to priority queue with notification"""
    add_operation(operation_type, priority, operation_data)
    
    # Send notification about operation priority
    if priority >= 8:
        logger.info(f"⚡ פעולה מיידית נוספה לתור: {operation_type} (עדיפות: {priority})")
    else:
        logger.info(f"📋 פעולה נוספה לתור: {operation_type} (עדיפות: {priority})")

def save_scan_state(account_id: str, scan_state: dict):
    """Save current scan state before pausing"""
    global paused_scan_state
    paused_scan_state[account_id] = {
        'state': scan_state,
        'paused_at': datetime.now().isoformat()
    }
    logger.info(f"💾 מצב סריקה נשמר עבור {account_id}")

def get_scan_state(account_id: str) -> dict:
    """Get saved scan state for resuming"""
    global paused_scan_state
    return paused_scan_state.get(account_id, {})

def clear_scan_state(account_id: str):
    """Clear saved scan state after completion"""
    global paused_scan_state
    if account_id in paused_scan_state:
        del paused_scan_state[account_id]
        logger.info(f"🗑️ מצב סריקה נמחק עבור {account_id}")

def process_next_operation():
    """Process next operation in queue"""
    global current_operation, operation_queue, is_scanning
    
    if current_operation is not None:
        return  # Already processing an operation
    
    next_op = get_next_operation()
    if next_op:
        logger.info(f"🔄 מתחיל פעולה: {next_op['type']} (עדיפות: {next_op['priority']})")
        
        # If it's a scan operation, resume scanning
        if next_op['type'] == 'scan':
            resume_scanning()
            # Restore scan state if available
            account_id = next_op['data']['account_id']
            scan_state = get_scan_state(account_id)
            if scan_state:
                logger.info(f"📂 משחזר מצב סריקה עבור {account_id}")
                # The scan will resume from where it was paused
        else:
            # For immediate operations, ensure scanning is paused
            pause_scanning()
        
        return next_op
    
    return None

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # React dev server
        "http://127.0.0.1:5173",  # Alternative localhost
        "http://localhost:3000",  # Alternative React port
        "https://local-telegram-messa-cgvs.bolt.host",  # Deployed frontend
        "null"  # For file:// protocol testing
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_origin_regex=r"https?://.*",  # Allow any http/https origin
)

# Add logging middleware
@app.middleware("http")
async def log_requests(request, call_next):
    logger.info(f"Request: {request.method} {request.url}")
    logger.info(f"Headers: {dict(request.headers)}")
    response = await call_next(request)
    logger.info(f"Response: {response.status_code}")
    return response

# Mount static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Templates
templates = Jinja2Templates(directory="app/templates")

# Pydantic models
class CreateAccountRequest(BaseModel):
    label: str
    api_id: int
    api_hash: str
    phone: str

class ConnectAccountRequest(BaseModel):
    code: Optional[str] = None
    phone_code_hash: Optional[str] = None
    password: Optional[str] = None

class ConnectRequest(BaseModel):
    phone: str

class ScanRequest(BaseModel):
    include_private: bool = False
    chat_name_filters: List[str] = []
    after: Optional[str] = None
    before: Optional[str] = None
    limit_per_chat: Optional[int] = None
    revoke: bool = True
    dry_run: bool = True
    test_mode: bool = False
    full_scan: bool = False
    batch_size: Optional[int] = None

class BatchMessageRequest(BaseModel):
    message: str
    chat_ids: List[int]
    delay_seconds: int = 1
    dry_run: bool = True
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.options("/{path:path}")
async def options_handler(path: str):
    """Handle CORS preflight requests"""
    return {"message": "OK"}

@app.post("/accounts")
async def create_account(data: CreateAccountRequest):
    try:
        logger.info(f"Creating account: {data.label}")
        account = account_store.create_account(
            label=data.label,
            api_id=data.api_id,
            api_hash=data.api_hash,
            phone=data.phone
        )
        logger.info(f"Account created successfully: {account.id}")
        return {
            "success": True,
            "account": {
                "id": account.id,
                "label": account.label,
                "phone": account.phone,
                "is_authenticated": False
            }
        }
    except Exception as e:
        logger.error(f"Error creating account: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/accounts")
async def get_accounts():
    try:
        logger.info("GET /accounts endpoint called")
        accounts = account_store.get_all_accounts()
        logger.info(f"Found {len(accounts)} accounts in store")
        
        # Return accounts without auth check to avoid server crashes
        account_list = []
        for acc in accounts:
            logger.info(f"Processing account: {acc.id} - {acc.label}")
            is_authenticated = False
            username = None
            
            account_data = {
                "id": acc.id,
                "label": acc.label,
                "phone": acc.phone,
                "api_id": acc.api_id,
                "api_hash": acc.api_hash,
                "is_authenticated": is_authenticated,
                "username": username
            }
            account_list.append(account_data)
            logger.info(f"Account data: {account_data}")
        
        logger.info(f"Returning {len(account_list)} accounts")
        return account_list
    except Exception as e:
        logger.error(f"Error getting accounts: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/accounts/{account_id}/connect")
async def connect_account(account_id: str, data: ConnectAccountRequest):
    try:
        logger.info(f"Connecting account {account_id} with data: {data}")
        
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Get account info
        account = account_store.get_account(account_id)
        if not account:
            return {"success": False, "error": "Account not found"}
        
        # If code provided, try to sign in with code
        if data.code and data.phone_code_hash:
            logger.info(f"Attempting sign in with code for account {account_id}")
            result = await deleter.sign_in_with_code(
                phone=account.phone,
                code=data.code,
                phone_code_hash=data.phone_code_hash,
                password=data.password
            )
            logger.info(f"Sign in result: {result}")
            return result
        else:
            # No code provided, send verification code and return phone_code_hash
            logger.info(f"Sending verification code for account {account_id}")
            result = await deleter.connect(phone=account.phone)
            logger.info(f"Connect result: {result}")
            return result
            
    except Exception as e:
        logger.error(f"Error connecting account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.delete("/accounts/{account_id}")
async def delete_account(account_id: str):
    try:
        logger.info(f"Deleting account {account_id}")
        # Clear all cached instances before deleting account
        clear_deleter_cache(account_id)
        if account_id in checkpoint_managers:
            del checkpoint_managers[account_id]
        success = account_store.delete_account(account_id)
        if success:
            return {"success": True, "message": "Account deleted successfully"}
        else:
            return {"success": False, "error": "Account not found"}
    except Exception as e:
        logger.error(f"Error deleting account {account_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/accounts/{account_id}/scan-status")
async def get_scan_status(account_id: str):
    try:
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Get current scan progress
        progress = deleter.checkpoint_manager.get_progress()
        
        # Get all checkpoints (previous scan results)
        checkpoints = deleter.checkpoint_manager.get_all_checkpoints()
        
        # Convert checkpoints to scanned_chats format
        scanned_chats = []
        for chat_id, checkpoint in checkpoints.items():
            if checkpoint.total_messages_found > 0:
                scanned_chats.append({
                    'id': chat_id,
                    'title': checkpoint.chat_title,
                    'status': 'completed',
                    'messages_found': checkpoint.total_messages_found,
                    'messages_deleted': checkpoint.messages_deleted,
                    'last_scan_date': checkpoint.last_scan_date,
                    'member_count': checkpoint.member_count,
                    'messages': []  # Messages not stored in checkpoint
                })
        
        return {
            "success": True,
            "result": {
                "scan_progress": progress,
                "scanned_chats": scanned_chats,
                "has_previous_scan": len(scanned_chats) > 0
            }
        }
    except Exception as e:
        logger.error(f"Error getting scan status for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/reset")
async def reset_account_data(account_id: str):
    """Reset all scan data and checkpoints for an account"""
    try:
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Reset checkpoint data
        deleter.checkpoint_manager.reset_all_data()
        
        return {
            "success": True,
            "message": "All data reset successfully"
        }
    except Exception as e:
        logger.error(f"Error resetting account data for {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/chat-messages/{chat_id}")
async def get_chat_messages(account_id: str, chat_id: int):
    """Get messages for a specific chat"""
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        progress = deleter.checkpoint_manager.get_progress()
        scanned_chats = progress.get('scanned_chats', [])
        
        logger.info(f"Looking for chat {chat_id} (type: {type(chat_id)})")
        logger.info(f"Found {len(scanned_chats)} scanned chats")
        
        # Find the specific chat
        chat = next((c for c in scanned_chats if c.get('id') == chat_id), None)
        if not chat:
            logger.warning(f"Chat {chat_id} not found in scanned chats")
            return {"success": False, "error": "Chat not found"}
        
        messages = chat.get('messages', [])
        
        return {
            "success": True,
            "messages": messages,
            "chat_id": chat_id,
            "total_messages": len(messages)
        }
    except Exception as e:
        logger.error(f"Error getting chat messages for {account_id}/{chat_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/delete-messages")
async def delete_messages_endpoint(account_id: str, request: dict):
    """Delete specific messages from a chat - HIGH PRIORITY"""
    try:
        logger.info(f"DELETE MESSAGES REQUEST: account={account_id}, data={request}")
        
        # Add to priority queue (priority 10 = highest)
        add_operation_with_notification("delete_messages", 10, {
            "account_id": account_id,
            "request": request
        })
        
        # Pause scanning if running and save state
        if is_scanning:
            # Save current scan state before pausing
            deleter = get_deleter_for_account(account_id)
            if deleter and hasattr(deleter, 'get_scan_state'):
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
        pause_scanning()
        
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            logger.error(f"Account not found: {account_id}")
            return {"success": False, "error": "Account not found"}
        
        chat_id = request.get('chat_id')
        message_ids = request.get('message_ids', [])
        revoke = request.get('revoke', True)
        
        if not chat_id or not message_ids:
            logger.error(f"Missing chat_id or message_ids: chat_id={chat_id}, message_ids={message_ids}")
            return {"success": False, "error": "Missing chat_id or message_ids"}
        
        logger.info(f"Deleting {len(message_ids)} messages from chat {chat_id} (revoke={revoke})")
        
        # Delete messages using the deleter (ACTUAL DELETION - NOT DRY RUN)
        result = await deleter.delete_messages(chat_id, message_ids, revoke)
        
        if result.get('success'):
            deleted_count = result.get('deleted_count', 0)
            logger.info(f"Successfully deleted {deleted_count} messages from chat {chat_id}")
            
            # Update checkpoint after successful deletion
            deleter.checkpoint_manager.update_checkpoint(
                chat_id,
                f"Chat_{chat_id}",
                max(message_ids) if message_ids else None,
                deleted_count,
                len(message_ids)
            )
            
            # אחרי השלמת המחיקה, בדוק אם יש סריקות מושהות
            complete_operation()
            
            return {
                "success": True,
                "message": f"Successfully deleted {deleted_count} messages",
                "deleted_count": deleted_count,
                "failed_count": result.get('failed_count', 0)
            }
        else:
            logger.error(f"Failed to delete messages: {result.get('error')}")
            return {"success": False, "error": result.get('error', 'Failed to delete messages')}
            
    except Exception as e:
        logger.error(f"Error deleting messages for {account_id}: {str(e)}", exc_info=True)
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/verify-deletion")
async def verify_deletion(account_id: str, request: dict):
    """Verify that messages were actually deleted by scanning the chat in the time range - HIGH PRIORITY"""
    try:
        logger.info(f"VERIFY DELETION REQUEST: account={account_id}, data={request}")
        
        # Add to priority queue (priority 9 = high)
        add_operation_with_notification("verify_deletion", 9, {
            "account_id": account_id,
            "request": request
        })
        
        # Pause scanning if running and save state
        if is_scanning:
            # Save current scan state before pausing
            deleter = get_deleter_for_account(account_id)
            if deleter and hasattr(deleter, 'get_scan_state'):
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
        pause_scanning()
        
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            logger.error(f"Account not found: {account_id}")
            return {"success": False, "error": "Account not found"}
        
        chat_id = request.get("chat_id")
        deleted_message_ids = request.get("deleted_message_ids", [])
        time_range_minutes = request.get("time_range_minutes", 1)  # Default 1 minute
        
        if not chat_id or not deleted_message_ids:
            return {"success": False, "error": "Missing chat_id or deleted_message_ids"}
        
        # Get the time range for verification
        from datetime import datetime, timedelta
        now = datetime.now()
        start_time = now - timedelta(minutes=time_range_minutes)
        end_time = now + timedelta(minutes=1)
        
        # Scan the chat in the time range
        verification_result = await deleter.verify_messages_deleted(
            chat_id, deleted_message_ids, start_time, end_time
        )
        
        return {
            "success": True,
            "verification_result": verification_result,
            "time_range": {
                "start": start_time.isoformat(),
                "end": end_time.isoformat()
            }
        }
        
    except Exception as e:
        logger.error(f"Error verifying deletion: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/chats")
async def get_all_chats(account_id: str):
    """Get all chats for the account"""
    try:
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Check if client is connected
        if not deleter.client or not deleter.client.is_connected():
            return {"success": False, "error": "Account not connected"}
        
        # Get all dialogs
        all_dialogs = await deleter.client.get_dialogs()
        
        chats = []
        for dialog in all_dialogs:
            # Get dialog ID safely
            dialog_id = getattr(dialog, 'id', None)
            if not dialog_id or not isinstance(dialog_id, (int, str)):
                continue
                
            # Only include groups with more than 10 members
            member_count = 0
            if hasattr(dialog, 'entity') and hasattr(dialog.entity, 'participants_count'):
                member_count = dialog.entity.participants_count or 0
            
            if member_count > 10:
                # Get last message time and content
                last_message_time = None
                last_message_content = None
                try:
                    if hasattr(dialog, 'date') and dialog.date:
                        last_message_time = int(dialog.date.timestamp() * 1000)
                    if hasattr(dialog, 'message') and dialog.message:
                        if hasattr(dialog.message, 'message') and dialog.message.message:
                            last_message_content = dialog.message.message[:100]  # First 100 chars
                except:
                    pass
                
                chats.append({
                    'id': dialog_id,
                    'title': dialog.name or "Unknown",
                    'member_count': member_count,
                    'type': 'group',
                    'lastMessageTime': last_message_time,
                    'lastMessageContent': last_message_content
                })
        
        return {
            "success": True,
            "chats": chats,
            "total": len(chats)
        }
        
    except Exception as e:
        logger.error(f"Error getting chats for {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

# Removed get_chat_members endpoint - not essential for core functionality

@app.post("/accounts/{account_id}/scan")
async def scan_account(account_id: str, data: ScanRequest):
    try:
        logger.info(f"Starting scan for account {account_id}")
        
        # Check if there are higher priority operations
        if operation_queue:
            logger.info(f"Higher priority operations queued, adding scan to queue")
            add_operation_with_notification("scan", 5, {
                "account_id": account_id,
                "data": data.dict()
            })
            return {"success": True, "message": "Scan queued, will start when higher priority operations complete"}
        
        # Check if there's a saved scan state to resume
        scan_state = get_scan_state(account_id)
        if scan_state:
            logger.info(f"📂 ממשיך סריקה מהמקום שעצרנו עבור {account_id}")
            # Clear the saved state as we're resuming
            clear_scan_state(account_id)
        
        # Set scanning flag
        resume_scanning()
        
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Create filters
        filters = Filters(
            include_private=data.include_private,
            chat_name_filters=data.chat_name_filters,
            after=date.fromisoformat(data.after) if data.after else (
                date.today().replace(year=date.today().year - 5) if not data.test_mode else None
            ),
            before=date.fromisoformat(data.before) if data.before else None,
            limit_per_chat=data.limit_per_chat,
            revoke=data.revoke,
            dry_run=data.dry_run,
            test_mode=data.test_mode,
            full_scan=data.full_scan,
            batch_size=data.batch_size
        )
        
        # Start scan
        result = await deleter.scan(filters)
        
        return {
            "success": True,
            "result": {
                "total_chats_processed": result.total_chats_processed,
                "total_chats_skipped": result.total_chats_skipped,
                "total_candidates": result.total_candidates,
                "total_deleted": result.total_deleted,
                "chats": [
                    {
                        "id": chat.id,
                        "title": chat.title,
                        "type": chat.type,
                        "participants_count": chat.participants_count,
                        "candidates_found": chat.candidates_found,
                        "deleted": chat.deleted,
                        "error": chat.error,
                        "skipped_reason": chat.skipped_reason,
                        "messages": chat.messages or [],
                        "is_user_created": getattr(chat, 'is_user_created', False)
                    }
                    for chat in result.chats
                ],
                "user_created_groups": getattr(result, 'user_created_groups', [])
            }
        }
        
    except Exception as e:
        logger.error(f"Error scanning account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/scan-progress")
async def get_scan_progress(account_id: str):
    try:
        logger.info(f"Getting scan progress for account {account_id}")

        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        # Get current scan progress from deleter
        progress = deleter.get_scan_progress()

        return {
            "success": True,
            "progress": progress
        }

    except Exception as e:
        logger.error(f"Error getting scan progress for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

# Removed get_rate_limit_status endpoint - not essential for core functionality

@app.post("/connect")
async def connect(data: ConnectRequest):
    try:
        logger.info(f"Connecting to phone: {data.phone}")
        # This is a legacy endpoint - you might want to remove it
        # or redirect to the account-specific endpoint
        return {"success": False, "error": "Use account-specific connect endpoint"}
    except Exception as e:
        logger.error(f"Error connecting to phone {data.phone}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Duplicate endpoint removed - using the one defined earlier with proper checkpoint management

@app.post("/accounts/{account_id}/pause-scan")
async def pause_scan(account_id: str):
    try:
        logger.info(f"Pausing scan for account {account_id}")
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Pause the scan
        deleter.pause_scan()
        
        return {"success": True, "message": "Scan paused successfully"}
    except Exception as e:
        logger.error(f"Error pausing scan for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/resume-scan")
async def resume_scan(account_id: str):
    try:
        logger.info(f"Resuming scan for account {account_id}")
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Resume the scan
        deleter.resume_scan()
        
        return {"success": True, "message": "Scan resumed successfully"}
    except Exception as e:
        logger.error(f"Error resuming scan for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/delete-all-found-messages")
async def delete_all_found_messages(account_id: str):
    """מחיקת כל ההודעות שנמצאו בכל הקבוצות"""
    try:
        logger.info(f"Deleting all found messages for account {account_id}")
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # קבלת כל ההודעות שנמצאו
        progress = deleter.checkpoint_manager.get_progress()
        scanned_chats = progress.get('scanned_chats', [])
        
        total_deleted = 0
        deleted_chats = []
        errors = []
        
        for chat in scanned_chats:
            if chat.get('messages_found', 0) > 0:
                try:
                    # מחיקת ההודעות בקבוצה הזו
                    messages = chat.get('messages', [])
                    if messages:
                        message_ids = [msg['id'] for msg in messages]
                        result = await deleter.delete_messages(chat['id'], message_ids, True)
                        
                        if result.get('success'):
                            deleted_count = result.get('deleted_count', 0)
                            total_deleted += deleted_count
                            deleted_chats.append({
                                'chat_name': chat['name'],
                                'deleted_count': deleted_count
                            })
                        else:
                            errors.append(f"Failed to delete messages in {chat['name']}: {result.get('error', 'Unknown error')}")
                    
                except Exception as e:
                    errors.append(f"Error deleting messages in {chat['name']}: {str(e)}")
        
        return {
            "success": True,
            "total_deleted": total_deleted,
            "deleted_chats": deleted_chats,
            "errors": errors,
            "message": f"Deleted {total_deleted} messages from {len(deleted_chats)} chats"
        }
        
    except Exception as e:
        logger.error(f"Error deleting all found messages for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/keep-message")
async def keep_message(account_id: str, data: dict):
    """סימון הודעה כ'השאר' - הסרת ההודעה מרשימת המחיקה"""
    try:
        chat_id = data.get('chat_id')
        message_id = data.get('message_id')
        
        if not chat_id or not message_id:
            return {"success": False, "error": "Missing chat_id or message_id"}
        
        logger.info(f"Keeping message {message_id} in chat {chat_id} for account {account_id}")
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # קבלת התוצאות הנוכחיות
        progress = deleter.checkpoint_manager.get_progress()
        scanned_chats = progress.get('scanned_chats', [])
        
        # חיפוש הקבוצה והודעה
        updated = False
        for chat in scanned_chats:
            if chat['id'] == chat_id:
                messages = chat.get('messages', [])
                # הסרת ההודעה מרשימת המחיקה
                chat['messages'] = [msg for msg in messages if msg['id'] != message_id]
                chat['messages_found'] = len(chat['messages'])
                updated = True
                break
        
        if updated:
            # שמירת השינויים
            deleter.checkpoint_manager.current_progress['scanned_chats'] = scanned_chats
            deleter.checkpoint_manager.save_checkpoints()
            
            return {"success": True, "message": "Message marked as keep"}
        else:
            return {"success": False, "error": "Message not found"}
            
    except Exception as e:
        logger.error(f"Error keeping message for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/send-batch-message")
async def send_batch_message(account_id: str, data: BatchMessageRequest):
    """Send a message to multiple chats"""
    try:
        logger.info(f"Sending batch message to {len(data.chat_ids)} chats for account {account_id}")
        
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Send batch message
        result = await deleter.send_batch_message(
            message=data.message,
            chat_ids=data.chat_ids,
            delay_seconds=data.delay_seconds,
            dry_run=data.dry_run
        )
        
        return {
            "success": True,
            "message": f"Successfully sent message to {result['sent_count']} chats",
            "sent_count": result['sent_count'],
            "failed_count": result['failed_count'],
            "results": result['results']
        }
            
    except Exception as e:
        logger.error(f"Error sending batch message for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/scan-events")
async def scan_events(account_id: str):
    """Server-Sent Events endpoint for real-time scan updates"""
    async def event_generator():
        try:
            deleter = get_deleter_for_account(account_id)
            if not deleter:
                yield f"data: {json.dumps({'error': 'Account not found'})}\n\n"
                return
            
            # Send initial status
            yield f"data: {json.dumps({'type': 'connected', 'message': 'Connected to scan events'})}\n\n"
            
            # Create a callback to capture real-time updates from the deleter
            update_queue = asyncio.Queue()
            
            def status_callback(message: str, data: dict = None):
                """Callback to capture status updates from deleter"""
                try:
                    update_queue.put_nowait({'message': message, 'data': data or {}})
                except:
                    pass
            
            # Set the callback
            deleter.set_status_callback(status_callback)
            
            # Keep connection alive and send updates
            last_status = None
            while True:
                try:
                    # Try to get update from queue (non-blocking)
                    try:
                        update = await asyncio.wait_for(update_queue.get(), timeout=0.5)
                        
                        # Send the update
                        event_data = {
                            'type': update['data'].get('type', 'status_update'),
                            'message': update['message'],
                            **update['data']
                        }
                        
                        # Send different event types based on update type
                        if update['data'].get('type') == 'group_discovered':
                            # Phase 1 - group discovered
                            yield f"data: {json.dumps(event_data)}\n\n"
                        elif update['data'].get('type') == 'phase1_complete':
                            # Phase 1 complete
                            yield f"data: {json.dumps(event_data)}\n\n"
                        elif update['data'].get('type') == 'phase2_start':
                            # Phase 2 starting
                            yield f"data: {json.dumps(event_data)}\n\n"
                        elif update['data'].get('type') == 'chat_scanning':
                            # Phase 2 - scanning chat
                            yield f"data: {json.dumps(event_data)}\n\n"
                        elif update['data'].get('type') == 'message_found':
                            # Phase 2 - message found
                            yield f"data: {json.dumps(event_data)}\n\n"
                        elif update['data'].get('type') == 'chat_completed':
                            # Phase 2 - chat completed
                            yield f"data: {json.dumps(event_data)}\n\n"
                        else:
                            # Generic status update
                            yield f"data: {json.dumps(event_data)}\n\n"
                        
                        last_status = update['data'].get('type')
                        
                    except asyncio.TimeoutError:
                        # No update available, check progress state
                        progress = deleter.checkpoint_manager.get_progress()
                        status = progress.get('status', 'idle')
                        
                        if status == 'completed' and last_status != 'scan_complete':
                            yield f"data: {json.dumps({'type': 'scan_complete', 'message': 'Scan completed', 'scanned_chats': progress.get('scanned_chats', [])})}\n\n"
                            last_status = 'scan_complete'
                            break
                        elif status == 'idle' and last_status != 'scan_idle':
                            yield f"data: {json.dumps({'type': 'scan_idle', 'message': 'Scan is idle'})}\n\n"
                            last_status = 'scan_idle'
                    
                    await asyncio.sleep(0.1)  # Small delay
                    
                except Exception as e:
                    logger.error(f"Error in event loop: {str(e)}")
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                    break
                    
        except Exception as e:
            logger.error(f"Error in event generator: {str(e)}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Clear the callback
            if deleter:
                deleter.set_status_callback(None)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Cache-Control"
        }
    )

@app.post("/accounts/{account_id}/semantic-scan")
async def semantic_scan(account_id: str, query: dict):
    """Perform semantic search on Telegram messages - HIGH PRIORITY"""
    try:
        # Add to priority queue (priority 8 = high)
        add_operation_with_notification("semantic_scan", 8, {
            "account_id": account_id,
            "query": query
        })
        
        # Pause scanning if running and save state
        if is_scanning:
            # Save current scan state before pausing
            deleter = get_deleter_for_account(account_id)
            if deleter and hasattr(deleter, 'get_scan_state'):
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
        pause_scanning()
        
        # Lazy import to avoid loading heavy modules on startup
        from app.semantic_search_models import SemanticSearchQuery, SemanticSearchResponse
        from app.semantic_search_engine import semantic_engine
        
        # Convert dict to SemanticSearchQuery
        search_query = SemanticSearchQuery(**query)
        
        logger.info(f"Starting semantic search for account {account_id}: {search_query.query_text}")
        
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Validate query
        if not search_query.query_text.strip():
            return {"success": False, "error": "Query text cannot be empty"}
        
        # Start time tracking
        import time
        start_time = time.time()
        
        # Get messages from specified groups or all groups
        messages = []
        if search_query.groups_to_scan:
            # Search specific groups
            for group_id in search_query.groups_to_scan:
                group_messages = await deleter.get_messages_from_group(group_id, search_query.time_frame_hours)
                messages.extend(group_messages)
        else:
            # Search all groups
            all_messages = await deleter.get_all_messages(search_query.time_frame_hours)
            messages.extend(all_messages)
        
        logger.info(f"Retrieved {len(messages)} messages for semantic search")
        
        # Perform semantic search
        results = await semantic_engine.search_messages(search_query, messages)
        
        # Calculate duration
        duration = time.time() - start_time
        
        response = SemanticSearchResponse(
            success=True,
            total_messages_scanned=len(messages),
            total_matches_found=len(results),
            search_duration_seconds=duration,
            results=results
        )
        
        logger.info(f"Semantic search completed: {len(results)} matches in {duration:.2f}s")
        return response
        
    except Exception as e:
        logger.error(f"Error in semantic search: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/semantic-scan-events")
async def semantic_scan_events(account_id: str, query_text: str, fidelity: str = "semantic", time_frame_hours: int = 24):
    """Server-Sent Events endpoint for real-time semantic search updates"""
    async def event_generator():
        try:
            # Lazy import to avoid loading heavy modules on startup
            from app.semantic_search_models import SemanticSearchQuery
            from app.semantic_search_engine import semantic_engine
            
            # Send initial status
            yield f"data: {json.dumps({'type': 'connected', 'message': 'Connected to semantic search events'})}\n\n"
            
            # Get deleter instance
            deleter = get_deleter_for_account(account_id)
            if not deleter:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Account not found'})}\n\n"
                return
            
            # Create query object
            query = SemanticSearchQuery(
                query_text=query_text,
                fidelity=fidelity,
                time_frame_hours=time_frame_hours,
                account_id=account_id
            )
            
            # Send search started
            yield f"data: {json.dumps({'type': 'search_started', 'message': f'Starting semantic search: {query_text}'})}\n\n"
            
            # Get messages from already scanned data
            yield f"data: {json.dumps({'type': 'retrieving_messages', 'message': 'Retrieving messages from scanned data...'})}\n\n"
            
            # Get messages from checkpoint manager (already scanned data)
            progress = deleter.checkpoint_manager.get_progress()
            scanned_chats = progress.get('scanned_chats', [])
            
            messages = []
            for chat in scanned_chats:
                if chat.get('messages') and len(chat['messages']) > 0:
                    # Filter messages by time frame
                    cutoff_time = datetime.now() - timedelta(hours=query.time_frame_hours)
                    for message in chat['messages']:
                        message_date = datetime.fromisoformat(message.get('date', '').replace('Z', '+00:00'))
                        if message_date >= cutoff_time:
                            messages.append({
                                'id': message.get('id'),
                                'text': message.get('content', ''),
                                'chat_id': chat.get('id'),
                                'chat_name': chat.get('title', 'Unknown'),
                                'date': message.get('date', '')
                            })
            
            yield f"data: {json.dumps({'type': 'messages_retrieved', 'count': len(messages), 'message': f'Retrieved {len(messages)} messages from scanned data'})}\n\n"
            
            # Perform semantic search with progress updates
            results = []
            total_messages = len(messages)
            
            for i, message in enumerate(messages):
                if i % 100 == 0:  # Update every 100 messages
                    progress = (i / total_messages) * 100
                    yield f"data: {json.dumps({'type': 'search_progress', 'progress': progress, 'processed': i, 'total': total_messages, 'matches': len(results)})}\n\n"
                
                # Calculate similarity
                similarity, keywords = semantic_engine.calculate_similarity(
                    query.query_text, 
                    message.get('text', '')
                )
                
                threshold = semantic_engine.get_fidelity_threshold(query.fidelity)
                if similarity >= threshold:
                    # Send message content preview immediately
                    message_preview = {
                        'type': 'message_preview',
                        'content': message.get('text', '')[:100] + ('...' if len(message.get('text', '')) > 100 else ''),
                        'chat_name': message.get('chat_name', 'Unknown'),
                        'similarity': f"{similarity:.2f}",
                        'keywords': ', '.join(keywords[:3]) if keywords else ''
                    }
                    yield f"data: {json.dumps(message_preview)}\n\n"
                    result = {
                        'message_id': message.get('id', 0),
                        'chat_id': message.get('chat_id', 0),
                        'chat_name': message.get('chat_name', 'Unknown'),
                        'message_text': message.get('text', ''),
                        'similarity_score': similarity,
                        'matched_keywords': keywords
                    }
                    results.append(result)
                    
                    # Send individual match with message content preview
                    message_preview = {
                        'type': 'match_found',
                        'result': result,
                        'message_preview': {
                            'content': message.get('text', '')[:100] + ('...' if len(message.get('text', '')) > 100 else ''),
                            'chat_name': message.get('chat_name', 'Unknown'),
                            'similarity': f"{similarity:.2f}",
                            'keywords': ', '.join(keywords[:3]) if keywords else ''
                        }
                    }
                    yield f"data: {json.dumps(message_preview)}\n\n"
            
            # Send completion
            yield f"data: {json.dumps({'type': 'search_complete', 'total_matches': len(results), 'total_processed': total_messages})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Cache-Control"
        }
    )

# Cloud backup endpoints
@app.post("/accounts/{account_id}/backup")
async def backup_account_data(account_id: str):
    """Backup account data to cloud storage"""
    try:
        if account_id not in account_store.accounts:
            raise HTTPException(status_code=404, detail="Account not found")
        
        checkpoint_manager = get_checkpoint_manager(account_id)
        checkpoint_manager.force_sync_to_cloud()
        
        backup_info = checkpoint_manager.get_cloud_backup_info()
        
        return {
            "success": True,
            "message": "Data backed up successfully",
            "backup_info": backup_info
        }
        
    except Exception as e:
        logger.error(f"Error backing up account data: {e}")
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/restore")
async def restore_account_data(account_id: str):
    """Restore account data from cloud storage"""
    try:
        if account_id not in account_store.accounts:
            raise HTTPException(status_code=404, detail="Account not found")
        
        checkpoint_manager = get_checkpoint_manager(account_id)
        checkpoint_manager.restore_from_cloud()
        
        return {
            "success": True,
            "message": "Data restored successfully",
            "checkpoints_count": len(checkpoint_manager.checkpoints),
            "scanned_chats_count": len(checkpoint_manager.current_progress.get('scanned_chats', []))
        }
        
    except Exception as e:
        logger.error(f"Error restoring account data: {e}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/backup-info")
async def get_backup_info(account_id: str):
    """Get information about cloud backups for an account"""
    try:
        if account_id not in account_store.accounts:
            raise HTTPException(status_code=404, detail="Account not found")
        
        checkpoint_manager = get_checkpoint_manager(account_id)
        backup_info = checkpoint_manager.get_cloud_backup_info()
        
        return {
            "success": True,
            "backup_info": backup_info
        }
        
    except Exception as e:
        logger.error(f"Error getting backup info: {e}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/data-status")
async def get_data_status(account_id: str):
    """Get current data status for an account"""
    try:
        if account_id not in account_store.accounts:
            raise HTTPException(status_code=404, detail="Account not found")
        
        checkpoint_manager = get_checkpoint_manager(account_id)
        
        return {
            "success": True,
            "data_status": {
                "checkpoints_count": len(checkpoint_manager.checkpoints),
                "scanned_chats_count": len(checkpoint_manager.current_progress.get('scanned_chats', [])),
                "total_messages_found": checkpoint_manager.current_progress.get('total_messages', 0),
                "completed_scans": checkpoint_manager.current_progress.get('completed', 0),
                "last_scan_date": max([
                    checkpoint.last_scan_date 
                    for checkpoint in checkpoint_manager.checkpoints.values() 
                    if checkpoint.last_scan_date
                ], default=None)
            }
        }
        
    except Exception as e:
        logger.error(f"Error getting data status: {e}")
        return {"success": False, "error": str(e)}

@app.post("/system/clear-cache")
async def clear_system_cache():
    """Clear all system caches to free memory"""
    try:
        clear_all_caches()
        return {
            "success": True,
            "message": "All caches cleared successfully"
        }
    except Exception as e:
        logger.error(f"Error clearing caches: {e}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/status")
async def get_account_status(account_id: str):
    """Get account status and check for paused scans"""
    try:
        # בדוק אם יש סריקה מושהית עבור החשבון הזה
        scan_state = get_scan_state(account_id)
        if scan_state and not is_scanning:
            logger.info(f"🔄 נמצאה סריקה מושהית עבור {account_id} - ממשיך אוטומטית")
            check_and_resume_paused_scans()
        
        return {"success": True, "status": "active"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/system/operation-status")
async def get_operation_status():
    """Get current operation status and queue"""
    global operation_queue, current_operation, is_scanning, paused_scan_state
    return {
        "success": True,
        "current_operation": current_operation,
        "queue_length": len(operation_queue),
        "is_scanning": is_scanning,
        "paused_scans": list(paused_scan_state.keys()),
        "queue": operation_queue[:5]  # Show first 5 operations
    }

@app.post("/system/process-next-operation")
async def process_next_operation_endpoint():
    """Process next operation in queue"""
    try:
        next_op = process_next_operation()
        if next_op:
            return {
                "success": True,
                "operation": next_op,
                "message": f"Processing {next_op['type']} operation"
            }
        else:
            return {
                "success": True,
                "message": "No operations in queue"
            }
    except Exception as e:
        logger.error(f"Error processing next operation: {e}")
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)