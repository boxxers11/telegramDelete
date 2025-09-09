import threading
from typing import Optional
from .accounts import account_store, Account
from .telegram_delete import TelegramDeleter

# Global cache for deleter instances and session locks
_deleter_instances: dict[str, TelegramDeleter] = {}
_session_locks: dict[str, threading.Lock] = {}
_cache_lock = threading.Lock()

def get_deleter_for_account(account_id: str) -> Optional[TelegramDeleter]:
    """Get TelegramDeleter instance for a specific account"""
    with _cache_lock:
        # Return cached instance if it exists
        if account_id in _deleter_instances:
            return _deleter_instances[account_id]
        
        # Get account info
        account = account_store.get_account(account_id)
        if not account:
            return None
        
        # Get or create session lock for this account
        session_path = account.session_path
        if session_path not in _session_locks:
            _session_locks[session_path] = threading.Lock()
        session_lock = _session_locks[session_path]
        
        # Create new deleter instance with shared lock
        deleter = TelegramDeleter(
            session_name=account.session_path.replace('.session', ''),
            api_id=account.api_id,
            api_hash=account.api_hash,
            session_lock=session_lock
        )
        
        # Cache the instance
        _deleter_instances[account_id] = deleter
        return deleter

def clear_deleter_cache(account_id: str = None):
    """Clear cached deleter instances"""
    with _cache_lock:
        if account_id:
            # Clear specific account
            if account_id in _deleter_instances:
                deleter = _deleter_instances[account_id]
                # Disconnect client if it exists
                if deleter.client:
                    try:
                        import asyncio
                        asyncio.create_task(deleter.client.disconnect())
                    except:
                        pass
                del _deleter_instances[account_id]
        else:
            # Clear all instances
            for deleter in _deleter_instances.values():
                if deleter.client:
                    try:
                        import asyncio
                        asyncio.create_task(deleter.client.disconnect())
                    except:
                        pass
            _deleter_instances.clear()

# Legacy function for backward compatibility
def get_deleter_for_account_legacy(account_id: str) -> Optional[TelegramDeleter]:
    """Legacy function - creates new instance each time (not recommended)"""
    account = account_store.get_account(account_id)
    if not account:
        return None
    
    # Create a new lock for each instance (legacy behavior)
    session_lock = threading.Lock()
    
    return TelegramDeleter(
        session_name=account.session_path.replace('.session', ''),
        api_id=account.api_id,
        api_hash=account.api_hash,
        session_lock=session_lock
    )