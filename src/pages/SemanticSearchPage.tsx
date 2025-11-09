import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader, X, Search, Clock, Settings, Save, Trash2, Pause } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import SharedGroupsList from '../components/ui/SharedGroupsList';
import HeaderFullScreen from '../components/ui/HeaderFullScreen';
import { useAppContext } from '../App';

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

const SemanticSearchPage: React.FC = () => {
  const navigate = useNavigate();
  const { accountId = '' } = useParams<{ accountId: string }>();
  const { accountsState, semanticSearch } = useAppContext();
  const { startSearch, stopSearch, searchProgress, searchResults, isSearching } = semanticSearch;
  const resultsFromContext = searchResults ?? [];
  const account = useMemo(() => accountsState.accounts.find(acc => acc.id === accountId), [accountsState.accounts, accountId]);
  const isAuthenticated = account?.is_authenticated ?? false;
  useEffect(() => {
    if (accountsState.loading) {
      return;
    }
    if (!account) {
      navigate('/', { replace: true });
    }
  }, [accountsState.loading, account, navigate]);

  const [query, setQuery] = useState('');
  const [fidelity, setFidelity] = useState<'exact' | 'close' | 'semantic'>('semantic');
  const [timeFrame, setTimeFrame] = useState(24);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<Record<number, string>>({});
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSavedSearches, setShowSavedSearches] = useState(false);
  const [realtimeUpdates, setRealtimeUpdates] = useState<string[]>([]);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [activeSection, setActiveSection] = useState<'search' | 'results'>('search');
  const [liveResults, setLiveResults] = useState<SearchResult[]>([]);
  const handleGroupsLoaded = useCallback((groups: any[]) => {
    const mapping: Record<number, string> = {};
    groups.forEach((group) => {
      if (group && typeof group.id === 'number') {
        mapping[group.id] = group.title || group.name || 'ללא שם';
      }
    });
    setAvailableGroups((prev) => ({ ...prev, ...mapping }));
  }, []);
  const pushRealtimeUpdate = useCallback((message: string) => {
    setRealtimeUpdates(prev => [message, ...prev.slice(0, 9)]);
  }, []);
  const upsertLiveResult = useCallback((incoming: SearchResult) => {
    setLiveResults(prev => {
      const key = `${incoming.chat_id}-${incoming.message_id}`;
      const existingIndex = prev.findIndex(item => `${item.chat_id}-${item.message_id}` === key);
      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = incoming;
        return updated;
      }
      return [incoming, ...prev].slice(0, 200);
    });
  }, []);
  const parsePreviewToResult = useCallback((preview: any): SearchResult => {
    const similarityValue = typeof preview?.similarity === 'number'
      ? preview.similarity
      : typeof preview?.similarity_score === 'number'
        ? preview.similarity_score
        : 0;
    return {
      message_id: preview?.message_id ?? preview?.id ?? Date.now(),
      chat_id: preview?.chat_id ?? preview?.chatId ?? 0,
      chat_name: preview?.chat_name ?? preview?.chatName ?? 'ללא שם',
      message_text: preview?.content ?? preview?.message_text ?? '',
      timestamp: preview?.timestamp ?? new Date().toISOString(),
      similarity_score: Number(similarityValue),
      matched_keywords: preview?.matched_keywords ?? preview?.keywords ?? []
    };
  }, []);
  const displayedResults = useMemo(() => {
    return liveResults.length > 0 ? liveResults : resultsFromContext;
  }, [liveResults, resultsFromContext]);

  if (!account) {
    if (accountsState.loading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950/95 text-white">
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      );
    }
    return null;
  }

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

  useEffect(() => {
    setActiveSection('search');
    setLiveResults([]);
    setRealtimeUpdates([]);
    setShowGroupSelector(false);
  }, [accountId]);

  // Real-time updates via SSE
  useEffect(() => {
    if (isSearching && accountId) {
      const source = new EventSource(
        `http://127.0.0.1:8001/accounts/${accountId}/semantic-scan-events?query_text=${encodeURIComponent(query)}&fidelity=${fidelity}&time_frame_hours=${timeFrame}`
      );
      setEventSource(source);

      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'search_started') {
            pushRealtimeUpdate(`🔍 ${data.message}`);
            setLiveResults([]);
            setActiveSection('results');
          } else if (data.type === 'retrieving_messages') {
            pushRealtimeUpdate(`📥 ${data.message}`);
          } else if (data.type === 'messages_retrieved') {
            pushRealtimeUpdate(`✅ ${data.message}`);
          } else if (data.type === 'search_progress') {
            pushRealtimeUpdate(`🔄 סורק הודעות: ${data.processed}/${data.total} (${data.matches} תוצאות)`);
          } else if (data.type === 'message_preview') {
            const preview = data.message_preview || data;
            pushRealtimeUpdate(`🔍 [${preview.chat_name}] ${preview.content} (דמיון: ${preview.similarity})`);
            upsertLiveResult(parsePreviewToResult(preview));
          } else if (data.type === 'match_found') {
            const preview = data.message_preview;
            pushRealtimeUpdate(`✨ [${preview.chat_name}] ${preview.content} (דמיון: ${preview.similarity})`);
            upsertLiveResult(parsePreviewToResult(preview));
          } else if (data.type === 'search_complete') {
            pushRealtimeUpdate(`🎉 סריקה הושלמה! ${data.total_matches} תוצאות`);
            source.close();
            setEventSource(null);
          } else if (data.type === 'error') {
            pushRealtimeUpdate(`❌ שגיאה: ${data.message}`);
            source.close();
            setEventSource(null);
          }
        } catch (error) {
          console.error('Error parsing SSE data:', error);
        }
      };

      source.onerror = (error) => {
        console.error('SSE error:', error);
        pushRealtimeUpdate('❌ חיבור נקטע');
        source.close();
        setEventSource(null);
      };

      return () => {
        source.close();
        setEventSource(null);
      };
    }
  }, [isSearching, accountId, query, fidelity, timeFrame, parsePreviewToResult, pushRealtimeUpdate, upsertLiveResult]);

  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
      }
      stopSearch();
    };
  }, [eventSource, stopSearch]);

  const handleSearch = () => {
    if (!query.trim()) return;

    const searchQuery: SemanticSearchQuery = {
      query_text: query.trim(),
      fidelity,
      time_frame_hours: timeFrame,
      groups_to_scan: Array.from(selectedGroupIds).map((id) => id.toString()),
      account_id: accountId
    };

    setActiveSection('results');
    setLiveResults([]);
    startSearch(searchQuery);
  };

  const handleBack = () => {
    if (eventSource) {
      eventSource.close();
      setEventSource(null);
    }
    stopSearch();
    navigate('/');
  };

  const handleStopSearch = () => {
    if (eventSource) {
      eventSource.close();
      setEventSource(null);
    }
    stopSearch();
  };

  const saveSearch = () => {
    if (!query.trim()) return;

    const newSearch: SavedSearch = {
      id: Date.now().toString(),
      query_text: query.trim(),
      fidelity,
      time_frame_hours: timeFrame,
      groups_count: selectedGroupIds.size,
      created_at: new Date().toISOString(),
      last_used: new Date().toISOString(),
      results_count: displayedResults.length
    };

    const updatedSearches = [newSearch, ...savedSearches.slice(0, 9)]; // Keep last 10
    setSavedSearches(updatedSearches);
    localStorage.setItem(`semantic_searches_${accountId}`, JSON.stringify(updatedSearches));
  };

  const loadSavedSearch = (savedSearch: SavedSearch) => {
    setQuery(savedSearch.query_text);
    setFidelity(savedSearch.fidelity as 'exact' | 'close' | 'semantic');
    setTimeFrame(savedSearch.time_frame_hours);
    setSelectedGroupIds(new Set());
    setShowSavedSearches(false);
  };

  const deleteSavedSearch = (searchId: string) => {
    const updatedSearches = savedSearches.filter(s => s.id !== searchId);
    setSavedSearches(updatedSearches);
    localStorage.setItem(`semantic_searches_${accountId}`, JSON.stringify(updatedSearches));
  };

  const resultCount = liveResults.length > 0 ? liveResults.length : resultsFromContext.length;
  const statusChipClass = isSearching
    ? 'border border-emerald-400/30 bg-emerald-500/20 text-emerald-200'
    : 'border border-white/20 bg-white/10 text-white/70';
  const headerActions = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`rounded-full px-3 py-1 ${statusChipClass}`}>
        {isSearching ? 'חיפוש פעיל' : 'מוכן לחיפוש'}
      </span>
      {resultCount > 0 && (
        <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-white/80">
          {resultCount} תוצאות
        </span>
      )}
      <button
        type="button"
        onClick={() => setShowSavedSearches(true)}
        className="btn-secondary flex items-center gap-2"
      >
        <Settings className="h-4 w-4" />
        חיפושים שמורים
      </button>
    </div>
  );

  const renderResultsPanel = () => (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Real-time Progress */}
      {searchProgress && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3">התקדמות החיפוש</h3>
          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-medium">{searchProgress.message || 'מתחיל חיפוש...'}</span>
              <span className="text-blue-400 text-sm">
                {searchProgress.status === 'retrieving'
                  ? 'מביא הודעות...'
                  : searchProgress.status === 'searching'
                    ? 'מחפש...'
                    : searchProgress.status === 'completed'
                      ? 'הושלם'
                      : 'מתחיל...'}
              </span>
            </div>
            {searchProgress.total && searchProgress.total > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-gray-300">
                  <span>הודעות: {searchProgress.processed || 0} / {searchProgress.total}</span>
                  <span>תוצאות: {searchProgress.matches || 0}</span>
                </div>
                <div className="w-full rounded-full bg-gray-700 h-2">
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
          <div className="space-y-2 max-h-64 overflow-y-auto">
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
      {displayedResults.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-3">
            תוצאות חיפוש ({displayedResults.length})
          </h3>
          <div className="space-y-3">
            {displayedResults.map((result, index) => (
              <div
                key={`${result.chat_id}-${result.message_id}-${index}`}
                className="glass-card p-4 rounded-xl transition-colors hover:bg-white/5"
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
                {result.matched_keywords && result.matched_keywords.length > 0 && (
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
      {!isSearching && displayedResults.length === 0 && query && (
        <div className="py-12 text-center">
          <Search className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">לא נמצאו תוצאות</h3>
          <p className="text-gray-400">נסה לשנות את רמת הדיוק או את טקסט החיפוש</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative z-10 flex min-h-screen flex-col overflow-hidden bg-slate-950/95" dir="rtl">
        <HeaderFullScreen
          title="חיפוש סמנטי מתקדם"
          onBack={handleBack}
          description="חפש הודעות לפי משמעות ולא רק מילות מפתח"
          actions={headerActions}
        />
        <div className="border-b border-white/10 bg-white/5">
          <div className="flex justify-center px-6 pb-4">
            <div className="inline-flex rounded-xl bg-white/10 p-1">
              <button
                type="button"
                onClick={() => setActiveSection('search')}
                className={`min-w-[140px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  activeSection === 'search'
                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                פרטי חיפוש
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('results')}
                className={`min-w-[140px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  activeSection === 'results'
                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                    : 'text-white/70 hover:text-white'
                }`}
                disabled={!isSearching && liveResults.length === 0 && resultsFromContext.length === 0}
              >
                תוצאות חיפוש
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {activeSection === 'search' ? (
            <div className="flex w-full flex-col md:flex-row">
          {/* Left Panel - Search Controls */}
          <div className="w-full border-b border-white/10 bg-black/30 p-6 md:w-[360px] md:flex-shrink-0 md:border-b-0 md:border-l md:border-white/10 md:overflow-y-auto">
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
                {selectedGroupIds.size === 0 ? 'כל הקבוצות' : `${selectedGroupIds.size} קבוצות נבחרו`}
              </button>
              {selectedGroupIds.size > 0 && (
                <div className="mt-2 text-xs text-white/60">
                  {Array.from(selectedGroupIds)
                    .slice(0, 3)
                    .map((id) => availableGroups[id] || `קבוצה ${id}`)
                    .join(', ')}
                      {selectedGroupIds.size > 3 && ` ועוד ${selectedGroupIds.size - 3}`}
                </div>
              )}
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
              <div className="flex-1 min-h-0 overflow-hidden bg-black/10">
                {renderResultsPanel()}
              </div>
            </div>
          ) : (
            renderResultsPanel()
          )}
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
      {showGroupSelector && (
        <div
          className="fixed inset-0 z-[2050] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          dir="rtl"
          onClick={() => setShowGroupSelector(false)}
        >
          <div
            className="relative w-full max-w-4xl rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">בחר קבוצות לסריקה</h3>
              <button
                onClick={() => setShowGroupSelector(false)}
                className="rounded-full bg-white/10 p-2 text-white transition hover:bg-red-500/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-3 flex items-center justify-between text-sm text-white/70">
              <span>
                {selectedGroupIds.size === 0
                  ? 'כל הקבוצות יסרקו'
                  : `נבחרו ${selectedGroupIds.size} קבוצות לסריקה`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedGroupIds(new Set())}
                  className="btn-secondary px-4 py-2 text-xs"
                >
                  נקה בחירה
                </button>
                <button
                  onClick={() => setShowGroupSelector(false)}
                  className="btn-primary px-4 py-2 text-xs"
                >
                  סיום
                </button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto rounded-2xl border border-white/10 bg-white/5">
              <SharedGroupsList
                accountId={accountId}
                isAuthenticated={isAuthenticated}
                showSelection={true}
                selectedChats={selectedGroupIds}
                onSelectionChange={(selection) => setSelectedGroupIds(new Set(selection))}
                onGroupsLoaded={handleGroupsLoaded}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SemanticSearchPage;
