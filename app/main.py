from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # React dev server
        "http://127.0.0.1:5173",  # Alternative localhost
        "http://localhost:3000",  # Alternative React port
        "https://local-telegram-messa-cgvs.bolt.host"  # Deployed frontend
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

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

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

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
        accounts = account_store.get_all_accounts()
        
        # Check authentication status for each account
        account_list = []
        for acc in accounts:
            # Try to get deleter instance to check auth status
            deleter = get_deleter_for_account(acc.id)
            is_authenticated = False
            username = None
            
            if deleter and deleter.client:
                try:
                    # Check if client is connected and authorized
                    if hasattr(deleter.client, 'is_user_authorized'):
                        is_authenticated = await deleter.client.is_user_authorized()
                        if is_authenticated:
                            me = await deleter.client.get_me()
                            username = me.username or f"{me.first_name} {me.last_name or ''}".strip()
                except Exception:
                    # If there's an error checking auth status, assume not authenticated
                    is_authenticated = False
            
            account_list.append({
                "id": acc.id,
                "label": acc.label,
                "phone": acc.phone,
                "api_id": acc.api_id,
                "api_hash": acc.api_hash,
                "is_authenticated": is_authenticated,
                "username": username
            })
        
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
        # Clear cached deleter instance before deleting account
        clear_deleter_cache(account_id)
        success = account_store.delete_account(account_id)
        if success:
            return {"success": True, "message": "Account deleted successfully"}
        else:
            return {"success": False, "error": "Account not found"}
    except Exception as e:
        logger.error(f"Error deleting account {account_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)