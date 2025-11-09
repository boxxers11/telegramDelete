import React, { useState, useEffect } from 'react';
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
  FolderX
} from 'lucide-react';
import ScanGuidancePanel from './ScanGuidancePanel';
import HeaderFullScreen from './ui/HeaderFullScreen';
import type { GuidanceStage, ScanGuidance } from '../hooks/useScan';

interface Message {
  id: number;
  content: string;
  date: string;
  media_type?: string;
  media_url?: string;
  selected?: boolean;
}

interface ChatInfo {
  id: number;
  title: string;
  type: string;
  status: 'pending' | 'scanning' | 'completed' | 'skipped' | 'error';
  messages_found?: number;
  messages_deleted?: number;
  error?: string;
  reason?: string;
  messages?: Message[];
  selected: boolean;
}

interface SimpleScanInterfaceProps {
  accountId: string;
  accountLabel: string;
  onClose: () => void;
  onStartScan: (isFullScan: boolean, batchSize?: number) => void;
  onStopScan?: () => void;
  isScanning: boolean;
  scanProgress?: any;
  lastScanResults?: ChatInfo[];
  uiMode?: 'simple' | 'advanced';
  onShowRecentMessages: () => void;
  guidance: ScanGuidance;
  onUpdateGuidance?: (stage: GuidanceStage, overrides?: Partial<ScanGuidance>) => void;
}

const SimpleScanInterface: React.FC<SimpleScanInterfaceProps> = ({
  accountId,
  accountLabel,
  onClose,
  onStartScan,
  onStopScan,
  isScanning,
  scanProgress,
  lastScanResults,
  uiMode = 'advanced',
  onShowRecentMessages,
  guidance,
  onUpdateGuidance
}) => {
  const [currentChat, setCurrentChat] = useState<ChatInfo | null>(null);
  const [scannedChats, setScannedChats] = useState<ChatInfo[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<number | null>(null);
  const [skippedChats, setSkippedChats] = useState<Set<number>>(new Set());
  const [showStatsModal, setShowStatsModal] = useState<string | null>(null);
  const [expandedChats, setExpandedChats] = useState<Set<number>>(new Set());
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [floatingPanelPosition, setFloatingPanelPosition] = useState({ 
    x: window.innerWidth - 420, // Right side
    y: 16 
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [localScanProgress, setLocalScanProgress] = useState<any>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    skipped: 0,
    errors: 0,
    totalMessages: 0,
    totalDeleted: 0,
    withMessages: 0,
    empty: 0,
    deleted: 0
  });

  // Initialize from last scan results
  useEffect(() => {
    if (lastScanResults && lastScanResults.length > 0) {
      setScannedChats(lastScanResults);
      
      // Calculate stats
      const total = lastScanResults.length;
      const completed = lastScanResults.filter(c => c.status === 'completed').length;
      const skipped = lastScanResults.filter(c => c.status === 'skipped').length;
      const errors = lastScanResults.filter(c => c.status === 'error').length;
      const totalMessages = lastScanResults.reduce((sum, chat) => sum + (chat.messages_found || 0), 0);
      const totalDeleted = lastScanResults.reduce((sum, chat) => sum + (chat.messages_deleted || 0), 0);
      
      setStats({ total, completed, skipped, errors, totalMessages, totalDeleted });
      
      // Set current chat to the first completed chat with messages
      const firstChatWithMessages = lastScanResults.find(chat => 
        chat.status === 'completed' && 
        chat.messages && 
        chat.messages.length > 0
      );
      if (firstChatWithMessages) {
        setCurrentChat(firstChatWithMessages);
      }
    }
  }, [lastScanResults]);

  // Update current chat from scan progress
  useEffect(() => {
    if (scanProgress && scanProgress.chat_name) {
      console.log('Setting current chat from scan progress:', scanProgress);
      setCurrentChat({
        id: scanProgress.chat_id || 0,
        title: scanProgress.chat_name,
        type: 'Group',
        status: 'scanning',
        selected: false
      });
    }
  }, [scanProgress]);

  // Debug: Log when scanProgress changes
  useEffect(() => {
    console.log('Scan progress changed:', scanProgress);
  }, [scanProgress]);

  // Poll for scan results when scanning
  useEffect(() => {
    if (isScanning) {
      const interval = setInterval(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/scan-status`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.result) {
              console.log('Polling scan status:', data.result);
              // Update scan progress if available
              if (data.result.scan_progress) {
                setLocalScanProgress(data.result.scan_progress);
              }
              // Update scanned chats if available
              if (data.result.scanned_chats) {
                setScannedChats(data.result.scanned_chats);
                
                // Update stats based on scanned chats
                const chats = data.result.scanned_chats;
                const withMessages = chats.filter(chat => 
                  chat.status === 'completed' && 
                  chat.messages && 
                  chat.messages.length > 0
                ).length;
                const empty = chats.filter(chat => 
                  chat.status === 'completed' && 
                  (!chat.messages || chat.messages.length === 0)
                ).length;
                const totalMessages = chats.reduce((sum, chat) => 
                  sum + (chat.messages ? chat.messages.length : 0), 0
                );
                
                setStats(prev => ({
                  ...prev,
                  total: chats.length,
                  withMessages,
                  empty,
                  totalMessages
                }));
              }
            }
          }
        } catch (error) {
          console.error('Error polling scan status:', error);
        }
      }, 2000); // Poll every 2 seconds

      return () => clearInterval(interval);
    }
  }, [isScanning, accountId]);

  useEffect(() => {
    if (!onUpdateGuidance) {
      return;
    }

    const totalGroups =
      scanProgress?.total ??
      localScanProgress?.total ??
      stats.total ??
      scannedChats.length;

    const completedGroups = scannedChats.filter(chat => chat.status === 'completed').length;
    const skippedGroups = scannedChats.filter(chat => chat.status === 'skipped').length;
    const finishedGroups = completedGroups + skippedGroups;

    if (isScanning) {
      const messageSegments: string[] = [];

      if (scanProgress?.chat_name) {
        messageSegments.push(`כעת סורקים את "${scanProgress.chat_name}".`);
      }

      if (totalGroups) {
        messageSegments.push(`התקדמות: ${finishedGroups}/${totalGroups} קבוצות.`);
      }

      onUpdateGuidance('scanning', {
        message: messageSegments.join(' '),
        batches: {
          total: Math.max(1, Math.ceil(totalGroups / 10)),
          completed: Math.min(
            Math.max(0, Math.ceil(finishedGroups / 10)),
            Math.max(1, Math.ceil(totalGroups / 10))
          ),
          size: 10
        },
        tips: [
          'בכל עצירה ניתן להמשיך מאותה נקודה בזכות שמירת המטמון.',
          'אם ההמתנה ארוכה, שקול לצמצם לטווח זמן קצר יותר או למספר קבוצות קטן.'
        ]
      });
    } else if (scannedChats.length && guidance.stage === 'scanning') {
      onUpdateGuidance('completed', {
        message: 'הסריקה הסתיימה. ניתן לבחון את הממצאים או להגדיר סריקה חדשה.',
        batches: guidance.batches,
        tips: [
          'הסריקות הבאות יהיו מהירות יותר אם תסמן לדלג על קבוצות שבהן לא נמצאו הודעות.',
          'באפשרותך להפעיל סריקה מתוזמנת מהגדרות כדי להכין נתונים מראש.'
        ]
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScanning, scannedChats, scanProgress, localScanProgress, stats.total]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('he-IL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scanning':
        return <Loader className="w-5 h-5 animate-spin text-blue-400" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'deleting':
        return <Loader className="w-5 h-5 animate-spin text-orange-400" />;
      case 'skipped':
        return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-400" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusText = (chat: ChatInfo) => {
    switch (chat.status) {
      case 'scanning':
        return 'סורק...';
      case 'completed':
        return `נמצאו ${chat.messages_found || 0} הודעות${chat.messages_deleted ? `, נמחקו ${chat.messages_deleted}` : ''}`;
      case 'deleting':
        return 'מוחק הודעות...';
      case 'skipped':
        return chat.reason || 'דולג';
      case 'error':
        return chat.error || 'שגיאה';
      default:
        return 'ממתין';
    }
  };

  const handleSelectMessage = (messageId: number) => {
    const newSelected = new Set(selectedMessages);
    if (newSelected.has(messageId)) {
      newSelected.delete(messageId);
    } else {
      newSelected.add(messageId);
    }
    setSelectedMessages(newSelected);
  };

  const handleSelectAllMessages = () => {
    if (!currentChat || !currentChat.messages) return;
    
    const allSelected = currentChat.messages.every(msg => selectedMessages.has(msg.id));
    const newSelected = new Set(selectedMessages);
    
    if (allSelected) {
      currentChat.messages.forEach(msg => newSelected.delete(msg.id));
    } else {
      currentChat.messages.forEach(msg => newSelected.add(msg.id));
    }
    
    setSelectedMessages(newSelected);
  };

  const handleDeleteClick = () => {
    if (selectedMessages.size === 0) return;
    setDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (selectedMessages.size === 0 || !currentChat) return;
    
    try {
      // Show loading state
      setCurrentChat(prev => prev ? { ...prev, status: 'deleting' } : null);
      setDeletingChatId(currentChat.id);
      
      // Call real delete API
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/delete-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: currentChat.id,
          message_ids: Array.from(selectedMessages),
          revoke: true
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Update stats
        const deletedCount = data.result?.deleted_count || data.deleted_count || selectedMessages.size;
        setStats(prev => ({
          ...prev,
          totalDeleted: prev.totalDeleted + deletedCount
        }));
        
        // Update the chat to reflect deleted messages (don't remove the chat)
        setScannedChats(prev => prev.map(chat => 
          chat.id === currentChat.id 
            ? { 
                ...chat, 
                messages: chat.messages?.filter(msg => !selectedMessages.has(msg.id)) || [],
                messages_found: (chat.messages_found || 0) - selectedMessages.size,
                messages_deleted: (chat.messages_deleted || 0) + selectedMessages.size
              }
            : chat
        ));
        
        // Clear selections but keep current chat open
        setSelectedMessages(new Set());
        setDeleteConfirm(false);
        setDeletingChatId(null);
        
        // Show success message
        setSuccess(`נמחקו ${deletedCount} הודעות מ-${currentChat.title}`);
        
      } else {
        setError(`שגיאה במחיקה: ${data.error || 'Delete failed'}`);
        setDeletingChatId(null);
        return;
      }
      
    } catch (error) {
      console.error('Delete error:', error);
      setError(`שגיאה במחיקה: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setCurrentChat(prev => prev ? { ...prev, status: 'completed' } : null);
      setDeleteConfirm(false);
      setDeletingChatId(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirm(false);
  };

  const handleSkipChat = () => {
    if (currentChat) {
      setSkippedChats(prev => new Set([...prev, currentChat.id]));
      setCurrentChat(prev => prev ? { ...prev, status: 'skipped' } : null);
      
      // Move to next chat
      setTimeout(() => {
        handleNextChat();
      }, 500);
    }
  };

  const handleStatsClick = (statType: string) => {
    setShowStatsModal(statType);
  };

  const toggleChatExpansion = (chatId: number) => {
    setExpandedChats(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chatId)) {
        newSet.delete(chatId);
      } else {
        newSet.add(chatId);
      }
      return newSet;
    });
  };

  const toggleChatSelection = (chatId: number) => {
    setSelectedChats(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chatId)) {
        newSet.delete(chatId);
      } else {
        newSet.add(chatId);
      }
      return newSet;
    });
  };

  const toggleMessageSelection = (messageId: string) => {
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

  const selectAllMessages = (chatId: number) => {
    const chat = scannedChats.find(c => c.id === chatId);
    if (chat && chat.messages) {
      const messageIds = chat.messages.map(m => m.id.toString());
      setSelectedMessages(prev => new Set([...prev, ...messageIds]));
    }
  };

  const deselectAllMessages = (chatId: number) => {
    const chat = scannedChats.find(c => c.id === chatId);
    if (chat && chat.messages) {
      const messageIds = chat.messages.map(m => m.id.toString());
      setSelectedMessages(prev => {
        const newSet = new Set(prev);
        messageIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      
      // Keep panel within viewport bounds
      const maxX = window.innerWidth - 400; // 400px is approximate panel width
      const maxY = window.innerHeight - 300; // 300px is approximate panel height
      
      setFloatingPanelPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const getStatsData = (statType: string) => {
    switch (statType) {
      case 'scanned':
        return scannedChats;
      case 'with_messages':
        return scannedChats.filter(chat => chat.status === 'completed' && (chat.messages_found || 0) > 0);
      case 'empty':
        return scannedChats.filter(chat => chat.status === 'completed' && (chat.messages_found || 0) === 0);
      case 'messages':
        return scannedChats.flatMap(chat => chat.messages || []);
      case 'deleted':
        return scannedChats.filter(chat => chat.messages_deleted && chat.messages_deleted > 0);
      default:
        return [];
    }
  };

  const handleNextChat = () => {
    console.log('Next chat clicked, scannedChats:', scannedChats);
    
    // If we have scanned chats, find the next pending one
    if (scannedChats.length > 0) {
      const nextIndex = scannedChats.findIndex(chat => chat.status === 'pending');
      console.log('Next pending index:', nextIndex);
      
      if (nextIndex !== -1) {
        // Move to next pending chat
        setCurrentChat(scannedChats[nextIndex]);
        console.log('Moving to next chat:', scannedChats[nextIndex].title);
      } else {
        // All chats scanned, start new scan with increased batch size
        const currentBatchSize = scannedChats.length;
        const nextBatchSize = Math.min(currentBatchSize + 10, 30);
        console.log('Starting new scan with batch size:', nextBatchSize);
        onStartScan(false, nextBatchSize);
      }
    } else {
      // No chats yet, start first scan with 10 chats
      console.log('Starting first scan with 10 chats');
      onStartScan(false, 10);
    }
  };

  const handleResetScan = () => {
    if (confirm('האם אתה בטוח שברצונך לאפס את כל נתוני הסריקה ולהתחיל מחדש?')) {
      setCurrentChat(null);
      setScannedChats([]);
      setSelectedMessages(new Set());
      setLocalScanProgress(null);
      setStats({
        total: 0,
        completed: 0,
        skipped: 0,
        errors: 0,
        totalMessages: 0,
        totalDeleted: 0
      });
    }
  };

  const handleResetAllData = async () => {
    if (confirm('האם אתה בטוח שברצונך לאפס את כל הנתונים (כולל זיכרון הסריקות) ולהתחיל מאפס?')) {
      try {
        // Reset backend data
        const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        
        if (response.ok) {
          // Reset frontend data
          handleResetScan();
          alert('כל הנתונים אופסו בהצלחה!');
        } else {
          throw new Error('Failed to reset data');
        }
      } catch (error) {
        console.error('Error resetting data:', error);
        alert('שגיאה באיפוס הנתונים');
      }
    }
  };

  const chatsWithMessages = scannedChats.filter(chat => 
    chat.status === 'completed' && 
    chat.messages && 
    chat.messages.length > 0
  );

  const hasScanData = scannedChats.length > 0 || currentChat;
  const headerActions = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        onClick={onShowRecentMessages}
        className="btn-secondary flex items-center gap-2"
      >
        <Clock className="h-4 w-4" />
        הודעות אחרונות
      </button>
      {isScanning ? (
        <button
          type="button"
          onClick={() => onStopScan?.()}
          disabled={!onStopScan}
          className="btn-destructive flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Square className="h-4 w-4" />
          עצור
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onStartScan(false, 10)}
            className="btn-primary flex items-center gap-2"
          >
            <Play className="h-4 w-4" />
            התחל סריקה (10 קבוצות)
          </button>
          {hasScanData && (
            <button
              type="button"
              onClick={handleResetScan}
              className="btn-destructive flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              איפוס סריקה
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: 'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #16213e 100%)' }}
    >
      <HeaderFullScreen
        title={uiMode === 'simple' ? 'סריקה פשוטה' : 'סריקה מתקדמת'}
        onBack={onClose}
        description={`חשבון: ${accountLabel}`}
        actions={headerActions}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-4">
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
        

        {/* Stats */}
        <div className="glass-elevated p-8 mb-8">
          <h3 className="text-title text-white mb-6">סטטיסטיקות</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            <div className="glass-card p-6 text-center hover-lift cursor-pointer focus:ring-2 focus:ring-blue-400 focus:outline-none" 
                 onClick={() => handleStatsClick('scanned')}
                 tabIndex={0}>
              <div className="flex items-center justify-center mb-4">
                <Search className="w-6 h-6 text-blue-400 mr-3" />
                <div className="text-3xl font-bold text-blue-400">{stats.total}</div>
              </div>
              <div className="text-body text-white/70">נסרקו</div>
            </div>
            <div className="glass-card p-6 text-center hover-lift cursor-pointer focus:ring-2 focus:ring-green-400 focus:outline-none" 
                 onClick={() => handleStatsClick('with_messages')}
                 tabIndex={0}>
              <div className="flex items-center justify-center mb-4">
                <MessageSquare className="w-6 h-6 text-green-400 mr-3" />
                <div className="text-3xl font-bold text-green-400">{stats.completed}</div>
              </div>
              <div className="text-body text-white/70">עם הודעות</div>
            </div>
            <div className="glass-card p-6 text-center hover-lift cursor-pointer focus:ring-2 focus:ring-yellow-400 focus:outline-none" 
                 onClick={() => handleStatsClick('empty')}
                 tabIndex={0}>
              <div className="flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-yellow-400 mr-3" />
                <div className="text-3xl font-bold text-yellow-400">{stats.skipped}</div>
              </div>
              <div className="text-body text-white/70">ריקות</div>
            </div>
            <div className="glass-card p-6 text-center hover-lift cursor-pointer focus:ring-2 focus:ring-purple-400 focus:outline-none" 
                 onClick={() => handleStatsClick('messages')}
                 tabIndex={0}>
              <div className="flex items-center justify-center mb-4">
                <MessageSquare className="w-6 h-6 text-purple-400 mr-3" />
                <div className="text-3xl font-bold text-purple-400">{stats.totalMessages}</div>
              </div>
              <div className="text-body text-white/70">הודעות</div>
            </div>
            <div className="glass-card p-6 text-center hover-lift cursor-pointer focus:ring-2 focus:ring-orange-400 focus:outline-none" 
                 onClick={() => handleStatsClick('deleted')}
                 tabIndex={0}>
              <div className="flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6 text-orange-400 mr-3" />
                <div className="text-3xl font-bold text-orange-400">{stats.totalDeleted}</div>
              </div>
              <div className="text-body text-white/70">נמחקו</div>
            </div>
          </div>
        </div>

        {/* Scan Progress Info */}
        <div className="glass-card p-4 mb-4">
          <h3 className="text-body text-white mb-2">מידע סריקה:</h3>
          <div className="grid grid-cols-2 gap-4 text-small text-white/70">
            <div>
              <p>סטטוס: {isScanning ? 'סורק' : 'ממתין'}</p>
              <p>קבוצות נסרקות: {scannedChats.length}</p>
              <p>קבוצה נוכחית: {currentChat ? currentChat.title : 'אין'}</p>
            </div>
            <div>
              <p>תוצאות אחרונות: {lastScanResults ? lastScanResults.length : 0}</p>
              <p>הודעות נבחרות: {selectedMessages.size}</p>
              <p>סטטוס קבוצה: {currentChat ? currentChat.status : 'אין'}</p>
            </div>
          </div>
        </div>

        {/* Scanning Status */}
        {isScanning && !currentChat && (
          <div className="glass-elevated p-6 mb-6 animate-fade-in-up">
            <div className="flex items-center justify-center">
              <Loader className="w-8 h-8 animate-spin text-blue-400 mr-4" />
              <div>
                <h2 className="text-title text-white">סורק קבוצות...</h2>
                <p className="text-body text-white/70">אנא המתן בזמן שהמערכת טוענת את רשימת הקבוצות</p>
              </div>
            </div>
          </div>
        )}

        {/* Current Chat */}
        {currentChat && (
          <div className="glass-elevated p-6 mb-6 animate-fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                {getStatusIcon(currentChat.status)}
                <h2 className="text-title text-white ml-3">{currentChat.title}</h2>
              </div>
              <div className="text-body text-white/70">
                {getStatusText(currentChat)}
              </div>
            </div>

            {/* Messages */}
            {currentChat.messages && currentChat.messages.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-body text-white">
                    נמצאו {currentChat.messages.length} הודעות
                  </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={handleSelectAllMessages}
                className="btn-secondary text-small px-4 py-2"
              >
                בחר הכל
              </button>
                    {!deleteConfirm ? (
                      <button
                        onClick={handleDeleteClick}
                        disabled={selectedMessages.size === 0}
                        className="btn-destructive text-small disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        מחק נבחרות ({selectedMessages.size})
                      </button>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={handleDeleteConfirm}
                          disabled={currentChat?.status === 'deleting'}
                          className="btn-destructive text-small disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Sure? מחק ({selectedMessages.size})
                        </button>
                        <button
                          onClick={handleDeleteCancel}
                          className="btn-secondary text-small"
                        >
                          ביטול
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto space-y-2">
                  {currentChat.messages.map((message) => (
                    <div key={message.id} className="glass-card p-4 hover-lift">
                      <div className="flex items-start">
                        <input
                          type="checkbox"
                          checked={selectedMessages.has(message.id)}
                          onChange={() => handleSelectMessage(message.id)}
                          className="mt-1 mr-3 w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-small text-white/70">
                              {formatDate(message.date)}
                            </div>
                            {message.media_type && (
                              <div className="text-small text-purple-400">
                                📷 {message.media_type}
                              </div>
                            )}
                          </div>
                          <p className="text-body text-white leading-relaxed">
                            {message.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No Messages */}
            {currentChat.status === 'completed' && (!currentChat.messages || currentChat.messages.length === 0) && (
              <div className="text-center py-8">
                <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-body text-white/70">לא נמצאו הודעות בקבוצה זו</p>
              </div>
            )}

            {/* Action Buttons */}
            {currentChat.status === 'completed' && (
              <div className="mt-6 text-center">
                <div className="flex justify-center space-x-4">
                  <button
                    onClick={handleNextChat}
                    className="btn-primary flex items-center"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {scannedChats.length > 0 ? 'קבוצה הבאה' : 'סרוק עוד 10 קבוצות'}
                  </button>
                </div>
              </div>
            )}
            
            {/* Skip Button for scanning chats */}
            {currentChat.status === 'scanning' && (
              <div className="mt-6 text-center">
                <button
                  onClick={handleSkipChat}
                  className="btn-secondary flex items-center mx-auto"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  דלג על קבוצה זו
                </button>
              </div>
            )}
          </div>
        )}

        {/* Floating Scan Status Panel - Show based on UI mode */}
        {(isScanning || localScanProgress) && uiMode === 'advanced' && (
          <div 
            className="fixed z-50 max-w-md w-full cursor-move select-none"
            style={{
              left: `${floatingPanelPosition.x}px`,
              top: `${floatingPanelPosition.y}px`,
              transform: isDragging ? 'scale(1.02)' : 'scale(1)',
              transition: isDragging ? 'none' : 'transform 0.2s ease'
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div className="glass-advanced p-6 border-2 border-blue-400/30 bg-blue-900/20 backdrop-blur-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <Loader className="w-6 h-6 animate-spin text-blue-400 mr-3" />
                  <h3 className="text-title text-blue-300">סורק קבוצות...</h3>
                </div>
                 <div className="flex items-center space-x-3">
                   <div className="text-body text-blue-200 font-bold">
                     {localScanProgress?.current_index || scanProgress?.current_index || 0} / {localScanProgress?.total || scanProgress?.total || 0}
                   </div>
                  <button
                    onClick={() => onStopScan()}
                    className="text-red-400 hover:text-red-300 transition-colors"
                    title="עצור סריקה"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              {/* Progress Bar */}
              <div className="w-full bg-gray-700 rounded-full h-3 mb-4">
                <div 
                  className="bg-blue-400 h-3 rounded-full transition-all duration-500"
                  style={{ 
                    width: `${scanProgress?.progress_percent || 0}%` 
                  }}
                ></div>
              </div>
              
              {/* Current Group Info */}
              <div className="glass-card p-4 mb-4">
                <h4 className="text-subtitle text-white mb-2">קבוצה נוכחית</h4>
                <p className="text-body text-blue-200">{currentChat?.title || 'מתכונן...'}</p>
                <p className="text-small text-blue-300">ID: {currentChat?.id || 'N/A'}</p>
                <p className="text-small text-blue-300">סטטוס: {currentChat?.status || 'מתכונן...'}</p>
              </div>
              
              {/* Live Stats */}
              <div className="grid grid-cols-2 gap-4 text-small text-blue-200/80" dir="rtl">
                <div className="text-right">
                  <p><strong>📝 נמצאו הודעות:</strong> {stats.totalMessages || 0}</p>
                  <p><strong>💬 קבוצות עם הודעות:</strong> {stats.withMessages || 0}</p>
                  <p><strong>📊 קבוצות נסרקו:</strong> {stats.total || 0}</p>
                </div>
                <div className="text-right">
                  <p><strong>📭 קבוצות ריקות:</strong> {stats.empty || 0}</p>
                   <p><strong>⚡ התקדמות:</strong> {localScanProgress?.progress_percent || scanProgress?.progress_percent || 0}%</p>
                   <p><strong>⏱️ זמן משוער:</strong> {localScanProgress?.current_index || scanProgress?.current_index ? 
                     `${Math.round((((localScanProgress?.total || scanProgress?.total || 0) - (localScanProgress?.current_index || scanProgress?.current_index || 0)) * 2) / 60)} דקות` : 'מחשב...'}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Simple UI - Basic scan status */}
        {(isScanning || localScanProgress) && uiMode === 'simple' && (
          <div className="fixed top-4 right-4 z-50">
            <div className="glass-card p-4 max-w-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-title text-white">סריקה פעילה</h3>
                <button
                  onClick={() => onStopScan?.()}
                  className="text-red-400 hover:text-red-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="text-small text-white/80">
                <p>קבוצה: {localScanProgress?.current_chat || 'מתכונן...'}</p>
                <p>התקדמות: {localScanProgress?.current_index || 0} / {localScanProgress?.total_chats || 0}</p>
                <p>נמצאו: {stats.totalMessages || 0} הודעות</p>
              </div>
            </div>
          </div>
        )}

        {/* Scanned Chats List */}
        {scannedChats.length > 0 && (
          <div className="glass-elevated p-6 animate-fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-title text-white">קבוצות שנסרקו ({scannedChats.length})</h3>
              <div className="flex items-center space-x-4">
                {selectedChats.size > 0 && (
                  <button
                    onClick={() => {
                      // Delete selected chats
                      setScannedChats(prev => prev.filter(chat => !selectedChats.has(chat.id)));
                      setSelectedChats(new Set());
                    }}
                    className="btn-destructive text-small"
                  >
                    מחק נבחרות ({selectedChats.size})
                  </button>
                )}
                <button
                  onClick={() => setScannedChats([])}
                  className="btn-secondary text-small"
                >
                  נקה רשימה
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-96 overflow-y-auto">
            {/* Current scanning chat */}
            {currentChat && currentChat.status === 'scanning' && (
              <div className="mb-4">
                <h4 className="text-small text-blue-400 mb-2 font-semibold">
                  🔄 כרגע סורק
                </h4>
                <div className="glass-card p-4 flex items-center justify-between border-l-4 border-blue-400 bg-blue-900/20">
                  <div className="flex items-center">
                    {getStatusIcon(currentChat.status)}
                    <div className="ml-3">
                      <span className="text-body text-blue-200">{currentChat.title}</span>
                      <div className="text-small text-blue-300">
                        {scanProgress?.current_index || 0} / {scanProgress?.total || 0} קבוצות
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-small text-blue-300 mb-1">
                      {scanProgress?.progress_percent || 0}%
                    </div>
                    <div className="w-20 bg-gray-600 rounded-full h-2">
                      <div 
                        className="bg-blue-400 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${scanProgress?.progress_percent || 0}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
              
              {/* Group chats by status */}
              {(() => {
                const completedChats = scannedChats.filter(chat => 
                  chat.status === 'completed' && 
                  chat.messages && 
                  chat.messages.length > 0
                );
                const emptyChats = scannedChats.filter(chat => 
                  chat.status === 'completed' && 
                  (!chat.messages || chat.messages.length === 0)
                );
                const errorChats = scannedChats.filter(chat => chat.status === 'error');
                
                return (
                  <>
                    {/* Chats with messages */}
                    {completedChats.length > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-small text-green-400 font-semibold">
                            📝 קבוצות עם הודעות ({completedChats.length})
                          </h4>
                          <button
                            onClick={() => {
                              const chatIds = completedChats.map(chat => chat.id);
                              setSelectedChats(prev => new Set([...prev, ...chatIds]));
                            }}
                            className="btn-secondary text-xs px-2 py-1"
                          >
                            בחר הכל
                          </button>
                        </div>
                        {completedChats.map((chat) => (
                          <div key={chat.id} className="mb-1">
                            <div 
                              className={`glass-card p-3 hover-lift border-l-4 border-green-400 ${
                                deletingChatId === chat.id ? 'animate-wipe-out' : ''
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                  <label className="flex items-center cursor-pointer mr-3">
                                    <input
                                      type="checkbox"
                                      checked={selectedChats.has(chat.id)}
                                      onChange={() => toggleChatSelection(chat.id)}
                                      className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                                    />
                                    <span className="ml-2"></span>
                                  </label>
                                  <button
                                    onClick={() => toggleChatExpansion(chat.id)}
                                    className="flex items-center flex-1 text-right"
                                  >
                                    {getStatusIcon(chat.status)}
                                    <span className="text-body text-white ml-2">{chat.title}</span>
                                    <div className="text-small text-green-300 font-medium mr-2">
                                      {chat.messages ? chat.messages.length : 0} הודעות
                                      {chat.member_count && (
                                        <span className="text-white/60 ml-1">
                                          ({chat.member_count} משתתפים)
                                        </span>
                                      )}
                                      {chat.has_unscanned_dates && (
                                        <span className="text-yellow-400 ml-1">
                                          יש תאריכים שלא נסרקו
                                        </span>
                                      )}
                                    </div>
                                    
                                    {/* Progress Bar for this chat */}
                                    <div className="w-full mt-2">
                                      <div className="flex items-center justify-between text-xs text-white/60 mb-1">
                                        <span>התקדמות סריקה</span>
                                        <span>{chat.progress_percent || 0}%</span>
                                      </div>
                                      <div className="w-full bg-white/10 rounded-full h-2">
                                        <div 
                                          className="bg-gradient-to-r from-blue-400 to-green-400 h-2 rounded-full transition-all duration-300"
                                          style={{ width: `${chat.progress_percent || 0}%` }}
                                        ></div>
                                      </div>
                                    </div>
                                    <ChevronDown className={`w-4 h-4 text-white/50 transition-transform ${
                                      expandedChats.has(chat.id) ? 'rotate-180' : ''
                                    }`} />
                                  </button>
                                </div>
                              </div>
                              
                              {/* Expanded Messages */}
                              {expandedChats.has(chat.id) && chat.messages && chat.messages.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-white/10">
                                  <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center space-x-2">
                                    <button
                                      onClick={() => selectAllMessages(chat.id)}
                                      className="btn-secondary text-xs px-2 py-1"
                                    >
                                      בחר הכל
                                    </button>
                                    <button
                                      onClick={() => deselectAllMessages(chat.id)}
                                      className="btn-secondary text-xs px-2 py-1"
                                    >
                                      בטל הכל
                                    </button>
                                    <button
                                      onClick={() => {
                                        // Select all messages from all chats
                                        const allMessageIds = scannedChats
                                          .filter(c => c.messages && c.messages.length > 0)
                                          .flatMap(c => c.messages!.map(m => m.id.toString()));
                                        setSelectedMessages(new Set(allMessageIds));
                                      }}
                                      className="btn-primary text-xs px-2 py-1"
                                    >
                                      בחר הכל בכל הקבוצות
                                    </button>
                                  </div>
                                    {selectedMessages.size > 0 && (
                                      <button
                                        onClick={() => {
                                          // Delete selected messages
                                          console.log('Deleting messages:', Array.from(selectedMessages));
                                        }}
                                        className="btn-destructive text-xs px-2 py-1"
                                      >
                                        מחק נבחרות ({selectedMessages.size})
                                      </button>
                                    )}
                                  </div>
                                  <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {chat.messages.map((message) => (
                                      <div key={message.id} className="glass-card p-2 flex items-start space-x-2">
                                        <label className="flex items-start cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={selectedMessages.has(message.id.toString())}
                                            onChange={() => toggleMessageSelection(message.id.toString())}
                                            className="mt-1 w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                                          />
                                          <span className="ml-2"></span>
                                        </label>
                                        <div className="flex-1">
                                          <div className="text-small text-white/80 mb-1">
                                            {message.content || 'הודעה ללא תוכן'}
                                          </div>
                                          <div className="text-xs text-white/50">
                                            {new Date(message.date).toLocaleString('he-IL')}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Empty chats */}
                    {emptyChats.length > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-small text-gray-400 font-semibold">
                            📭 קבוצות ריקות ({emptyChats.length})
                          </h4>
                          <button
                            onClick={() => {
                              const chatIds = emptyChats.map(chat => chat.id);
                              setSelectedChats(prev => new Set([...prev, ...chatIds]));
                            }}
                            className="btn-secondary text-xs px-2 py-1"
                          >
                            בחר הכל
                          </button>
                        </div>
                        {emptyChats.map((chat) => (
                          <div key={chat.id} className="mb-1">
                            <div className="glass-card p-3 flex items-center justify-between hover-lift border-l-4 border-gray-400 opacity-70">
                              <div className="flex items-center">
                                <label className="flex items-center cursor-pointer mr-3">
                                  <input
                                    type="checkbox"
                                    checked={selectedChats.has(chat.id)}
                                    onChange={() => toggleChatSelection(chat.id)}
                                    className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                                  />
                                  <span className="ml-2"></span>
                                </label>
                                {getStatusIcon(chat.status)}
                                <span className="text-body text-white/70 ml-2">{chat.title}</span>
                              </div>
                              <div className="text-small text-gray-400">
                                ריקה
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Error chats */}
                    {errorChats.length > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-small text-red-400 font-semibold">
                            ❌ שגיאות ({errorChats.length})
                          </h4>
                          <button
                            onClick={() => {
                              const chatIds = errorChats.map(chat => chat.id);
                              setSelectedChats(prev => new Set([...prev, ...chatIds]));
                            }}
                            className="btn-secondary text-xs px-2 py-1"
                          >
                            בחר הכל
                          </button>
                        </div>
                        {errorChats.map((chat) => (
                          <div key={chat.id} className="mb-1">
                            <div className="glass-card p-3 flex items-center justify-between hover-lift border-l-4 border-red-400">
                              <div className="flex items-center">
                                <label className="flex items-center cursor-pointer mr-3">
                                  <input
                                    type="checkbox"
                                    checked={selectedChats.has(chat.id)}
                                    onChange={() => toggleChatSelection(chat.id)}
                                    className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                                  />
                                  <span className="ml-2"></span>
                                </label>
                                {getStatusIcon(chat.status)}
                                <span className="text-body text-white ml-2">{chat.title}</span>
                              </div>
                              <div className="text-small text-red-300">
                                {chat.error || 'שגיאה'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* Empty State or Ready to Scan */}
        {!isScanning && scannedChats.length === 0 && !currentChat && (
          <div className="glass-elevated p-12 text-center animate-fade-in-up">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-6" />
            <h3 className="text-title text-white mb-4">מוכן לסריקה</h3>
            <p className="text-body text-white/70 mb-8">
              התחל לסרוק את קבוצות הטלגרם שלך כדי למצוא ולנהל את ההודעות שלך
            </p>
            <div className="flex items-center justify-center space-x-6">
              <button
                onClick={() => onStartScan(false, 10)}
                className="btn-primary flex items-center px-8 py-4"
              >
                <Play className="w-5 h-5 mr-3" />
                התחל סריקה (10 קבוצות)
              </button>
              <button
                onClick={() => onStartScan(true, 30)}
                className="btn-secondary flex items-center px-8 py-4"
              >
                <Search className="w-5 h-5 mr-3" />
                סריקה מלאה (30 קבוצות)
              </button>
            </div>
          </div>
        )}

        {/* After Scan Complete - Show Reset Button */}
        {!isScanning && scannedChats.length > 0 && !currentChat && (
          <div className="glass-elevated p-8 text-center animate-fade-in-up mb-6">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
            <h3 className="text-title text-white mb-4">סריקה הושלמה!</h3>
            <p className="text-body text-white/70 mb-6">
              נסרקו {scannedChats.length} קבוצות. תוכל להתחיל סריקה חדשה או לבדוק את התוצאות.
            </p>
            <div className="flex items-center justify-center space-x-6">
              <button
                onClick={() => onStartScan(false, 10)}
                className="btn-primary flex items-center px-8 py-4"
              >
                <Play className="w-5 h-5 mr-3" />
                התחל סריקה חדשה
              </button>
          <button
            onClick={handleResetScan}
            className="btn-destructive flex items-center px-8 py-4"
          >
            <RefreshCw className="w-5 h-5 mr-3" />
            אפס הכל
          </button>
          <button
            onClick={handleResetAllData}
            className="btn-destructive flex items-center px-8 py-4 bg-red-600 hover:bg-red-700"
          >
            <RefreshCw className="w-5 h-5 mr-3" />
            אפס זיכרון סריקות
          </button>
            </div>
          </div>
        )}

        {/* Stats Modal */}
        {showStatsModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-elevated p-8 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-title text-white">
                  {showStatsModal === 'scanned' && 'קבוצות שנסרקו'}
                  {showStatsModal === 'with_messages' && 'קבוצות עם הודעות'}
                  {showStatsModal === 'empty' && 'קבוצות ריקות'}
                  {showStatsModal === 'messages' && 'כל ההודעות'}
                  {showStatsModal === 'deleted' && 'הודעות שנמחקו'}
                </h2>
                <button
                  onClick={() => setShowStatsModal(null)}
                  className="btn-secondary"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="space-y-4">
                {getStatsData(showStatsModal).map((item, index) => (
                  <div key={index} className="glass-card p-4">
                    {showStatsModal === 'messages' ? (
                      <div>
                        <div className="text-body text-white mb-2">{item.content}</div>
                        <div className="text-small text-white/70">
                          {new Date(item.date).toLocaleString('he-IL')}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-body text-white">{item.title}</div>
                          <div className="text-small text-white/70">
                            {item.messages_found || 0} הודעות
                            {item.messages_deleted && ` • נמחקו ${item.messages_deleted}`}
                          </div>
                        </div>
                        <div className="text-small text-white/70">
                          {getStatusText(item)}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                
                {getStatsData(showStatsModal).length === 0 && (
                  <div className="text-center py-8">
                    <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-body text-white/70">אין נתונים להצגה</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default SimpleScanInterface;
