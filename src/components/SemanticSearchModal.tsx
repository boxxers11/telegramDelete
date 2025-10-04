import React, { useState, useEffect } from 'react';
import { X, Search, Clock, Settings, Save, Trash2, Pause } from 'lucide-react';

interface SemanticSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  onSearchStart: (query: SemanticSearchQuery) => void;
  onSearchStop: () => void;
  isSearching: boolean;
  searchProgress?: SemanticSearchProgress;
  searchResults?: SearchResult[];
}

interface SemanticSearchQuery {
  query_text: string;
  fidelity: 'exact' | 'close' | 'semantic';
  time_frame_hours: number;
  groups_to_scan: string[];
  account_id: string;
}

interface SemanticSearchProgress {
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

interface SearchResult {
  message_id: number;
  chat_id: number;
  chat_name: string;
  message_text: string;
  timestamp: string;
  similarity_score: number;
  matched_keywords: string[];
}

interface SavedSearch {
  id: string;
  query_text: string;
  fidelity: string;
  time_frame_hours: number;
  groups_count: number;
  created_at: string;
  last_used: string;
  results_count: number;
}

const SemanticSearchModal: React.FC<SemanticSearchModalProps> = ({
  isOpen,
  onClose,
  accountId,
  onSearchStart,
  onSearchStop,
  isSearching,
  searchProgress,
  searchResults = []
}) => {
  const [query, setQuery] = useState('');
  const [fidelity, setFidelity] = useState<'exact' | 'close' | 'semantic'>('semantic');
  const [timeFrame, setTimeFrame] = useState(24);
  const [selectedGroups] = useState<string[]>([]);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSavedSearches, setShowSavedSearches] = useState(false);
  const [realtimeUpdates, setRealtimeUpdates] = useState<string[]>([]);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  // Load saved searches on mount
  useEffect(() => {
    const saved = localStorage.getItem(`semantic_searches_${accountId}`);
    if (saved) {
      try {
        setSavedSearches(JSON.parse(saved));
      } catch (error) {
        console.error('Error loading saved searches:', error);
      }
    }
  }, [accountId]);

  // Real-time updates via SSE
  useEffect(() => {
    if (isSearching && accountId) {
      const eventSource = new EventSource(
        `http://127.0.0.1:8001/accounts/${accountId}/semantic-scan-events?query_text=${encodeURIComponent(query)}&fidelity=${fidelity}&time_frame_hours=${timeFrame}`
      );
      setEventSource(eventSource);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'search_started') {
            setRealtimeUpdates(prev => [`🔍 ${data.message}`, ...prev.slice(0, 9)]);
          } else if (data.type === 'retrieving_messages') {
            setRealtimeUpdates(prev => [`📥 ${data.message}`, ...prev.slice(0, 9)]);
          } else if (data.type === 'messages_retrieved') {
            setRealtimeUpdates(prev => [`✅ ${data.message}`, ...prev.slice(0, 9)]);
          } else if (data.type === 'search_progress') {
            const updateMessage = `🔄 סורק הודעות: ${data.processed}/${data.total} (${data.matches} תוצאות)`;
            setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]);
          } else if (data.type === 'message_preview') {
            const updateMessage = `🔍 [${data.chat_name}] ${data.content} (דמיון: ${data.similarity})`;
            setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]);
          } else if (data.type === 'match_found') {
            const preview = data.message_preview;
            const updateMessage = `✨ [${preview.chat_name}] ${preview.content} (דמיון: ${preview.similarity})`;
            setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]);
          } else if (data.type === 'search_complete') {
            setRealtimeUpdates(prev => [`🎉 סריקה הושלמה! ${data.total_matches} תוצאות`, ...prev.slice(0, 9)]);
            eventSource.close();
            setEventSource(null);
          } else if (data.type === 'error') {
            setRealtimeUpdates(prev => [`❌ שגיאה: ${data.message}`, ...prev.slice(0, 9)]);
            eventSource.close();
            setEventSource(null);
          }
        } catch (error) {
          console.error('Error parsing SSE data:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        setRealtimeUpdates(prev => ['❌ חיבור נקטע', ...prev.slice(0, 9)]);
        eventSource.close();
        setEventSource(null);
      };

      return () => {
        eventSource.close();
        setEventSource(null);
      };
    }
  }, [isSearching, accountId, query, fidelity, timeFrame]);

  const handleSearch = () => {
    if (!query.trim()) return;

    const searchQuery: SemanticSearchQuery = {
      query_text: query.trim(),
      fidelity,
      time_frame_hours: timeFrame,
      groups_to_scan: selectedGroups,
      account_id: accountId
    };

    onSearchStart(searchQuery);
  };

  const handleStopSearch = () => {
    if (eventSource) {
      eventSource.close();
      setEventSource(null);
    }
    onSearchStop();
  };

  const saveSearch = () => {
    if (!query.trim()) return;

    const newSearch: SavedSearch = {
      id: Date.now().toString(),
      query_text: query.trim(),
      fidelity,
      time_frame_hours: timeFrame,
      groups_count: selectedGroups.length,
      created_at: new Date().toISOString(),
      last_used: new Date().toISOString(),
      results_count: searchResults.length
    };

    const updatedSearches = [newSearch, ...savedSearches.slice(0, 9)]; // Keep last 10
    setSavedSearches(updatedSearches);
    localStorage.setItem(`semantic_searches_${accountId}`, JSON.stringify(updatedSearches));
  };

  const loadSavedSearch = (savedSearch: SavedSearch) => {
    setQuery(savedSearch.query_text);
    setFidelity(savedSearch.fidelity as 'exact' | 'close' | 'semantic');
    setTimeFrame(savedSearch.time_frame_hours);
    setShowSavedSearches(false);
  };

  const deleteSavedSearch = (searchId: string) => {
    const updatedSearches = savedSearches.filter(s => s.id !== searchId);
    setSavedSearches(updatedSearches);
    localStorage.setItem(`semantic_searches_${accountId}`, JSON.stringify(updatedSearches));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-elevated w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className="glass-card p-3 rounded-xl">
              <Search className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">חיפוש סמנטי מתקדם</h2>
              <p className="text-gray-300">חפש הודעות לפי משמעות ולא רק מילות מפתח</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="glass-card p-3 rounded-xl hover:bg-white/10 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
        </div>

        <div className="flex h-[calc(90vh-120px)]">
          {/* Left Panel - Search Controls */}
          <div className="w-1/3 p-6 border-r border-white/10 overflow-y-auto">
            {/* Search Query */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-white mb-2">
                טקסט החיפוש
              </label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="לדוגמה: זוגות מחפשים ביסקסואל בודד..."
                className="w-full p-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={3}
                disabled={isSearching}
              />
            </div>

            {/* Fidelity Slider */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-white mb-2">
                רמת דיוק: {fidelity === 'exact' ? 'מדויק' : fidelity === 'close' ? 'קרוב' : 'סמנטי'}
              </label>
              <div className="space-y-2">
                <div className="flex items-center space-x-3">
                  <input
                    type="radio"
                    id="exact"
                    name="fidelity"
                    value="exact"
                    checked={fidelity === 'exact'}
                    onChange={(e) => setFidelity(e.target.value as 'exact')}
                    className="w-4 h-4 text-blue-600"
                    disabled={isSearching}
                  />
                  <label htmlFor="exact" className="text-white cursor-pointer">
                    מדויק (95%+ דמיון)
                  </label>
                </div>
                <div className="flex items-center space-x-3">
                  <input
                    type="radio"
                    id="close"
                    name="fidelity"
                    value="close"
                    checked={fidelity === 'close'}
                    onChange={(e) => setFidelity(e.target.value as 'close')}
                    className="w-4 h-4 text-blue-600"
                    disabled={isSearching}
                  />
                  <label htmlFor="close" className="text-white cursor-pointer">
                    קרוב (70%+ דמיון)
                  </label>
                </div>
                <div className="flex items-center space-x-3">
                  <input
                    type="radio"
                    id="semantic"
                    name="fidelity"
                    value="semantic"
                    checked={fidelity === 'semantic'}
                    onChange={(e) => setFidelity(e.target.value as 'semantic')}
                    className="w-4 h-4 text-blue-600"
                    disabled={isSearching}
                  />
                  <label htmlFor="semantic" className="text-white cursor-pointer">
                    סמנטי (50%+ דמיון)
                  </label>
                </div>
              </div>
            </div>

            {/* Time Frame */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-white mb-2">
                חלון זמן (שעות)
              </label>
              <div className="flex items-center space-x-3">
                <Clock className="w-5 h-5 text-gray-400" />
                <input
                  type="number"
                  value={timeFrame}
                  onChange={(e) => setTimeFrame(parseInt(e.target.value) || 24)}
                  min="1"
                  max="168"
                  className="flex-1 p-3 bg-white/5 border border-white/20 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isSearching}
                />
              </div>
            </div>

            {/* Group Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-white mb-2">
                קבוצות לסריקה
              </label>
              <button
                onClick={() => setShowGroupSelector(!showGroupSelector)}
                className="w-full p-3 bg-white/5 border border-white/20 rounded-xl text-white hover:bg-white/10 transition-colors text-right"
                disabled={isSearching}
              >
                {selectedGroups.length === 0 ? 'כל הקבוצות' : `${selectedGroups.length} קבוצות נבחרו`}
              </button>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              {!isSearching ? (
                <button
                  onClick={handleSearch}
                  disabled={!query.trim()}
                  className="w-full btn-primary flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Search className="w-5 h-5" />
                  <span>התחל חיפוש</span>
                </button>
              ) : (
                <button
                  onClick={handleStopSearch}
                  className="w-full btn-destructive flex items-center justify-center space-x-2"
                >
                  <Pause className="w-5 h-5" />
                  <span>עצור חיפוש</span>
                </button>
              )}

              <div className="flex space-x-2">
                <button
                  onClick={saveSearch}
                  disabled={!query.trim() || isSearching}
                  className="flex-1 btn-secondary flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" />
                  <span>שמור</span>
                </button>
                <button
                  onClick={() => setShowSavedSearches(!showSavedSearches)}
                  className="flex-1 btn-secondary flex items-center justify-center space-x-2"
                >
                  <Settings className="w-4 h-4" />
                  <span>שמורים</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Panel - Results and Progress */}
          <div className="flex-1 p-6 overflow-y-auto">
            {/* Real-time Progress */}
            {searchProgress && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-3">התקדמות החיפוש</h3>
                <div className="glass-card p-4 rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-white font-medium">{searchProgress.message || 'מתחיל חיפוש...'}</span>
                    <span className="text-blue-400 text-sm">
                      {searchProgress.status === 'retrieving' ? 'מביא הודעות...' :
                       searchProgress.status === 'searching' ? 'מחפש...' :
                       searchProgress.status === 'completed' ? 'הושלם' : 'מתחיל...'}
                    </span>
                  </div>
                  
                  {searchProgress.total && searchProgress.total > 0 && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-300">
                        <span>הודעות: {searchProgress.processed || 0} / {searchProgress.total}</span>
                        <span>תוצאות: {searchProgress.matches || 0}</span>
                      </div>
                      {searchProgress.messages_scanned && (
                        <div className="text-xs text-green-400">
                          נסרקו {searchProgress.messages_scanned} הודעות מהנתונים השמורים
                        </div>
                      )}
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div 
                          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${searchProgress.progress || 0}%` }}
                        ></div>
                      </div>
                      <div className="text-xs text-gray-400">
                        {searchProgress.progress ? `${Math.round(searchProgress.progress)}%` : '0%'} הושלם
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Real-time Updates */}
            {realtimeUpdates.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-3">עדכונים בזמן אמת</h3>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {realtimeUpdates.map((update, index) => (
                    <div
                      key={index}
                      className="realtime-update p-2 bg-blue-500/20 border border-blue-500/30 rounded-lg text-sm text-blue-300 animate-fade-in-up"
                      style={{ animationDelay: `${index * 0.1}s` }}
                    >
                      {update}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">
                  תוצאות חיפוש ({searchResults.length})
                </h3>
                <div className="space-y-3">
                  {searchResults.map((result, index) => (
                    <div
                      key={index}
                      className="glass-card p-4 rounded-xl hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="font-medium text-white mb-1">
                            {result.chat_name}
                          </h4>
                          <p className="text-sm text-gray-300 mb-2">
                            {new Date(result.timestamp).toLocaleString('he-IL')}
                          </p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded-full">
                            {(result.similarity_score * 100).toFixed(1)}% דמיון
                          </span>
                        </div>
                      </div>
                      <p className="text-white/80 text-sm mb-2">{result.message_text}</p>
                      {result.matched_keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {result.matched_keywords.map((keyword, idx) => (
                            <span
                              key={idx}
                              className="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded-full"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No Results */}
            {!isSearching && searchResults.length === 0 && query && (
              <div className="text-center py-12">
                <Search className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">לא נמצאו תוצאות</h3>
                <p className="text-gray-400">נסה לשנות את רמת הדיוק או את טקסט החיפוש</p>
              </div>
            )}
          </div>
        </div>

        {/* Saved Searches Modal */}
        {showSavedSearches && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-60 p-4">
            <div className="glass-elevated w-full max-w-2xl rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">חיפושים שמורים</h3>
                <button
                  onClick={() => setShowSavedSearches(false)}
                  className="glass-card p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {savedSearches.map((search) => (
                  <div key={search.id} className="glass-card p-4 rounded-xl">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-white mb-1">{search.query_text}</p>
                        <p className="text-sm text-gray-300">
                          {search.fidelity} • {search.time_frame_hours} שעות • {search.results_count} תוצאות
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => loadSavedSearch(search)}
                          className="btn-primary px-3 py-1 text-sm"
                        >
                          טען
                        </button>
                        <button
                          onClick={() => deleteSavedSearch(search.id)}
                          className="btn-destructive px-3 py-1 text-sm"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SemanticSearchModal;
