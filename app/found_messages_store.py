import json
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import logging

logger = logging.getLogger(__name__)


@dataclass
class FoundMessage:
    key: str
    chat_id: int
    chat_title: str
    message_id: int
    content: str
    date: str
    found_at: str
    sender: str = "me"
    link: Optional[str] = None
    can_delete: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)
    deleted: bool = False
    deleted_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "chatId": self.chat_id,
            "chatTitle": self.chat_title,
            "messageId": self.message_id,
            "content": self.content,
            "date": self.date,
            "foundAt": self.found_at,
            "sender": self.sender,
            "link": self.link,
            "canDelete": self.can_delete and not self.deleted,
            "metadata": self.metadata,
            "deleted": self.deleted,
            "deletedAt": self.deleted_at,
            "status": "deleted" if self.deleted else "pending"
        }


class FoundMessagesStore:
    """Persistent storage for messages that were identified during scans."""

    def __init__(self, account_id: str):
        self.account_id = account_id
        self.file_path = Path(f"sessions/found_messages_{account_id}.json")
        self.messages: Dict[str, FoundMessage] = {}
        self.chat_index: Dict[str, List[str]] = {}
        self.sorted_keys: List[str] = []
        self.owner_id: Optional[int] = None
        self._load()

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _build_key(self, chat_id: int, message_id: int) -> str:
        return f"{chat_id}:{message_id}"

    def _load(self):
        if not self.file_path.exists():
            return
        try:
            with self.file_path.open("r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception as exc:
            logger.error(f"Failed to load found messages for {self.account_id}: {exc}")
            return

        if isinstance(payload, dict):
            self.owner_id = payload.get("owner_id")
            messages = payload.get("messages", [])
        else:
            messages = payload
        for item in messages:
            try:
                message = FoundMessage(
                    key=item.get("key")
                    or self._build_key(item.get("chat_id") or item.get("chatId"), item.get("message_id") or item.get("messageId")),
                    chat_id=int(item.get("chat_id") or item.get("chatId")),
                    chat_title=item.get("chat_title") or item.get("chatTitle") or "",
                    message_id=int(item.get("message_id") or item.get("messageId")),
                    content=item.get("content") or "",
                    date=item.get("date") or datetime.utcnow().isoformat(),
                    found_at=item.get("found_at") or item.get("foundAt") or datetime.utcnow().isoformat(),
                    sender=item.get("sender") or "me",
                    link=item.get("link"),
                    can_delete=item.get("can_delete", True),
                    metadata=item.get("metadata") or {},
                    deleted=item.get("deleted", False),
                    deleted_at=item.get("deleted_at") or item.get("deletedAt"),
                )
                self.messages[message.key] = message
            except Exception as exc:
                logger.warning(f"Skipping malformed found message record: {exc}")

        self._rebuild_indexes()

    def _save(self):
        try:
            self.file_path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "account_id": self.account_id,
                "updated_at": datetime.utcnow().isoformat(),
                "owner_id": self.owner_id,
                "messages": [asdict(message) for message in self.messages.values()],
            }
            with self.file_path.open("w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.error(f"Failed to persist found messages for {self.account_id}: {exc}")

    def _rebuild_indexes(self):
        self.chat_index = {}
        for key, message in self.messages.items():
            if message.deleted:
                continue
            chat_key = str(message.chat_id)
            self.chat_index.setdefault(chat_key, []).append(key)
        for keys in self.chat_index.values():
            keys.sort(key=lambda item_key: self.messages[item_key].found_at, reverse=True)

        # Global ordering by found_at desc
        self.sorted_keys = [
            key for key, message in sorted(
                ((k, msg) for k, msg in self.messages.items() if not msg.deleted),
                key=lambda pair: pair[1].found_at,
                reverse=True
            )
        ]

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def replace_chat_messages(self, chat_id: int, chat_title: str, messages: List[Dict[str, Any]]):
        chat_key = str(chat_id)
        # Remove existing entries for chat
        existing_keys = self.chat_index.get(chat_key, [])
        for key in existing_keys:
            self.messages.pop(key, None)

        now_iso = datetime.utcnow().isoformat()
        for item in messages:
            message_id = int(item.get("id") or item.get("message_id") or item.get("messageId"))
            key = self._build_key(chat_id, message_id)
            content = item.get("content") or item.get("message") or ""
            date_value = item.get("date") or now_iso
            message = FoundMessage(
                key=key,
                chat_id=chat_id,
                chat_title=chat_title,
                message_id=message_id,
                content=content,
                date=date_value,
                found_at=item.get("found_at") or item.get("foundAt") or now_iso,
                sender=item.get("sender") or "me",
                link=item.get("link"),
                can_delete=item.get("can_delete", True),
                metadata=item.get("metadata") or {},
                deleted=False,
                deleted_at=None,
            )
            self.messages[key] = message

        self._rebuild_indexes()
        self._save()

    def upsert_messages(self, messages: List[Dict[str, Any]]):
        now_iso = datetime.utcnow().isoformat()
        for item in messages:
            chat_id = int(item.get("chat_id") or item.get("chatId"))
            chat_title = item.get("chat_title") or item.get("chatTitle") or ""
            message_id = int(item.get("message_id") or item.get("messageId") or item.get("id"))
            key = self._build_key(chat_id, message_id)
            content = item.get("content") or item.get("message") or ""
            date_value = item.get("date") or now_iso
            message = FoundMessage(
                key=key,
                chat_id=chat_id,
                chat_title=chat_title,
                message_id=message_id,
                content=content,
                date=date_value,
                found_at=item.get("found_at") or item.get("foundAt") or now_iso,
                sender=item.get("sender") or "me",
                link=item.get("link"),
                can_delete=item.get("can_delete", True),
                metadata=item.get("metadata") or {},
                deleted=item.get("deleted", False),
                deleted_at=item.get("deleted_at") or item.get("deletedAt"),
            )
            self.messages[key] = message

        self._rebuild_indexes()
        self._save()

    def get_chat_messages(self, chat_id: int, cursor: Optional[str] = None, limit: int = 50) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        chat_keys = self.chat_index.get(str(chat_id), [])
        if not chat_keys:
            return [], None

        start = int(cursor) if cursor else 0
        end = start + max(1, limit)
        slice_keys = chat_keys[start:end]
        items = [self.messages[key].to_dict() for key in slice_keys]
        next_cursor = str(end) if end < len(chat_keys) else None
        return items, next_cursor

    def get_summary_for_chat(self, chat_id: int) -> Dict[str, int]:
        chat_keys = self.chat_index.get(str(chat_id), [])
        total = len(chat_keys)
        return {
            "total": total,
            "deleted": sum(1 for key in chat_keys if self.messages[key].deleted),
        }

    def get_all_messages(
        self,
        cursor: Optional[str] = None,
        limit: int = 100,
        search: Optional[str] = None,
        group_id: Optional[str] = None,
        sort: str = "foundAt:desc",
    ) -> Tuple[List[Dict[str, Any]], Optional[str], int]:
        keys = self.sorted_keys
        if group_id is not None:
            keys = self.chat_index.get(str(group_id), [])

        filtered_keys = keys
        if search:
            query = search.lower()
            filtered_keys = [
                key for key in keys if query in (self.messages[key].content or "").lower()
            ]

        reverse = sort.endswith(":desc")
        sort_field = sort.split(":", 1)[0]

        if sort_field in {"foundAt", "date"}:
            filtered_keys = sorted(
                filtered_keys,
                key=lambda key: getattr(self.messages[key], sort_field.lower(), self.messages[key].found_at),
                reverse=reverse,
            )

        start = int(cursor) if cursor else 0
        end = start + max(1, limit)
        slice_keys = filtered_keys[start:end]
        items = [self.messages[key].to_dict() for key in slice_keys]
        next_cursor = str(end) if end < len(filtered_keys) else None
        return items, next_cursor, len(filtered_keys)

    def apply_delete_results(self, chat_id: int, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        summary = {
            "deleted": 0,
            "failed": 0,
            "failed_messages": []
        }
        if not results:
            return summary

        now_iso = datetime.utcnow().isoformat()
        for result in results:
            raw_message_id = result.get("message_id")
            try:
                message_id = int(raw_message_id)
            except (TypeError, ValueError):
                continue
            key = self._build_key(chat_id, message_id)
            message = self.messages.get(key)
            status = result.get("status")
            if status == "deleted":
                if message and not message.deleted:
                    message.deleted = True
                    message.deleted_at = now_iso
                    summary["deleted"] += 1
            else:
                summary["failed"] += 1
                reason = result.get("error") or "Unknown error"
                summary["failed_messages"].append({
                    "message_id": message_id,
                    "chat_id": chat_id,
                    "chat_title": message.chat_title if message else "",
                    "reason": reason
                })
                if message:
                    message.metadata["delete_error"] = reason

        if summary["deleted"] or summary["failed"]:
            self._rebuild_indexes()
            self._save()
        return summary

    def mark_messages_deleted(self, chat_id: int, message_ids: List[int]) -> Dict[str, Any]:
        results = [{"message_id": message_id, "status": "deleted"} for message_id in message_ids]
        return self.apply_delete_results(chat_id, results)

    def mark_chat_deleted(self, chat_id: int) -> int:
        chat_keys = self.chat_index.get(str(chat_id), [])
        results = [{"message_id": self.messages[key].message_id, "status": "deleted"} for key in chat_keys if key in self.messages]
        summary = self.apply_delete_results(chat_id, results)
        return summary.get("deleted", 0)

    def mark_all_deleted(self) -> int:
        deleted_total = 0
        for chat_id_str, keys in list(self.chat_index.items()):
            chat_id = int(chat_id_str)
            chat_results = [
                {"message_id": self.messages[key].message_id, "status": "deleted"}
                for key in keys if key in self.messages
            ]
            chat_summary = self.apply_delete_results(chat_id, chat_results)
            deleted_total += chat_summary.get("deleted", 0)
        return deleted_total

    def purge_deleted(self):
        deleted_keys = [key for key, msg in self.messages.items() if msg.deleted]
        for key in deleted_keys:
            self.messages.pop(key, None)
        if deleted_keys:
            self._rebuild_indexes()
            self._save()

    def statistics(self) -> Dict[str, Any]:
        total = len([msg for msg in self.messages.values() if not msg.deleted])
        grouped = {}
        for key, message in self.messages.items():
            if message.deleted:
                continue
            grouped.setdefault(message.chat_id, {"chatId": message.chat_id, "chatTitle": message.chat_title, "total": 0})
            grouped[message.chat_id]["total"] += 1
        return {
            "totalMessages": total,
            "groups": list(grouped.values()),
        }

    def reset(self, owner_id: Optional[int] = None):
        self.messages = {}
        self.chat_index = {}
        self.sorted_keys = []
        self.owner_id = owner_id
        self._save()

    def ensure_owner(self, owner_id: Optional[int]) -> bool:
        if owner_id is None:
            return False
        if self.owner_id == owner_id:
            return False
        self.reset(owner_id)
        return True
