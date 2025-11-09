from fastapi import FastAPI, HTTPException, Request, UploadFile, File, BackgroundTasks
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal, Tuple
import logging
import asyncio
import os
import uuid
import random
from pathlib import Path
from app.accounts import account_store
from app.telegram_client_factory import get_deleter_for_account, clear_deleter_cache
from app.telegram_delete import Filters
from telethon.tl.functions.messages import GetDialogFiltersRequest, ImportChatInviteRequest, CheckChatInviteRequest
from telethon.tl.functions.channels import JoinChannelRequest, LeaveChannelRequest
from telethon.errors import FloodWaitError, InviteHashInvalidError, InviteHashExpiredError, UserAlreadyParticipantError, ChannelPrivateError, ChatAdminRequiredError
from telethon.tl.functions.contacts import ImportContactsRequest
from telethon.tl.types import Dialog as TLDialog, User as TLUser, InputPhoneContact
# Lazy imports for heavy modules
# from app.semantic_search_models import SemanticSearchQuery, SemanticSearchResponse, SemanticSearchProgress
# from app.semantic_search_engine import semantic_engine
from app.checkpoint_manager import CheckpointManager
import json
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse
import re

# Paths for backlog storage
BACKLOG_FILE = Path("cloud_backups/backlog_tasks.json")
BACKLOG_ATTACHMENTS_DIR = Path("cloud_backups/backlog_attachments")
BACKLOG_ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)

# Create FastAPI app instance
app = FastAPI()
app.mount("/backlog/attachments", StaticFiles(directory=str(BACKLOG_ATTACHMENTS_DIR)), name="backlog_attachments")

# Cache for checkpoint managers to avoid recreating them
checkpoint_managers = {}
deleter_cache = {}  # Cache for deleter instances

# Priority system for operations
operation_queue = []
current_operation = None
is_scanning = False
paused_scan_state = {}  # Store paused scan state


class UserLookupRequest(BaseModel):
    """Payload for cross-account user lookup."""
    username: Optional[str] = Field(default=None, description="Target Telegram username (with or without @)")
    user_ids: Optional[List[str]] = Field(default=None, description="List of user ID strings or numbers")
    account_ids: Optional[List[str]] = Field(default=None, description="Subset of account IDs to inspect")
    max_messages: int = Field(default=5, ge=1, le=20, description="How many recent messages to include per account")


backlog_lock = asyncio.Lock()


class ExpertReview(BaseModel):
    design_lead: str
    dev_lead: str
    product_lead: str
    microcopy: str


class BacklogTask(BaseModel):
    id: str
    subject: str
    subtasks: List[str]
    expert_review: ExpertReview
    attachments: List[str] = Field(default_factory=list)
    priority: Literal['נמוך', 'רגיל', 'דחוף'] = 'רגיל'
    complexity: Literal['קל מאוד', 'קל', 'בינוני', 'מורכב', 'מורכב מאוד'] = 'בינוני'
    effort_minutes: int = 90
    status: Literal['pending', 'in_progress', 'completed'] = 'pending'
    created_at: datetime
    updated_at: datetime
    last_executed_at: Optional[datetime] = None
    execution_log: List[Dict[str, str]] = Field(default_factory=list)


class BacklogCreateRequest(BaseModel):
    subject: str
    priority: Optional[Literal['נמוך', 'רגיל', 'דחוף']] = 'רגיל'
    attachments: List[str] = Field(default_factory=list)
    attachments: List[str] = Field(default_factory=list)


class BacklogUpdateRequest(BaseModel):
    subject: Optional[str] = None
    priority: Optional[Literal['נמוך', 'רגיל', 'דחוף']] = None
    status: Optional[Literal['pending', 'in_progress', 'completed']] = None
    effort_minutes: Optional[int] = Field(default=None, ge=15, le=600)
    complexity: Optional[Literal['קל מאוד', 'קל', 'בינוני', 'מורכב', 'מורכב מאוד']] = None
    attachments: Optional[List[str]] = None
    attachments: Optional[List[str]] = None


class BacklogQuestionRequest(BaseModel):
    content: str


class BacklogExecuteRequest(BaseModel):
    note: Optional[str] = None


def _generate_subtasks(subject: str) -> List[str]:
    base = subject.strip()
    return [
        f"איסוף דרישות והגדרת מדדי הצלחה ל-{base}",
        f"פיתוח והטמעה של {base}",
        f"בדיקות, fine tuning והשקה מבוקרת עבור {base}"
    ]


def _generate_expert_review(subject: str) -> ExpertReview:
    focus = subject.strip()
    return ExpertReview(
        design_lead=f"לבנות חוויה שמציגה את {focus} בצורה אינטואיטיבית עם היררכיה ברורה.",
        dev_lead=f"לפרק את {focus} למודול עצמאי עם בדיקות יחידה ואינטגרציה לפני עלייה לסביבה חיה.",
        product_lead=f"להגדיר KPI מדיד ל-{focus} ולוודא התאמה ליעדים הרבעוניים.",
        microcopy=f"שם התכונה והכפתורים סביב {focus} צריכים להיות בהירים, מזמינים ונטולי ז'רגון."
    )


def _estimate_complexity(subject: str) -> Literal['קל מאוד', 'קל', 'בינוני', 'מורכב', 'מורכב מאוד']:
    length = len(subject.strip())
    if length <= 12:
        return 'קל'
    if length <= 24:
        return 'בינוני'
    if length <= 40:
        return 'מורכב'
    return 'מורכב מאוד'


def _estimate_effort(subject: str) -> int:
    length = len(subject.strip()) or 10
    estimate = min(360, max(60, length * 6))
    return int(round(estimate / 15) * 15)


def _default_backlog_tasks() -> List[BacklogTask]:
    seed_subjects = [
        "איחוד לוגיקת סריקות לסריקה מתקדמת",
        "מעקב חיים אחר סריקה בצד השרת",
        "ספריית טקסטים אחידה לחוויית המשתמש"
    ]
    tasks: List[BacklogTask] = []
    for subject in seed_subjects:
        now = datetime.utcnow()
        tasks.append(BacklogTask(
            id=str(uuid.uuid4()),
            subject=subject,
            subtasks=_generate_subtasks(subject),
            expert_review=_generate_expert_review(subject),
            attachments=[],
            priority='רגיל',
            complexity=_estimate_complexity(subject),
            effort_minutes=_estimate_effort(subject),
            status='pending',
            created_at=now,
            updated_at=now,
            last_executed_at=None,
            execution_log=[]
        ))
    specific_subject = "לכל מסך הוסף את הבקלוג ענן"
    specific_timestamp = datetime(2025, 10, 21, 5, 5, 27)
    tasks.append(BacklogTask(
        id="45030741-9f75-4766-9a1f-89ee7e9be151",
        subject=specific_subject,
        subtasks=_generate_subtasks(specific_subject),
        expert_review=_generate_expert_review(specific_subject),
        attachments=[],
        priority='רגיל',
        complexity='מורכב',
        effort_minutes=150,
        status='pending',
        created_at=specific_timestamp,
        updated_at=specific_timestamp,
        last_executed_at=None,
        execution_log=[]
    ))
    return tasks


def _sanitize_attachment_name(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return Path(str(value)).name


def _sanitize_attachments(values: Optional[List[str]]) -> List[str]:
    sanitized: List[str] = []
    if not values:
        return sanitized
    for value in values:
        filename = _sanitize_attachment_name(value)
        if filename:
            sanitized.append(filename)
    return sanitized


def _attachment_url(filename: str) -> str:
    return f"/backlog/attachments/{filename}"


def _serialize_attachment(filename: str) -> Dict[str, str]:
    return {
        'filename': filename,
        'url': _attachment_url(filename)
    }


def _ensure_backlog_file():
    if not BACKLOG_FILE.exists():
        BACKLOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        seed_data = {
            'tasks': [task.model_dump() for task in _default_backlog_tasks()],
            'questions': []
        }
        with BACKLOG_FILE.open('w', encoding='utf-8') as f:
            json.dump(seed_data, f, ensure_ascii=False, indent=2, default=str)


def _load_backlog_data() -> Dict[str, Any]:
    _ensure_backlog_file()
    with BACKLOG_FILE.open('r', encoding='utf-8') as f:
        data = json.load(f)
    data.setdefault('tasks', [])
    data.setdefault('questions', [])
    return data


def _save_backlog_data(data: Dict[str, Any]):
    BACKLOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with BACKLOG_FILE.open('w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


async def _add_backlog_task(subject: str, priority: Literal['נמוך', 'רגיל', 'דחוף'], attachments: Optional[List[str]] = None) -> BacklogTask:
    async with backlog_lock:
        data = _load_backlog_data()
        now = datetime.utcnow()
        task = BacklogTask(
            id=str(uuid.uuid4()),
            subject=subject,
            subtasks=_generate_subtasks(subject),
            expert_review=_generate_expert_review(subject),
            attachments=_sanitize_attachments(attachments),
            priority=priority,
            complexity=_estimate_complexity(subject),
            effort_minutes=_estimate_effort(subject),
            status='pending',
            created_at=now,
            updated_at=now
        )
        data['tasks'].append(task.model_dump())
        _save_backlog_data(data)
        return task


async def _update_backlog_task(task_id: str, payload: BacklogUpdateRequest) -> Optional[BacklogTask]:
    async with backlog_lock:
        data = _load_backlog_data()
        tasks = data.get('tasks', [])
        for index, raw in enumerate(tasks):
            if raw.get('id') == task_id:
                existing = _task_from_raw(raw)
                update_data = existing.model_dump()
                if payload.subject is not None:
                    update_data['subject'] = payload.subject.strip()
                    update_data['subtasks'] = _generate_subtasks(update_data['subject'])
                    update_data['expert_review'] = _generate_expert_review(update_data['subject']).model_dump()
                    update_data['complexity'] = _estimate_complexity(update_data['subject'])
                    update_data['effort_minutes'] = _estimate_effort(update_data['subject']) if payload.effort_minutes is None else payload.effort_minutes
                if payload.priority is not None:
                    update_data['priority'] = payload.priority
                if payload.status is not None:
                    update_data['status'] = payload.status
                if payload.effort_minutes is not None:
                    update_data['effort_minutes'] = payload.effort_minutes
                if payload.complexity is not None:
                    update_data['complexity'] = payload.complexity
                if payload.attachments is not None:
                    update_data['attachments'] = _sanitize_attachments(payload.attachments)
                update_data['updated_at'] = datetime.utcnow().isoformat()
                tasks[index] = update_data
                data['tasks'] = tasks
                _save_backlog_data(data)
                return _task_from_raw(update_data)
        return None


async def _delete_backlog_task(task_id: str) -> bool:
    async with backlog_lock:
        data = _load_backlog_data()
        tasks = data.get('tasks', [])
        filtered = [task for task in tasks if task.get('id') != task_id]
        if len(filtered) == len(tasks):
            return False
        data['tasks'] = filtered
        _save_backlog_data(data)
        return True


async def _add_backlog_question(content: str) -> Dict[str, Any]:
    async with backlog_lock:
        data = _load_backlog_data()
        entry = {
            'id': str(uuid.uuid4()),
            'content': content.strip(),
            'created_at': datetime.utcnow().isoformat()
        }
        data.setdefault('questions', []).append(entry)
        _save_backlog_data(data)
        return entry


_ensure_backlog_file()

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
    return operation

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
    operation = add_operation(operation_type, priority, operation_data)
    
    # Send notification about operation priority
    if priority >= 8:
        logger.info(f"⚡ פעולה מיידית נוספה לתור: {operation_type} (עדיפות: {priority})")
    else:
        logger.info(f"📋 פעולה נוספה לתור: {operation_type} (עדיפות: {priority})")
    return operation

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
    force_chat_ids: List[int] = Field(default_factory=list)


class DirectMessageRequest(BaseModel):
    message: str
    targets: List[str]
    delay_seconds: int = 1
    dry_run: bool = True


class JoinGroupsRequest(BaseModel):
    links: List[str]
    platform: Literal['user', 'bot'] = 'user'


class LeaveGroupRequest(BaseModel):
    chat_ids: List[str]


class DirectTargetRequest(BaseModel):
    target: str

class MentionReplyRequest(BaseModel):
    mention_id: str
    user_id: Optional[int] = None
    username: Optional[str] = None
    reply_text: str
    original_text: Optional[str] = None
    mention_text: Optional[str] = None
    chat_id: Optional[int] = None
    chat_name: Optional[str] = None


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

async def _check_account_auth(acc, timeout_seconds: float = 3.0):
    """Check authentication status for a single account with timeout."""
    is_authenticated = False
    username = None
    last_connected_at = None

    try:
        deleter = get_deleter_for_account(acc.id)
        if deleter:
            try:
                client = await asyncio.wait_for(
                    _ensure_client_ready(deleter),
                    timeout=timeout_seconds
                )
                if client:
                    try:
                        authorized = await asyncio.wait_for(
                            client.is_user_authorized(),
                            timeout=timeout_seconds
                        )
                        if authorized:
                            is_authenticated = True
                            try:
                                me = await asyncio.wait_for(
                                    client.get_me(),
                                    timeout=timeout_seconds
                                )
                                if me:
                                    raw_username = getattr(me, 'username', None)
                                    if raw_username:
                                        username = raw_username
                                    else:
                                        name_candidate = f"{getattr(me, 'first_name', '')} {getattr(me, 'last_name', '')}".strip()
                                        username = name_candidate or None
                            except asyncio.TimeoutError:
                                logger.warning(f"Timeout fetching profile info for {acc.id}")
                            except Exception as info_error:
                                logger.warning(f"Failed to fetch profile info for {acc.id}: {info_error}")
                            
                            session_path = Path(acc.session_path)
                            if session_path.exists():
                                last_connected_at = datetime.fromtimestamp(session_path.stat().st_mtime, tz=timezone.utc).isoformat()
                            else:
                                last_connected_at = datetime.utcnow().replace(tzinfo=timezone.utc).isoformat()
                    except asyncio.TimeoutError:
                        logger.warning(f"Timeout checking auth for {acc.id}")
                    except Exception as auth_check_error:
                        logger.warning(f"Auth check failed for {acc.id}: {auth_check_error}")
            except asyncio.TimeoutError:
                logger.warning(f"Timeout initializing client for {acc.id}")
            except Exception as init_error:
                logger.warning(f"Failed to initialize client for {acc.id}: {init_error}")
    except Exception as auth_error:
        logger.warning(f"Auth status detection failed for {acc.id}: {auth_error}")

    return {
        "id": acc.id,
        "label": acc.label,
        "phone": acc.phone,
        "api_id": acc.api_id,
        "api_hash": acc.api_hash,
        "is_authenticated": is_authenticated,
        "username": username,
        "last_connected_at": last_connected_at
    }

@app.get("/accounts")
async def get_accounts():
    try:
        logger.info("GET /accounts endpoint called")
        accounts = account_store.get_all_accounts()
        logger.info(f"Found {len(accounts)} accounts in store")
        
        # Process all accounts in parallel with timeout to avoid hanging
        account_tasks = [_check_account_auth(acc, timeout_seconds=3.0) for acc in accounts]
        account_list = await asyncio.gather(*account_tasks, return_exceptions=True)
        
        # Convert any exceptions to safe account data
        safe_account_list = []
        for i, result in enumerate(account_list):
            if isinstance(result, Exception):
                logger.warning(f"Error processing account {accounts[i].id}: {result}")
                safe_account_list.append({
                    "id": accounts[i].id,
                    "label": accounts[i].label,
                    "phone": accounts[i].phone,
                    "api_id": accounts[i].api_id,
                    "api_hash": accounts[i].api_hash,
                    "is_authenticated": False,
                    "username": None,
                    "last_connected_at": None
                })
            else:
                safe_account_list.append(result)
        
        logger.info(f"Returning {len(safe_account_list)} accounts")
        return safe_account_list
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
        progress = deleter.checkpoint_manager.get_progress() or {}
        scanned_chats = progress.get('scanned_chats', []) or []
        
        # Get all checkpoints (previous scan results) and merge with progress
        checkpoints = deleter.checkpoint_manager.get_all_checkpoints()
        existing_ids = {chat.get('id') for chat in scanned_chats if isinstance(chat.get('id'), (int, str))}
        for chat_id, checkpoint in checkpoints.items():
            if chat_id in existing_ids:
                continue
            if not checkpoint.last_scan_date:
                last_scan = None
            elif hasattr(checkpoint.last_scan_date, "isoformat"):
                last_scan = checkpoint.last_scan_date.isoformat()
            else:
                # already a string, ensure consistent format
                last_scan = str(checkpoint.last_scan_date)
            scanned_chats.append({
                'id': chat_id,
                'title': checkpoint.chat_title,
                'status': 'completed' if checkpoint.total_messages_found >= 0 else 'pending',
                'messages_found': checkpoint.total_messages_found,
                'messages_deleted': checkpoint.messages_deleted,
                'last_scan_date': last_scan,
                'member_count': checkpoint.member_count,
                'messages': []
            })
        
        # Ensure progress includes latest scanned chats
        progress_with_chats = dict(progress)
        progress_with_chats['scanned_chats'] = scanned_chats
        
        return {
            "success": True,
            "result": {
                "scan_progress": progress_with_chats,
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

@app.get("/accounts/{account_id}/scan-cache-info")
async def get_scan_cache_info(account_id: str):
    """Get information about scan cache before clearing"""
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        checkpoint_manager = deleter.checkpoint_manager
        checkpoints = checkpoint_manager.get_all_checkpoints()
        scanned_chats = checkpoint_manager.current_progress.get('scanned_chats', [])
        
        # Count groups with scan data
        groups_with_data = len([c for c in checkpoints.values() if c.last_scan_date])
        
        # Find latest scan date
        latest_scan_date = None
        if checkpoints:
            dates = [c.last_scan_date for c in checkpoints.values() if c.last_scan_date]
            if dates:
                # Convert to datetime for comparison
                date_objects = []
                for d in dates:
                    try:
                        if isinstance(d, str):
                            date_objects.append(datetime.fromisoformat(d.replace('Z', '+00:00')))
                        elif isinstance(d, datetime):
                            date_objects.append(d)
                        elif isinstance(d, date):
                            date_objects.append(datetime.combine(d, datetime.min.time()))
                    except:
                        pass
                if date_objects:
                    latest_scan_date = max(date_objects).isoformat()
        
        # Count total messages found
        total_messages_found = sum(c.total_messages_found for c in checkpoints.values())
        
        return {
            "success": True,
            "groups_count": groups_with_data,
            "total_groups": len(checkpoints),
            "latest_scan_date": latest_scan_date,
            "total_messages_found": total_messages_found,
            "scanned_chats_count": len(scanned_chats)
        }
    except Exception as e:
        logger.error(f"Error getting scan cache info for {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/clear-scan-cache")
async def clear_scan_cache(account_id: str):
    """Clear scan cache and checkpoints but keep session/auth data"""
    try:
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Clear scan cache (keeps session/auth data)
        deleter.checkpoint_manager.clear_scan_cache()
        
        # Also clear found messages store if exists
        if hasattr(deleter, 'found_messages_store'):
            try:
                deleter.found_messages_store.clear_all()
            except Exception as e:
                logger.warning(f"Could not clear found messages store: {e}")
        
        return {
            "success": True,
            "message": "Scan cache cleared successfully. Session/auth data preserved."
        }
    except Exception as e:
        logger.error(f"Error clearing scan cache for {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/chat-messages/{chat_id}")
async def get_chat_messages(account_id: str, chat_id: int, cursor: Optional[str] = None, limit: int = 50):
    """Get messages for a specific chat"""
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        store = getattr(deleter, "found_messages_store", None)
        if not store:
            return {"success": False, "error": "Found messages store not initialised"}

        try:
            limit_value = max(1, min(int(limit), 200))
        except (TypeError, ValueError):
            limit_value = 50

        messages, next_cursor = store.get_chat_messages(chat_id, cursor=cursor, limit=limit_value)
        summary = store.get_summary_for_chat(chat_id)

        return {
            "success": True,
            "messages": messages,
            "chat_id": chat_id,
            "next_cursor": next_cursor,
            "page_size": limit_value,
            "total_messages": summary.get("total", len(messages))
        }
    except Exception as e:
        logger.error(f"Error getting chat messages for {account_id}/{chat_id}: {str(e)}")
        return {"success": False, "error": str(e)}


@app.get("/accounts/{account_id}/recent-direct-messages")
async def get_recent_direct_messages(account_id: str, limit: int = 20):
    """Return the latest incoming messages from private chats (non-groups)."""
    operation = add_operation_with_notification("recent_direct_messages", 8, {
        "account_id": account_id,
        "limit": limit
    })
    try:
        requested_limit = max(1, min(limit, 50))

        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        if is_scanning and hasattr(deleter, 'get_scan_state'):
            try:
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
            except Exception as state_error:
                logger.warning(f"Failed to save scan state before loading recent DMs: {state_error}")
        pause_scanning()

        client = await _ensure_client_ready(deleter)
        if not client:
            return {"success": False, "error": "Failed to initialize Telegram client"}

        if not await client.is_user_authorized():
            return {"success": False, "error": "Account is not authenticated with Telegram"}

        collected: List[Dict[str, Any]] = []

        async for dialog in client.iter_dialogs():
            entity = getattr(dialog, 'entity', None)
            if not isinstance(entity, TLUser):
                continue

            display_name = _format_user_display(entity)

            async for message in client.iter_messages(entity, limit=requested_limit * 3):
                if getattr(message, 'out', False):
                    continue  # Skip messages we sent

                message_date = getattr(message, 'date', None)
                if not message_date:
                    continue

                collected.append({
                    'message_id': message.id,
                    'chat_id': entity.id,
                    'chat_name': display_name,
                    'message_text': _format_message_text(message),
                    'timestamp': message_date.isoformat(),
                    'username': getattr(entity, 'username', None),
                    'first_name': getattr(entity, 'first_name', None),
                    'last_name': getattr(entity, 'last_name', None)
                })

                if len(collected) >= requested_limit * 3:
                    break

            if len(collected) >= requested_limit * 3:
                break

        collected.sort(key=lambda item: item['timestamp'], reverse=True)

        return {
            'success': True,
            'count': min(len(collected), requested_limit),
            'messages': collected[:requested_limit]
        }

    except Exception as error:
        logger.error(f"Error loading recent direct messages for {account_id}: {error}")
        return {"success": False, "error": str(error)}
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()


@app.get("/accounts/{account_id}/user-history")
async def get_user_history(
    account_id: str,
    username: Optional[str] = None,
    chat_id: Optional[str] = None,
    to_date: Optional[str] = None,
    from_date: Optional[str] = None,
    limit: int = 200
):
    """Load the full conversation history with a specific user up to a given date.
    Can search by username OR chat_id (user_id).
    """
    operation = add_operation_with_notification("user_history_lookup", 8, {
        "account_id": account_id,
        "username": username,
        "chat_id": chat_id,
        "to_date": to_date,
        "limit": limit
    })
    try:
        # Check if either username or chat_id is provided
        normalized_username = _normalize_username(username) if username else None
        user_id = None
        
        if chat_id:
            try:
                user_id = int(chat_id)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="chat_id חייב להיות מספר תקף")
        
        if not normalized_username and not user_id:
            raise HTTPException(status_code=400, detail="נדרש להזין שם משתמש או chat_id לחיפוש ההיסטוריה")

        try:
            requested_limit = max(1, min(int(limit), 1000))
        except (TypeError, ValueError):
            requested_limit = 200

        deleter = get_deleter_for_account(account_id)
        if not deleter:
            raise HTTPException(status_code=404, detail="Account not found")

        if is_scanning and hasattr(deleter, 'get_scan_state'):
            try:
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
            except Exception as state_error:
                logger.warning(f"Failed to save scan state before loading user history: {state_error}")
        pause_scanning()

        client = await _ensure_client_ready(deleter)
        if not client:
            raise HTTPException(status_code=500, detail="Failed to initialize Telegram client")

        if not await client.is_user_authorized():
            raise HTTPException(status_code=401, detail="Account is not authenticated with Telegram")

        # Try to get entity by username or user_id
        entity = None
        if normalized_username:
            try:
                entity = await client.get_entity(normalized_username)
            except ValueError:
                # If username not found and we have user_id, try that instead
                if user_id:
                    try:
                        entity = await client.get_entity(user_id)
                    except (ValueError, TypeError):
                        raise HTTPException(status_code=404, detail="המשתמש לא נמצא לפי שם המשתמש או ה-chat_id")
                else:
                    raise HTTPException(status_code=404, detail="המשתמש לא נמצא או שהשם שגוי")
            except Exception as fetch_error:
                logger.error(f"Failed to resolve username {normalized_username}: {fetch_error}")
                # If username failed and we have user_id, try that instead
                if user_id:
                    try:
                        entity = await client.get_entity(user_id)
                    except Exception:
                        raise HTTPException(status_code=500, detail="אירעה שגיאה בעת ניסיון לאתר את המשתמש")
                else:
                    raise HTTPException(status_code=500, detail="אירעה שגיאה בעת ניסיון לאתר את המשתמש")
        elif user_id:
            try:
                entity = await client.get_entity(user_id)
            except (ValueError, TypeError):
                raise HTTPException(status_code=404, detail="המשתמש לא נמצא לפי ה-chat_id")
            except Exception as fetch_error:
                logger.error(f"Failed to resolve user_id {user_id}: {fetch_error}")
                raise HTTPException(status_code=500, detail="אירעה שגיאה בעת ניסיון לאתר את המשתמש")

        if not entity or not isinstance(entity, TLUser):
            raise HTTPException(status_code=400, detail="הזיהוי שסופק אינו תואם לחשבון משתמש פרטי")

        offset_date, normalized_to_date = _normalize_history_offset(to_date)
        if to_date and normalized_to_date is None:
            raise HTTPException(status_code=400, detail="פורמט התאריך אינו תקין. השתמשו בתאריך בפורמט ISO 8601")

        if not normalized_to_date:
            auto_to_date = datetime.utcnow().replace(tzinfo=timezone.utc)
            normalized_to_date = auto_to_date.isoformat().replace("+00:00", "Z")
            offset_date = (auto_to_date + timedelta(seconds=1)).replace(tzinfo=None)

        parsed_from_date = _parse_iso_datetime(from_date)
        normalized_from_date = None
        if parsed_from_date:
            parsed_from_date = parsed_from_date.astimezone(timezone.utc)
            normalized_from_date = parsed_from_date.isoformat().replace("+00:00", "Z")

        to_datetime_utc = _parse_iso_datetime(normalized_to_date)
        if parsed_from_date and to_datetime_utc and parsed_from_date > to_datetime_utc:
            raise HTTPException(status_code=400, detail="from_date חייב להיות קטן או שווה ל-to_date")

        max_fetch = max(requested_limit * 3, requested_limit)
        max_fetch = min(max_fetch, 2000)

        collected: List[Dict[str, Any]] = []
        has_more = False
        async for history_message in client.iter_messages(
            entity,
            limit=max_fetch,
            offset_date=offset_date
        ):
            message_date = getattr(history_message, 'date', None)
            if parsed_from_date and message_date:
                message_date_utc = message_date.astimezone(timezone.utc)
                if message_date_utc < parsed_from_date:
                    has_more = True
                    break

            collected.append(_serialize_history_message(history_message, entity.id))

            if len(collected) >= requested_limit:
                has_more = True
                break

        collected.reverse()

        chat_metadata = {
            'id': entity.id,
            'username': getattr(entity, 'username', None),
            'first_name': getattr(entity, 'first_name', None),
            'last_name': getattr(entity, 'last_name', None),
            'display_name': _format_user_display(entity),
            'is_bot': getattr(entity, 'bot', False)
        }

        return {
            'success': True,
            'chat': chat_metadata,
            'messages': collected,
            'requested': {
                'username': normalized_username,
                'chat_id': str(user_id) if user_id else None,
                'from_date': normalized_from_date,
                'to_date': normalized_to_date,
                'limit': requested_limit
            },
            'stats': {
                'total': len(collected),
                'has_more': has_more
            }
        }
    except HTTPException:
        raise
    except Exception as error:
        identifier = username or chat_id or "unknown"
        logger.error(f"Error loading user history for {account_id}/{identifier}: {error}")
        raise HTTPException(status_code=500, detail="שגיאה בטעינת היסטוריית המשתמש")
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()

@app.get("/accounts/{account_id}/found-messages")
async def list_found_messages(
    account_id: str,
    cursor: Optional[str] = None,
    limit: int = 100,
    search: Optional[str] = None,
    group_id: Optional[str] = None,
    sort: str = "foundAt:desc"
):
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        store = getattr(deleter, "found_messages_store", None)
        if not store:
            return {"success": False, "error": "Found messages store not initialised"}

        try:
            limit_value = max(1, min(int(limit), 200))
        except (TypeError, ValueError):
            limit_value = 100

        group_filter = group_id if group_id not in {None, "", "all"} else None
        items, next_cursor, total_count = store.get_all_messages(
            cursor=cursor,
            limit=limit_value,
            search=search,
            group_id=group_filter,
            sort=sort
        )
        stats = store.statistics()
        return {
            "success": True,
            "items": items,
            "next_cursor": next_cursor,
            "page_size": limit_value,
            "total_items": total_count,
            "summary": stats
        }
    except Exception as exc:
        logger.error(f"Error listing found messages for {account_id}: {exc}")
        return {"success": False, "error": str(exc)}

@app.post("/accounts/{account_id}/delete-messages")
async def delete_messages_endpoint(account_id: str, request: dict):
    """Delete specific messages from a chat - HIGH PRIORITY"""
    operation = add_operation_with_notification("delete_messages", 10, {
        "account_id": account_id,
        "request": request
    })
    try:
        logger.info(f"DELETE MESSAGES REQUEST: account={account_id}, data={request}")
        
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            logger.error(f"Account not found: {account_id}")
            return {"success": False, "error": "Account not found"}
        
        # Pause scanning if running and save state
        if is_scanning and hasattr(deleter, 'get_scan_state'):
            try:
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
            except Exception as state_error:
                logger.warning(f"Failed to save scan state before deletion: {state_error}")
        pause_scanning()
        
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
            deleter.checkpoint_manager.increment_group_deleted(str(chat_id), deleted_count)

            store = getattr(deleter, "found_messages_store", None)
            store_summary = None
            if store:
                try:
                    store_summary = store.apply_delete_results(chat_id, result.get('results', []))
                    logger.info(f"Updated found messages store after deletion: {store_summary}")
                except Exception as store_error:
                    logger.warning(f"Failed to update found messages store: {store_error}")

            return {
                "success": True,
                "message": f"Successfully deleted {deleted_count} messages",
                "deleted_count": deleted_count,
                "failed_count": result.get('failed_count', 0),
                "results": result.get('results', []),
                "store_summary": store_summary
            }
        
        logger.error(f"Failed to delete messages: {result.get('error')}")
        return {"success": False, "error": result.get('error', 'Failed to delete messages')}
    except Exception as e:
        logger.error(f"Error deleting messages for {account_id}: {str(e)}", exc_info=True)
        return {"success": False, "error": str(e)}
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()

@app.post("/accounts/{account_id}/verify-deletion")
async def verify_deletion(account_id: str, request: dict):
    """Verify that messages were actually deleted by scanning the chat in the time range - HIGH PRIORITY"""
    operation = add_operation_with_notification("verify_deletion", 9, {
        "account_id": account_id,
        "request": request
    })
    try:
        logger.info(f"VERIFY DELETION REQUEST: account={account_id}, data={request}")
        
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            logger.error(f"Account not found: {account_id}")
            return {"success": False, "error": "Account not found"}
        
        # Pause scanning if running and save state
        if is_scanning and hasattr(deleter, 'get_scan_state'):
            try:
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
            except Exception as state_error:
                logger.warning(f"Failed to save scan state before deletion verification: {state_error}")
        pause_scanning()
        
        chat_id = request.get("chat_id")
        deleted_message_ids = request.get("deleted_message_ids", [])
        time_range_minutes = request.get("time_range_minutes", 1)  # Default 1 minute
        
        if not chat_id or not deleted_message_ids:
            return {"success": False, "error": "Missing chat_id or deleted_message_ids"}
        
        # Get the time range for verification
        now = datetime.now(timezone.utc)
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
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()

@app.get("/accounts/{account_id}/chats/summary")
async def get_chats_summary(account_id: str):
    """Get quick summary of chats for the account (fast response)"""
    try:
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Check if client is connected
        if not deleter.client or not deleter.client.is_connected():
            return {"success": False, "error": "Account not connected"}
        
        # Get only count of dialogs (fast)
        all_dialogs = await deleter.client.get_dialogs()
        group_dialogs = [d for d in all_dialogs if hasattr(d.entity, 'megagroup') and d.entity.megagroup]
        
        return {
            "success": True,
            "total": len(group_dialogs),
            "message": f"Found {len(group_dialogs)} groups"
        }
    except Exception as e:
        logger.error(f"Error getting chats summary: {str(e)}")
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/chats")
async def get_all_chats(account_id: str, page: int = 1, limit: int = 50):
    """Get all chats for the account with pagination"""
    try:
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Check if client is connected
        if not deleter.client or not deleter.client.is_connected():
            return {"success": False, "error": "Account not connected"}

        try:
            me = await deleter.safe_api_call(deleter.client.get_me)
            owner_id = getattr(me, 'id', None)
            deleter.ensure_owner_context(owner_id)
        except Exception as owner_error:
            logger.warning(f"Failed to ensure owner context for {account_id}: {owner_error}")
            owner_id = None

        # Get dialog folders mapping (folder id -> title)
        folder_titles = {}
        try:
            dialog_filters = await deleter.client(GetDialogFiltersRequest())
            filters_list = getattr(dialog_filters, 'filters', []) or []
            for dialog_filter in filters_list:
                folder_id = getattr(dialog_filter, 'id', None)
                title = getattr(dialog_filter, 'title', None)
                if folder_id is not None:
                    folder_titles[folder_id] = title or f"תיקייה {folder_id}"
        except Exception as folder_error:
            logger.debug(f"Could not load dialog folders for {account_id}: {folder_error}")

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
                
                folder_id = getattr(dialog, 'folder_id', None)
                folder_name = folder_titles.get(folder_id)
                if folder_name is None:
                    folder_name = 'ללא תיקייה' if folder_id is None else f"תיקייה {folder_id}"

                # Fetch group rules/description
                group_rules = await deleter.get_group_rules(dialog)

                chats.append({
                    'id': dialog_id,
                    'title': dialog.name or "Unknown",
                    'member_count': member_count,
                    'type': 'group',
                    'lastMessageTime': last_message_time,
                    'lastMessageContent': last_message_content,
                    'folder_id': folder_id,
                    'folder_name': folder_name,
                    'group_rules': group_rules,
                    'metadata': {
                        'folder_id': folder_id,
                        'folder_name': folder_name,
                        'lastMessageTime': last_message_time,
                        'lastMessageContent': last_message_content,
                        'group_rules': group_rules,
                        'type': 'group'
                    }
                })

        checkpoint_manager = deleter.checkpoint_manager
        checkpoint_manager.update_groups_cache(chats, owner_id)

        cache_meta = checkpoint_manager.get_groups_cache()

        return {
            "success": True,
            "chats": chats,
            "total": len(chats),
            "updated_at": cache_meta.get('updated_at')
        }
        
    except Exception as e:
        logger.error(f"Error getting chats for {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}


@app.get("/accounts/{account_id}/cached-groups")
async def get_cached_groups(account_id: str):
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        cache = deleter.checkpoint_manager.get_groups_cache()
        return {
            "success": True,
            "groups": cache.get('groups', []),
            "updated_at": cache.get('updated_at')
        }
    except Exception as e:
        logger.error(f"Error getting cached groups for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}


@app.get("/accounts/{account_id}/temporary-messages")
async def get_temporary_messages(account_id: str):
    """Get temporary messages (self-destructing messages) for an account"""
    logger.info(f"GET /accounts/{account_id}/temporary-messages - endpoint called")
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            logger.warning(f"Account {account_id} not found")
            return {"success": False, "error": "Account not found"}
        
        checkpoint_manager = deleter.checkpoint_manager
        active_messages = checkpoint_manager.get_active_temporary_messages()
        logger.info(f"Found {len(active_messages)} active temporary messages for {account_id}")
        
        # Calculate minutes remaining for each message
        now = datetime.now(timezone.utc)
        temporary_messages = []
        for key, msg in active_messages.items():
            deletes_at = datetime.fromisoformat(msg['deletes_at'].replace('Z', '+00:00'))
            minutes_remaining = max(0, int((deletes_at - now).total_seconds() / 60))
            
            temporary_messages.append({
                'key': key,
                'chat_id': msg['chat_id'],
                'chat_title': msg['chat_title'],
                'message_id': msg['message_id'],
                'sent_at': msg['sent_at'],
                'deletes_at': msg['deletes_at'],
                'minutes_remaining': minutes_remaining
            })
        
        logger.info(f"Returning {len(temporary_messages)} temporary messages for {account_id}")
        return {
            "success": True,
            "temporary_messages": temporary_messages
        }
    except Exception as e:
        logger.error(f"Error getting temporary messages for {account_id}: {str(e)}", exc_info=True)
        return {"success": False, "error": str(e)}

@app.get("/accounts/{account_id}/groups")
async def list_persisted_groups(account_id: str):
    try:
        checkpoint_manager = get_checkpoint_manager(account_id)
        if not checkpoint_manager:
            return {"success": False, "error": "Account not found"}
        
        # Try to get groups from cache first (scanned groups)
        cache = checkpoint_manager.get_groups_cache()
        if cache.get('groups'):
            return {
                "success": True,
                "groups": cache.get('groups', []),
                "synced_at": cache.get('updated_at')
            }
        
        # Fallback to persisted groups
        snapshot = checkpoint_manager.list_persisted_groups()
        return {
            "success": True,
            "groups": snapshot.get('groups', []),
            "synced_at": snapshot.get('synced_at')
        }
    except Exception as e:
        logger.error(f"Error listing groups for account {account_id}: {e}")
        return {"success": False, "error": str(e)}


@app.get("/accounts/{account_id}/blocked-contacts")
async def get_blocked_contacts(account_id: str):
    """Get list of all blocked contacts/users for an account"""
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        # Ensure client is ready
        client = await _ensure_client_ready(deleter)
        if not client:
            return {"success": False, "error": "Failed to initialize Telegram client"}
        
        if not await client.is_user_authorized():
            return {"success": False, "error": "Account is not authenticated with Telegram"}
        
        # Get blocked contacts with timeout (now returns dict with total and loaded)
        try:
            result = await asyncio.wait_for(
                deleter.get_blocked_contacts(),
                timeout=120.0  # 2 minutes total timeout
            )
        except asyncio.TimeoutError:
            logger.error(f"Timeout getting blocked contacts for account {account_id}")
            return {"success": False, "error": "Request timed out. Please try again."}
        
        return {
            "success": True,
            "blocked_contacts": result.get('blocked_contacts', []),
            "total": result.get('total', 0),
            "loaded": result.get('loaded', 0)
        }
    except Exception as e:
        logger.error(f"Error getting blocked contacts for account {account_id}: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.post("/accounts/{account_id}/groups/refresh")
async def refresh_groups(account_id: str):
    try:
        response = await get_all_chats(account_id)
        return response
    except Exception as e:
        logger.error(f"Error refreshing groups for account {account_id}: {e}")
        return {"success": False, "error": str(e)}


@app.post("/accounts/{account_id}/groups/join")
async def join_groups(account_id: str, request: JoinGroupsRequest):
    links = [link.strip() for link in request.links if link.strip()]
    if not links:
        return {"success": False, "error": "לא סופקו קישורים"}

    operation = add_operation_with_notification("join_groups", 8, {
        "account_id": account_id,
        "link_count": len(links)
    })

    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        client = await _ensure_client_ready(deleter)
        if not client:
            return {"success": False, "error": "Failed to initialize Telegram client"}

        results = []
        checkpoint_manager = deleter.checkpoint_manager

        for idx, link in enumerate(links):
            status, info = await _join_group_by_link(client, link)
            chat_id = info.get('chat_id') or link
            if status == 'joined':
                checkpoint_manager.mark_group_joined(chat_id, info)
            else:
                checkpoint_manager.mark_group_status(chat_id, status, info)
            results.append({
                'link': link,
                'status': status,
                'info': info
            })

            if status == 'waiting' and info.get('wait_seconds'):
                await asyncio.sleep(min(max(int(info['wait_seconds']), 1), 60))
            else:
                await asyncio.sleep(2)

        return {
            "success": True,
            "results": results
        }
    except Exception as e:
        logger.error(f"Error joining groups for account {account_id}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()


@app.post("/accounts/{account_id}/groups/leave")
async def leave_groups(account_id: str, request: LeaveGroupRequest):
    if not request.chat_ids:
        return {"success": False, "error": "לא נבחרו קבוצות"}

    operation = add_operation_with_notification("leave_groups", 7, {
        "account_id": account_id,
        "chat_count": len(request.chat_ids)
    })

    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        client = await _ensure_client_ready(deleter)
        if not client:
            return {"success": False, "error": "Failed to initialize Telegram client"}

        checkpoint_manager = deleter.checkpoint_manager
        results = []

        for chat_id in request.chat_ids:
            status, info = await _leave_group(client, chat_id)
            if status == 'left':
                checkpoint_manager.mark_group_left(info.get('chat_id', chat_id))
            else:
                checkpoint_manager.mark_group_status(info.get('chat_id', chat_id), status, info)
            results.append({
                'chat_id': chat_id,
                'status': status,
                'info': info
            })
            await asyncio.sleep(1)

        return {
            "success": True,
            "results": results
        }
    except Exception as e:
        logger.error(f"Error leaving groups for account {account_id}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()

def _normalize_username(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    username = value.strip()
    if not username:
        return None
    if username.startswith('@'):
        username = username[1:]
    return username.lower()


def _normalize_user_ids(values: Optional[List[str]]) -> List[int]:
    normalized: List[int] = []
    if not values:
        return normalized

    for raw in values:
        if raw is None:
            continue
        text = str(raw).strip()
        if not text:
            continue
        # Remove common prefixes like "id:" and keep digits/optional sign
        text = re.sub(r'(?i)^id[:\s]+', '', text)
        cleaned = re.sub(r'[^0-9-]', '', text)
        if not cleaned or cleaned in {'-', '+', ''}:
            continue
        try:
            value_int = int(cleaned)
        except ValueError:
            continue
        normalized.append(value_int)
    return normalized


def _normalize_phone_number(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    digits = re.sub(r'[^0-9]', '', str(value))
    if len(digits) < 5:
        return None
    return digits


async def _join_via_invite_hash(client, invite_hash: str, info: Dict[str, Any]):
    try:
        result = await client(ImportChatInviteRequest(invite_hash))
        chats = getattr(result, 'chats', []) or []
        if chats:
            entity = chats[0]
            info['chat_id'] = str(getattr(entity, 'id', info.get('chat_id')))
            info['title'] = getattr(entity, 'title', info.get('title'))
        return 'joined', info
    except UserAlreadyParticipantError:
        info['note'] = 'already_member'
        try:
            check = await client(CheckChatInviteRequest(invite_hash))
            chat = getattr(check, 'chat', None)
            if chat:
                entity = await client.get_entity(chat)
                info['chat_id'] = str(getattr(entity, 'id', info.get('chat_id')))
                info['title'] = getattr(entity, 'title', info.get('title'))
        except Exception as exc:
            info['error'] = str(exc)
        return 'joined', info
    except FloodWaitError as fw:
        info['wait_seconds'] = fw.seconds
        return 'waiting', info
    except ChannelPrivateError as exc:
        info['error'] = str(exc)
        return 'pending', info
    except (InviteHashInvalidError, InviteHashExpiredError) as exc:
        info['error'] = str(exc)
        return 'failed', info
    except Exception as exc:
        info['error'] = str(exc)
        return 'failed', info


async def _join_group_by_link(client, link: str):
    cleaned = (link or '').strip()
    info: Dict[str, Any] = {'input': link}
    if not cleaned:
        info['error'] = 'קישור ריק'
        return 'failed', info

    try:
        if cleaned.startswith('@'):
            username = cleaned[1:]
            entity = await client.get_entity(username)
            await client(JoinChannelRequest(entity))
            resolved = await client.get_entity(entity)
            info['chat_id'] = str(getattr(resolved, 'id', entity.id))
            info['title'] = getattr(resolved, 'title', username)
            info['username'] = username
            return 'joined', info

        candidate = cleaned
        if not candidate.startswith('http'):
            candidate = f"https://{candidate}"

        parsed = urlparse(candidate)
        if parsed.netloc.lower() not in {'t.me', 'telegram.me'}:
            if re.fullmatch(r'[A-Za-z0-9_]{5,}', cleaned):
                entity = await client.get_entity(cleaned)
                await client(JoinChannelRequest(entity))
                resolved = await client.get_entity(entity)
                info['chat_id'] = str(getattr(resolved, 'id', entity.id))
                info['title'] = getattr(resolved, 'title', cleaned)
                info['username'] = cleaned
                return 'joined', info
            raise ValueError('Unsupported link domain')

        path = (parsed.path or '').lstrip('/')
        if not path:
            raise ValueError('Invalid link format')

        if path.startswith('joinchat/'):
            invite_hash = path.split('/', 1)[1]
            return await _join_via_invite_hash(client, invite_hash, info)
        if path.startswith('+'):
            invite_hash = path.lstrip('+')
            return await _join_via_invite_hash(client, invite_hash, info)

        username = path
        if username.startswith('@'):
            username = username[1:]
        entity = await client.get_entity(username)
        await client(JoinChannelRequest(entity))
        resolved = await client.get_entity(entity)
        info['chat_id'] = str(getattr(resolved, 'id', entity.id))
        info['title'] = getattr(resolved, 'title', username)
        info['username'] = username
        return 'joined', info

    except FloodWaitError as fw:
        info['wait_seconds'] = fw.seconds
        return 'waiting', info
    except ChannelPrivateError as exc:
        info['error'] = str(exc)
        return 'pending', info
    except (InviteHashInvalidError, InviteHashExpiredError) as exc:
        info['error'] = str(exc)
        return 'failed', info
    except UserAlreadyParticipantError:
        info['note'] = 'already_member'
        try:
            entity = await client.get_entity(cleaned)
            info['chat_id'] = str(getattr(entity, 'id', info.get('chat_id')))
            info['title'] = getattr(entity, 'title', info.get('title'))
        except Exception:
            pass
        return 'joined', info
    except Exception as exc:
        info['error'] = str(exc)
        return 'failed', info


async def _leave_group(client, chat_id: str):
    info: Dict[str, Any] = {'chat_id': str(chat_id)}
    try:
        try:
            numeric_id = int(str(chat_id))
        except (ValueError, TypeError):
            numeric_id = None

        entity = await client.get_entity(numeric_id or chat_id)
        await client(LeaveChannelRequest(entity))
        info['title'] = getattr(entity, 'title', None)
        return 'left', info
    except Exception as exc:
        info['error'] = str(exc)
        return 'failed', info


async def _build_known_user_index(client) -> Dict[str, Dict[Any, TLUser]]:
    username_map: Dict[str, TLUser] = {}
    phone_map: Dict[str, TLUser] = {}
    id_map: Dict[int, TLUser] = {}

    async for dialog in client.iter_dialogs():
        entity = getattr(dialog, 'entity', None)
        if not isinstance(entity, TLUser):
            continue
        id_map[entity.id] = entity
        username = getattr(entity, 'username', None)
        if username:
            username_map[username.lower()] = entity
        phone_digits = _normalize_phone_number(getattr(entity, 'phone', None))
        if phone_digits:
            phone_map[phone_digits] = entity

    return {
        'id': id_map,
        'username': username_map,
        'phone': phone_map
    }

async def _resolve_direct_target(
    client,
    user_index: Optional[Dict[str, Dict[Any, TLUser]]],
    raw_target: str
):
    target = (raw_target or '').strip()
    if not target:
        return None, {
            'input': raw_target,
            'error': 'הערך שסופק ריק'
        }, None

    lower_target = target.lower()
    is_username = '@' in target or any(ch.isalpha() for ch in target)
    normalized_username = _normalize_username(target) if is_username else None
    index_cache = user_index
    has_full_index = user_index is not None

    def ensure_index_dict() -> Dict[str, Dict[Any, TLUser]]:
        nonlocal index_cache
        if index_cache is None:
            index_cache = {'id': {}, 'username': {}, 'phone': {}}
        return index_cache

    async def ensure_full_index() -> Dict[str, Dict[Any, TLUser]]:
        nonlocal index_cache, has_full_index
        if not has_full_index:
            index_cache = await _build_known_user_index(client)
            has_full_index = True
        return index_cache or {'id': {}, 'username': {}, 'phone': {}}

    if normalized_username:
        if index_cache and normalized_username in index_cache.get('username', {}):
            entity = index_cache['username'][normalized_username]
            return entity, {
                'input': raw_target,
                'matched_by': 'username',
                'display_name': _format_user_display(entity)
            }, None
        try:
            entity = await client.get_entity(normalized_username)
            return entity, {
                'input': raw_target,
                'matched_by': 'username_lookup',
                'display_name': _format_user_display(entity)
            }, None
        except Exception as error:
            try:
                index = await ensure_full_index()
                entity = index['username'].get(normalized_username)
                if entity:
                    return entity, {
                        'input': raw_target,
                        'matched_by': 'username',
                        'display_name': _format_user_display(entity)
                    }, None
            except Exception:
                pass
            return None, {
                'input': raw_target,
                'error': f"לא ניתן למצוא משתמש בשם @{normalized_username}: {error}"
            }, None

    phone_digits = _normalize_phone_number(target)
    is_phone = target.startswith('+') or (phone_digits is not None and not is_username and len(phone_digits) >= 8)

    if is_phone and phone_digits:
        if index_cache and phone_digits in index_cache.get('phone', {}):
            entity = index_cache['phone'][phone_digits]
            return entity, {
                'input': raw_target,
                'matched_by': 'phone',
                'display_name': _format_user_display(entity)
            }, None
        try:
            contact = InputPhoneContact(client_id=random.randint(1, 2**31 - 1), phone=phone_digits, first_name='Imported', last_name='Contact')
            import_result = await client(ImportContactsRequest([contact]))
            if import_result.users:
                entity = import_result.users[0]
                index = ensure_index_dict()
                index['id'][entity.id] = entity
                username = getattr(entity, 'username', None)
                if username:
                    index['username'][username.lower()] = entity
                normalized_phone = _normalize_phone_number(getattr(entity, 'phone', None))
                if normalized_phone:
                    index['phone'][normalized_phone] = entity
                return entity, {
                    'input': raw_target,
                    'matched_by': 'phone_import',
                    'display_name': _format_user_display(entity)
                }, entity
            return None, {
                'input': raw_target,
                'error': 'המספר לא נמצא או שהמשתמש חסם הודעות'
            }, None
        except Exception as error:
            return None, {
                'input': raw_target,
                'error': f"שגיאה בייבוא איש הקשר מהטלפון: {error}"
            }, None

    digits_only = re.sub(r'[^0-9-]', '', lower_target)
    if digits_only:
        try:
            user_id = int(digits_only)
        except ValueError:
            user_id = None
        if user_id is not None:
            if index_cache and user_id in index_cache.get('id', {}):
                entity = index_cache['id'][user_id]
                return entity, {
                    'input': raw_target,
                    'matched_by': 'id',
                    'display_name': _format_user_display(entity)
                }, None
            try:
                entity = await client.get_entity(user_id)
                return entity, {
                    'input': raw_target,
                    'matched_by': 'id_lookup',
                    'display_name': _format_user_display(entity)
                }, None
            except Exception as error:
                try:
                    index = await ensure_full_index()
                    entity = index['id'].get(user_id)
                    if entity:
                        return entity, {
                            'input': raw_target,
                            'matched_by': 'id',
                            'display_name': _format_user_display(entity)
                        }, None
                except Exception:
                    pass
                return None, {
                    'input': raw_target,
                    'error': f"לא ניתן למצוא משתמש עם מזהה {user_id}: {error}"
                }, None

    return None, {
        'input': raw_target,
        'error': 'לא זוהה סוג המזהה או שהמשתמש לא נמצא'
    }, None


async def _ensure_client_ready(deleter) -> Optional[Any]:
    try:
        if not deleter.client:
            await deleter.safe_client_connect()
        elif not deleter.client.is_connected():
            await deleter.client.connect()
    except Exception:
        await deleter.safe_client_connect()
    return deleter.client


def _format_message_text(message) -> str:
    text = getattr(message, 'message', None) or getattr(message, 'raw_text', '') or ''
    text = text.strip()
    if text:
        return text
    if getattr(message, 'media', None):
        return '[מדיה]'
    if getattr(message, 'action', None):
        return '[פעולת מערכת]'
    return '[ללא טקסט]'


def _format_user_display(entity: TLUser) -> str:
    first = getattr(entity, 'first_name', None) or ''
    last = getattr(entity, 'last_name', None) or ''
    full_name = ' '.join(part for part in [first.strip(), last.strip()] if part).strip()
    if full_name:
        return full_name
    username = getattr(entity, 'username', None)
    if username:
        return f"@{username}"
    return 'ללא שם'


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        normalized = value.strip()
        if normalized.endswith('Z'):
            normalized = normalized[:-1] + '+00:00'
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return None


def _normalize_history_offset(value: Optional[str]) -> Tuple[Optional[datetime], Optional[str]]:
    parsed = _parse_iso_datetime(value)
    if not parsed:
        return None, None
    utc_datetime = parsed.astimezone(timezone.utc)
    offset_for_iter = (utc_datetime + timedelta(seconds=1)).replace(tzinfo=None)
    iso_value = utc_datetime.isoformat().replace('+00:00', 'Z')
    return offset_for_iter, iso_value


def _extract_media_details(message) -> Optional[Dict[str, Any]]:
    media = getattr(message, 'media', None)
    if not media:
        return None

    details: Dict[str, Any] = {
        'type': 'unknown',
        'file_name': None,
        'size_bytes': None,
        'mime_type': None,
        'caption': None
    }

    file = getattr(message, 'file', None)
    if file:
        details['file_name'] = getattr(file, 'name', None) or getattr(file, 'title', None)
        details['mime_type'] = getattr(file, 'mime_type', None)
        details['size_bytes'] = getattr(file, 'size', None)

    media_class = media.__class__.__name__.lower()
    mime_type = (details.get('mime_type') or '').lower()

    if 'photo' in media_class or mime_type.startswith('image/'):
        details['type'] = 'photo'
    elif 'video' in mime_type:
        details['type'] = 'video'
    elif 'voice' in mime_type:
        details['type'] = 'voice'
    elif 'audio' in mime_type:
        details['type'] = 'audio'
    elif 'gif' in mime_type or 'animation' in media_class:
        details['type'] = 'animation'
    elif 'sticker' in mime_type:
        details['type'] = 'sticker'
    elif 'contact' in media_class:
        details['type'] = 'contact'
    elif 'geo' in media_class or 'location' in media_class:
        details['type'] = 'geo'
    elif 'poll' in media_class:
        details['type'] = 'poll'
    elif 'document' in media_class:
        details['type'] = 'document'
    else:
        details['type'] = 'media'

    caption = getattr(message, 'message', None)
    if isinstance(caption, str):
        caption = caption.strip()
    details['caption'] = caption or None
    return details


def _format_service_action(message) -> Optional[str]:
    action = getattr(message, 'action', None)
    if not action:
        return None

    action_name = action.__class__.__name__
    if action_name == 'MessageActionContactSignUp':
        return 'המשתמש הצטרף לטלגרם'
    if action_name == 'MessageActionPhoneCall':
        return 'שיחת טלגרם בוצעה'
    if action_name == 'MessageActionChatAddUser':
        users = getattr(action, 'users', None) or []
        if len(users) > 1:
            return f"נוספו {len(users)} משתמשים לשיחה"
        return 'נוסף משתמש לשיחה'
    if action_name == 'MessageActionChatDeleteUser':
        return 'משתמש הוסר מהשיחה'
    if action_name == 'MessageActionChatJoinedByLink':
        return 'הצטרפת באמצעות קישור הזמנה'
    if action_name == 'MessageActionHistoryClear':
        return 'היסטוריית השיחה נוקתה'
    if action_name == 'MessageActionPinMessage':
        return 'הודעה ננעצה בצ׳אט'
    return action_name


def _serialize_history_message(message, chat_id: int) -> Dict[str, Any]:
    timestamp = getattr(message, 'date', None)
    media_details = _extract_media_details(message)

    text = getattr(message, 'message', None)
    if isinstance(text, str):
        text = text.strip()
        if not text:
            text = None

    if media_details and media_details.get('caption') and not text:
        text = media_details.get('caption')

    direction = 'outgoing' if getattr(message, 'out', False) else 'incoming'
    is_service = bool(getattr(message, 'action', None))

    via_bot = None
    via_bot_entity = getattr(message, 'via_bot', None)
    if via_bot_entity and hasattr(via_bot_entity, 'username'):
        via_bot = getattr(via_bot_entity, 'username', None)
    elif hasattr(message, 'via_bot_id'):
        via_bot = getattr(message, 'via_bot_id')

    return {
        'message_id': message.id,
        'chat_id': chat_id,
        'timestamp': timestamp.isoformat() if timestamp else None,
        'direction': direction,
        'text': text,
        'is_service': is_service,
        'service_text': _format_service_action(message) if is_service else None,
        'media': media_details,
        'via_bot': via_bot
    }


def _dialog_has_history(dialog: Optional[TLDialog]) -> bool:
    if not dialog:
        return False
    top_message = getattr(dialog, 'top_message', 0) or 0
    read_inbox = getattr(dialog, 'read_inbox_max_id', 0) or 0
    read_outbox = getattr(dialog, 'read_outbox_max_id', 0) or 0
    pts = getattr(dialog, 'pts', 0) or 0
    return any(value > 0 for value in (top_message, read_inbox, read_outbox, pts))


@app.post("/user-lookup")
async def user_lookup(payload: UserLookupRequest):
    """Check all (or selected) accounts for conversation history with a specific user."""
    normalized_username = _normalize_username(payload.username)
    normalized_ids = _normalize_user_ids(payload.user_ids)

    if not normalized_username and not normalized_ids:
        raise HTTPException(status_code=400, detail="No username or user IDs provided")

    account_filter = set(payload.account_ids or [])
    target_accounts = account_store.get_all_accounts()
    if account_filter:
        target_accounts = [acc for acc in target_accounts if acc.id in account_filter]

    results = []

    for account in target_accounts:
        account_result = {
            'account_id': account.id,
            'account_label': account.label,
            'status': 'pending',
            'conversation_state': 'unknown',
            'target_user': None,
            'matched_by': None,
            'messages': [],
            'summary_text': None,
            'last_message': None,
            'last_message_at': None,
            'notes': None,
            'error': None,
            'lookup_errors': None
        }

        try:
            deleter = get_deleter_for_account(account.id)
            if not deleter:
                account_result.update({
                    'status': 'error',
                    'error': 'Account session not initialized'
                })
                results.append(account_result)
                continue

            client = await _ensure_client_ready(deleter)
            if not client:
                account_result.update({
                    'status': 'error',
                    'error': 'Failed to initialize Telegram client'
                })
                results.append(account_result)
                continue

            if not await client.is_user_authorized():
                account_result.update({
                    'status': 'not_connected',
                    'conversation_state': 'not_authenticated',
                    'error': 'Account is not authenticated with Telegram'
                })
                results.append(account_result)
                continue

            matched_dialog = None
            matched_entity = None
            matched_reason = None

            async for dialog in client.iter_dialogs():
                entity = getattr(dialog, 'entity', None)
                if not isinstance(entity, TLUser):
                    continue

                username = (entity.username or '').lower()
                if normalized_username and username and username == normalized_username:
                    matched_dialog = dialog
                    matched_entity = entity
                    matched_reason = 'username'
                    break

                if normalized_ids and entity.id in normalized_ids:
                    matched_dialog = dialog
                    matched_entity = entity
                    matched_reason = 'user_id'
                    # Continue searching if username mismatch to prefer username match
                    if not normalized_username:
                        break

            lookup_errors = []

            if not matched_entity and normalized_username:
                try:
                    candidate = await client.get_entity(normalized_username)
                    if isinstance(candidate, TLUser):
                        matched_entity = candidate
                        matched_reason = matched_reason or 'username_lookup'
                except Exception as fetch_error:
                    lookup_errors.append(str(fetch_error))

            if not matched_entity and normalized_ids:
                for candidate_id in normalized_ids:
                    try:
                        candidate = await client.get_entity(candidate_id)
                        if isinstance(candidate, TLUser):
                            matched_entity = candidate
                            matched_reason = matched_reason or 'user_id_lookup'
                            break
                    except Exception as fetch_error:
                        lookup_errors.append(str(fetch_error))

            if not matched_entity:
                account_result.update({
                    'status': 'ok',
                    'conversation_state': 'no_conversation',
                    'notes': 'לא נמצאה שיחה או גישה לאיש הקשר בחשבון זה',
                    'lookup_errors': lookup_errors or None
                })
                results.append(account_result)
                continue

            account_result['target_user'] = {
                'id': matched_entity.id,
                'username': matched_entity.username,
                'first_name': matched_entity.first_name,
                'last_name': matched_entity.last_name,
                'is_bot': getattr(matched_entity, 'bot', False)
            }
            account_result['matched_by'] = matched_reason

            dialog_obj = getattr(matched_dialog, 'dialog', None) if matched_dialog else None

            messages: List[Dict[str, Any]] = []
            try:
                async for message in client.iter_messages(matched_entity, limit=payload.max_messages):
                    text = _format_message_text(message)
                    record = {
                        'id': message.id,
                        'timestamp': message.date.isoformat() if getattr(message, 'date', None) else None,
                        'from_me': bool(getattr(message, 'out', False)),
                        'text': text,
                        'raw_type': message.__class__.__name__
                    }
                    messages.append(record)
            except Exception as history_error:
                account_result['notes'] = f"אירעה שגיאה בעת קריאת היסטוריית ההודעות: {history_error}"

            messages.reverse()
            account_result['messages'] = messages

            if messages:
                account_result['conversation_state'] = 'active'
                account_result['status'] = 'ok'
                account_result['last_message'] = messages[-1]
                account_result['last_message_at'] = messages[-1].get('timestamp')

                summary_lines = []
                for summary_msg in messages[-3:]:
                    prefix = 'אתה' if summary_msg['from_me'] else 'איש הקשר'
                    preview = summary_msg['text'][:140]
                    summary_lines.append(f"{prefix}: {preview}")
                account_result['summary_text'] = '\n'.join(summary_lines)
            else:
                account_result['status'] = 'ok'
                if matched_dialog and _dialog_has_history(dialog_obj):
                    account_result['conversation_state'] = 'history_deleted'
                    account_result['notes'] = 'נמצא צ׳אט עם המשתמש, אך אין הודעות זמינות (יתכן שנמחקו)'
                else:
                    account_result['conversation_state'] = 'no_messages'
                    account_result['notes'] = 'נמצא משתמש אך אין היסטוריית הודעות זמינה'

        except Exception as account_error:
            account_result.update({
                'status': 'error',
                'conversation_state': 'unknown',
                'error': str(account_error)
            })

        results.append(account_result)

    return {
        'success': True,
        'query': {
            'username': normalized_username,
            'user_ids': normalized_ids,
            'max_messages': payload.max_messages,
            'accounts_checked': len(target_accounts)
        },
        'results': results
    }


def _task_from_raw(raw: Dict[str, Any]) -> BacklogTask:
    expert_raw = raw.get('expert_review') or {}
    if isinstance(expert_raw, ExpertReview):
        expert_model = expert_raw
    else:
        expert_model = ExpertReview(
            design_lead=expert_raw.get('design_lead', '') if isinstance(expert_raw, dict) else '',
            dev_lead=expert_raw.get('dev_lead', '') if isinstance(expert_raw, dict) else '',
            product_lead=expert_raw.get('product_lead', '') if isinstance(expert_raw, dict) else '',
            microcopy=expert_raw.get('microcopy', '') if isinstance(expert_raw, dict) else ''
        )
    created_at = raw.get('created_at')
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at)
    updated_at = raw.get('updated_at')
    if isinstance(updated_at, str):
        updated_at = datetime.fromisoformat(updated_at)
    attachments_raw = raw.get('attachments', [])
    attachments: List[str] = []
    last_executed_raw = raw.get('last_executed_at')
    if isinstance(last_executed_raw, str):
        try:
            last_executed_at = datetime.fromisoformat(last_executed_raw)
        except ValueError:
            last_executed_at = None
    elif isinstance(last_executed_raw, datetime):
        last_executed_at = last_executed_raw
    else:
        last_executed_at = None
    if isinstance(attachments_raw, list):
        for item in attachments_raw:
            if isinstance(item, dict):
                filename = item.get('filename') or item.get('url') or ''
            else:
                filename = str(item)
            sanitized = _sanitize_attachment_name(filename)
            if sanitized:
                attachments.append(sanitized)
    execution_log_raw = raw.get('execution_log')
    execution_log: List[Dict[str, str]] = []
    if isinstance(execution_log_raw, list):
        for entry in execution_log_raw:
            if isinstance(entry, dict):
                timestamp = entry.get('timestamp')
                note = entry.get('note', '')
                execution_log.append({
                    'timestamp': str(timestamp) if timestamp is not None else datetime.utcnow().isoformat(),
                    'note': str(note)
                })

    return BacklogTask(
        id=raw.get('id'),
        subject=raw.get('subject', ''),
        subtasks=list(raw.get('subtasks', [])),
        expert_review=expert_model,
        attachments=attachments,
        priority=raw.get('priority', 'רגיל'),
        complexity=raw.get('complexity', 'בינוני'),
        effort_minutes=int(raw.get('effort_minutes', 90)),
        status=raw.get('status', 'pending'),
        created_at=created_at or datetime.utcnow(),
        updated_at=updated_at or datetime.utcnow(),
        last_executed_at=last_executed_at,
        execution_log=execution_log
    )


def _task_to_response(task: BacklogTask) -> Dict[str, Any]:
    payload = task.model_dump()
    payload['expert_review'] = task.expert_review.model_dump()
    payload['created_at'] = task.created_at.isoformat()
    payload['updated_at'] = task.updated_at.isoformat()
    payload['attachments'] = [_serialize_attachment(name) for name in task.attachments]
    if task.last_executed_at:
        payload['last_executed_at'] = task.last_executed_at.isoformat()
    else:
        payload['last_executed_at'] = None
    payload['execution_log'] = list(task.execution_log or [])
    return payload


@app.post("/backlog/attachments")
async def upload_backlog_attachment(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        original_name = file.filename or 'attachment'
        suffix = Path(original_name).suffix.lower()
        if suffix not in {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'}:
            suffix = '.png'

        filename = f"{uuid.uuid4().hex}{suffix}"
        destination = BACKLOG_ATTACHMENTS_DIR / filename
        with destination.open('wb') as buffer:
            buffer.write(contents)

        return {
            'success': True,
            'attachment': {
                'filename': filename,
                'url': _attachment_url(filename),
                'original_name': original_name
            }
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error uploading attachment: {exc}")
        raise HTTPException(status_code=500, detail="Failed to upload attachment")


@app.get("/backlog")
async def get_backlog():
    async with backlog_lock:
        data = _load_backlog_data()
    tasks_raw = data.get('tasks', [])
    tasks = [_task_to_response(_task_from_raw(task)) for task in tasks_raw]
    questions = data.get('questions', [])
    return {
        'success': True,
        'tasks': tasks,
        'questions': questions
    }


@app.post("/backlog")
async def create_backlog_task(payload: BacklogCreateRequest):
    subject = payload.subject.strip()
    if not subject:
        raise HTTPException(status_code=400, detail="Subject cannot be empty")
    priority = payload.priority or 'רגיל'
    task = await _add_backlog_task(subject, priority, payload.attachments)
    return {
        'success': True,
        'task': _task_to_response(task)
    }


@app.put("/backlog/{task_id}")
async def update_backlog_task(task_id: str, payload: BacklogUpdateRequest):
    updated = await _update_backlog_task(task_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        'success': True,
        'task': _task_to_response(updated)
    }


@app.delete("/backlog/{task_id}")
async def delete_backlog_task(task_id: str):
    if not await _delete_backlog_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {'success': True}


@app.post("/backlog/{task_id}/execute")
async def execute_backlog_task(task_id: str, payload: BacklogExecuteRequest = BacklogExecuteRequest()):
    note = (payload.note or '').strip()
    async with backlog_lock:
        data = _load_backlog_data()
        tasks = data.get('tasks', [])
        for index, raw in enumerate(tasks):
            if raw.get('id') == task_id:
                now = datetime.utcnow()
                raw['status'] = 'in_progress'
                raw['updated_at'] = now.isoformat()
                raw['last_executed_at'] = now.isoformat()
                execution_log = raw.get('execution_log')
                if not isinstance(execution_log, list):
                    execution_log = []
                execution_log.append({
                    'timestamp': now.isoformat(),
                    'note': note or 'הופעל ידנית מתוך מסך הבקלוג'
                })
                raw['execution_log'] = execution_log[-50:]  # Keep last 50 entries
                tasks[index] = raw
                _save_backlog_data(data)
                task = _task_from_raw(raw)
                add_operation_with_notification(
                    "backlog_task",
                    9,
                    {
                        "task_id": task_id,
                        "subject": raw.get('subject'),
                        "note": note or 'Triggered from backlog UI'
                    }
                )
                process_next_operation()
                return {
                    'success': True,
                    'task': _task_to_response(task)
                }
    raise HTTPException(status_code=404, detail="Task not found")


@app.post("/backlog/questions")
async def add_backlog_question(payload: BacklogQuestionRequest):
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    entry = await _add_backlog_question(content)
    return {
        'success': True,
        'entry': entry
    }


# Removed get_chat_members endpoint - not essential for core functionality

@app.post("/accounts/{account_id}/scan")
async def scan_account(account_id: str, data: ScanRequest, background_tasks: BackgroundTasks):
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
        # Set initial status to scanning
        progress = deleter.checkpoint_manager.get_progress()
        progress['status'] = 'scanning'
        deleter.checkpoint_manager.save_checkpoints()
        
        # Start scan in background
        async def run_scan_background():
            try:
                logger.info(f"🔍 Running scan in background for account {account_id}")
                logger.info(f"🔍 Scan filters: full_scan={filters.full_scan}, batch_size={filters.batch_size}")
                
                # Verify client is ready before starting
                if not deleter.client:
                    logger.warning(f"⚠️ Client not initialized for {account_id}, attempting to connect...")
                    await deleter.safe_client_connect()
                
                if not await deleter.client.is_user_authorized():
                    logger.error(f"❌ Account {account_id} is not authenticated")
                    progress = deleter.checkpoint_manager.get_progress()
                    progress['status'] = 'error'
                    progress['error'] = 'Account not authenticated'
                    deleter.checkpoint_manager.save_checkpoints()
                    return
                
                logger.info(f"✅ Starting scan for authenticated account {account_id}")
                result = await deleter.scan(filters)
                logger.info(f"✅ Scan completed for account {account_id}: {result.total_chats_processed} chats processed")
                
                # Save scan results
                progress = deleter.checkpoint_manager.get_progress()
                progress['last_scan_result'] = {
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
                progress['status'] = 'completed'
                deleter.checkpoint_manager.save_checkpoints()
                logger.info(f"Scan completed for account {account_id}")
            except Exception as scan_error:
                error_type = type(scan_error).__name__
                error_msg = str(scan_error)
                logger.error(f"❌ Error in background scan for {account_id}: {error_type}: {error_msg}", exc_info=True)
                progress = deleter.checkpoint_manager.get_progress()
                progress['status'] = 'error'
                progress['error'] = f"{error_type}: {error_msg}"
                deleter.checkpoint_manager.save_checkpoints()
                # Also update status via deleter
                if hasattr(deleter, 'update_status'):
                    deleter.update_status(f"Scan failed: {error_type}: {error_msg}", {
                        'type': 'error',
                        'error': f"{error_type}: {error_msg}",
                        'error_type': error_type
                    })
        
        # Run scan in background task using asyncio.create_task
        # This ensures the async function runs properly in the background
        asyncio.create_task(run_scan_background())
        
        return {
            "success": True,
            "message": "Scan started successfully. Use /scan-status or /scan-events to track progress.",
            "scanning": True
        }
    except Exception as e:
        logger.error(f"Error starting scan for account {account_id}: {str(e)}", exc_info=True)
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


@app.post("/accounts/{account_id}/stop-scan")
async def stop_scan(account_id: str):
    """Stop the current scan, clear saved state, and pause global scanning"""
    try:
        logger.info(f"Stopping scan for account {account_id}")
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        if hasattr(deleter, 'pause_scan'):
            try:
                deleter.pause_scan()
            except Exception as pause_error:
                logger.warning(f"Failed to pause scan via deleter for {account_id}: {pause_error}")

        pause_scanning()
        clear_scan_state(account_id)

        return {
            "success": True,
            "message": "Scan stopped successfully"
        }
    except Exception as error:
        logger.error(f"Error stopping scan for {account_id}: {error}")
        return {"success": False, "error": str(error)}

@app.post("/accounts/{account_id}/delete-all-found-messages")
async def delete_all_found_messages(account_id: str):
    """מחיקת כל ההודעות שנמצאו בכל הקבוצות"""
    try:
        logger.info(f"Deleting all found messages for account {account_id}")
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        store = getattr(deleter, "found_messages_store", None)
        if not store:
            return {"success": False, "error": "Found messages store not initialised"}

        total_deleted = 0
        total_failed = 0
        deleted_chats = []
        errors: list[str] = []
        failed_messages: list[dict[str, Any]] = []
        chat_results: list[dict[str, Any]] = []

        # Build target list from store
        for chat_id_str, keys in list(store.chat_index.items()):
            chat_id = int(chat_id_str)
            message_ids = [store.messages[key].message_id for key in keys if not store.messages[key].deleted]
            if not message_ids:
                continue
            chat_title = store.messages[keys[0]].chat_title if keys else chat_id_str
            logger.info(f"Attempting to delete {len(message_ids)} messages from chat {chat_id}")
            try:
                result = await deleter.delete_messages(chat_id, message_ids, True)
                if result.get("success"):
                    deleted_count = result.get("deleted_count", 0)
                    failed_count = result.get("failed_count", 0)
                    store_summary = store.apply_delete_results(chat_id, result.get("results", []))
                    total_deleted += store_summary.get("deleted", deleted_count)
                    total_failed += store_summary.get("failed", failed_count)
                    failed_messages.extend(store_summary.get("failed_messages", []))
                    if store_summary.get("deleted"):
                        deleter.checkpoint_manager.increment_group_deleted(str(chat_id), store_summary.get("deleted"))
                        deleted_chats.append({
                            "chat_id": chat_id,
                            "chat_title": chat_title,
                            "deleted_count": store_summary.get("deleted", 0),
                            "failed_count": store_summary.get("failed", 0)
                        })
                    if store_summary.get("failed"):
                        errors.append(f"Failed to delete {store_summary.get('failed')} messages in {chat_title}")
                    remaining_summary = store.get_summary_for_chat(chat_id)
                    chat_results.append({
                        "chat_id": chat_id,
                        "chat_title": chat_title,
                        "results": result.get("results", []),
                        "summary": store_summary,
                        "remaining": remaining_summary.get("total", 0)
                    })
                else:
                    errors.append(result.get("error") or f"Unknown error deleting messages in {chat_title}")
            except Exception as exc:
                logger.error(f"Error deleting found messages in {chat_title}: {exc}")
                errors.append(str(exc))

        return {
            "success": True,
            "total_deleted": total_deleted,
            "total_failed": total_failed,
            "deleted_chats": deleted_chats,
            "chat_results": chat_results,
            "failed_messages": failed_messages,
            "errors": errors,
            "message": f"Deleted {total_deleted} messages from {len(deleted_chats)} chats"
        }

    except Exception as e:
        logger.error(f"Error deleting all found messages for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}


@app.post("/accounts/{account_id}/groups/{chat_id}/found-messages/delete")
async def delete_found_messages_for_chat(account_id: str, chat_id: int):
    """Delete all found messages for a specific chat."""
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        store = getattr(deleter, "found_messages_store", None)
        if not store:
            return {"success": False, "error": "Found messages store not initialised"}

        message_ids = [
            store.messages[key].message_id
            for key in store.chat_index.get(str(chat_id), [])
            if key in store.messages and not store.messages[key].deleted
        ]

        if not message_ids:
            return {
                "success": True,
                "message": "No messages to delete",
                "summary": {"deleted": 0, "failed": 0, "failed_messages": []},
                "results": [],
                "remaining": 0
            }

        result = await deleter.delete_messages(chat_id, message_ids, True)
        if not result.get("success"):
            return {"success": False, "error": result.get("error", "Delete failed"), "results": result.get("results", [])}

        store_summary = store.apply_delete_results(chat_id, result.get("results", []))
        if store_summary.get("deleted"):
            deleter.checkpoint_manager.increment_group_deleted(str(chat_id), store_summary.get("deleted", 0))

        remaining = store.get_summary_for_chat(chat_id).get("total", 0)

        return {
            "success": True,
            "message": f"Deleted {store_summary.get('deleted', 0)} messages from chat {chat_id}",
            "summary": store_summary,
            "results": result.get("results", []),
            "remaining": remaining
        }

    except Exception as exc:
        logger.error(f"Error deleting found messages for account {account_id} chat {chat_id}: {exc}")
        return {"success": False, "error": str(exc)}

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
    operation = add_operation_with_notification("send_batch_message", 9, {
        "account_id": account_id,
        "chat_count": len(data.chat_ids),
        "dry_run": data.dry_run
    })
    try:
        logger.info(f"Sending batch message to {len(data.chat_ids)} chats for account {account_id}")
        
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        if is_scanning and hasattr(deleter, 'get_scan_state'):
            try:
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
            except Exception as state_error:
                logger.warning(f"Failed to save scan state before sending batch message: {state_error}")
        pause_scanning()
        
        result = await deleter.send_batch_message(
            message=data.message,
            chat_ids=data.chat_ids,
            delay_seconds=data.delay_seconds,
            dry_run=data.dry_run,
            force_chat_ids=data.force_chat_ids
        )

        # Persist analytics for sent messages
        if not data.dry_run:
            checkpoint_manager = deleter.checkpoint_manager
            for entry in result.get('results', []):
                chat_id = entry.get('chat_id')
                if chat_id is None:
                    continue
                if entry.get('status') == 'sent':
                    checkpoint_manager.increment_group_sent(str(chat_id))
                    checkpoint_manager.mark_group_status(str(chat_id), 'active', {
                        'last_post_at': datetime.utcnow().isoformat()
                    })
        
        return {
            "success": True,
            "message": f"Successfully sent message to {result['sent_count']} chats",
            "sent_count": result['sent_count'],
            "failed_count": result['failed_count'],
            "skipped_count": result.get('skipped_count', 0),
            "results": result['results']
        }
    except Exception as e:
        logger.error(f"Error sending batch message for account {account_id}: {str(e)}")
        return {"success": False, "error": str(e)}
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()


@app.post("/accounts/{account_id}/send-direct-message")
async def send_direct_message(account_id: str, payload: DirectMessageRequest):
    """Send a message directly to users by username, phone number, or user ID."""
    operation = add_operation_with_notification("send_direct_message", 9, {
        "account_id": account_id,
        "target_count": len(payload.targets),
        "dry_run": payload.dry_run
    })
    try:
        if not payload.targets:
            return {"success": False, "error": "לא נבחרו נמענים לשליחה"}

        seen_targets = set()
        targets: List[str] = []
        for raw in payload.targets:
            cleaned = (raw or '').strip()
            if not cleaned:
                continue
            key = cleaned.lower()
            if key not in seen_targets:
                seen_targets.add(key)
                targets.append(cleaned)

        if not targets:
            return {"success": False, "error": "לא נמצאו נמענים תקינים לשליחה"}

        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        if is_scanning and hasattr(deleter, 'get_scan_state'):
            try:
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
            except Exception as state_error:
                logger.warning(f"Failed to save scan state before direct messaging: {state_error}")
        pause_scanning()

        client = await _ensure_client_ready(deleter)
        if not client:
            return {"success": False, "error": "Failed to initialize Telegram client"}

        if not await client.is_user_authorized():
            return {"success": False, "error": "Account is not authenticated with Telegram"}

        user_index = await _build_known_user_index(client)

        results = []
        sent_count = 0
        failed_count = 0

        for idx, raw_target in enumerate(targets):
            resolved_entity, meta, _cleanup = await _resolve_direct_target(client, user_index, raw_target)
            started_at = datetime.utcnow()
            result_entry = {
                'input': meta.get('input', raw_target),
                'timestamp': started_at.isoformat(),
                'matched_by': meta.get('matched_by'),
                'display_name': meta.get('display_name') or meta.get('input', raw_target)
            }

            if resolved_entity is None:
                result_entry['status'] = 'failed'
                result_entry['error'] = meta.get('error', 'הנמען לא נמצא')
                failed_count += 1
                results.append(result_entry)
                continue

            result_entry['user_id'] = resolved_entity.id
            result_entry['username'] = getattr(resolved_entity, 'username', None)
            result_entry['phone'] = getattr(resolved_entity, 'phone', None)

            try:
                if payload.dry_run:
                    result_entry['status'] = 'dry_run'
                    result_entry['message'] = 'Message would be sent (dry run)'
                    sent_count += 1
                else:
                    await client.send_message(resolved_entity, payload.message)
                    finished_at = datetime.utcnow()
                    result_entry['status'] = 'sent'
                    result_entry['timestamp'] = finished_at.isoformat()
                    result_entry['duration_ms'] = int((finished_at - started_at).total_seconds() * 1000)
                    sent_count += 1

                    if payload.delay_seconds and idx < len(targets) - 1:
                        await asyncio.sleep(max(0, min(payload.delay_seconds, 60)))

            except Exception as error:
                logger.error(f"Error sending direct message to {raw_target}: {error}")
                result_entry['status'] = 'failed'
                result_entry['error'] = str(error)
                failed_count += 1

            results.append(result_entry)

        return {
            'success': True,
            'sent_count': sent_count,
            'failed_count': failed_count,
            'results': results,
            'total_targets': len(targets)
        }

    except Exception as error:
        logger.error(f"Error sending direct message for account {account_id}: {error}")
        return {"success": False, "error": str(error)}
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()


@app.post("/accounts/{account_id}/resolve-direct-target")
async def resolve_direct_target(account_id: str, payload: DirectTargetRequest):
    """Resolve a single direct messaging target without sending a message."""
    try:
        target_value = (payload.target or '').strip()
        if not target_value:
            return {"success": False, "error": "נמען ריק"}

        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        client = await _ensure_client_ready(deleter)
        if not client:
            return {"success": False, "error": "Failed to initialize Telegram client"}

        if not await client.is_user_authorized():
            return {"success": False, "error": "Account is not authenticated with Telegram"}

        entity, meta, _imported = await _resolve_direct_target(client, None, target_value)

        if not entity:
            return {"success": False, "error": meta.get('error', 'הנמען לא נמצא או אינו זמין')}

        return {
            "success": True,
            "result": {
                "user_id": getattr(entity, 'id', None),
                "username": getattr(entity, 'username', None),
                "phone": getattr(entity, 'phone', None),
                "display_name": _format_user_display(entity),
                "matched_by": meta.get('matched_by')
            }
        }

    except Exception as error:
        logger.error(f"Error resolving direct target for account {account_id}: {error}")
        return {"success": False, "error": str(error)}

@app.post("/accounts/{account_id}/contacts-export")
async def export_contacts(account_id: str, payload: dict):
    """Export contacts with date range filtering."""
    try:
        start_date = payload.get('start_date')
        end_date = payload.get('end_date')
        
        if not start_date or not end_date:
            return {"success": False, "error": "תאריכי התחלה וסיום נדרשים"}
        
        # Validate date range (max 2 years)
        from datetime import datetime, timedelta
        start_dt = datetime.fromisoformat(start_date)
        end_dt = datetime.fromisoformat(end_date)
        max_range = timedelta(days=730)  # 2 years
        
        if end_dt - start_dt > max_range:
            return {"success": False, "error": "טווח התאריכים לא יכול להיות יותר מ-2 שנים"}
        
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        client = await _ensure_client_ready(deleter)
        if not client:
            return {"success": False, "error": "Failed to initialize Telegram client"}

        if not await client.is_user_authorized():
            return {"success": False, "error": "Account is not authenticated with Telegram"}

        # Get contacts from Telegram
        contacts = []
        try:
            # Get all dialogs (chats and users)
            dialogs = await client.get_dialogs()
            
            for dialog in dialogs:
                entity = dialog.entity
                if hasattr(entity, 'id') and hasattr(entity, 'first_name'):
                    # This is a user contact
                    contact_data = {
                        'user_id': entity.id,
                        'username': getattr(entity, 'username', None),
                        'first_name': getattr(entity, 'first_name', ''),
                        'last_name': getattr(entity, 'last_name', ''),
                        'phone': getattr(entity, 'phone', None),
                        'display_name': f"{getattr(entity, 'first_name', '')} {getattr(entity, 'last_name', '')}".strip(),
                        'last_message_date': dialog.date.isoformat() if dialog.date else None,
                        'first_message_date': None  # Will be populated when chat history is loaded
                    }
                    contacts.append(contact_data)
        except Exception as e:
            logger.error(f"Error fetching contacts for account {account_id}: {e}")
            return {"success": False, "error": f"שגיאה בקבלת אנשי הקשר: {str(e)}"}

        return {
            "success": True,
            "contacts": contacts,
            "total_contacts": len(contacts),
            "date_range": {
                "start": start_date,
                "end": end_date
            }
        }

    except Exception as error:
        logger.error(f"Error exporting contacts for account {account_id}: {error}")
        return {"success": False, "error": str(error)}


@app.get("/accounts/{account_id}/mentions")
async def get_account_mentions(account_id: str, days: int = 1):
    """Fetch mentions of the authenticated user within the chosen day window."""
    safe_days = max(1, min(days, 14))
    operation = add_operation_with_notification("mentions_lookup", 9, {
        "account_id": account_id,
        "days": safe_days
    })
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        if is_scanning and hasattr(deleter, 'get_scan_state'):
            try:
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
            except Exception as state_error:
                logger.warning(f"Failed to save scan state before mentions lookup: {state_error}")
        pause_scanning()

        client = await _ensure_client_ready(deleter)
        if not client:
            return {"success": False, "error": "Failed to initialize Telegram client"}
        if not await client.is_user_authorized():
            return {"success": False, "error": "Account is not authenticated with Telegram"}

        mentions = await deleter.get_user_mentions(safe_days)
        return {
            "success": True,
            "days": safe_days,
            "count": len(mentions),
            "mentions": mentions
        }
    except Exception as error:
        logger.error(f"Error collecting mentions for account {account_id}: {error}")
        return {"success": False, "error": str(error)}
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()

@app.post("/accounts/{account_id}/mentions/reply")
async def reply_to_mention(account_id: str, payload: MentionReplyRequest):
    """Send a private reply to a user that mentioned us."""
    operation = add_operation_with_notification("mention_reply", 9, {
        "account_id": account_id,
        "mention_id": payload.mention_id
    })
    try:
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}

        if is_scanning and hasattr(deleter, 'get_scan_state'):
            try:
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
            except Exception as state_error:
                logger.warning(f"Failed to save scan state before replying to mention: {state_error}")
        pause_scanning()

        client = await _ensure_client_ready(deleter)
        if not client:
            return {"success": False, "error": "Failed to initialize Telegram client"}
        if not await client.is_user_authorized():
            return {"success": False, "error": "Account is not authenticated with Telegram"}

        result = await deleter.send_mention_reply(payload.model_dump())
        return result
    except Exception as error:
        logger.error(f"Error sending mention reply for account {account_id}: {error}")
        return {"success": False, "error": str(error)}
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()

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
            if hasattr(deleter, 'add_status_callback'):
                deleter.add_status_callback(status_callback)
            
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
                        elif update['data'].get('type') == 'message_send_status':
                            # Message send status - forward to frontend
                            yield f"data: {json.dumps(event_data)}\n\n"
                        else:
                            # Generic status update
                            yield f"data: {json.dumps(event_data)}\n\n"
                        
                        last_status = update['data'].get('type')
                        
                    except asyncio.TimeoutError:
                        # No update available, check progress state and send periodic updates
                        progress = deleter.checkpoint_manager.get_progress()
                        status = progress.get('status', 'idle')
                        
                        # Send periodic progress updates even when no callback events
                        if status == 'scanning':
                            # Send scan_progress update with current state
                            scan_progress_data = {
                                'type': 'scan_progress',
                                'status': status,
                                'current_chat': progress.get('current_chat', ''),
                                'current_chat_id': progress.get('current_chat_id', 0),
                                'chat_id': progress.get('chat_id', 0),
                                'current_index': progress.get('current_index', 0),
                                'total_chats': progress.get('total_chats', 0),
                                'total': progress.get('total_chats', 0),
                                'progress_percent': progress.get('progress_percent', 0),
                                'messages_found': progress.get('messages_found', 0),
                                'scanned_chats': progress.get('scanned_chats', [])
                            }
                            yield f"data: {json.dumps(scan_progress_data)}\n\n"
                        
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
            if deleter and hasattr(deleter, 'remove_status_callback'):
                deleter.remove_status_callback(status_callback)
    
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
    operation = add_operation_with_notification("semantic_scan", 8, {
        "account_id": account_id,
        "query": query
    })
    try:
        # Lazy import to avoid loading heavy modules on startup
        from app.semantic_search_models import SemanticSearchQuery, SemanticSearchResponse
        from app.semantic_search_engine import semantic_engine
        
        search_query = SemanticSearchQuery(**query)
        logger.info(f"Starting semantic search for account {account_id}: {search_query.query_text}")
        
        # Get deleter instance for this account
        deleter = get_deleter_for_account(account_id)
        if not deleter:
            return {"success": False, "error": "Account not found"}
        
        if is_scanning and hasattr(deleter, 'get_scan_state'):
            try:
                scan_state = deleter.get_scan_state()
                save_scan_state(account_id, scan_state)
            except Exception as state_error:
                logger.warning(f"Failed to save scan state before semantic scan: {state_error}")
        pause_scanning()
        
        if not search_query.query_text.strip():
            return {"success": False, "error": "Query text cannot be empty"}
        
        import time
        start_time = time.time()
        
        cache_key = f"semantic_cache_{account_id}_{search_query.time_frame_hours}_{','.join(search_query.groups_to_scan or ['all'])}_{search_query.folder_id}".replace(' ', '_')
        cached_messages = deleter.semantic_cache.get(cache_key) if hasattr(deleter, 'semantic_cache') else None

        if cached_messages is not None:
            messages = cached_messages
            logger.info(f"Using cached semantic messages: {len(messages)} items")
        else:
            messages = []
            target_dialogs = await deleter.get_folder_dialogs(search_query.folder_id)

            for dialog in target_dialogs:
                dialog_id = getattr(dialog, 'id', None)
                if not dialog_id:
                    continue

                if search_query.groups_to_scan and str(dialog_id) not in search_query.groups_to_scan:
                    continue

                try:
                    chat_messages = await deleter.get_messages_from_dialog(dialog, search_query.time_frame_hours, include_all_users=True)
                    messages.extend(chat_messages)
                except Exception as e:
                    deleter.log(f"Semantic search: error retrieving messages from {dialog.name}: {e}")
                    continue

            if not hasattr(deleter, 'semantic_cache'):
                deleter.semantic_cache = {}
            deleter.semantic_cache[cache_key] = messages
            logger.info(f"Cached {len(messages)} semantic messages for key {cache_key}")
        
        logger.info(f"Retrieved {len(messages)} messages for semantic search")
        
        results = await semantic_engine.search_messages(search_query, messages)
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
    finally:
        try:
            operation_queue.remove(operation)
        except ValueError:
            pass
        complete_operation()

@app.get("/accounts/{account_id}/semantic-scan-events")
async def semantic_scan_events(
    account_id: str,
    query_text: str,
    fidelity: str = "semantic",
    time_frame_hours: int = 24,
    folder_id: Optional[int] = None,
    groups_to_scan: Optional[str] = None
):
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
            
            # Clamp time frame between 1 and 72 hours
            try:
                requested_window = int(time_frame_hours)
            except ValueError:
                requested_window = 24
            safe_window = max(1, min(requested_window, 72))

            # Parse requested groups list if provided
            group_identifiers = []
            if groups_to_scan:
                try:
                    group_identifiers = [item.strip() for item in groups_to_scan.split(',') if item.strip()]
                except Exception:
                    group_identifiers = []

            # Create query object
            query = SemanticSearchQuery(
                query_text=query_text,
                fidelity=fidelity,
                time_frame_hours=safe_window,
                account_id=account_id,
                folder_id=folder_id,
                groups_to_scan=group_identifiers
            )
            
            # Send search started
            yield f"data: {json.dumps({'type': 'search_started', 'message': f'Starting semantic search: {query_text}'})}\n\n"
            
            # Get messages from already scanned data
            yield f"data: {json.dumps({'type': 'retrieving_messages', 'message': 'Retrieving messages from scanned data...'})}\n\n"
            
            # Get messages from checkpoint manager (already scanned data)
            target_dialogs = await deleter.get_folder_dialogs(query.folder_id)

            messages = []
            allowed_dialogs = set(query.groups_to_scan or [])
            for dialog in target_dialogs:
                dialog_id = getattr(dialog, 'id', None)
                if not dialog_id:
                    continue

                if allowed_dialogs and str(dialog_id) not in allowed_dialogs:
                    continue

                try:
                    chat_messages = await deleter.get_messages_from_dialog(dialog, query.time_frame_hours, include_all_users=True)
                    for message in chat_messages:
                        messages.append({
                            'id': message.get('id'),
                            'text': message.get('text', ''),
                            'chat_id': dialog_id,
                            'chat_name': message.get('chat_name') or getattr(dialog, 'title', 'Unknown'),
                            'date': message.get('date').isoformat() if hasattr(message.get('date'), 'isoformat') else message.get('date', ''),
                            'sender_id': message.get('sender_id')
                        })
                except Exception as e:
                    deleter.log(f"Semantic SSE: error retrieving messages from dialog {dialog_id}: {e}")
                    continue
            
            yield f"data: {json.dumps({'type': 'messages_retrieved', 'count': len(messages), 'message': f'Retrieved {len(messages)} messages from scanned data'})}\n\n"

            # Group messages by chat for better visibility
            messages_by_chat: Dict[int, List[dict]] = {}
            chat_names: Dict[int, str] = {}
            for message in messages:
                chat_id = message.get('chat_id')
                if chat_id is None:
                    continue
                messages_by_chat.setdefault(chat_id, []).append(message)
                chat_names[chat_id] = message.get('chat_name', 'Unknown')

            # Notify UI which groups are being processed
            group_summary = [
                {
                    'chat_id': chat_id,
                    'chat_name': chat_names.get(chat_id, 'Unknown'),
                    'messages': len(chat_messages)
                }
                for chat_id, chat_messages in messages_by_chat.items()
            ]
            if group_summary:
                yield f"data: {json.dumps({'type': 'search_groups', 'groups': group_summary})}\n\n"

            # Perform semantic search with progress updates
            results = []
            total_messages = len(messages)
            processed_messages = 0
            top_candidates: List[dict] = []

            for chat_index, (chat_id, chat_messages) in enumerate(messages_by_chat.items()):
                chat_name = chat_names.get(chat_id, f"Chat {chat_id}")
                yield f"data: {json.dumps({'type': 'group_progress', 'chat_id': chat_id, 'chat_name': chat_name, 'status': 'started', 'index': chat_index + 1, 'total_groups': len(messages_by_chat)})}\n\n"

                matches_in_group = 0

                for message in chat_messages:
                    processed_messages += 1
                    if processed_messages % 50 == 0:
                        progress_percent = (processed_messages / total_messages) * 100 if total_messages else 100
                        yield f"data: {json.dumps({'type': 'search_progress', 'progress': progress_percent, 'processed': processed_messages, 'total': total_messages, 'matches': len(results)})}\n\n"

                    similarity, keywords = semantic_engine.calculate_similarity(
                        query.query_text,
                        message.get('text', '')
                    )

                    threshold = semantic_engine.get_fidelity_threshold(query.fidelity)
                    if similarity >= threshold:
                        preview_text = message.get('text', '')
                        message_preview = {
                            'type': 'message_preview',
                            'content': preview_text[:100] + ('...' if len(preview_text) > 100 else ''),
                            'chat_name': chat_name,
                            'similarity': f"{similarity:.2f}",
                            'keywords': ', '.join(keywords[:3]) if keywords else ''
                        }
                        yield f"data: {json.dumps(message_preview)}\n\n"
                        result = {
                            'message_id': message.get('id', 0),
                            'chat_id': chat_id,
                            'chat_name': chat_name,
                            'message_text': preview_text,
                            'similarity_score': similarity,
                            'matched_keywords': keywords
                        }
                        results.append(result)
                        matches_in_group += 1

                        yield f"data: {json.dumps({'type': 'match_found', 'result': result, 'message_preview': message_preview})}\n\n"
                    else:
                        preview_text = message.get('text', '')
                        candidate = {
                            'message_id': message.get('id', 0),
                            'chat_id': chat_id,
                            'chat_name': chat_name,
                            'message_text': preview_text,
                            'timestamp': message.get('date', ''),
                            'similarity_score': float(similarity),
                            'matched_keywords': keywords
                        }
                        top_candidates.append(candidate)
                        top_candidates = sorted(top_candidates, key=lambda item: item['similarity_score'], reverse=True)[:3]

                yield f"data: {json.dumps({'type': 'group_progress', 'chat_id': chat_id, 'chat_name': chat_name, 'status': 'completed', 'matches': matches_in_group, 'processed_messages': processed_messages})}\n\n"

            # Send completion
            yield f"data: {json.dumps({'type': 'search_complete', 'total_matches': len(results), 'total_processed': total_messages})}\n\n"

            if len(results) == 0 and top_candidates:
                yield f"data: {json.dumps({'type': 'suggestions', 'suggestions': top_candidates})}\n\n"
            
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
    uvicorn.run(app, host="0.0.0.0", port=8001)
