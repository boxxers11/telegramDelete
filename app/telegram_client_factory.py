from typing import Optional
from .accounts import account_store, Account
from .telegram_delete import TelegramDeleter

def get_deleter_for_account(account_id: str) -> Optional[TelegramDeleter]:
    """Get TelegramDeleter instance for a specific account"""
    account = account_store.get_account(account_id)
    if not account:
        return None
    
    return TelegramDeleter(
        session_name=account.session_path.replace('.session', ''),
        api_id=account.api_id,
        api_hash=account.api_hash
    )