import { useState, useCallback } from 'react';

export interface SemanticSearchProgress {
    status: 'starting' | 'retrieving' | 'searching' | 'completed' | 'error';
    message?: string;
    progress?: number;
    processed?: number;
    total?: number;
    matches?: number;
    current_group?: string;
    groups_completed?: number;
    total_groups?: number;
    messages_scanned?: number;
    matches_found?: number;
    progress_percent?: number;
    estimated_time_remaining?: number;
    error_message?: string;
}

export interface SemanticSearchResult {
    message_id: number;
    chat_id: number;
    chat_name: string;
    message_text: string;
    timestamp: string;
    similarity_score: number;
    matched_keywords: string[];
}

export const useSemanticSearch = () => {
    const [isSearching, setIsSearching] = useState(false);
    const [searchProgress, setSearchProgress] = useState<SemanticSearchProgress | null>(null);
    const [searchResults, setSearchResults] = useState<SemanticSearchResult[]>([]);
    const [eventSource, setEventSource] = useState<EventSource | null>(null);

    const startSearch = useCallback(async (query: {
        account_id: string;
        query_text: string;
        fidelity: 'exact' | 'close' | 'semantic';
        time_frame_hours: number;
        groups_to_scan?: string[];
        folder_id?: number;
    }) => {
        try {
            setIsSearching(true);
            setSearchResults([]);
            setSearchProgress(null);
            
            console.log('Starting semantic search:', query);
            
            // Close existing connection if any
            if (eventSource) {
                eventSource.close();
            }
            
            const clampedWindow = Math.max(1, Math.min(query.time_frame_hours, 72));
            const params = new URLSearchParams({
                query_text: query.query_text,
                fidelity: query.fidelity,
                time_frame_hours: String(clampedWindow)
            });

            if (typeof query.folder_id === 'number' && !Number.isNaN(query.folder_id)) {
                params.set('folder_id', String(query.folder_id));
            }

            if (query.groups_to_scan && query.groups_to_scan.length > 0) {
                params.set('groups_to_scan', query.groups_to_scan.join(','));
            }

            // Use SSE for real-time updates
            const newEventSource = new EventSource(
                `http://127.0.0.1:8001/accounts/${query.account_id}/semantic-scan-events?${params.toString()}`
            );
            
            setEventSource(newEventSource);
            
            newEventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('SSE data received:', data);
                    
                    switch (data.type) {
                        case 'connected':
                            console.log('Connected to semantic search events');
                            break;
                            
                        case 'search_started':
                            setSearchProgress({
                                status: 'searching',
                                message: data.message,
                                progress: 0,
                                processed: 0,
                                total: 0,
                                matches: 0
                            });
                            break;
                            
                        case 'retrieving_messages':
                            setSearchProgress(prev => ({
                                ...prev!,
                                message: data.message,
                                status: 'retrieving'
                            }));
                            break;
                            
                        case 'messages_retrieved':
                            setSearchProgress(prev => ({
                                ...prev!,
                                message: data.message,
                                total: data.count,
                                status: 'searching',
                                messages_scanned: data.count
                            }));
                            break;
                            
                        case 'search_progress':
                            setSearchProgress(prev => ({
                                ...prev!,
                                progress: data.progress,
                                processed: data.processed,
                                total: data.total,
                                matches: data.matches,
                                message: `מחפש... ${data.processed}/${data.total} הודעות (${data.matches} תוצאות)`
                            }));
                            break;
                            
                        case 'match_found':
                            setSearchResults(prev => [...prev, data.result]);
                            setSearchProgress(prev => ({
                                ...prev!,
                                matches: (prev?.matches || 0) + 1,
                                message: `נמצאה תוצאה ${(prev?.matches || 0) + 1}: ${data.result.chat_name}`
                            }));
                            break;
                            
                        case 'search_complete':
                            setSearchProgress(prev => ({
                                ...prev!,
                                status: 'completed',
                                message: `חיפוש הושלם! נמצאו ${data.total_matches} תוצאות מ-${data.total_messages} הודעות.`
                            }));
                            setIsSearching(false);
                            newEventSource.close();
                            setEventSource(null);
                            break;
                            
                        case 'error':
                            console.error('Search error:', data.message);
                            setSearchProgress(prev => ({
                                ...prev!,
                                status: 'error',
                                message: data.message || 'אירעה שגיאה בחיפוש'
                            }));
                            setIsSearching(false);
                            newEventSource.close();
                            setEventSource(null);
                            break;
                    }
                } catch (error) {
                    console.error('Error parsing SSE data:', error);
                }
            };
            
            newEventSource.onerror = (error) => {
                console.error('SSE error:', error);
                setIsSearching(false);
                newEventSource.close();
                setEventSource(null);
            };
            
            return { success: true };
            
        } catch (error) {
            console.error('Semantic search error:', error);
            setIsSearching(false);
            return { success: false, error: 'Failed to start semantic search' };
        }
    }, [eventSource]);

    const stopSearch = useCallback(() => {
        if (eventSource) {
            eventSource.close();
            setEventSource(null);
        }
        setIsSearching(false);
        setSearchProgress(null);
    }, [eventSource]);

    const clearResults = useCallback(() => {
        setSearchResults([]);
        setSearchProgress(null);
    }, []);

    return {
        // State
        isSearching,
        searchProgress,
        searchResults,
        
        // Actions
        startSearch,
        stopSearch,
        clearResults
    };
};
