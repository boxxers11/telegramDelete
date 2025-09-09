import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date
from typing import Optional, List
from fastapi import FastAPI, Request, Form, HTTPException
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import uvicorn
import logging
from .telegram_delete import TelegramDeleter, Filters
from .accounts import account_store, Account
from .telegram_client_factory import get_deleter_for_account
import re

# Semaphore to prevent concurrent database access
_account_status_lock = asyncio.Semaphore(1)

# Define request models
class DeleteSelectedRequest(BaseModel):
    message_ids: List[int]

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
    api_id: int
    api_hash: str

class SmartSearchRequest(BaseModel):
    prompt: str
    limit: Optional[int] = 100

class OperationRequest(BaseModel):
    include_private: bool = False
    chat_name_filters: str = ""
    after: Optional[str] = None
    before: Optional[str] = None
    limit_per_chat: Optional[int] = None
    revoke: bool = True
    dry_run: bool = True
    test_mode: bool = False

class MultiAccountOperationRequest(BaseModel):
    include_private: bool = False
    chat_name_filters: str = ""
    after: Optional[str] = None
    before: Optional[str] = None
    limit_per_chat: Optional[int] = None
    revoke: bool = True
    test_mode: bool = False

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app and middleware
app = FastAPI(title="Telegram Message Manager")

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Templates and static files
templates = Jinja2Templates(directory="app/templates")
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Initialize telegram deleter instance
deleter: Optional[TelegramDeleter] = None

async def _check_account_status(account: Account) -> dict:
    """Check authentication status for a single account"""
    async with _account_status_lock:
        try:
            account_deleter = get_deleter_for_account(account.id)
            if not account_deleter:
                return {
                    "id": account.id,
                    "label": account.label,
                    "phone": account.phone,
                    "api_id": account.api_id,
                    "api_hash": account.api_hash,
                    "is_authenticated": False,
                    "username": None
                }
            
            try:
                await account_deleter.safe_client_connect()
                if await account_deleter.client.is_user_authorized():
                    me = await account_deleter.client.get_me()
                    username = me.username or me.first_name
                    return {
                        "id": account.id,
                        "label": account.label,
                        "phone": account.phone,
                        "api_id": account.api_id,
                        "api_hash": account.api_hash,
                        "is_authenticated": True,
                        "username": username
                    }
                else:
                    return {
                        "id": account.id,
                        "label": account.label,
                        "phone": account.phone,
                        "api_id": account.api_id,
                        "api_hash": account.api_hash,
                        "is_authenticated": False,
                        "username": None
                    }
            finally:
                if account_deleter.client:
                    await account_deleter.client.disconnect()
        except Exception as e:
            logger.error(f"Error checking status for account {account.id}: {e}")
            return {
                "id": account.id,
                "label": account.label,
                "phone": account.phone,
                "api_id": account.api_id,
                "api_hash": account.api_hash,
                "is_authenticated": False,
                "username": None
            }

# Routes
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    auth_status = None
    if deleter and deleter.client:
        try:
            if await deleter.client.is_user_authorized():
                me = await deleter.client.get_me()
                auth_status = f"@{me.username or me.first_name}"
        except:
            pass
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "auth_status": auth_status, "accounts": account_store.get_all_accounts()}
    )

@app.get("/accounts")
async def get_accounts():
    """Get all accounts with basic authentication status"""
    logger.info("GET /accounts called")
    
    all_accounts = account_store.get_all_accounts()
    if not all_accounts:
        logger.info("No accounts found")
        return []
    
    try:
        # Check authentication status for all accounts concurrently
        accounts_data = await asyncio.gather(*[_check_account_status(account) for account in all_accounts])
    except Exception as e:
        logger.error(f"Error checking account statuses: {e}")
        # Fallback to basic account data without authentication status
        accounts_data = [{
            "id": account.id,
            "label": account.label,
            "phone": account.phone,
            "api_id": account.api_id,
            "api_hash": account.api_hash,
            "is_authenticated": False,
            "username": None
        } for account in all_accounts]
    
    logger.info(f"Returning {len(accounts_data)} accounts")
    return accounts_data

@app.post("/accounts")
async def create_account(data: CreateAccountRequest):
    try:
        account = account_store.create_account(
            label=data.label,
            api_id=data.api_id,
            api_hash=data.api_hash,
            phone=data.phone,
        )
        logger.info(f"Account created with id {account.id}")
        return {"success": True, "account_id": account.id}
    except Exception as e:
        logger.error(f"Error creating account: {e}")
        return {"success": False, "error": str(e)}

@app.delete("/accounts/{account_id}")
async def delete_account(account_id: str):
    success = account_store.delete_account(account_id)
    if success:
        return {"success": True}
    else:
        return {"success": False, "error": "Account not found"}

@app.post("/accounts/{account_id}/connect")
async def connect_account(account_id: str, data: ConnectAccountRequest):
    account_deleter = get_deleter_for_account(account_id)
    if not account_deleter:
        return {"success": False, "error": "Account not found"}
    
    try:
        account = account_store.get_account(account_id)
        if not account:
            return {"success": False, "error": "Account not found"}
        
        # If code provided, try to sign in with code and phone_code_hash
        if data.code and data.phone_code_hash:
            logger.info(f"Attempting sign in with code for account {account_id}")
            sign_in_result = await account_deleter.sign_in_with_code(
                phone=account.phone,
                code=data.code,
                phone_code_hash=data.phone_code_hash,
                password=data.password
            )
            logger.info(f"Sign in result: {sign_in_result}")
            return sign_in_result
        else:
            # No code provided, send verification code and return phone_code_hash
            logger.info(f"Sending verification code for account {account_id}")
            connect_result = await account_deleter.connect(account.phone)
            logger.info(f"Connect result: {connect_result}")
            # If code expired, we need to send a new one
            if connect_result.get('success') and connect_result.get('status') == 'CODE_SENT':
                logger.info(f"New verification code sent for account {account_id}")
            return connect_result
        
    except Exception as e:
        logger.error(f"Error connecting account {account_id}: {e}")
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/scan")
async def scan_account(account_id: str, data: OperationRequest):
    account_deleter = get_deleter_for_account(account_id)
    if not account_deleter:
        raise HTTPException(status_code=400, detail="Account not found")
    
    # Set up real-time status callback
    def status_callback(status: str, data: dict):
        logger.info(f"SCAN STATUS: {status}")
        # Here you could implement WebSocket or Server-Sent Events for real-time updates
    
    account_deleter.set_status_callback(status_callback)
    filters = _build_filters(data, dry_run=True)
    result = await account_deleter.scan(filters)
    return {
        "success": True,
        "result": {
            "chats": [{
                "id": c.id,
                "title": c.title,
                "type": c.type,
                "participants": c.participants_count,
                "candidates": c.candidates_found,
                "deleted": c.deleted,
                "error": c.error,
                "skipped_reason": c.skipped_reason
            } for c in result.chats],
            "summary": {
                "total_processed": result.total_chats_processed,
                "total_skipped": result.total_chats_skipped,
                "total_candidates": result.total_candidates,
                "total_deleted": result.total_deleted
            },
            "logs": result.logs
        }
    }

@app.post("/accounts/{account_id}/delete")
async def delete_messages(account_id: str, data: OperationRequest):
    account_deleter = get_deleter_for_account(account_id)
    if not account_deleter:
        raise HTTPException(status_code=400, detail="Account not found")
    filters = _build_filters(data, dry_run=False)
    result = await account_deleter.delete(filters)
    return {
        "success": True,
        "result": {
            "chats": [{
                "id": c.id,
                "title": c.title,
                "type": c.type,
                "participants": c.participants_count,
                "candidates": c.candidates_found,
                "deleted": c.deleted,
                "error": c.error,
                "skipped_reason": c.skipped_reason
            } for c in result.chats],
            "summary": {
                "total_processed": result.total_chats_processed,
                "total_skipped": result.total_chats_skipped,
                "total_candidates": result.total_candidates,
                "total_deleted": result.total_deleted
            },
            "logs": result.logs
        }
    }

@app.post("/accounts/{account_id}/smart-search")
async def smart_search_messages(account_id: str, data: SmartSearchRequest):
    account_deleter = get_deleter_for_account(account_id)
    if not account_deleter:
        raise HTTPException(status_code=400, detail="Account not found")
    
    try:
        # Simple keyword-based search for now (can be enhanced with AI later)
        keywords = extract_keywords_from_prompt(data.prompt)
        result = await account_deleter.smart_search(keywords, data.limit)
        
        return {
            "success": True,
            "prompt": data.prompt,
            "keywords": keywords,
            "messages": result.messages,
            "total_found": len(result.messages) if result.messages else 0,
            "logs": result.logs
        }
    except Exception as e:
        logger.error(f"Smart search failed for account {account_id}: {e}")
        return {"success": False, "error": str(e)}

def extract_keywords_from_prompt(prompt: str) -> List[str]:
    """Extract keywords from search prompt"""
    # Simple keyword extraction - can be enhanced with NLP
    prompt_lower = prompt.lower()
    
    # Common patterns for different search intents
    food_patterns = ['sweet', 'candy', 'chocolate', 'cake', 'dessert', 'sugar', 'treat', 'snack']
    emotion_patterns = ['sad', 'happy', 'angry', 'excited', 'depressed', 'anxious', 'worried']
    help_patterns = ['help', 'advice', 'support', 'assistance', 'guidance', 'recommend']
    
    keywords = []
    
    # Extract explicit keywords
    words = re.findall(r'\b\w+\b', prompt_lower)
    keywords.extend([word for word in words if len(word) > 3])
    
    # Add pattern-based keywords
    if any(pattern in prompt_lower for pattern in food_patterns):
        keywords.extend(food_patterns)
    if any(pattern in prompt_lower for pattern in emotion_patterns):
        keywords.extend(emotion_patterns)
    if any(pattern in prompt_lower for pattern in help_patterns):
        keywords.extend(help_patterns)
    
    return list(set(keywords))  # Remove duplicates

def _build_filters(data, dry_run=True):
    try:
        chat_filters = [f.strip() for f in data.chat_name_filters.split(",")] if data.chat_name_filters else []
        after = datetime.strptime(data.after, "%Y-%m-%d").date() if data.after else None
        before = datetime.strptime(data.before, "%Y-%m-%d").date() if data.before else None
    except Exception:
        after = None
        before = None
    return Filters(
        include_private=data.include_private,
        chat_name_filters=chat_filters,
        after=after,
        before=before,
        limit_per_chat=data.limit_per_chat,
        revoke=data.revoke,
        dry_run=dry_run,
        test_mode=data.test_mode,
    )

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
