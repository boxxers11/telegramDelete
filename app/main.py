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

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = FastAPI(title="Telegram Message Deleter")

# Add CORS middleware to allow frontend connections
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup templates and static files
templates = Jinja2Templates(directory="app/templates")
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Global deleter instance
deleter: Optional[TelegramDeleter] = None

# Account-related models
class CreateAccountRequest(BaseModel):
    label: str
    api_id: int
    api_hash: str
    phone: str

class ConnectAccountRequest(BaseModel):
    code: Optional[str] = None
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

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Main page"""
    auth_status = None
    if deleter and deleter.client:
        try:
            if await deleter.client.is_user_authorized():
                me = await deleter.client.get_me()
                username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
                auth_status = f"@{username}"
        except:
            pass
    
    return templates.TemplateResponse(
        "index.html", 
        {"request": request, "auth_status": auth_status, "accounts": account_store.get_all_accounts()}
    )

# Account management endpoints
@app.get("/accounts")
async def get_accounts():
    """Get all accounts with their authentication status"""
    accounts_data = []
    
    for account in account_store.get_all_accounts():
        account_deleter = get_deleter_for_account(account.id)
        is_authenticated = False
        username = None
        
        if account_deleter and account_deleter.client:
            try:
                await account_deleter.connect()
                if await account_deleter.client.is_user_authorized():
                    is_authenticated = True
                    me = await account_deleter.client.get_me()
                    username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            except Exception:
                pass
        
        accounts_data.append({
            "id": account.id,
            "label": account.label,
            "phone": account.phone,
            "is_authenticated": is_authenticated,
            "username": username
        })
    
    return accounts_data

@app.post("/accounts")
async def create_account(data: CreateAccountRequest):
    """Create a new account"""
    logger.info(f"Creating account: {data.label} - {data.phone}")
    try:
        account = account_store.create_account(
            label=data.label,
            api_id=data.api_id,
            api_hash=data.api_hash,
            phone=data.phone
        )
        logger.info(f"Account created successfully: {account.id}")
        return {"success": True, "account_id": account.id}
    except ValueError as e:
        logger.error(f"Validation error creating account: {e}")
        return {"success": False, "error": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error creating account: {e}")
        return {"success": False, "error": f"Failed to create account: {str(e)}"}

@app.delete("/accounts/{account_id}")
async def delete_account(account_id: str):
    """Delete an account"""
    success = account_store.delete_account(account_id)
    if success:
        return {"success": True}
    else:
        return {"success": False, "error": "Account not found"}

@app.post("/accounts/{account_id}/connect")
async def connect_account(account_id: str, data: ConnectAccountRequest):
    """Connect/authenticate an account"""
    account_deleter = get_deleter_for_account(account_id)
    if not account_deleter:
        return {"success": False, "error": "Account not found"}
    
    try:
        # Connect to Telegram
        await account_deleter.connect()
        
        # Check if already authenticated
        if await account_deleter.client.is_user_authorized():
            me = await account_deleter.client.get_me()
            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
            return {"success": True, "status": "OK", "username": username}
        
        # If no code provided, send code
        if not data.code:
            account = account_store.get_account(account_id)
            await account_deleter.client.send_code_request(account.phone)
            return {"success": True, "status": "CODE_SENT"}
        
        # Sign in with code (and optional password)
        account = account_store.get_account(account_id)
        await account_deleter.client.sign_in(
            phone=account.phone,
            code=data.code,
            password=data.password
        )
        
        me = await account_deleter.client.get_me()
        username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
        return {"success": True, "status": "OK", "username": username}
        
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/accounts/{account_id}/scan")
async def scan_account_messages(account_id: str, data: OperationRequest):
    """Scan messages for a specific account"""
    account_deleter = get_deleter_for_account(account_id)
    if not account_deleter:
        raise HTTPException(status_code=400, detail="Account not found")
    
    filters = _build_filters(data, dry_run=True)
    result = await account_deleter.scan(filters)
    
    return {
        "success": True,
        "result": {
            "chats": [
                {
                    "id": chat.id,
                    "title": chat.title,
                    "type": chat.type,
                    "participants_count": chat.participants_count,
                    "candidates_found": chat.candidates_found,
                    "deleted": chat.deleted,
                    "error": chat.error,
                    "skipped_reason": chat.skipped_reason
                }
                for chat in result.chats
            ],
            "summary": {
                "total_chats_processed": result.total_chats_processed,
                "total_chats_skipped": result.total_chats_skipped,
                "total_candidates": result.total_candidates,
                "total_deleted": result.total_deleted
            },
            "logs": result.logs
        }
    }

@app.post("/accounts/{account_id}/delete")
async def delete_account_messages(account_id: str, data: OperationRequest):
    """Delete messages for a specific account"""
    account_deleter = get_deleter_for_account(account_id)
    if not account_deleter:
        raise HTTPException(status_code=400, detail="Account not found")
    
    filters = _build_filters(data, dry_run=False)
    result = await account_deleter.delete(filters)
    
    return {
        "success": True,
        "result": {
            "chats": [
                {
                    "id": chat.id,
                    "title": chat.title,
                    "type": chat.type,
                    "participants_count": chat.participants_count,
                    "candidates_found": chat.candidates_found,
                    "deleted": chat.deleted,
                    "error": chat.error,
                    "skipped_reason": chat.skipped_reason
                }
                for chat in result.chats
            ],
            "summary": {
                "total_chats_processed": result.total_chats_processed,
                "total_chats_skipped": result.total_chats_skipped,
                "total_candidates": result.total_candidates,
                "total_deleted": result.total_deleted
            },
            "logs": result.logs
        }
    }

@app.post("/scan_all")
async def scan_all_accounts(data: MultiAccountOperationRequest):
    """Scan messages across all authenticated accounts"""
    accounts = account_store.get_all_accounts()
    if not accounts:
        return {"success": False, "error": "No accounts configured"}
    
    filters = _build_multi_account_filters(data, dry_run=True)
    
    # Use semaphore to limit concurrency
    semaphore = asyncio.Semaphore(2)
    
    async def scan_account(account):
        async with semaphore:
            account_deleter = get_deleter_for_account(account.id)
            if not account_deleter:
                return None
            
            try:
                await account_deleter.connect()
                if not await account_deleter.client.is_user_authorized():
                    return None
                
                me = await account_deleter.client.get_me()
                username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
                
                result = await account_deleter.scan(filters)
                return {
                    "account_id": account.id,
                    "username": username,
                    "data": {
                        "chats": [
                            {
                                "id": chat.id,
                                "title": chat.title,
                                "type": chat.type,
                                "participants_count": chat.participants_count,
                                "candidates_found": chat.candidates_found,
                                "deleted": chat.deleted,
                                "error": chat.error,
                                "skipped_reason": chat.skipped_reason
                            }
                            for chat in result.chats
                        ],
                        "summary": {
                            "total_chats_processed": result.total_chats_processed,
                            "total_chats_skipped": result.total_chats_skipped,
                            "total_candidates": result.total_candidates,
                            "total_deleted": result.total_deleted
                        },
                        "logs": result.logs
                    }
                }
            except Exception as e:
                return {
                    "account_id": account.id,
                    "error": str(e)
                }
    
    # Run scans concurrently
    results = await asyncio.gather(*[scan_account(account) for account in accounts])
    
    # Filter out None results and compile summary
    valid_results = [r for r in results if r and "data" in r]
    accounts_processed = len(valid_results)
    skipped_not_authenticated = len(accounts) - accounts_processed
    
    total_candidates = sum(r["data"]["summary"]["total_candidates"] for r in valid_results)
    skipped_small_groups = sum(r["data"]["summary"]["total_chats_skipped"] for r in valid_results)
    
    return {
        "success": True,
        "accounts": results,
        "summary": {
            "accounts_processed": accounts_processed,
            "skipped_not_authenticated": skipped_not_authenticated,
            "total_candidates": total_candidates,
            "skipped_small_groups": skipped_small_groups
        }
    }

@app.post("/delete_all")
async def delete_all_accounts(data: MultiAccountOperationRequest):
    """Delete messages across all authenticated accounts"""
    accounts = account_store.get_all_accounts()
    if not accounts:
        return {"success": False, "error": "No accounts configured"}
    
    filters = _build_multi_account_filters(data, dry_run=False)
    
    # Use semaphore to limit concurrency
    semaphore = asyncio.Semaphore(2)
    
    async def delete_account(account):
        async with semaphore:
            account_deleter = get_deleter_for_account(account.id)
            if not account_deleter:
                return None
            
            try:
                await account_deleter.connect()
                if not await account_deleter.client.is_user_authorized():
                    return None
                
                me = await account_deleter.client.get_me()
                username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
                
                result = await account_deleter.delete(filters)
                return {
                    "account_id": account.id,
                    "username": username,
                    "data": {
                        "chats": [
                            {
                                "id": chat.id,
                                "title": chat.title,
                                "type": chat.type,
                                "participants_count": chat.participants_count,
                                "candidates_found": chat.candidates_found,
                                "deleted": chat.deleted,
                                "error": chat.error,
                                "skipped_reason": chat.skipped_reason
                            }
                            for chat in result.chats
                        ],
                        "summary": {
                            "total_chats_processed": result.total_chats_processed,
                            "total_chats_skipped": result.total_chats_skipped,
                            "total_candidates": result.total_candidates,
                            "total_deleted": result.total_deleted
                        },
                        "logs": result.logs
                    }
                }
            except Exception as e:
                return {
                    "account_id": account.id,
                    "error": str(e)
                }
    
    # Run deletions concurrently
    results = await asyncio.gather(*[delete_account(account) for account in accounts])
    
    # Filter out None results and compile summary
    valid_results = [r for r in results if r and "data" in r]
    accounts_processed = len(valid_results)
    skipped_not_authenticated = len(accounts) - accounts_processed
    
    total_candidates = sum(r["data"]["summary"]["total_candidates"] for r in valid_results)
    total_deleted = sum(r["data"]["summary"]["total_deleted"] for r in valid_results)
    skipped_small_groups = sum(r["data"]["summary"]["total_chats_skipped"] for r in valid_results)
    
    return {
        "success": True,
        "accounts": results,
        "summary": {
            "accounts_processed": accounts_processed,
            "skipped_not_authenticated": skipped_not_authenticated,
            "total_candidates": total_candidates,
            "total_deleted": total_deleted,
            "skipped_small_groups": skipped_small_groups
        }
    }

@app.post("/connect")
async def connect(data: ConnectRequest):
    """Connect to Telegram with credentials"""
    global deleter
    
    try:
        session_name = "tg_ui_session"
        deleter = TelegramDeleter(session_name, data.api_id, data.api_hash)
        result = await deleter.connect()
        return result
    except Exception as e:
        return {"success": False, "error": f"Connection error: {str(e)}"}

@app.post("/scan")
async def scan_messages(data: OperationRequest):
    """Scan for messages without deleting"""
    if not deleter:
        raise HTTPException(status_code=400, detail="Not connected")
    
    filters = _build_filters(data, dry_run=True)
    result = await deleter.scan(filters)
    
    return {
        "success": True,
        "result": {
            "chats": [
                {
                    "id": chat.id,
                    "title": chat.title,
                    "type": chat.type,
                    "participants_count": chat.participants_count,
                    "candidates_found": chat.candidates_found,
                    "deleted": chat.deleted,
                    "error": chat.error,
                    "skipped_reason": chat.skipped_reason
                }
                for chat in result.chats
            ],
            "summary": {
                "total_chats_processed": result.total_chats_processed,
                "total_chats_skipped": result.total_chats_skipped,
                "total_candidates": result.total_candidates,
                "total_deleted": result.total_deleted
            },
            "logs": result.logs
        }
    }

@app.post("/delete")
async def delete_messages(data: OperationRequest):
    """Delete messages according to filters"""
    if not deleter:
        raise HTTPException(status_code=400, detail="Not connected")
    
    filters = _build_filters(data, dry_run=False)
    result = await deleter.delete(filters)
    
    return {
        "success": True,
        "result": {
            "chats": [
                {
                    "id": chat.id,
                    "title": chat.title,
                    "type": chat.type,
                    "participants_count": chat.participants_count,
                    "candidates_found": chat.candidates_found,
                    "deleted": chat.deleted,
                    "error": chat.error,
                    "skipped_reason": chat.skipped_reason
                }
                for chat in result.chats
            ],
            "summary": {
                "total_chats_processed": result.total_chats_processed,
                "total_chats_skipped": result.total_chats_skipped,
                "total_candidates": result.total_candidates,
                "total_deleted": result.total_deleted
            },
            "logs": result.logs
        }
    }

def _build_filters(data: OperationRequest, dry_run: bool = True) -> Filters:
    """Build Filters object from request data"""
    # Parse chat name filters
    chat_filters = []
    if data.chat_name_filters:
        chat_filters = [f.strip() for f in data.chat_name_filters.split(",") if f.strip()]
    
    # Parse date filters
    after_date = None
    before_date = None
    
    if data.after:
        try:
            after_date = datetime.strptime(data.after, "%Y-%m-%d").date()
        except ValueError:
            pass
    
    if data.before:
        try:
            before_date = datetime.strptime(data.before, "%Y-%m-%d").date()
        except ValueError:
            pass
    
    return Filters(
        include_private=data.include_private,
        chat_name_filters=chat_filters,
        after=after_date,
        before=before_date,
        limit_per_chat=data.limit_per_chat,
        revoke=data.revoke,
        dry_run=dry_run,
        test_mode=data.test_mode
    )

def _build_multi_account_filters(data: MultiAccountOperationRequest, dry_run: bool = True) -> Filters:
    """Build Filters object from multi-account request data"""
    # Parse chat name filters
    chat_filters = []
    if data.chat_name_filters:
        chat_filters = [f.strip() for f in data.chat_name_filters.split(",") if f.strip()]
    
    # Parse date filters
    after_date = None
    before_date = None
    
    if data.after:
        try:
            after_date = datetime.strptime(data.after, "%Y-%m-%d").date()
        except ValueError:
            pass
    
    if data.before:
        try:
            before_date = datetime.strptime(data.before, "%Y-%m-%d").date()
        except ValueError:
            pass
    
    return Filters(
        include_private=data.include_private,
        chat_name_filters=chat_filters,
        after=after_date,
        before=before_date,
        limit_per_chat=data.limit_per_chat,
        revoke=data.revoke,
        dry_run=dry_run,
        test_mode=data.test_mode
    )

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)