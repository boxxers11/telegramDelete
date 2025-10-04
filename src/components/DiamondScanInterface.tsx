import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft,
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
import MessageWizard from './MessageWizard';
import SharedGroupsList from './SharedGroupsList';

interface Message {
  id: number;
  content: string;
  date: string;
  selected: boolean;
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
}

const DiamondScanInterface: React.FC<DiamondScanInterfaceProps> = ({
  accountId,
  accountLabel,
  onClose,
  onStartScan,
  onStopScan,
  isScanning,
  scanProgress,
  lastScanResults
}) => {
  const [allChats, setAllChats] = useState<ChatInfo[]>([]);
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
  const [showBatchMessageModal, setShowBatchMessageModal] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const [batchDelay, setBatchDelay] = useState(2);
  const [batchDryRun, setBatchDryRun] = useState(true);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [isPaused, setIsPaused] = useState(false);
  const [hasPreviousScan, setHasPreviousScan] = useState(false);
  const [realtimeUpdates, setRealtimeUpdates] = useState<string[]>([]);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  // Load all chats on component mount
  useEffect(() => {
    loadSavedState();
  }, [accountId]);

  // Real-time updates via Server-Sent Events
  useEffect(() => {
    if (isScanning && accountId) {
      // Close existing connection if any
      if (eventSource) {
        eventSource.close();
        setEventSource(null);
      }
      
      const eventSource = new EventSource(`http://127.0.0.1:8001/accounts/${accountId}/scan-events`);
      setEventSource(eventSource);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'scan_status') {
            // Update scan progress
            if (data.status === 'scanning') {
              const updateMessage = `🔍 סורק: ${data.current_chat} (${data.current_index}/${data.total})`;
              setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]); // Keep last 10 updates
            }
            
            // Update stats
            setStats(prev => ({
              ...prev,
              total: data.total || 0,
              completed: data.current_index || 0,
              totalMessages: data.messages_found || 0
            }));
          } else if (data.type === 'scan_complete') {
            setRealtimeUpdates(prev => ['✅ סריקה הושלמה!', ...prev.slice(0, 9)]);
            // Close SSE connection when scan is complete
            eventSource.close();
            setEventSource(null);
          } else if (data.type === 'scan_idle') {
            setRealtimeUpdates(prev => ['⏸️ סריקה לא פעילה', ...prev.slice(0, 9)]);
            // Close SSE connection when scan is idle
            eventSource.close();
            setEventSource(null);
          } else if (data.type === 'error') {
            setRealtimeUpdates(prev => [`❌ שגיאה: ${data.message}`, ...prev.slice(0, 9)]);
            // Close SSE connection on error
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
        // Close SSE connection on error
        eventSource.close();
        setEventSource(null);
      };

      return () => {
        eventSource.close();
        setEventSource(null);
      };
    }
  }, [isScanning, accountId]);

  // Load saved state from localStorage
  const loadSavedState = () => {
    try {
      const savedState = localStorage.getItem(`diamond_scan_${accountId}`);
      if (savedState) {
        const state = JSON.parse(savedState);
        setScannedChats(state.scannedChats || []);
        setStats(state.stats || {
          total: 0,
          completed: 0,
          scanning: 0,
          pending: 0,
          totalMessages: 0,
          totalDeleted: 0
        });
        
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
            
            setScannedChats(scanned);
            
            // Update current scanning chat
            if (progress.current_chat) {
              console.log('Setting current scanning chat:', progress.current_chat);
              setCurrentScanningChat({
                id: progress.current_chat_id || 0,
                title: progress.current_chat,
                status: 'scanning',
                messages_found: progress.messages_found || 0,
                messages_deleted: 0,
                member_count: 0,
                progress_percent: progress.progress_percent || 0,
                has_unscanned_dates: false,
                selected: false
              });
            } else {
              console.log('No current chat in progress');
              setCurrentScanningChat(null);
            }
            
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
            
            setStats(prev => ({
              ...prev,
              total: allChats.length,
              completed: completedChats.length,
              scanning: progress.current_chat ? 1 : 0,
              pending: allChats.length - scanned.length,
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


  const handleResetScan = async () => {
    if (confirm('האם אתה בטוח שברצונך לאפס את כל נתוני הסריקה ולהתחיל מחדש?')) {
      try {
        // Reset backend data
        const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/reset`, {
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
          
          setSuccess('נתוני הסריקה אופסו בהצלחה');
        } else {
          setError('שגיאה באיפוס נתוני הסריקה');
        }
      } catch (error) {
        console.error('Error resetting scan:', error);
        setError('שגיאה באיפוס נתוני הסריקה');
      }
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

  const handleDiamondClick = async (chat: ChatInfo) => {
    setSelectedChat(chat);
    setShowChatModal(true);
    setSelectedMessages(new Set());
    
    // Load chat members if not already loaded
    if (chat.member_count > 0) {
      try {
        const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/chat-members/${chat.id}`);
        const data = await response.json();
        if (data.success) {
          setChatMembers(data.members || []);
        }
      } catch (error) {
        console.error('Error loading chat members:', error);
      }
    }
  };

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
          
          // Update chat messages
          setSelectedChat(prev => {
            if (!prev) return prev;
            const remainingMessages = prev.messages?.filter(msg => !selectedMessages.has(msg.id)) || [];
            return {
              ...prev,
              messages: remainingMessages,
              messages_found: remainingMessages.length,
              messages_deleted: (prev.messages_deleted || 0) + selectedMessages.size
            };
          });
          
          // Update allChats
          setAllChats(prev => prev.map(chat => 
            chat.id === selectedChat.id 
              ? {
                  ...chat,
                  messages: chat.messages?.filter(msg => !selectedMessages.has(msg.id)) || [],
                  messages_found: (chat.messages?.filter(msg => !selectedMessages.has(msg.id)) || []).length,
                  messages_deleted: (chat.messages_deleted || 0) + selectedMessages.size
                }
              : chat
          ));
          
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

  const handleDeleteAll = async () => {
    const totalMessages = allChats.reduce((sum, chat) => sum + (chat.messages_found || 0), 0);
    
    if (confirm(`⚠️ אזהרה! פעולה זו תמחק את כל ${totalMessages} ההודעות שנסרקו מכל הקבוצות. האם אתה בטוח?`)) {
      try {
        const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/delete-all-found-messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        const result = await response.json();
        
        if (result.success) {
          setSuccess(`✅ נמחקו ${result.total_deleted} הודעות מ-${result.deleted_chats.length} קבוצות`);
          // רענון הנתונים
          loadSavedState();
        } else {
          setError(`❌ שגיאה במחיקה: ${result.error}`);
        }
      } catch (error) {
        setError(`❌ שגיאה במחיקה: ${error}`);
      }
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

  const handleSendBatchMessage = async () => {
    if (!batchMessage.trim()) {
      setError('אנא הזן הודעה');
      return;
    }

    const selectedChatIds = Array.from(selectedChats);
    if (selectedChatIds.length === 0) {
      setError('אנא בחר לפחות קבוצה אחת');
      return;
    }

    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/send-batch-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: batchMessage,
          chat_ids: selectedChatIds,
          delay_seconds: batchDelay,
          dry_run: batchDryRun
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send batch message');
      }

      const data = await response.json();
      
      if (data.success) {
        setSuccess(`הודעה נשלחה ל-${data.sent_count} קבוצות בהצלחה`);
        setShowBatchMessageModal(false);
        setBatchMessage('');
      } else {
        setError(data.error || 'שגיאה בשליחת הודעה');
      }
    } catch (error) {
      console.error('Error sending batch message:', error);
      setError('שגיאה בשליחת הודעה');
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

  return (
    <div className="min-h-screen" style={{background: 'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #16213e 100%)'}} dir="rtl">
      <div className="max-w-7xl mx-auto p-4">
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

        {/* Header */}
        <div className="glass-elevated p-6 mb-6 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <button
                onClick={onClose}
                className="flex items-center px-4 py-2 text-white/70 hover:text-white mr-4 transition-colors"
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                חזור
              </button>
              <div>
                <h1 className="text-title text-white">ממשק יהלומים - סריקה ויזואלית</h1>
                <p className="text-small text-white/60">חשבון: {accountLabel}</p>
                
                {/* Success/Error Messages */}
                {success && (
                  <div className="mt-2 p-3 bg-green-500/20 border border-green-500/30 rounded-lg text-green-300 text-sm">
                    ✅ {success}
                  </div>
                )}
                {error && (
                  <div className="mt-2 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 text-sm">
                    ❌ {error}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              {isScanning ? (
                isPaused ? (
                  <button
                    onClick={handleResumeScan}
                    className="btn-primary flex items-center px-6 py-3"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    המשך סריקה
                  </button>
                ) : (
                  <button
                    onClick={handlePauseScan}
                    className="btn-secondary flex items-center px-6 py-3"
                  >
                    <Square className="w-5 h-5 mr-2" />
                    השהה סריקה
                  </button>
                )
              ) : hasPreviousScan ? (
                <div className="flex space-x-2">
                  <button
                    onClick={handleContinuePreviousScan}
                    className="btn-primary flex items-center px-6 py-3"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    המשך סריקה קודמת
                  </button>
                  <button
                    onClick={() => onStartScan(true, 0)}
                    className="btn-secondary flex items-center px-6 py-3"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    התחל סריקה חדשה
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => onStartScan(true, 0)}
                  className="btn-primary flex items-center px-6 py-3"
                >
                  <Play className="w-5 h-5 mr-2" />
                  התחל סריקה
                </button>
              )}
              
              <button
                onClick={handleResetScan}
                disabled={isScanning}
                className="btn-destructive flex items-center px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-5 h-5 mr-2" />
                איפוס סריקה
              </button>
              
              <button
                onClick={() => setShowDiamonds(!showDiamonds)}
                className={`flex items-center px-6 py-3 ${showDiamonds ? 'btn-secondary' : 'btn-primary'}`}
              >
                <Sparkles className="w-5 h-5 mr-2" />
                {showDiamonds ? 'הסתר יהלומים' : 'הצג יהלומים'}
              </button>
              
              <button
                onClick={() => {
                  // This will be handled by the parent component
                  // For now, show the old modal
                  setShowBatchMessageModal(true);
                }}
                className="btn-secondary flex items-center px-6 py-3"
              >
                <MessageSquare className="w-5 h-5 mr-2" />
                שליחת הודעות
              </button>
            </div>
          </div>
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
                  קבוצה {stats.completed + 1} מתוך {stats.total}
                </p>
                <div className="w-40 bg-white/10 rounded-full h-3">
                  <div 
                    className="bg-gradient-to-r from-yellow-400 to-green-400 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${currentScanningChat?.progress_percent || 0}%` }}
                  ></div>
                </div>
                <p className="text-xs text-white/50 mt-1">
                  {currentScanningChat?.progress_percent || 0}% הושלם
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
              <div className="glass-card p-3">
                <div className="text-lg font-bold text-purple-400">{stats.totalMessages}</div>
                <div className="text-xs text-white/60">הודעות נמצאו</div>
              </div>
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
            <h3 className="text-title text-white mb-4">קבוצות עם הודעות שנמצאו</h3>
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
                          onClick={() => handleDiamondClick(chat)}
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
                      className="btn-destructive flex items-center px-3 py-2 text-sm"
                      title="מחק את כל ההודעות שנמצאו בכל הקבוצות"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
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
                    הודעות שנמצאו ({selectedChat.messages?.length || 0})
                  </h3>
                  {selectedChat.messages && selectedChat.messages.length > 0 && (
                    <button
                      onClick={handleSelectAllMessages}
                      className="btn-secondary flex items-center px-3 py-1 text-sm"
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      בחר הכל
                    </button>
                  )}
                </div>

                {selectedChat.messages && selectedChat.messages.length > 0 ? (
                  <div className="space-y-3">
                    {selectedChat.messages.map((message) => (
                      <div key={message.id} className="glass-card p-4">
                        <div className="flex items-start space-x-3">
                          <input
                            type="checkbox"
                            checked={selectedMessages.has(message.id)}
                            onChange={() => handleMessageSelect(message.id)}
                            className="mt-1 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs text-white/60">
                                {new Date(message.date).toLocaleString('he-IL')}
                              </span>
                            </div>
                            <div className="bg-blue-500/20 rounded-lg p-3 max-w-md">
                              <p className="text-white text-sm">{message.content}</p>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => handleKeepMessage(selectedChat.id, message.id)}
                            className="ml-2 px-2 py-1 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 transition-colors flex-shrink-0"
                            title="השאר הודעה - לא תמחק"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            השאר
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <MessageSquare className="w-12 h-12 text-white/40 mx-auto mb-2" />
                    <p className="text-white/60">לא נמצאו הודעות בקבוצה זו</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Message Wizard Modal */}
        {showBatchMessageModal && (
          <MessageWizard
            accountId={accountId}
            accountLabel={accountLabel}
            onBack={() => setShowBatchMessageModal(false)}
          />
        )}
      </div>
    </div>
  );
};

export default DiamondScanInterface;
