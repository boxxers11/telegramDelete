"""
Semantic Search Engine for Telegram Messages
Uses sentence-transformers for semantic similarity matching
"""
import asyncio
import logging
import time
from datetime import datetime
from typing import List, Dict, Tuple, Optional
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import re

from .semantic_search_models import SemanticSearchQuery, SearchResult, SemanticSearchProgress

logger = logging.getLogger(__name__)


class SemanticSearchEngine:
    """Core semantic search engine using sentence transformers"""
    
    def __init__(self):
        self.model = None
        self.model_loaded = False
        self._load_model()
    
    def _load_model(self):
        """Load the sentence transformer model"""
        try:
            logger.info("Loading semantic search model...")
            # Using a lightweight, fast model for real-time processing
            self.model = SentenceTransformer('all-MiniLM-L6-v2')
            self.model_loaded = True
            logger.info("Semantic search model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load semantic search model: {e}")
            self.model_loaded = False
    
    def _preprocess_text(self, text: str) -> str:
        """Preprocess text for better semantic matching"""
        if not text:
            return ""
        
        # Remove extra whitespace and normalize
        text = re.sub(r'\s+', ' ', text.strip())
        
        # Remove common Hebrew/English stop words that don't add semantic value
        stop_words = {
            'את', 'של', 'על', 'ב', 'ל', 'מ', 'ה', 'ו', 'או', 'אבל', 'כי', 'אם', 'כאשר',
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'
        }
        
        words = text.split()
        filtered_words = [word for word in words if word.lower() not in stop_words]
        
        return ' '.join(filtered_words)
    
    def _extract_keywords(self, text: str, query_text: str) -> List[str]:
        """Extract relevant keywords from the text that match the query"""
        query_words = set(query_text.lower().split())
        text_words = text.lower().split()
        
        # Find words that appear in both query and text
        matching_words = [word for word in text_words if word in query_words]
        
        # Also find similar words (simple similarity)
        similar_words = []
        for text_word in text_words:
            for query_word in query_words:
                if len(text_word) > 3 and len(query_word) > 3:
                    # Simple similarity check
                    if text_word[:3] == query_word[:3] or text_word[-3:] == query_word[-3:]:
                        similar_words.append(text_word)
        
        return list(set(matching_words + similar_words))
    
    def calculate_similarity(self, query_text: str, message_text: str) -> Tuple[float, List[str]]:
        """Calculate semantic similarity between query and message"""
        if not self.model_loaded or not message_text:
            return 0.0, []
        
        try:
            # Preprocess texts
            processed_query = self._preprocess_text(query_text)
            processed_message = self._preprocess_text(message_text)
            
            if not processed_query or not processed_message:
                return 0.0, []
            
            # Generate embeddings
            query_embedding = self.model.encode([processed_query])
            message_embedding = self.model.encode([processed_message])
            
            # Calculate cosine similarity
            similarity = cosine_similarity(query_embedding, message_embedding)[0][0]
            
            # Extract matching keywords
            keywords = self._extract_keywords(message_text, query_text)
            
            return float(similarity), keywords
            
        except Exception as e:
            logger.error(f"Error calculating similarity: {e}")
            return 0.0, []
    
    def get_fidelity_threshold(self, fidelity: str) -> float:
        """Get similarity threshold based on fidelity setting"""
        thresholds = {
            'exact': 0.95,    # Very high similarity - almost exact match
            'close': 0.70,     # High similarity - close variations
            'semantic': 0.50   # Medium similarity - similar intent
        }
        return thresholds.get(fidelity, 0.50)
    
    async def search_messages(
        self, 
        query: SemanticSearchQuery, 
        messages: List[Dict], 
        progress_callback: Optional[callable] = None
    ) -> List[SearchResult]:
        """
        Search through messages using semantic similarity
        
        Args:
            query: The search query
            messages: List of message dictionaries
            progress_callback: Optional callback for progress updates
            
        Returns:
            List of matching SearchResult objects
        """
        if not self.model_loaded:
            logger.error("Semantic search model not loaded")
            return []
        
        results = []
        threshold = self.get_fidelity_threshold(query.fidelity)
        
        logger.info(f"Starting semantic search with fidelity: {query.fidelity} (threshold: {threshold})")
        
        for i, message in enumerate(messages):
            try:
                # Update progress
                if progress_callback and i % 100 == 0:
                    await progress_callback({
                        'messages_scanned': i,
                        'matches_found': len(results)
                    })
                
                # Calculate similarity
                similarity, keywords = self.calculate_similarity(
                    query.query_text, 
                    message.get('text', '')
                )
                
                # Check if similarity meets threshold
                if similarity >= threshold:
                    result = SearchResult(
                        message_id=message.get('id', 0),
                        chat_id=message.get('chat_id', 0),
                        chat_name=message.get('chat_name', 'Unknown'),
                        message_text=message.get('text', ''),
                        timestamp=message.get('date', datetime.now().isoformat()),
                        similarity_score=similarity,
                        matched_keywords=keywords
                    )
                    results.append(result)
                    
                    logger.debug(f"Found match: {similarity:.3f} - {message.get('text', '')[:50]}...")
                
            except Exception as e:
                logger.error(f"Error processing message {i}: {e}")
                continue
        
        # Sort results by similarity score (highest first)
        results.sort(key=lambda x: x.similarity_score, reverse=True)
        
        logger.info(f"Semantic search completed: {len(results)} matches found from {len(messages)} messages")
        return results


# Global instance
semantic_engine = SemanticSearchEngine()
