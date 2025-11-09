import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Play, 
  Square, 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Loader,
  Trash2,
  Eye,
  MessageSquare,
  Users,
  Clock,
  RefreshCw,
  Search,
  X,
  ChevronDown,
  FolderX,
  Sparkles,
  RotateCcw,
  Activity
} from 'lucide-react';
import SharedGroupsList from './SharedGroupsList';
import ScanGuidancePanel from './ScanGuidancePanel';
import HeaderFullScreen from './ui/HeaderFullScreen';
import FoundMessagesModal from './ui/FoundMessagesModal';
import type { GuidanceStage, ScanGuidance } from '../hooks/useScan';

interface Message {
  id: number;
  content: string;
  date: string;
  foundAt?: string;
  sender?: string | number;
  link?: string | null;
  status?: 'pending' | 'deleted' | 'failed';
  selected: boolean;
  key?: string;
}

interface ChatInfo {
  id: number;
  title: string;
  status: 'pending' | 'scanning' | 'completed' | 'skipped' | 'error' | 'deleting';
  messages_found: number;
  messages_deleted: number;
  member_count: number;
  progress_percent: number;
  has_unscanned_dates: boolean;
  user_joined_at?: string;
  error?: string;
  reason?: string;
  messages?: Message[];
  selected: boolean;
}

interface DiamondScanInterfaceProps {
  accountId: string;
  accountLabel: string;
  onClose: () => void;
  onStartScan: (isFullScan: boolean, batchSize?: number) => void;
  onStopScan: () => void;
  isScanning: boolean;
  scanProgress?: any;
  lastScanResults?: ChatInfo[];
  isAuthenticated: boolean;
  onShowRecentMessages: () => void;
  guidance: ScanGuidance;
  onUpdateGuidance?: (stage: GuidanceStage, overrides?: Partial<ScanGuidance>) => void;
}

const normalizeChat = (chat: Partial<ChatInfo> & Record<string, unknown>): ChatInfo => {
  const rawId = chat.id;
  let id = 0;
  if (typeof rawId === 'number') {
    id = rawId;
  } else if (typeof rawId === 'string') {
    const maybe = Number(rawId);
    id = Number.isNaN(maybe) ? 0 : maybe;
  }
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const messagesFound =
    typeof chat.messages_found === 'number'
      ? chat.messages_found
      : typeof chat.candidates_found === 'number'
        ? chat.candidates_found
        : 0;
  const messagesDeleted =
    typeof chat.messages_deleted === 'number'
      ? chat.messages_deleted
      : typeof chat.deleted === 'number'
        ? chat.deleted
        : 0;

  return {
    id,
    title: chat.title || 'Unknown',
    status:
      chat.status ??
      (chat.error ? 'error' : messagesFound > 0 || messagesDeleted > 0 ? 'completed' : 'pending'),
    messages_found: messagesFound,
    messages_deleted: messagesDeleted,
    member_count: chat.member_count ?? 0,
    progress_percent: chat.progress_percent ?? 0,
    has_unscanned_dates: chat.has_unscanned_dates ?? false,
    messages,
    selected: chat.selected ?? false,
    error: chat.error,
    reason: chat.reason
  };
};

const DiamondScanInterface: React.FC<DiamondScanInterfaceProps> = ({
  accountId,
  accountLabel,
  onClose,
  onStartScan,
  onStopScan,
  isScanning,
  scanProgress,
  lastScanResults,
  isAuthenticated,
  onShowRecentMessages,
  guidance,
  onUpdateGuidance
}) => {
  const hydratedChats = useMemo(() => {
    if (!lastScanResults || lastScanResults.length === 0) {
      return [];
    }
    return lastScanResults.map(normalizeChat);
  }, [lastScanResults]);

  const [allChats, setAllChats] = useState<ChatInfo[]>(hydratedChats);
  const [loadingChats, setLoadingChats] = useState(false);
  const [scannedChats, setScannedChats] = useState<ChatInfo[]>([]);
  const [currentScanningChat, setCurrentScanningChat] = useState<ChatInfo | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    scanning: 0,
    pending: 0,
    totalMessages: 0,
    totalDeleted: 0
  });
  const [selectedChat, setSelectedChat] = useState<ChatInfo | null>(null);
  const [showChatModal, setShowChatModal] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [chatMembers, setChatMembers] = useState<any[]>([]);
  const [showMembersTooltip, setShowMembersTooltip] = useState(false);
  const [showDiamonds, setShowDiamonds] = useState(true);
  const [showFoundMessagesModal, setShowFoundMessagesModal] = useState(false);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [isPaused, setIsPaused] = useState(false);
  const [hasPreviousScan, setHasPreviousScan] = useState(false);
  const [realtimeUpdates, setRealtimeUpdates] = useState<string[]>([]);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [loadingChatMessages, setLoadingChatMessages] = useState(false);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMessagesError, setLoadingMessagesError] = useState<string | null>(null);
  const [currentProgress, setCurrentProgress] = useState<any>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const lastRequestedCursorRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (loadAbortRef.current) {
        loadAbortRef.current.abort();
        loadAbortRef.current = null;
      }
    };
  }, []);

  const normalizeFetchedMessage = useCallback((item: any): Message => {
    const rawId = item?.messageId ?? item?.message_id ?? item?.id;
    const messageId = typeof rawId === 'number' ? rawId : Number(rawId ?? 0);

    return {
      id: Number.isNaN(messageId) ? 0 : messageId,
      content: item?.content ?? item?.message ?? '',
      date: item?.date ?? item?.foundAt ?? new Date().toISOString(),
      foundAt: item?.foundAt ?? item?.found_at ?? undefined,
      sender: item?.sender,
      link: item?.link ?? null,
      status: item?.deleted ? 'deleted' : 'pending',
      selected: false,
      key: item?.key
    };
  }, []);

  const applyMessagesToChat = useCallback(
    (chatId: number, newMessages: Message[], append: boolean, totalCount: number) => {
      setSelectedChat(prev => {
        if (!prev || prev.id !== chatId) {
          return prev;
        }
        const existing = append && Array.isArray(prev.messages) ? prev.messages : [];
        const merged = append ? [...existing, ...newMessages] : newMessages;
        return {
          ...prev,
          messages: merged,
          messages_found: totalCount
        };
      });

      const updateList = (list: ChatInfo[]) =>
        list.map(chat => {
          if (chat.id !== chatId) {
            return chat;
          }
          const existing = append && Array.isArray(chat.messages) ? chat.messages : [];
          const merged = append ? [...existing, ...newMessages] : newMessages;
          return {
            ...chat,
            messages: merged,
            messages_found: totalCount
          };
        });

      setAllChats(prev => updateList(prev));
      setScannedChats(prev => updateList(prev));
    },
    []
  );

  const fetchChatMessages = useCallback(
    (chatId: number, cursorValue: string | null = null) => {
      if (loadAbortRef.current) {
        loadAbortRef.current.abort();
        loadAbortRef.current = null;
      }

      if (!cursorValue) {
        setLoadingMessagesError(null);
        setMessagesCursor(null);
      }

      lastRequestedCursorRef.current = cursorValue;
      setLoadingChatMessages(true);

      const execute = (attempt: number) => {
        const controller = new AbortController();
        loadAbortRef.current = controller;
        const params = new URLSearchParams();
        params.set('limit', '50');
        if (cursorValue) {
          params.set('cursor', cursorValue);
        }

        const timeoutId = window.setTimeout(() => controller.abort(), 20000);
        let shouldFinalize = true;

        fetch(`http://127.0.0.1:8001/accounts/${accountId}/chat-messages/${chatId}?${params.toString()}`, {
          signal: controller.signal
        })
          .then(async response => {
            if (!response.ok) {
              throw new Error(`שגיאת שרת (${response.status})`);
            }
            const data = await response.json();
            if (!data.success) {
              throw new Error(data.error || 'טעינת ההודעות נכשלה');
            }

            const normalized: Message[] = (data.messages || []).map(normalizeFetchedMessage);
            applyMessagesToChat(
              chatId,
              normalized,
              Boolean(cursorValue),
              data.total_messages ?? normalized.length
            );
            setMessagesCursor(data.next_cursor ?? null);
            setHasMoreMessages(Boolean(data.next_cursor));
            setLoadingMessagesError(null);
            if (!cursorValue) {
              setSelectedMessages(new Set());
            }
            lastRequestedCursorRef.current = null;
          })
          .catch((error: any) => {
            if ((error?.name || error?.code) === 'AbortError') {
              setLoadingMessagesError('הבקשה בוטלה או פג תוקף. נסה שוב.');
              return;
            }

            if (attempt < 1) {
              shouldFinalize = false;
              const jitter = 300 + Math.random() * 500;
              window.setTimeout(() => execute(attempt + 1), jitter);
              return;
            }

            setLoadingMessagesError(error?.message || 'שגיאה בטעינת ההודעות');
            setHasMoreMessages(Boolean(cursorValue));
          })
          .finally(() => {
            clearTimeout(timeoutId);
            if (shouldFinalize) {
              if (loadAbortRef.current === controller) {
                loadAbortRef.current = null;
              }
              setLoadingChatMessages(false);
            }
          });
      };

      execute(0);
    },
    [accountId, applyMessagesToChat, normalizeFetchedMessage]
  );

  const handleRetryMessages = useCallback(() => {
    if (!selectedChat) {
      return;
    }
    const cursorValue = lastRequestedCursorRef.current;
    fetchChatMessages(selectedChat.id, cursorValue ?? null);
  }, [fetchChatMessages, selectedChat]);

  const handleLoadMoreMessages = useCallback(() => {
    if (!selectedChat || !messagesCursor) {
      return;
    }
    fetchChatMessages(selectedChat.id, messagesCursor);
  }, [fetchChatMessages, messagesCursor, selectedChat]);

  const displayedMessageCount = selectedChat?.messages ? selectedChat.messages.length : 0;
  const totalMessageCount = selectedChat?.messages_found ?? displayedMessageCount;
  const hasLoadedMessages = displayedMessageCount > 0;

  useEffect(() => {
    setStats(prev => ({
      ...prev,
      total: allChats.length,
      completed: scannedChats.filter(chat => chat.status === 'completed').length,
      pending: Math.max(0, allChats.length - scannedChats.length),
      totalMessages: scannedChats.reduce((sum, chat) => sum + (chat.messages_found || 0), 0),
      totalDeleted: prev.totalDeleted
    }));
  }, [allChats, scannedChats]);

  useEffect(() => {
    if (hydratedChats.length === 0) {
      return;
    }
    setAllChats(hydratedChats);
    setScannedChats(hydratedChats);
    setStats({
      total: hydratedChats.length,
      completed: hydratedChats.filter(chat => chat.status === 'completed').length,
      scanning: 0,
      pending: hydratedChats.filter(chat => chat.status === 'pending').length,
      totalMessages: hydratedChats.reduce((sum, chat) => sum + (chat.messages_found || 0), 0),
      totalDeleted: hydratedChats.reduce((sum, chat) => sum + (chat.messages_deleted || 0), 0)
    });
    setHasPreviousScan(true);
  }, [hydratedChats]);

  // Load all chats on component mount
  useEffect(() => {
    loadSavedState();
  }, [accountId]);

  // Real-time updates via Server-Sent Events
  useEffect(() => {
    if (!isScanning || !accountId) {
      return;
    }

    // Close existing connection if any
    if (eventSource) {
      eventSource.close();
      setEventSource(null);
    }

    const source = new EventSource(`http://127.0.0.1:8001/accounts/${accountId}/scan-events`);
    setEventSource(source);

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'scan_status' || data.type === 'scan_progress') {
          // Update scan progress
          if (data.status === 'scanning') {
            const updateMessage = `🔍 סורק: ${data.current_chat} (${data.current_index}/${data.total_chats || data.total || 0})`;
            setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]); // Keep last 10 updates
          }
          
          // Update stats with total_chats from backend
          setStats(prev => ({
            ...prev,
            total: data.total_chats || data.total || prev.total || 0,
            completed: data.current_index || prev.completed || 0,
            totalMessages: data.messages_found || prev.totalMessages || 0
          }));
          
          // Update current progress state
          if (data.total_chats || data.total) {
            setCurrentProgress(prev => ({
              ...prev,
              total_chats: data.total_chats || data.total || prev.total_chats || 0,
              current_index: data.current_index || prev.current_index || 0,
              current_chat: data.current_chat || prev.current_chat || '',
              current_chat_id: data.current_chat_id || data.chat_id || prev.current_chat_id || 0
            }));
          }
        } else if (data.type === 'scan_complete') {
          setRealtimeUpdates(prev => ['✅ סריקה הושלמה!', ...prev.slice(0, 9)]);
          // Close SSE connection when scan is complete
          source.close();
          setEventSource(null);
        } else if (data.type === 'scan_idle') {
          setRealtimeUpdates(prev => ['⏸️ סריקה לא פעילה', ...prev.slice(0, 9)]);
          // Close SSE connection when scan is idle
          source.close();
          setEventSource(null);
        } else if (data.type === 'error') {
          setRealtimeUpdates(prev => [`❌ שגיאה: ${data.message}`, ...prev.slice(0, 9)]);
          // Close SSE connection on error
          source.close();
          setEventSource(null);
        }
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };

    source.onerror = (error) => {
      console.error('SSE error:', error);
      setRealtimeUpdates(prev => ['❌ חיבור נקטע', ...prev.slice(0, 9)]);
      // Close SSE connection on error
      source.close();
      setEventSource(null);
    };

    return () => {
      source.close();
      setEventSource(current => (current === source ? null : current));
    };
  }, [isScanning, accountId]);

  useEffect(() => {
    return () => {
      if (loadAbortRef.current) {
        loadAbortRef.current.abort();
        loadAbortRef.current = null;
      }
    };
  }, []);

  // Load saved state from localStorage
const loadSavedState = () => {
  try {
    const savedState = localStorage.getItem(`diamond_scan_${accountId}`);
    if (savedState) {
      const state = JSON.parse(savedState);
      const savedChats: ChatInfo[] = (state.scannedChats || []).map(normalizeChat);

      setScannedChats(savedChats);
      setAllChats(prev => (prev.length === 0 ? savedChats : prev));

      const recomputedStats = {
        total: savedChats.length,
        completed: savedChats.filter(chat => chat.status === 'completed').length,
        scanning: savedChats.filter(chat => chat.status === 'scanning').length,
        pending: savedChats.filter(chat => chat.status === 'pending').length,
        totalMessages: savedChats.reduce((sum, chat) => sum + (chat.messages_found || 0), 0),
        totalDeleted: savedChats.reduce((sum, chat) => sum + (chat.messages_deleted || 0), 0)
      };

      setStats(prev => ({
        ...prev,
        ...state.stats,
        ...recomputedStats
      }));
        
        // Check if there's a previous scan that wasn't completed
        const hasIncompleteScan = state.scannedChats && state.scannedChats.length > 0 && 
          (state.stats.completed < state.stats.total);
        
        if (hasIncompleteScan) {
          setHasPreviousScan(true);
          console.log('Found previous incomplete scan');
        }
        
        console.log('Loaded saved state:', state);
      }
    } catch (error) {
      console.error('Error loading saved state:', error);
    }
  };

  const handleGroupsLoaded = (groups: ChatInfo[]) => {
    setAllChats(groups);
    setStats(prev => ({ ...prev, total: groups.length, pending: groups.length }));
  };

  // Save state to localStorage
  const saveState = () => {
    try {
      const state = {
        scannedChats,
        stats,
        timestamp: Date.now()
      };
      localStorage.setItem(`diamond_scan_${accountId}`, JSON.stringify(state));
    } catch (error) {
      console.error('Error saving state:', error);
    }
  };

  // Save state whenever scannedChats or stats change
  useEffect(() => {
    if (scannedChats.length > 0 || stats.total > 0) {
      saveState();
    }
  }, [scannedChats, stats, accountId]);

  // Auto-hide success/error messages
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Poll for scan progress
  useEffect(() => {
    if (isScanning) {
      const interval = setInterval(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/scan-status`);
          const data = await response.json();
          
          if (data.success) {
            const progress = data.result.scan_progress;
            const scanned = data.result.scanned_chats || [];
            
            console.log('Scan progress update:', progress);
            console.log('Scanned chats:', scanned);
            
            // Store progress in state for use in JSX
            setCurrentProgress(progress);
            setScannedChats(scanned);
            
            // Update current scanning chat - show even if status is scanning
            const currentChatName = progress.current_chat || progress.chat_name;
            const currentChatId = progress.current_chat_id || progress.chat_id || 0;
            const currentIndex = progress.current_index || 0;
            const totalGroups = progress.total_chats || progress.total || allChats.length || 0;
            
            if (currentChatName || currentIndex > 0 || progress.status === 'scanning') {
              // Always show current group if scanning
              const progressPercent = progress.progress_percent || 
                (totalGroups > 0 ? Math.floor((currentIndex / totalGroups) * 100) : 0);
              
              console.log('Setting current scanning chat:', {
                name: currentChatName,
                id: currentChatId,
                index: currentIndex,
                total: totalGroups,
                percent: progressPercent
              });
              
              setCurrentScanningChat({
                id: currentChatId,
                title: currentChatName || `קבוצה ${currentIndex} מתוך ${totalGroups}`,
                status: 'scanning',
                messages_found: progress.messages_found || 0,
                messages_deleted: 0,
                member_count: 0,
                progress_percent: progressPercent,
                has_unscanned_dates: false,
                selected: false
              });
            } else if (progress.status !== 'scanning' && progress.status !== 'idle') {
              // Only clear if scan is not active
              console.log('No current chat in progress - clearing');
              setCurrentScanningChat(null);
            }
            // Keep current chat if status is still scanning but no update
            
            // Update allChats with scan status
            setAllChats(prev => prev.map(chat => {
              const scannedChat = scanned.find(sc => sc.id === chat.id);
              if (scannedChat) {
                return {
                  ...chat,
                  status: scannedChat.status,
                  messages_found: scannedChat.messages_found || 0,
                  messages_deleted: scannedChat.messages_deleted || 0,
                  progress_percent: scannedChat.progress_percent || 0,
                  messages: scannedChat.messages || []
                };
              }
              // If currently scanning this chat
              if (progress.current_chat_id === chat.id) {
                return {
                  ...chat,
                  status: 'scanning',
                  progress_percent: progress.progress_percent || 0
                };
              }
              return chat;
            }));
            
            // Update stats
            const completedChats = scanned.filter(chat => chat.status === 'completed');
            const chatsWithMessages = scanned.filter(chat => (chat.messages_found || 0) > 0);
            
            // Use currentIndex and totalGroups already defined above (lines 549-550)
            setStats(prev => ({
              ...prev,
              total: totalGroups || allChats.length,
              completed: completedChats.length,
              scanning: (progress.current_chat || progress.status === 'scanning') ? 1 : 0,
              pending: Math.max(0, (totalGroups || allChats.length) - scanned.length),
              totalMessages: scanned.reduce((sum, chat) => sum + (chat.messages_found || 0), 0),
              totalDeleted: scanned.reduce((sum, chat) => sum + (chat.messages_deleted || 0), 0)
            }));
          }
        } catch (error) {
          console.error('Error fetching scan status:', error);
        }
      }, 1000); // Poll every second for faster updates

      return () => clearInterval(interval);
    }
  }, [isScanning, accountId, allChats.length]);

  useEffect(() => {
    if (!onUpdateGuidance) {
      return;
    }

    const totalGroups = stats.total || allChats.length || scanProgress?.total || 0;
    const completedGroups = scannedChats.filter(chat => chat.status === 'completed').length;
    const skippedGroups = scannedChats.filter(chat => chat.status === 'skipped').length;
    const finishedGroups = completedGroups + skippedGroups;

    if (isScanning) {
      const messageBits: string[] = [];
      if (currentScanningChat?.title) {
        messageBits.push(`כעת סורקים את "${currentScanningChat.title}".`);
      }
      if (totalGroups > 0) {
        messageBits.push(`התקדמות: ${finishedGroups}/${totalGroups} קבוצות.`);
      }

      onUpdateGuidance('scanning', {
        message: messageBits.join(' '),
        batches: {
          total: Math.max(1, Math.ceil(totalGroups / 20)),
          completed: Math.min(
            Math.max(0, Math.ceil(finishedGroups / 20)),
            Math.max(1, Math.ceil(totalGroups / 20))
          ),
          size: 20
        },
        tips: [
          'הסריקה מוצגת באצוות של 20 קבוצות כדי לראות התקדמות מדורגת.',
          'אם תרצה להאיץ, ניתן לעצור בשלב זה ולהריץ סריקה ממוקדת יותר בפחות קבוצות.'
        ]
      });
    } else if (scannedChats.length && guidance.stage === 'scanning') {
      onUpdateGuidance('completed', {
        message: 'הסריקה הסתיימה. ניתן לעיין בממצאים או להריץ סריקה נוספת עם הגדרות חדשות.',
        batches: guidance.batches,
        tips: [
          'השתמש באפשרות הסינון לפי פעילות כדי לקצר את הסריקות הבאות.',
          'ניתן לייצא את התוצאות או לשלוח הודעות ישירות מהתצוגה הנוכחית.'
        ]
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScanning, scannedChats, currentScanningChat, stats.total, allChats.length]);


  const [showClearCacheModal, setShowClearCacheModal] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{
    groups_count: number;
    latest_scan_date: string | null;
    total_messages_found: number;
  } | null>(null);
  const [loadingCacheInfo, setLoadingCacheInfo] = useState(false);

  const loadCacheInfo = async () => {
    setLoadingCacheInfo(true);
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/scan-cache-info`);
      const data = await response.json();
      if (data.success) {
        setCacheInfo({
          groups_count: data.groups_count || 0,
          latest_scan_date: data.latest_scan_date,
          total_messages_found: data.total_messages_found || 0
        });
        setShowClearCacheModal(true);
      } else {
        setError('שגיאה בטעינת פרטי המטמון');
      }
    } catch (error) {
      console.error('Error loading cache info:', error);
      setError('שגיאה בטעינת פרטי המטמון');
    } finally {
      setLoadingCacheInfo(false);
    }
  };

  const handleResetScan = async () => {
    // Load cache info first
    await loadCacheInfo();
  };

  const confirmClearCache = async () => {
    try {
      // Clear scan cache
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/clear-scan-cache`, {
        method: 'POST'
      });
      
      if (response.ok) {
        // Clear local state
        setScannedChats([]);
        setCurrentScanningChat(null);
        setStats({
          total: allChats.length,
          completed: 0,
          scanning: 0,
          pending: allChats.length,
          totalMessages: 0,
          totalDeleted: 0
        });
        
        // Clear localStorage
        localStorage.removeItem(`diamond_scan_${accountId}`);
        
        // Reset all chats to pending
        setAllChats(prev => prev.map(chat => ({
          ...chat,
          status: 'pending' as const,
          messages_found: 0,
          messages_deleted: 0,
          progress_percent: 0
        })));
        
        setShowClearCacheModal(false);
        setCacheInfo(null);
        setSuccess('מטמון הסריקה נוקה בהצלחה. הסריקה הבאה תתחיל מחדש מחודש אחורה.');
      } else {
        setError('שגיאה בניקוי מטמון הסריקה');
      }
    } catch (error) {
      console.error('Error clearing scan cache:', error);
      setError('שגיאה בניקוי מטמון הסריקה');
    }
  };

  const handlePauseScan = async () => {
    try {
      // Pause the scan
      setIsPaused(true);
      setSuccess('סריקה הושהתה. לחץ על "המשך סריקה" כדי להמשיך');
    } catch (error) {
      console.error('Error pausing scan:', error);
      setError('שגיאה בהשהת הסריקה');
    }
  };

  const handleRefreshGroups = () => {
    setAllChats([]);
    setScannedChats([]);
    setStats({
      total: 0,
      completed: 0,
      scanning: 0,
      pending: 0,
      totalMessages: 0,
      totalDeleted: 0
    });
    setHasPreviousScan(false);
    localStorage.removeItem(`diamond_scan_${accountId}`);
  };

  const handleResumeScan = async () => {
    try {
      // Resume the scan
      setIsPaused(false);
      setSuccess('סריקה ממשיכה...');
    } catch (error) {
      console.error('Error resuming scan:', error);
      setError('שגיאה בהמשכת הסריקה');
    }
  };

  const handleContinuePreviousScan = async () => {
    try {
      // Continue previous scan
      setIsPaused(false);
      setHasPreviousScan(false);
      setSuccess('ממשיך סריקה קודמת...');
      // The scan will automatically continue from where it left off
    } catch (error) {
      console.error('Error continuing previous scan:', error);
      setError('שגיאה בהמשכת הסריקה הקודמת');
    }
  };

  const handleDiamondClick = useCallback(async (chat: ChatInfo) => {
    const baseChat: ChatInfo = {
      ...chat,
      messages: [],
      messages_found: chat.messages_found || 0
    };

    setSelectedChat(baseChat);
    setShowChatModal(true);
    setSelectedMessages(new Set());
    setChatMembers([]);
    setMessagesCursor(null);
    setHasMoreMessages(false);
    setLoadingMessagesError(null);

    fetchChatMessages(chat.id, null);

    if (chat.member_count > 0) {
      try {
        const membersResponse = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/chat-members/${chat.id}`);
        const membersData = await membersResponse.json();
        if (membersData.success) {
          setChatMembers(membersData.members || []);
        }
      } catch (membersError) {
        console.error('Error loading chat members:', membersError);
      }
    }
  }, [accountId, fetchChatMessages]);

  const handleSelectAllMessages = () => {
    if (selectedChat && selectedChat.messages) {
      const allMessageIds = selectedChat.messages.map(msg => msg.id);
      setSelectedMessages(new Set(allMessageIds));
    }
  };

  const handleMessageSelect = (messageId: number) => {
    setSelectedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const handleDeleteMessages = async () => {
    if (!selectedChat || selectedMessages.size === 0) return;
    
    if (confirm(`האם אתה בטוח שברצונך למחוק ${selectedMessages.size} הודעות?`)) {
      try {
        const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/delete-messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: selectedChat.id,
            message_ids: Array.from(selectedMessages),
            revoke: true
          })
        });
        
        const data = await response.json();
        if (data.success) {
          setSuccess(`נמחקו ${data.deleted_count} הודעות בהצלחה`);

          const resultMap = new Map<number, string>();
          (data.results || []).forEach((item: any) => {
            if (typeof item.message_id === 'number') {
              resultMap.set(item.message_id, item.status);
            }
          });

          const updateMessagesWithResults = (messages?: Message[]) => {
            if (!messages) return [] as Message[];
            return messages.map(message => {
              const status = resultMap.get(message.id);
              if (!status) return message;
              return {
                ...message,
                status: status === 'deleted' ? 'deleted' : 'failed'
              };
            });
          };

          setSelectedChat(prev => {
            if (!prev) return prev;
            const updatedMessages = updateMessagesWithResults(prev.messages);
            const remainingMessages = updatedMessages.filter(msg => msg.status !== 'deleted');
            return {
              ...prev,
              messages: updatedMessages,
              messages_found: remainingMessages.length,
              messages_deleted: (prev.messages_deleted || 0) + data.deleted_count
            };
          });

          setAllChats(prev => prev.map(chat => {
            if (chat.id !== selectedChat.id) {
              return chat;
            }
            const updatedMessages = updateMessagesWithResults(chat.messages);
            const remainingMessages = updatedMessages.filter(msg => msg.status !== 'deleted');
            return {
              ...chat,
              messages: updatedMessages,
              messages_found: remainingMessages.length,
              messages_deleted: (chat.messages_deleted || 0) + data.deleted_count
            };
          }));

          setSelectedMessages(new Set());
        } else {
          setError(`שגיאה במחיקה: ${data.error}`);
        }
      } catch (error) {
        console.error('Error deleting messages:', error);
        setError('שגיאה במחיקת הודעות');
      }
    }
  };

  const handleDeleteChatMessages = useCallback(async (chat: ChatInfo) => {
    const confirmation = confirm(`האם למחוק את כל ההודעות שנמצאו ב"${chat.title}"?`);
    if (!confirmation) {
      return;
    }

    setLoadingChatMessages(true);
    setLoadingMessagesError(null);

    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/groups/${chat.id}/found-messages/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.error || 'שגיאה במחיקת ההודעות');
        return;
      }

      const summary = data.summary || {};
      const results: Array<{ message_id: number; status: string; error?: string }> = data.results || [];
      const remaining: number = data.remaining ?? 0;

      if (summary.deleted) {
        setSuccess(`✅ נמחקו ${summary.deleted} הודעות מקבוצה "${chat.title}"`);
      }
      if (summary.failed) {
        const failedReasons = (summary.failed_messages || []).map((item: any) => item.reason).join(', ');
        setError(`חלק מההודעות לא נמחקו (${summary.failed}). ${failedReasons}`);
      }

      const resultMap = new Map<number, string>();
      results.forEach((item) => {
        if (typeof item.message_id === 'number') {
          resultMap.set(item.message_id, item.status);
        }
      });

      setSelectedChat(prev => {
        if (!prev || prev.id !== chat.id) {
          return prev;
        }
        const updatedMessages = prev.messages?.map(message => {
          const status = resultMap.get(message.id);
          if (!status) {
            return message;
          }
          return {
            ...message,
            status: status === 'deleted' ? 'deleted' : 'failed'
          };
        }) || [];
        return {
          ...prev,
          messages: updatedMessages,
          messages_found: remaining
        };
      });

      const updateListAfterDelete = (list: ChatInfo[]) =>
        list
          .map(existing => {
            if (existing.id !== chat.id) {
              return existing;
            }
            const updatedMessages = existing.messages?.map(message => {
              const status = resultMap.get(message.id);
              if (!status) {
                return message;
              }
              return {
                ...message,
                status: status === 'deleted' ? 'deleted' : 'failed'
              };
            }) || [];
            return {
              ...existing,
              messages: updatedMessages,
              messages_found: remaining,
              messages_deleted: (existing.messages_deleted || 0) + (summary.deleted || 0)
            };
          })
          .filter(item => item.messages_found > 0 || (summary.failed && summary.failed > 0));

      setAllChats(updateListAfterDelete);
      setScannedChats(updateListAfterDelete);

      if (remaining === 0 && !(summary.failed && summary.failed > 0)) {
        setSelectedChat(prev => (prev && prev.id === chat.id ? { ...prev, messages_found: 0 } : prev));
      }

      setSelectedMessages(new Set());
    } catch (error) {
      console.error('Error deleting chat messages:', error);
      setError('שגיאה במחיקת ההודעות');
    } finally {
      setLoadingChatMessages(false);
    }
  }, [accountId]);

  const [isGlobalDeleteRunning, setIsGlobalDeleteRunning] = useState(false);

  const handleDeleteAll = async () => {
    const totalMessages = allChats.reduce((sum, chat) => sum + (chat.messages_found || 0), 0);
    if (!totalMessages) {
      setError('אין הודעות למחיקה.');
      return;
    }

    if (!confirm(`⚠️ פעולה זו תמחק את כל ${totalMessages} ההודעות שנמצאו בכל הקבוצות. האם להמשיך?`)) {
      return;
    }

    setIsGlobalDeleteRunning(true);
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/delete-all-found-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      if (!result.success) {
        setError(result.error || 'שגיאה במחיקה הגלובלית');
        return;
      }

      setSuccess(`✅ נמחקו ${result.total_deleted} הודעות מ-${result.deleted_chats.length} קבוצות`);

      const remainingByChat = new Map<number, number>();
      (result.chat_results || []).forEach((chatResult: any) => {
        if (typeof chatResult.chat_id === 'number') {
          remainingByChat.set(chatResult.chat_id, chatResult.remaining ?? 0);
        }
      });

      const filterChats = (list: ChatInfo[]) =>
        list
          .map(chat => {
            const remaining = remainingByChat.has(chat.id)
              ? remainingByChat.get(chat.id)!
              : chat.messages_found;
            if (!remaining) {
              return null;
            }
            return {
              ...chat,
              messages_found: remaining
            };
          })
          .filter((chat): chat is ChatInfo => Boolean(chat));

      setAllChats(prev => filterChats(prev));
      setScannedChats(prev => filterChats(prev));

      if (selectedChat && remainingByChat.get(selectedChat.id) === 0) {
        setSelectedChat(prev => (prev ? { ...prev, messages_found: 0, messages: prev.messages?.map(msg => ({ ...msg, status: 'deleted' })) || [] } : prev));
      }

      setSelectedMessages(new Set());
    } catch (error) {
      setError(`❌ שגיאה במחיקה: ${error}`);
    } finally {
      setIsGlobalDeleteRunning(false);
    }
  };

  const handleKeepMessage = async (chatId: number, messageId: number) => {
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/keep-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        // הסרת ההודעה מהמצב המקומי
        setAllChats(prev => prev.map(chat => {
          if (chat.id === chatId) {
            const updatedMessages = chat.messages?.filter(msg => msg.id !== messageId) || [];
            return {
              ...chat,
              messages: updatedMessages,
              messages_found: updatedMessages.length
            };
          }
          return chat;
        }));
        
        // אם זו הקבוצה הנבחרת, עדכן גם אותה
        if (selectedChat && selectedChat.id === chatId) {
          setSelectedChat(prev => {
            if (!prev) return prev;
            const updatedMessages = prev.messages?.filter(msg => msg.id !== messageId) || [];
            return {
              ...prev,
              messages: updatedMessages,
              messages_found: updatedMessages.length
            };
          });
        }
        
        // הסרת ההודעה מהבחירה
        setSelectedMessages(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        
        setSuccess('✅ ההודעה סומנה כ"השאר" ולא תמחק');
      } else {
        setError(`❌ שגיאה: ${result.error}`);
      }
    } catch (error) {
      setError(`❌ שגיאה: ${error}`);
    }
  };

  const getDiamondStatus = (chat: ChatInfo) => {
    if (chat.status === 'scanning') return 'scanning';
    if (chat.status === 'completed') return 'completed';
    if (chat.status === 'error') return 'error';
    return 'pending';
  };

  const getDiamondColor = (status: string, hasMessages: boolean = false) => {
    if (hasMessages) {
      return 'bg-purple-500/60 shadow-purple-500/50';
    }
    switch (status) {
      case 'completed':
        return 'bg-green-400 shadow-green-400/50';
      case 'scanning':
        return 'bg-yellow-400 shadow-yellow-400/50 animate-pulse';
      case 'error':
        return 'bg-red-400 shadow-red-400/50';
      default:
        return 'bg-white/20 shadow-white/20';
    }
  };

  const getTooltipContent = (chat: ChatInfo) => {
    const statusText = {
      'completed': 'בוצעה',
      'scanning': 'בסריקה',
      'error': 'שגיאה',
      'pending': 'לא בוצעה'
    }[chat.status] || 'לא ידוע';
    
    return `${chat.title}\nחברים: ${chat.member_count}\nסטטוס: ${statusText}\nהודעות: ${chat.messages_found}`;
  };

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {isScanning ? (
        isPaused ? (
          <button
            type="button"
            onClick={handleResumeScan}
            className="btn-primary flex items-center gap-2"
          >
            <Play className="h-4 w-4" />
            המשך סריקה
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePauseScan}
            className="btn-secondary flex items-center gap-2"
          >
            <Square className="h-4 w-4" />
            השהה סריקה
          </button>
        )
      ) : hasPreviousScan ? (
        <>
          <button
            type="button"
            onClick={handleContinuePreviousScan}
            disabled={isScanning}
            className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            המשך סריקה קודמת
          </button>
          <button
            type="button"
            onClick={() => !isScanning && onStartScan(true, 0)}
            disabled={isScanning}
            className="btn-secondary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            התחל סריקה חדשה
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => !isScanning && onStartScan(true, 0)}
          disabled={isScanning}
          className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play className="h-4 w-4" />
          התחל סריקה
        </button>
      )}
      <button
        type="button"
        onClick={handleResetScan}
        disabled={isScanning}
        className="btn-destructive flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RotateCcw className="h-4 w-4" />
        איפוס סריקה
      </button>
      <button
        type="button"
        onClick={() => setShowDiamonds(prev => !prev)}
        className={`${showDiamonds ? 'btn-secondary' : 'btn-primary'} flex items-center gap-2`}
      >
        <Sparkles className="h-4 w-4" />
        {showDiamonds ? 'הסתר יהלומים' : 'הצג יהלומים'}
      </button>
      <button
        type="button"
        onClick={handleRefreshGroups}
        className="btn-secondary flex items-center gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        רענן קבוצות
      </button>
      <button
        type="button"
        onClick={onShowRecentMessages}
        className="btn-secondary flex items-center gap-2"
      >
        <Clock className="h-4 w-4" />
        הודעות אחרונות
      </button>
    </div>
  );

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: 'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #16213e 100%)' }}
      dir="rtl"
    >
      <HeaderFullScreen
        title="ממשק יהלומים - סריקה ויזואלית"
        onBack={onClose}
        description={`חשבון: ${accountLabel}`}
        actions={headerActions}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl p-6 pt-6">
        {/* Success/Error Messages */}
        {success && (
          <div className="glass-card p-4 mb-4 bg-green-500/20 border-green-400/30 animate-fade-in-up">
            <div className="flex items-center">
              <CheckCircle className="w-5 h-5 text-green-400 mr-3" />
              <p className="text-green-300">{success}</p>
              <button
                onClick={() => setSuccess(null)}
                className="ml-auto text-green-400 hover:text-green-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="glass-card p-4 mb-4 bg-red-500/20 border-red-400/30 animate-fade-in-up">
            <div className="flex items-center">
              <AlertTriangle className="w-5 h-5 text-red-400 mr-3" />
              <p className="text-red-300">{error}</p>
              <button
                onClick={() => setError(null)}
                className="ml-auto text-red-400 hover:text-red-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="mb-4">
          <ScanGuidancePanel
            guidance={guidance}
            isScanning={isScanning}
            stats={{
              total: stats.total,
              completed: stats.completed,
              skipped: stats.skipped,
              errors: stats.errors
            }}
          />
        </div>
        {/* Stats Overview */}
        <div className="glass-elevated p-6 mb-6">
          <h3 className="text-title text-white mb-4">סטטיסטיקות כלליות</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-blue-400">{stats.total}</div>
              <div className="text-small text-white/60">סך הכל קבוצות</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{stats.completed}</div>
              <div className="text-small text-white/60">נסרקו</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-yellow-400">{stats.scanning}</div>
              <div className="text-small text-white/60">בסריקה</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-purple-400">{stats.totalMessages}</div>
              <div className="text-small text-white/60">הודעות נמצאו</div>
            </div>
          </div>
        </div>

        {/* Diamond Grid */}
        {showDiamonds && (
          <div className="glass-elevated p-6">
            <h3 className="text-title text-white mb-4">מפת הקבוצות - יהלומים</h3>
          {allChats.length === 0 ? (
            <SharedGroupsList
              accountId={accountId}
              isAuthenticated={isAuthenticated}
              onGroupsLoaded={handleGroupsLoaded}
              showSelection={false}
            />
          ) : (
            <div className="grid grid-cols-10 md:grid-cols-20 lg:grid-cols-30 gap-2">
              {allChats.map((chat, index) => {
              const status = getDiamondStatus(chat);
              const hasMessages = (chat.messages_found || 0) > 0;
              const colorClass = getDiamondColor(status, hasMessages);
              
              return (
                <div
                  key={chat.id}
                  className={`relative group cursor-pointer`}
                  title={getTooltipContent(chat)}
                  onClick={() => handleDiamondClick(chat)}
                >
                  {/* Diamond Shape */}
                  <div className={`
                    w-6 h-6 transform rotate-45 
                    ${colorClass}
                    shadow-lg transition-all duration-300
                    hover:scale-110 hover:shadow-xl
                    ${status === 'scanning' ? 'animate-pulse' : ''}
                  `}>
                    {/* Inner sparkle for completed */}
                    {status === 'completed' && (
                      <div className="absolute inset-1 bg-white/30 rounded-sm"></div>
                    )}
                  </div>
                  
                  {/* Index number */}
                  <div className="absolute -top-1 -right-1 text-xs text-white/60 font-bold">
                    {index + 1}
                  </div>
                  
                  {/* Status indicator */}
                  {status === 'scanning' && (
                    <div className="absolute -top-1 -left-1">
                      <Loader className="w-3 h-3 text-yellow-400 animate-spin" />
                    </div>
                  )}
                  
                  {status === 'completed' && (
                    <div className="absolute -top-1 -left-1">
                      <CheckCircle className="w-3 h-3 text-green-400" />
                    </div>
                  )}
                  
                  {status === 'error' && (
                    <div className="absolute -top-1 -left-1">
                      <XCircle className="w-3 h-3 text-red-400" />
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          )}
          
          {/* Legend */}
          <div className="mt-6 flex flex-wrap gap-4 text-small text-white/60">
            <div className="flex items-center">
              <div className="w-4 h-4 bg-white/20 transform rotate-45 mr-2"></div>
              לא נסרקה
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-yellow-400 transform rotate-45 mr-2 animate-pulse"></div>
              בסריקה
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-green-400 transform rotate-45 mr-2"></div>
              הושלמה
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-purple-500 transform rotate-45 mr-2"></div>
              עם הודעות
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-red-400 transform rotate-45 mr-2"></div>
              שגיאה
            </div>
          </div>
        </div>
        )}

        {/* Current Scanning Info - Always show when scanning */}
        {isScanning && (
          <div className="glass-elevated p-6 mt-6 animate-fade-in-up">
            <h3 className="text-title text-white mb-4 flex items-center">
              <Loader className="w-5 h-5 text-yellow-400 animate-spin mr-2" />
              סורק כעת
            </h3>
            
            {/* Real-time updates */}
            {realtimeUpdates.length > 0 && (
              <div className="mb-4 p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <h4 className="text-sm font-medium text-blue-300 mb-2">עדכונים בזמן אמת:</h4>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {realtimeUpdates.map((update, index) => (
                    <div 
                      key={index} 
                      className={`text-xs text-white/80 transition-all duration-500 ${
                        index === 0 ? 'opacity-100' : 'opacity-60'
                      }`}
                      style={{
                        animationDelay: `${index * 0.1}s`,
                        animation: index === 0 ? 'fadeInUp 0.5s ease-out' : 'none'
                      }}
                    >
                      {update}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-yellow-400/20 rounded-full flex items-center justify-center mr-4">
                  <Loader className="w-6 h-6 text-yellow-400 animate-spin" />
                </div>
                <div>
                  <p className="text-body text-white font-medium">
                    {currentScanningChat?.title || 'מחפש קבוצות...'}
                  </p>
                  <p className="text-small text-white/60">
                    התקדמות: {currentScanningChat?.progress_percent || 0}%
                  </p>
                  {(currentScanningChat?.messages_found || 0) > 0 && (
                    <p className="text-small text-purple-300 font-medium">
                      ✅ נמצאו {currentScanningChat.messages_found} הודעות
                    </p>
                  )}
                  <p className="text-small text-white/50">
                    {currentScanningChat?.member_count ? `${currentScanningChat.member_count} חברים` : ''}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-small text-white/60 mb-2">
                  {currentScanningChat && currentProgress ? (
                    <>קבוצה {currentProgress.current_index || stats.completed + 1} מתוך {currentProgress.total_chats || currentProgress.total || stats.total}</>
                  ) : (
                    <>קבוצה {stats.completed + 1} מתוך {stats.total}</>
                  )}
                </p>
                <div className="w-40 bg-white/10 rounded-full h-3">
                  <div 
                    className="bg-gradient-to-r from-yellow-400 to-green-400 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${currentScanningChat?.progress_percent || (stats.total > 0 ? Math.floor((stats.completed / stats.total) * 100) : 0)}%` }}
                  ></div>
                </div>
                <p className="text-xs text-white/50 mt-1">
                  {currentScanningChat?.progress_percent || (stats.total > 0 ? Math.floor((stats.completed / stats.total) * 100) : 0)}% הושלם
                </p>
              </div>
            </div>
            
            {/* Additional scanning details */}
            <div className="mt-4 grid grid-cols-3 gap-4 text-center">
              <div className="glass-card p-3">
                <div className="text-lg font-bold text-green-400">{stats.completed}</div>
                <div className="text-xs text-white/60">הושלמו</div>
              </div>
              <div className="glass-card p-3">
                <div className="text-lg font-bold text-yellow-400">{stats.scanning}</div>
                <div className="text-xs text-white/60">בסריקה</div>
              </div>
              <button
                type="button"
                onClick={() => setShowFoundMessagesModal(true)}
                className="glass-card p-3 text-left transition hover:bg-white/10"
              >
                <div className="text-lg font-bold text-purple-400">{stats.totalMessages}</div>
                <div className="text-xs text-white/60 underline-offset-2 hover:underline">
                  הודעות נמצאו
                </div>
                <div className="mt-1 text-[10px] text-white/40">
                  לחיצה תפתח רשימת כל ההודעות
                </div>
              </button>
            </div>
            
            {/* Live Activity Log */}
            <div className="mt-6">
              <h4 className="text-white text-sm font-medium mb-3 flex items-center">
                <Activity className="w-4 h-4 mr-2 text-blue-400" />
                פעילות בזמן אמת
              </h4>
              <div className="glass-card p-4 max-h-32 overflow-y-auto">
                <div className="space-y-1 text-xs">
                  {currentScanningChat?.title && (
                    <div className="text-blue-300">
                      🔍 סורק: {currentScanningChat.title}
                    </div>
                  )}
                  {currentScanningChat?.progress_percent && currentScanningChat.progress_percent > 0 && (
                    <div className="text-yellow-300">
                      📊 התקדמות: {currentScanningChat.progress_percent}%
                    </div>
                  )}
                  {currentScanningChat?.messages_found && currentScanningChat.messages_found > 0 && (
                    <div className="text-purple-300">
                      💬 נמצאו {currentScanningChat.messages_found} הודעות
                    </div>
                  )}
                  <div className="text-green-300">
                    ✅ הושלמו {stats.completed} קבוצות
                  </div>
                  <div className="text-white/60">
                    ⏳ נותרו {stats.pending} קבוצות לסריקה
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Groups with Messages */}
        {scannedChats.filter(chat => (chat.messages_found || 0) > 0).length > 0 && (
          <div className="glass-elevated p-6 mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-title text-white">קבוצות עם הודעות שנמצאו</h3>
              <button
                onClick={handleDeleteAll}
                className="btn-destructive flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isGlobalDeleteRunning}
              >
                {isGlobalDeleteRunning ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                מחיקת כל ההודעות מהקבוצות
              </button>
            </div>
            <div className="space-y-3">
              {scannedChats
                .filter(chat => (chat.messages_found || 0) > 0)
                .map((chat) => (
                  <div key={chat.id} className="glass-card p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-purple-500/60 rounded-full flex items-center justify-center">
                          <MessageSquare className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <h4 className="text-white font-medium">{chat.title}</h4>
                          <p className="text-white/60 text-sm">
                            {chat.messages_found} הודעות נמצאו | {chat.member_count} חברים
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleDiamondClick(chat)}
                          className="btn-secondary flex items-center px-3 py-1 text-sm"
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          צפה בהודעות
                        </button>
                        <button
                          onClick={() => handleDeleteChatMessages(chat)}
                          className="btn-destructive flex items-center px-3 py-1 text-sm"
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          מחק הכל
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Chat Modal */}
        {showChatModal && selectedChat && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="glass-advanced max-w-4xl w-full max-h-[90vh] overflow-hidden">
              {/* Modal Header */}
              <div className="glass-elevated p-6 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-title text-white">{selectedChat.title}</h2>
                      <div className="flex items-center space-x-4 text-sm text-white/60">
                        <span className="flex items-center">
                          <Users className="w-4 h-4 mr-1" />
                          {selectedChat.member_count} חברים
                        </span>
                        <button
                          onClick={() => setShowMembersTooltip(!showMembersTooltip)}
                          className="flex items-center cursor-pointer hover:text-white transition-colors"
                        >
                          <MessageSquare className="w-4 h-4 mr-1" />
                          {selectedChat.member_count} חברים סה"כ
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {selectedMessages.size > 0 && (
                      <button
                        onClick={handleDeleteMessages}
                        className="btn-destructive flex items-center px-4 py-2"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        מחק {selectedMessages.size} הודעות
                      </button>
                    )}
                    
                    <button
                      onClick={handleDeleteAll}
                      className="btn-destructive flex items-center px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      title="מחק את כל ההודעות שנמצאו בכל הקבוצות"
                      disabled={isGlobalDeleteRunning}
                    >
                      {isGlobalDeleteRunning ? (
                        <Loader className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3 mr-1" />
                      )}
                      מחק הכל
                    </button>
                    
                    <button
                      onClick={() => setShowChatModal(false)}
                      className="btn-secondary flex items-center px-4 py-2"
                    >
                      <X className="w-4 h-4 mr-2" />
                      סגור
                    </button>
                  </div>
                </div>
              </div>

              {/* Members Tooltip */}
              {showMembersTooltip && chatMembers.length > 0 && (
                <div className="absolute top-20 left-4 glass-elevated p-4 max-w-md z-10">
                  <h4 className="text-white font-medium mb-2">חברים משותפים:</h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {chatMembers.map((member, index) => (
                      <div key={index} className="text-sm text-white/80">
                        <span className="font-medium">{member.first_name || 'Unknown'}</span>
                        {member.username && (
                          <span className="text-white/60"> @{member.username}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages Section */}
              <div className="p-6 overflow-y-auto max-h-96">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-medium">
                    הודעות שנמצאו ({displayedMessageCount}
                    {totalMessageCount > displayedMessageCount ? ` מתוך ${totalMessageCount}` : ''})
                  </h3>
                  {hasLoadedMessages && (
                    <button
                      onClick={handleSelectAllMessages}
                      className="btn-secondary flex items-center px-3 py-1 text-sm"
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      בחר הכל
                    </button>
                  )}
                </div>

                {loadingChatMessages && !hasLoadedMessages ? (
                  <div className="text-center py-8">
                    <Loader className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-2" />
                    <p className="text-white/60">טוען הודעות מהשרת...</p>
                  </div>
                ) : (
                  <>
                    {loadingMessagesError && (
                      <div className="mb-4 rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">
                        <p className="mb-3">{loadingMessagesError}</p>
                        <button
                          onClick={handleRetryMessages}
                          className="btn-secondary px-3 py-1 text-xs"
                        >
                          נסה שוב
                        </button>
                      </div>
                    )}

                    {hasLoadedMessages ? (
                      <div className="space-y-3">
                        {selectedChat.messages?.map((message) => (
                          <div key={message.id} className={`glass-card p-4 ${message.status === 'deleted' ? 'opacity-60' : ''}`}>
                            <div className="flex items-start space-x-3">
                              <input
                                type="checkbox"
                                checked={selectedMessages.has(message.id)}
                                onChange={() => handleMessageSelect(message.id)}
                                className="mt-1 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                                disabled={message.status === 'deleted'}
                              />
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs text-white/60">
                                    {new Date(message.date).toLocaleString('he-IL')}
                                  </span>
                                  {message.status === 'deleted' && (
                                    <span className="text-xs text-white/40">נמחק</span>
                                  )}
                                </div>
                                <div className="bg-blue-500/20 rounded-lg p-3 max-w-md">
                                  <p className="text-white text-sm whitespace-pre-wrap break-words">{message.content}</p>
                                </div>
                              </div>

                              {message.status !== 'deleted' && (
                                <button
                                  onClick={() => handleKeepMessage(selectedChat.id, message.id)}
                                  className="ml-2 px-2 py-1 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 transition-colors flex-shrink-0"
                                  title="השאר הודעה - לא תמחק"
                                >
                                  <Eye className="w-3 h-3 mr-1" />
                                  השאר
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      !loadingMessagesError && (
                        <div className="text-center py-8">
                          <MessageSquare className="w-12 h-12 text-white/40 mx-auto mb-2" />
                          <p className="text-white/60">לא נמצאו הודעות בקבוצה זו</p>
                        </div>
                      )
                    )}

                    {loadingChatMessages && hasLoadedMessages && (
                      <div className="flex items-center justify-center py-4 text-white/60">
                        <Loader className="w-5 h-5 animate-spin mr-2" />
                        <span className="text-sm">טוען הודעות נוספות...</span>
                      </div>
                    )}

                    {hasMoreMessages && !loadingChatMessages && (
                      <div className="flex justify-center mt-4">
                        <button
                          onClick={handleLoadMoreMessages}
                          className="btn-secondary px-4 py-2"
                        >
                          טען עוד
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    <FoundMessagesModal
      accountId={accountId}
      isOpen={showFoundMessagesModal}
      onClose={() => setShowFoundMessagesModal(false)}
      onNavigateToGroup={(chatId, chatTitle) => {
        setShowFoundMessagesModal(false);
        const targetChat = allChats.find(chat => chat.id === chatId) || scannedChats.find(chat => chat.id === chatId);
        if (targetChat) {
          handleDiamondClick(targetChat);
        } else {
          const fallbackChat: ChatInfo = {
            id: chatId,
            title: chatTitle,
            status: 'completed',
            messages_found: 0,
            messages_deleted: 0,
            member_count: 0,
            progress_percent: 0,
            has_unscanned_dates: false,
            messages: [],
            selected: false
          };
          handleDiamondClick(fallbackChat);
        }
      }}
    />

    {/* Clear Cache Confirmation Modal */}
    {showClearCacheModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg shadow-2xl max-w-2xl w-full mx-4 border border-white/10">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-yellow-400" />
                איפוס מטמון סריקה
              </h2>
              <button
                onClick={() => {
                  setShowClearCacheModal(false);
                  setCacheInfo(null);
                }}
                className="text-white/60 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <p className="text-yellow-200 text-sm font-medium mb-2">
                  ⚠️ פעולה זו תמחק את כל מטמון הסריקה
                </p>
                <p className="text-white/80 text-sm">
                  נתוני הכניסה והאימות יישמרו. רק נתוני הסריקה יימחקו.
                </p>
              </div>

              {loadingCacheInfo ? (
                <div className="flex items-center justify-center py-8">
                  <Loader className="w-6 h-6 animate-spin text-white/60" />
                  <span className="ml-2 text-white/60">טוען פרטי מטמון...</span>
                </div>
              ) : cacheInfo ? (
                <div className="space-y-3">
                  <div className="bg-white/5 rounded-lg p-4">
                    <h3 className="text-white font-semibold mb-3">פרטי המטמון שיימחקו:</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/70">מספר קבוצות עם נתוני סריקה:</span>
                        <span className="text-white font-medium">{cacheInfo.groups_count}</span>
                      </div>
                      {cacheInfo.latest_scan_date && (
                        <div className="flex justify-between">
                          <span className="text-white/70">תאריך סריקה אחרון:</span>
                          <span className="text-white font-medium">
                            {new Date(cacheInfo.latest_scan_date).toLocaleDateString('he-IL', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-white/70">סה״כ הודעות שנמצאו:</span>
                        <span className="text-white font-medium">{cacheInfo.total_messages_found.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                    <h3 className="text-blue-200 font-semibold mb-2">מה יקרה אחרי האיפוס?</h3>
                    <p className="text-white/80 text-sm leading-relaxed">
                      כשתפעיל סריקה חדשה, האפליקציה תסרוק את כל הקבוצות מחדש החל מ-<strong className="text-white">חודש אחורה</strong> (30 ימים) עד היום.
                      <br />
                      <br />
                      <strong className="text-white">טווח הסריקה:</strong> מ-{new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('he-IL', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })} עד היום ({new Date().toLocaleDateString('he-IL', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })})
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-white/60">
                  לא נמצאו נתוני מטמון
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowClearCacheModal(false);
                  setCacheInfo(null);
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
              >
                ביטול
              </button>
              <button
                onClick={confirmClearCache}
                disabled={loadingCacheInfo || !cacheInfo}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                מחק מטמון סריקה
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
  );
};

export default DiamondScanInterface;
