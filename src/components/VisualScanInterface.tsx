import React, { useState, useEffect } from 'react';
import { 
  X, 
  Play, 
  Square, 
  BarChart3, 
  MessageSquare, 
  Users, 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Loader,
  Calendar,
  Trash2,
  ChevronDown,
  ChevronRight,
  Image,
  CheckSquare,
  Square as SquareIcon,
  RotateCcw,
  Eye,
  AlertTriangle as Warning,
  Check
} from 'lucide-react';

interface Message {
  id: number;
  content: string;
  date: string;
  media_type?: string;
  media_url?: string;
}

interface ChatInfo {
  id: number;
  title: string;
  type: string;
  last_scan_date?: string;
  last_deleted_count: number;
  status: 'pending' | 'scanning' | 'completed' | 'skipped' | 'error';
  messages_found?: number;
  messages_deleted?: number;
  error?: string;
  reason?: string;
  messages?: Message[];
  expanded?: boolean;
  selected: boolean;
}

interface VisualScanInterfaceProps {
  accountId: string;
  accountLabel: string;
  onClose: () => void;
  onStartScan: () => void;
  onStopScan?: () => void;
  onFullScan?: () => void;
  onRefresh?: () => void;
  isScanning: boolean;
  scanProgress?: {
    type?: string;
    chat_id?: number;
    chat_name?: string;
    current_index?: number;
    total?: number;
    status?: string;
    chats?: ChatInfo[];
    messages_found?: number;
    messages_deleted?: number;
    total_to_delete?: number;
  };
  lastScanResults?: ChatInfo[];
}

const VisualScanInterface: React.FC<VisualScanInterfaceProps> = ({
  accountId,
  accountLabel,
  onClose,
  onStartScan,
  onStopScan,
  onFullScan,
  onRefresh,
  isScanning,
  scanProgress,
  lastScanResults
}) => {
  const [chats, setChats] = useState<ChatInfo[]>(lastScanResults || []);
  const [currentScanningId, setCurrentScanningId] = useState<number | null>(null);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [allChatsSelected, setAllChatsSelected] = useState(false);
  const [showCheckboxes, setShowCheckboxes] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    skipped: 0,
    errors: 0,
    totalMessages: 0,
    totalDeleted: 0
  });
  const [isDeleting, setIsDeleting] = useState(false);

  // Update chats and stats based on scan progress
  useEffect(() => {
    if (!scanProgress) return;

    switch (scanProgress.type) {
      case 'chat_list':
        if (scanProgress.chats) {
          const newChats = scanProgress.chats.map(chat => ({ 
            ...chat, 
            expanded: false, 
            selected: false 
          }));
          setChats(newChats);
          setStats(prev => ({ ...prev, total: scanProgress.chats!.length }));
          // Show checkboxes immediately when we have chats
          setShowCheckboxes(true);
        }
        break;

      case 'chat_scanning':
        if (scanProgress.chat_id) {
          setCurrentScanningId(scanProgress.chat_id);
          setChats(prev => prev.map(chat => 
            chat.id === scanProgress.chat_id 
              ? { ...chat, status: 'scanning' }
              : chat
          ));
        }
        break;

      case 'chat_progress':
        if (scanProgress.chat_id) {
          setChats(prev => prev.map(chat => 
            chat.id === scanProgress.chat_id 
              ? { 
                  ...chat, 
                  messages_found: scanProgress.messages_found || chat.messages_found,
                  messages_deleted: scanProgress.messages_deleted || chat.messages_deleted
                }
              : chat
          ));
        }
        break;

      case 'chat_completed':
        if (scanProgress.chat_id) {
          setCurrentScanningId(null);
          setChats(prev => prev.map(chat => 
            chat.id === scanProgress.chat_id 
              ? { 
                  ...chat, 
                  status: scanProgress.status as any,
                  messages_found: scanProgress.messages_found || chat.messages_found,
                  messages_deleted: scanProgress.messages_deleted || chat.messages_deleted,
                  messages: (scanProgress as any).messages || chat.messages,
                  error: scanProgress.error,
                  reason: (scanProgress as any).reason
                }
              : chat
          ));

          // Update stats
          setStats(prev => {
            const newStats = { ...prev };
            if (scanProgress.status === 'completed') {
              newStats.completed++;
              newStats.totalMessages += scanProgress.messages_found || 0;
              newStats.totalDeleted += scanProgress.messages_deleted || 0;
            } else if (scanProgress.status === 'skipped') {
              newStats.skipped++;
            } else if (scanProgress.status === 'error') {
              newStats.errors++;
            }
            return newStats;
          });
          
          // Show checkboxes when we have chats with messages
          setShowCheckboxes(true);
        }
        break;

      case 'final_summary':
        // Update final stats
        setStats({
          total: scanProgress.total || 0,
          completed: scanProgress.completed || 0,
          skipped: scanProgress.skipped || 0,
          errors: scanProgress.errors || 0,
          totalMessages: scanProgress.totalMessages || 0,
          totalDeleted: scanProgress.totalDeleted || 0
        });
        
        // Show checkboxes when scan is complete and we have messages
        setShowCheckboxes(true);
        break;
    }
  }, [scanProgress]);

  // Initialize chats from lastScanResults when component mounts
  useEffect(() => {
    if (lastScanResults && lastScanResults.length > 0) {
      setChats(lastScanResults.map(chat => ({
        ...chat,
        expanded: false,
        selected: false
      })));
      
      // Calculate stats from lastScanResults
      const total = lastScanResults.length;
      const completed = lastScanResults.filter(c => c.status === 'completed').length;
      const skipped = lastScanResults.filter(c => c.status === 'skipped').length;
      const errors = lastScanResults.filter(c => c.status === 'error').length;
      const totalMessages = lastScanResults.reduce((sum, chat) => sum + (chat.messages_found || 0), 0);
      const totalDeleted = lastScanResults.reduce((sum, chat) => sum + (chat.messages_deleted || 0), 0);
      
      setStats({
        total,
        completed,
        skipped,
        errors,
        totalMessages,
        totalDeleted
      });
      
      setShowCheckboxes(true);
    }
  }, [lastScanResults]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('he-IL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatMessageDate = (dateString: string) => {
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
        return <Loader className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'skipped':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusText = (chat: ChatInfo) => {
    switch (chat.status) {
      case 'scanning':
        return 'סורק...';
      case 'completed':
        return `נמצאו ${chat.messages_found || 0} הודעות${chat.messages_deleted ? `, נמחקו ${chat.messages_deleted}` : ''}`;
      case 'skipped':
        return chat.reason || 'דולג';
      case 'error':
        return chat.error || 'שגיאה';
      default:
        return 'ממתין';
    }
  };

  const toggleChatExpansion = (chatId: number) => {
    setChats(prev => prev.map(chat => 
      chat.id === chatId 
        ? { ...chat, expanded: !chat.expanded }
        : chat
    ));
  };

  const handleSelectAllChats = () => {
    const chatsWithMessages = chats.filter(chat => 
      chat.status === 'completed' && 
      chat.messages && 
      chat.messages.length > 0
    );
    
    if (allChatsSelected) {
      // Deselect all
      setSelectedChats(new Set());
      setChats(prev => prev.map(chat => ({ ...chat, selected: false })));
      setSelectedMessages(new Set());
      setAllChatsSelected(false);
    } else {
      // Select all chats with messages
      setSelectedChats(new Set(chatsWithMessages.map(chat => chat.id)));
      setChats(prev => prev.map(chat => 
        chatsWithMessages.some(c => c.id === chat.id) 
          ? { ...chat, selected: true }
          : { ...chat, selected: false }
      ));
      
      // Select all messages from selected chats
      const allMessageIds = new Set<number>();
      chatsWithMessages.forEach(chat => {
        if (chat.messages) {
          chat.messages.forEach(msg => allMessageIds.add(msg.id));
        }
      });
      setSelectedMessages(allMessageIds);
      setAllChatsSelected(true);
    }
  };

  const handleSelectChat = (chatId: number) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat || !chat.messages || chat.messages.length === 0 || chat.status !== 'completed') {
      return;
    }
    
    const newSelected = new Set(selectedChats);
    const newSelectedMessages = new Set(selectedMessages);
    let newChatSelected = false;
    
    if (newSelected.has(chatId)) {
      newSelected.delete(chatId);
      // Remove all messages from this chat
      const chatMessageIds = chat.messages.map(m => m.id);
      chatMessageIds.forEach(id => newSelectedMessages.delete(id));
    } else {
      newSelected.add(chatId);
      newChatSelected = true;
      // Add all messages from this chat
      const chatMessageIds = chat.messages.map(m => m.id);
      chatMessageIds.forEach(id => newSelectedMessages.add(id));
    }
    
    setSelectedChats(newSelected);
    setSelectedMessages(newSelectedMessages);
    
    // Update chat selection state
    setChats(prev => prev.map(c => 
      c.id === chatId ? { ...c, selected: newChatSelected } : c
    ));
    
    // Update "select all" state
    const chatsWithMessages = chats.filter(chat => 
      chat.status === 'completed' && 
      chat.messages && 
      chat.messages.length > 0
    );
    setAllChatsSelected(newSelected.size === chatsWithMessages.length && chatsWithMessages.length > 0);
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

  const handleSelectAllMessagesInChat = (chatId: number) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat || !chat.messages) return;
    
    const chatMessageIds = chat.messages.map(m => m.id);
    const allSelected = chatMessageIds.every(id => selectedMessages.has(id));
    
    const newSelectedMessages = new Set(selectedMessages);
    
    if (allSelected) {
      // Deselect all messages in this chat
      chatMessageIds.forEach(id => newSelectedMessages.delete(id));
    } else {
      // Select all messages in this chat
      chatMessageIds.forEach(id => newSelectedMessages.add(id));
    }
    
    setSelectedMessages(newSelectedMessages);
  };
  const handleDeleteSelected = async () => {
    if (selectedMessages.size === 0 || isDeleting) return;
    
    const messagesByChat = new Map<number, { messageIds: number[]; title: string }>();
    chats.forEach(chat => {
      if (!chat.messages || chat.messages.length === 0) return;
      const messageIds = chat.messages
        .filter(msg => selectedMessages.has(msg.id))
        .map(msg => msg.id);
      if (messageIds.length > 0) {
        messagesByChat.set(chat.id, { messageIds, title: chat.title });
      }
    });
    
    if (messagesByChat.size === 0) {
      return;
    }
    
    const messageCount = Array.from(messagesByChat.values()).reduce(
      (sum, entry) => sum + entry.messageIds.length,
      0
    );
    const chatCount = messagesByChat.size;
    
    if (!confirm(`האם אתה בטוח שברצונך למחוק ${messageCount} הודעות נבחרות מ-${chatCount} קבוצות?`)) {
      return;
    }
    
    setIsDeleting(true);
    
    const deletedByChat = new Map<number, { messageIds: number[]; deletedCount: number }>();
    const failedChats: string[] = [];
    
    for (const [chatId, { messageIds, title }] of messagesByChat.entries()) {
      try {
        const response = await fetch(`/api/accounts/${accountId}/delete-messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chatId,
            message_ids: messageIds,
            revoke: true,
          }),
        });
        
        const result = await response.json();
        if (result.success) {
          const deletedCount = result.deleted_count ?? result.result?.deleted_count ?? messageIds.length;
          deletedByChat.set(chatId, { messageIds, deletedCount });
        } else {
          failedChats.push(title);
        }
      } catch (error) {
        console.error(`Delete error for chat ${chatId}:`, error);
        failedChats.push(title);
      }
    }
    
    if (deletedByChat.size > 0) {
      const totalDeleted = Array.from(deletedByChat.values()).reduce(
        (sum, entry) => sum + entry.deletedCount,
        0
      );
      const deletedMessageIds = new Set<number>();
      deletedByChat.forEach(({ messageIds }) => {
        messageIds.forEach(id => deletedMessageIds.add(id));
      });
      
      const newSelectedMessages = new Set<number>();
      selectedMessages.forEach(id => {
        if (!deletedMessageIds.has(id)) {
          newSelectedMessages.add(id);
        }
      });
      
      const updatedChats = chats.map(chat => {
        const deletion = deletedByChat.get(chat.id);
        if (!deletion) {
          return {
            ...chat,
            selected: (chat.messages || []).some(msg => newSelectedMessages.has(msg.id))
          };
        }
        const idsToRemove = new Set(deletion.messageIds);
        const remainingMessages = (chat.messages || []).filter(msg => !idsToRemove.has(msg.id));
        return {
          ...chat,
          messages: remainingMessages,
          messages_found: remainingMessages.length,
          messages_deleted: (chat.messages_deleted || 0) + deletion.deletedCount,
          selected: remainingMessages.some(msg => newSelectedMessages.has(msg.id))
        };
      });
      
      setChats(updatedChats);
      setStats(prev => ({
        ...prev,
        totalMessages: Math.max(0, prev.totalMessages - totalDeleted),
        totalDeleted: prev.totalDeleted + totalDeleted
      }));
      setSelectedMessages(newSelectedMessages);
      
      const newSelectedChats = new Set<number>();
      updatedChats.forEach(chat => {
        if (chat.messages && chat.messages.some(msg => newSelectedMessages.has(msg.id))) {
          newSelectedChats.add(chat.id);
        }
      });
      setSelectedChats(newSelectedChats);
      setAllChatsSelected(false);
      
      const successMessage = `✅ נמחקו ${totalDeleted} הודעות מ-${deletedByChat.size} קבוצות`;
      if (failedChats.length === 0) {
        alert(successMessage);
      } else {
        alert(`${successMessage}, אך התהליך נכשל בקבוצות: ${failedChats.join(', ')}`);
      }
    } else if (failedChats.length > 0) {
      alert(`❌ שגיאה במחיקה בקבוצות: ${failedChats.join(', ')}`);
    }
    
    setIsDeleting(false);
  };

  const handleDeleteAll = async () => {
    const totalMessages = chats.reduce((sum, chat) => sum + (chat.messages_found || 0), 0);
    
    if (confirm(`⚠️ אזהרה! פעולה זו תמחק את כל ${totalMessages} ההודעות שנסרקו מכל הקבוצות. האם אתה בטוח?`)) {
      try {
        const response = await fetch(`/api/accounts/${accountId}/delete-all-found-messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        const result = await response.json();
        
        if (result.success) {
          alert(`✅ נמחקו ${result.total_deleted} הודעות מ-${result.deleted_chats.length} קבוצות`);
          // רענון הנתונים
          onRefresh?.();
        } else {
          alert(`❌ שגיאה במחיקה: ${result.error}`);
        }
      } catch (error) {
        alert(`❌ שגיאה במחיקה: ${error}`);
      }
    }
  };

  const handleKeepMessage = async (chatId: number, messageId: number) => {
    try {
      const response = await fetch(`/api/accounts/${accountId}/keep-message`, {
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
        setChats(prev => prev.map(chat => {
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
        
        // הסרת ההודעה מהבחירה
        setSelectedMessages(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        
        alert('✅ ההודעה סומנה כ"השאר" ולא תמחק');
      } else {
        alert(`❌ שגיאה: ${result.error}`);
      }
    } catch (error) {
      alert(`❌ שגיאה: ${error}`);
    }
  };

  const chatsWithMessages = chats.filter(chat => 
    chat.status === 'completed' && 
    chat.messages && 
    chat.messages.length > 0
  );
  const totalSelectedMessages = Array.from(selectedMessages).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <button
                onClick={onClose}
                className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 mr-4"
              >
                <X className="w-5 h-5 mr-1" />
                סגור
              </button>
              <BarChart3 className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">סריקה ויזואלית</h1>
                <p className="text-gray-600">חשבון: {accountLabel}</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <button
                onClick={() => onFullScan && onFullScan()}
                disabled={isScanning}
                className="flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-orange-400 transition-colors"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                סריקה מלאה
              </button>
              
              {!isScanning ? (
                <button
                  onClick={onStartScan}
                  className="flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Play className="w-4 h-4 mr-2" />
                  התחל סריקה
                </button>
              ) : (
                <button
                  onClick={onStopScan}
                  disabled={!onStopScan}
                  className="flex items-center px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Square className="w-4 h-4 mr-2" />
                  עצור סריקה
                </button>
              )}
            </div>
          </div>

          {/* Full Scan Warning */}
          {!isScanning && (
            <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="flex items-start">
              <Warning className="w-4 h-4 text-orange-500 mr-2 mt-0.5" />
              <div className="text-sm text-orange-800">
                <strong>סריקה מלאה:</strong> סורקת את כל הקבוצות עד 5 שנים אחורה או מאז ההצטרפות. 
                עלולה לקחת זמן רב ולמצוא אלפי הודעות.
              </div>
            </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mt-6">
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
              <div className="text-sm text-blue-800">סה"כ קבוצות</div>
            </div>
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
              <div className="text-sm text-green-800">הושלמו</div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{stats.skipped}</div>
              <div className="text-sm text-yellow-800">דולגו</div>
            </div>
            <div className="bg-red-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.errors}</div>
              <div className="text-sm text-red-800">שגיאות</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">{stats.totalMessages}</div>
              <div className="text-sm text-purple-800">הודעות נמצאו</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">{stats.totalDeleted}</div>
              <div className="text-sm text-orange-800">הודעות נמחקו</div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {showCheckboxes && chatsWithMessages.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleSelectAllChats}
                  className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {allChatsSelected ? (
                    <CheckSquare className="w-4 h-4 mr-2" />
                  ) : (
                    <SquareIcon className="w-4 h-4 mr-2" />
                  )}
                  בחר הכל ({selectedChats.size}/{chatsWithMessages.length})
                </button>
                
                <span className="text-sm text-gray-600">
                  נבחרו {totalSelectedMessages} הודעות
                </span>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedMessages.size === 0 || isDeleting}
                  className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {isDeleting ? 'מוחק...' : `מחק הודעות נבחרות (${totalSelectedMessages})`}
                </button>
                
                <button
                  onClick={handleDeleteAll}
                  disabled={stats.totalMessages === 0}
                  className="flex items-center px-4 py-2 bg-red-800 text-white rounded-lg hover:bg-red-900 transition-colors text-sm"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  מחק הכל ({stats.totalMessages})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Chat List */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">רשימת קבוצות והודעות</h3>
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {chats.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {isScanning ? 'טוען רשימת קבוצות...' : 'לא נמצאו קבוצות'}
                </h3>
                <p className="text-gray-600">אנא המתן בזמן שהמערכת טוענת את רשימת הקבוצות</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {chats.map((chat) => (
                  <div key={chat.id} className="p-4">
                    {/* Chat Header */}
                    <div 
                      className={`transition-all duration-300 ${
                        chat.id === currentScanningId 
                          ? 'bg-blue-50 border-l-4 border-blue-500 animate-pulse' 
                          : chat.status === 'completed' 
                          ? 'bg-green-50' 
                          : chat.status === 'skipped' 
                          ? 'bg-yellow-50'
                          : chat.status === 'error'
                          ? 'bg-red-50'
                          : 'hover:bg-gray-50'
                      } p-3 rounded-lg`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center flex-1">
                          {showCheckboxes && chat.status === 'completed' && chat.messages && chat.messages.length > 0 && (
                            <input
                              type="checkbox"
                              checked={chat.selected || false}
                              onChange={() => handleSelectChat(chat.id)}
                              className="mr-3 w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                          )}
                          
                          {getStatusIcon(chat.status)}
                          
                          <button
                            onClick={() => toggleChatExpansion(chat.id)}
                            className="flex items-center mr-3 hover:bg-gray-100 p-1 rounded"
                          >
                            {chat.expanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            )}
                          </button>
                          
                          <div className="mr-3 flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-medium text-gray-900 truncate max-w-xs">
                                {chat.title}
                              </h4>
                              <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                                chat.type === 'User' 
                                  ? 'bg-blue-100 text-blue-800' 
                                  : 'bg-green-100 text-green-800'
                              }`}>
                                {chat.type === 'User' ? 'פרטי' : 'קבוצה'}
                              </span>
                            </div>
                            
                            <div className="flex items-center justify-between mt-1">
                              <p className="text-xs text-gray-600">
                                {getStatusText(chat)}
                              </p>
                              
                              <div className="flex items-center text-xs text-gray-500">
                                <Calendar className="w-3 h-3 mr-1" />
                                <span>סריקה אחרונה: {formatDate(chat.last_scan_date)}</span>
                                {chat.last_deleted_count > 0 && (
                                  <>
                                    <Trash2 className="w-3 h-3 mr-1 ml-2" />
                                    <span>נמחקו: {chat.last_deleted_count}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Progress bar for scanning chats */}
                      {chat.status === 'scanning' && chat.messages_found !== undefined && (
                        <div className="mt-2">
                          <div className="flex justify-between text-xs text-gray-600 mb-1">
                            <span>נמצאו {chat.messages_found} הודעות</span>
                            {chat.messages_deleted !== undefined && (
                              <span>נמחקו {chat.messages_deleted}</span>
                            )}
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1">
                            <div 
                              className="bg-blue-600 h-1 rounded-full transition-all duration-300 animate-pulse"
                              style={{ width: '60%' }}
                            ></div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Messages List */}
                    {chat.expanded && chat.messages && chat.messages.length > 0 && (
                      <div className="mt-3 mr-8 space-y-2">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm text-gray-600">
                            {chat.messages.length} הודעות נמצאו:
                          </div>
                          <button
                            onClick={() => handleSelectAllMessagesInChat(chat.id)}
                            className="flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                          >
                            {chat.messages.every(m => selectedMessages.has(m.id)) ? (
                              <>
                                <CheckSquare className="w-3 h-3 mr-1" />
                                בטל בחירה
                              </>
                            ) : (
                              <>
                                <Check className="w-3 h-3 mr-1" />
                                בחר הכל
                              </>
                            )}
                          </button>
                        </div>
                        {chat.messages.map((message) => (
                          <div key={message.id} className="bg-gray-50 p-3 rounded-lg border-r-2 border-blue-200">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start flex-1">
                                <input
                                  type="checkbox"
                                  checked={selectedMessages.has(message.id)}
                                  onChange={() => handleSelectMessage(message.id)}
                                  className="mt-1 mr-3 w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                />
                                
                                <div className="flex-1">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center text-xs text-gray-500">
                                      <Calendar className="w-3 h-3 mr-1" />
                                      <span>{formatMessageDate(message.date)}</span>
                                    </div>
                                    
                                    {message.media_type && (
                                      <div className="flex items-center">
                                        <Image className="w-3 h-3 mr-1 text-purple-500" />
                                        <span className="text-xs text-purple-600">{message.media_type}</span>
                                      </div>
                                    )}
                                  </div>
                                  
                                  <p className="text-sm text-gray-800 leading-relaxed">
                                    {message.content}
                                  </p>
                                  
                                  {message.media_url && (
                                    <div className="mt-2">
                                      <img 
                                        src={message.media_url} 
                                        alt="Message media"
                                        className="max-w-xs max-h-32 rounded-lg border"
                                      />
                                    </div>
                                  )}
                                  
                                  {message.media_type === 'photo' && (
                                    <div className="mt-2 text-xs text-purple-600">
                                      📷 תמונה מצורפת
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              <button
                                onClick={() => handleKeepMessage(chat.id, message.id)}
                                className="ml-2 px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors flex-shrink-0"
                                title="השאר הודעה - לא תמחק"
                              >
                                <Eye className="w-3 h-3 mr-1" />
                                השאר
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* No Messages Found */}
                    {chat.expanded && chat.status === 'completed' && (!chat.messages || chat.messages.length === 0) && (
                      <div className="mt-3 mr-8 p-4 bg-gray-50 rounded-lg text-center">
                        <MessageSquare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-600">לא נמצאו הודעות בקבוצה זו</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Current Status */}
        {isScanning && scanProgress && (
          <div className="mt-6 bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">סטטוס נוכחי</h3>
              <Loader className="w-5 h-5 animate-spin text-blue-600" />
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-700 mb-2">
                {scanProgress.status || 'מעבד...'}
              </p>
              
              {scanProgress.chat_name && (
                <p className="text-sm font-medium text-gray-900">
                  קבוצה נוכחית: {scanProgress.chat_name}
                </p>
              )}
              
              {scanProgress.current_index !== undefined && scanProgress.total && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>התקדמות</span>
                    <span>{scanProgress.current_index + 1}/{scanProgress.total}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${((scanProgress.current_index + 1) / scanProgress.total) * 100}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VisualScanInterface;
