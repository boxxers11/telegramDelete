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
    accounts_data = []
    for account in account_store.get_all_accounts():
        # Quick check if session file exists
        session_exists = os.path.exists(f"{account.session_path}.session")
        accounts_data.append({
            "id": account.id,
            "label": account.label,
            "phone": account.phone,
            "api_id": account.api_id,
            "api_hash": account.api_hash,
            "is_authenticated": session_exists,  # Basic check
            "username": None
        })
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
