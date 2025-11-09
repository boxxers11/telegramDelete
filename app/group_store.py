import json
from dataclasses import dataclass, asdict, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Iterable, Any
import logging

logger = logging.getLogger(__name__)


LifecycleStatus = str


@dataclass
class GroupRecord:
    id: str  # chat_id stored as string
    platform: str = 'user'  # 'user' | 'bot'
    title: Optional[str] = None
    username: Optional[str] = None
    invite_link: Optional[str] = None
    member_count: Optional[int] = None
    my_status: Optional[str] = None  # owner|admin|member|restricted|left|banned
    can_send: Optional[bool] = None
    slow_mode_delay: Optional[int] = None
    is_forum: Optional[bool] = None
    linked_chat_id: Optional[int] = None
    joined_at: Optional[str] = None
    last_post_at: Optional[str] = None
    sent_count_total: int = 0
    deleted_count_total: int = 0
    lifecycle_status: LifecycleStatus = 'unknown'
    metadata: Dict[str, Any] = field(default_factory=dict)
    last_status_change_at: Optional[str] = None
    creates_join_request: Optional[bool] = None
    deleted_at: Optional[str] = None
    first_seen_at: Optional[str] = None

    def update_from_scan(self, scan_data: Dict[str, Any]):
        self.title = scan_data.get('title') or self.title
        self.username = scan_data.get('username') or self.username
        self.member_count = scan_data.get('member_count', self.member_count)
        self.can_send = scan_data.get('can_send', self.can_send)
        self.slow_mode_delay = scan_data.get('slow_mode_delay', self.slow_mode_delay)
        self.is_forum = scan_data.get('is_forum', self.is_forum)
        # Merge metadata while preserving existing fields
        metadata_update = scan_data.get('metadata', {})
        if not isinstance(metadata_update, dict):
            metadata_update = {}
        self.metadata.update(metadata_update)
        # Promote common fields into metadata for downstream consumers
        for key in (
            'folder_id',
            'folder_name',
            'lastMessageTime',
            'lastMessageContent',
            'group_rules',
            'type'
        ):
            value = scan_data.get(key)
            if value is not None:
                self.metadata[key] = value


class GroupStore:
    """Persistent storage for Telegram group information per account."""

    def __init__(self, account_id: str):
        self.account_id = account_id
        self.file_path = Path(f"sessions/groups_{account_id}.json")
        self.records: Dict[str, GroupRecord] = {}
        self.synced_at: Optional[str] = None
        self._load()

    # ------------------------------------------------------------------ #
    # Persistence helpers
    # ------------------------------------------------------------------ #
    def _load(self):
        if self.file_path.exists():
            try:
                with self.file_path.open('r', encoding='utf-8') as fh:
                    payload = json.load(fh)
                if isinstance(payload, dict) and 'groups' in payload:
                    groups = payload.get('groups', [])
                    self.synced_at = payload.get('synced_at')
                elif isinstance(payload, list):
                    groups = payload
                else:
                    groups = []
                for item in groups:
                    try:
                        record = GroupRecord(**item)
                        if not record.first_seen_at:
                            record.first_seen_at = (
                                record.joined_at
                                or record.last_status_change_at
                                or datetime.utcnow().isoformat()
                            )
                        self.records[record.id] = record
                    except Exception as exc:
                        logger.warning(f"Failed to load group record for account {self.account_id}: {exc}")
            except Exception as exc:
                logger.error(f"Error loading group store for account {self.account_id}: {exc}")
                self.records = {}

    def _save(self):
        try:
            self.file_path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                'account_id': self.account_id,
                'updated_at': datetime.utcnow().isoformat(),
                'synced_at': self.synced_at,
                'groups': [asdict(record) for record in self.records.values()]
            }
            with self.file_path.open('w', encoding='utf-8') as fh:
                json.dump(payload, fh, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.error(f"Error saving group store for account {self.account_id}: {exc}")

    # ------------------------------------------------------------------ #
    # CRUD helpers
    # ------------------------------------------------------------------ #
    def list_groups(self) -> List[Dict[str, Any]]:
        now = datetime.utcnow()
        result = []
        for record in self.records.values():
            payload = asdict(record)
            first_seen = record.first_seen_at
            is_new = False
            if first_seen:
                try:
                    first_seen_dt = datetime.fromisoformat(first_seen)
                    is_new = (now - first_seen_dt) < timedelta(hours=24)
                except ValueError:
                    is_new = False
            payload['is_new'] = is_new
            result.append(payload)
        return result

    def set_synced_at(self, value: Optional[str]):
        if self.synced_at == value:
            return
        self.synced_at = value
        self._save()

    def get(self, chat_id: str) -> Optional[GroupRecord]:
        return self.records.get(str(chat_id))

    def upsert(self, record: GroupRecord):
        key = record.id
        existing = self.records.get(key)
        if existing:
            # Merge values while preserving counters and lifecycle unless overwritten
            record.sent_count_total = existing.sent_count_total
            record.deleted_count_total = existing.deleted_count_total
            record.lifecycle_status = record.lifecycle_status or existing.lifecycle_status
            record.metadata = {**existing.metadata, **(record.metadata or {})}
            record.joined_at = record.joined_at or existing.joined_at
            record.last_post_at = record.last_post_at or existing.last_post_at
            record.deleted_at = record.deleted_at or existing.deleted_at
            record.first_seen_at = existing.first_seen_at or record.first_seen_at
        else:
            record.first_seen_at = record.first_seen_at or datetime.utcnow().isoformat()
        self.records[key] = record
        self._save()

    def upsert_from_scan(self, chats: Iterable[Dict[str, Any]]):
        updated_any = False
        now = datetime.utcnow().isoformat()
        for chat in chats:
            chat_id = str(chat.get('id'))
            if not chat_id or chat_id == '0':
                continue
            record = self.records.get(chat_id)
            if not record:
                record = GroupRecord(id=chat_id, platform='user')
                record.lifecycle_status = 'active'
                record.last_status_change_at = now
                record.first_seen_at = now
            record.update_from_scan(chat)
            record.lifecycle_status = record.lifecycle_status or 'active'
            record.last_status_change_at = record.last_status_change_at or now
            record.first_seen_at = record.first_seen_at or now
            self.records[chat_id] = record
            updated_any = True
        if updated_any:
            self._save()

    def mark_joined(self, chat_id: str, metadata: Optional[Dict[str, Any]] = None):
        record = self.records.get(str(chat_id))
        now = datetime.utcnow().isoformat()
        if not record:
            record = GroupRecord(id=str(chat_id))
            record.first_seen_at = now
        record.lifecycle_status = 'active'
        record.joined_at = record.joined_at or now
        record.last_status_change_at = now
        if metadata:
            record.metadata.update(metadata)
            record.title = metadata.get('title') or record.title
            record.username = metadata.get('username') or record.username
            record.member_count = metadata.get('member_count', record.member_count)
            record.last_post_at = metadata.get('last_post_at', record.last_post_at)
        self.records[record.id] = record
        self._save()

    def mark_status(self, chat_id: str, status: LifecycleStatus, metadata: Optional[Dict[str, Any]] = None):
        record = self.records.get(str(chat_id))
        if not record:
            record = GroupRecord(id=str(chat_id))
            record.first_seen_at = datetime.utcnow().isoformat()
        record.lifecycle_status = status
        record.last_status_change_at = datetime.utcnow().isoformat()
        if metadata:
            record.metadata.update(metadata)
            if 'title' in metadata:
                record.title = metadata['title'] or record.title
            if 'username' in metadata:
                record.username = metadata['username'] or record.username
            if 'member_count' in metadata:
                record.member_count = metadata['member_count']
            if 'last_post_at' in metadata:
                record.last_post_at = metadata['last_post_at']
        self.records[record.id] = record
        self._save()

    def mark_left(self, chat_id: str):
        record = self.records.get(str(chat_id))
        if record:
            now = datetime.utcnow().isoformat()
            record.lifecycle_status = 'left'
            record.last_status_change_at = now
            record.deleted_at = now
            self.records[str(chat_id)] = record
            self._save()

    def increment_sent(self, chat_id: str, count: int = 1):
        record = self.records.get(str(chat_id))
        if not record:
            now = datetime.utcnow().isoformat()
            record = GroupRecord(id=str(chat_id), first_seen_at=now)
        record.sent_count_total += count
        record.last_post_at = datetime.utcnow().isoformat()
        self.records[record.id] = record
        self._save()

    def increment_deleted(self, chat_id: str, count: int = 1):
        record = self.records.get(str(chat_id))
        if not record:
            now = datetime.utcnow().isoformat()
            record = GroupRecord(id=str(chat_id), first_seen_at=now)
        record.deleted_count_total += count
        self.records[record.id] = record
        self._save()

    def bulk_results(self, updates: Iterable[Dict[str, Any]]):
        updated = False
        for update in updates:
            chat_id = str(update.get('id'))
            if not chat_id:
                continue
            record = self.records.get(chat_id)
            if not record:
                record = GroupRecord(id=chat_id, first_seen_at=datetime.utcnow().isoformat())
            for key, value in update.items():
                if hasattr(record, key) and value is not None:
                    setattr(record, key, value)
            record.last_status_change_at = datetime.utcnow().isoformat()
            self.records[chat_id] = record
            updated = True
        if updated:
            self._save()

    def reset(self):
        self.records = {}
        self.synced_at = None
        try:
            if self.file_path.exists():
                self.file_path.unlink()
        except Exception as exc:
            logger.warning(f"Failed to remove group store file for {self.account_id}: {exc}")
        self._save()
    
    def clear_scan_data(self):
        """Clear scan-related data but keep group info"""
        for group in self.records.values():
            # Clear scan-related fields but keep group metadata
            group.deleted_count_total = 0
            # Keep: sent_count_total, joined_at, last_post_at, etc.
        self._save()
        logger.info(f"Cleared scan data from group store for account {self.account_id}")