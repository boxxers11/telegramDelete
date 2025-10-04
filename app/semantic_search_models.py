"""
Semantic Search Models for Telegram Message Search
"""
from typing import List, Literal, Optional
from pydantic import BaseModel
from datetime import datetime


class SemanticSearchQuery(BaseModel):
    """Query model for semantic search requests"""
    query_text: str
    fidelity: Literal['exact', 'close', 'semantic'] = 'semantic'
    time_frame_hours: int = 24
    groups_to_scan: List[str] = []
    account_id: str


class SearchResult(BaseModel):
    """Individual search result model"""
    message_id: int
    chat_id: int
    chat_name: str
    message_text: str
    timestamp: datetime
    similarity_score: float
    matched_keywords: List[str] = []


class SemanticSearchResponse(BaseModel):
    """Response model for semantic search results"""
    success: bool
    total_messages_scanned: int
    total_matches_found: int
    search_duration_seconds: float
    results: List[SearchResult] = []
    error: Optional[str] = None


class SemanticSearchProgress(BaseModel):
    """Real-time progress updates for semantic search"""
    status: Literal['starting', 'scanning', 'processing', 'completed', 'error']
    current_group: Optional[str] = None
    groups_completed: int = 0
    total_groups: int = 0
    messages_scanned: int = 0
    matches_found: int = 0
    progress_percent: float = 0.0
    estimated_time_remaining: Optional[int] = None
    error_message: Optional[str] = None


class SavedSearch(BaseModel):
    """Model for saved searches in LocalStorage"""
    id: str
    query_text: str
    fidelity: str
    time_frame_hours: int
    groups_count: int
    created_at: datetime
    last_used: datetime
    results_count: int = 0
