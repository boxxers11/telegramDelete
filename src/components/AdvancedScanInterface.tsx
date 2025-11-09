import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft,
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
  Check,
  Plus,
  RefreshCw
} from 'lucide-react';
import ScanningWindow from './ScanningWindow';

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

interface ScanningItem {
  id: number;
  name: string;
  status: 'scanning' | 'completed' | 'error' | 'skipped';
  messagesFound?: number;
  error?: string;
  reason?: string;
}

interface AdvancedScanInterfaceProps {
  accountId: string;
  accountLabel: string;
  onClose: () => void;
  onStartScan: (isFullScan: boolean, batchSize?: number) => void;
  onStopScan?: () => void;
  isScanning: boolean;
  scanProgress?: any;
  lastScanResults?: ChatInfo[];
  showScanningWindow?: boolean;
  scanningItems?: any[];
  currentScanningItem?: any;
  isPaused?: boolean;
  globalScanProgress?: any;
}

const AdvancedScanInterface: React.FC<AdvancedScanInterfaceProps> = ({
  accountId,
  accountLabel,
  onClose,
  onStartScan,
  onStopScan,
  isScanning,
  scanProgress,
  lastScanResults,
  showScanningWindow = false,
  scanningItems = [],
  currentScanningItem = null,
  isPaused = false,
  globalScanProgress = null
}) => {
  const [chats, setChats] = useState<ChatInfo[]>(lastScanResults || []);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [allChatsSelected, setAllChatsSelected] = useState(false);
  const [batchSize, setBatchSize] = useState(10);
  const [showMoreButton, setShowMoreButton] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    skipped: 0,
    errors: 0,
    totalMessages: 0,
    totalDeleted: 0
  });

  // Initialize from last scan results
  useEffect(() => {
    if (lastScanResults && lastScanResults.length > 0) {
      const processedChats = lastScanResults.map(chat => ({
        ...chat,
        expanded: false,
        selected: false,
        messages: chat.messages?.map(msg => ({ ...msg, selected: false })) || []
      }));
      setChats(processedChats);
      
      // Calculate stats
      const total = processedChats.length;
      const completed = processedChats.filter(c => c.status === 'completed').length;
      const skipped = processedChats.filter(c => c.status === 'skipped').length;
      const errors = processedChats.filter(c => c.status === 'error').length;
      const totalMessages = processedChats.reduce((sum, chat) => sum + (chat.messages_found || 0), 0);
      const totalDeleted = processedChats.reduce((sum, chat) => sum + (chat.messages_deleted || 0), 0);
      
      setStats({ total, completed, skipped, errors, totalMessages, totalDeleted });
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
      setSelectedChats(new Set());
      setChats(prev => prev.map(chat => ({ ...chat, selected: false })));
      setSelectedMessages(new Set());
      setAllChatsSelected(false);
    } else {
      setSelectedChats(new Set(chatsWithMessages.map(chat => chat.id)));
      setChats(prev => prev.map(chat => 
        chatsWithMessages.some(c => c.id === chat.id) 
          ? { ...chat, selected: true }
          : { ...chat, selected: false }
      ));
      
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
      const chatMessageIds = chat.messages.map(m => m.id);
      chatMessageIds.forEach(id => newSelectedMessages.delete(id));
    } else {
      newSelected.add(chatId);
      newChatSelected = true;
      const chatMessageIds = chat.messages.map(m => m.id);
      chatMessageIds.forEach(id => newSelectedMessages.add(id));
    }
    
    setSelectedChats(newSelected);
    setSelectedMessages(newSelectedMessages);
    
    setChats(prev => prev.map(c => 
      c.id === chatId ? { ...c, selected: newChatSelected } : c
    ));
    
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
      chatMessageIds.forEach(id => newSelectedMessages.delete(id));
    } else {
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
    
    // Calculate time range
    const now = new Date();
    const oldestMessage = chats
      .filter(chat => chat.messages)
      .flatMap(chat => chat.messages || [])
      .filter(msg => selectedMessages.has(msg.id))
      .map(msg => new Date(msg.date))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    
    const timeDiff = now.getTime() - (oldestMessage?.getTime() || now.getTime());
    const years = Math.floor(timeDiff / (1000 * 60 * 60 * 24 * 365));
    const months = Math.floor((timeDiff % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30));
    
    const timeRange = years > 0 
      ? `${years} שנה${years > 1 ? '' : ''} ו-${months} חודש${months > 1 ? 'ים' : ''}`
      : `${months} חודש${months > 1 ? 'ים' : ''}`;
    
    if (!confirm(`האם אתה בטוח שברצונך למחוק ${messageCount} הודעות מ-${chatCount} קבוצות מה (${timeRange})?`)) {
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

  const handleContinueScanning = () => {
    onStartScan(true, batchSize + 20);
    setBatchSize(prev => prev + 20);
  };


  const chatsWithMessages = chats.filter(chat => 
    chat.status === 'completed' && 
    chat.messages && 
    chat.messages.length > 0
  );
  const totalSelectedMessages = Array.from(selectedMessages).length;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Revolutionary Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}
        ></div>
      </div>
      
      {/* Floating Elements */}
      <div className="absolute top-20 left-10 w-20 h-20 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full opacity-20 animate-float"></div>
      <div className="absolute top-40 right-20 w-16 h-16 bg-gradient-to-r from-pink-500 to-red-500 rounded-full opacity-20 animate-float" style={{animationDelay: '1s'}}></div>
      <div className="absolute bottom-40 left-20 w-12 h-12 bg-gradient-to-r from-green-500 to-blue-500 rounded-full opacity-20 animate-float" style={{animationDelay: '2s'}}></div>
      
      <div className="max-w-7xl mx-auto p-4 relative z-10">
        {/* Revolutionary Header */}
        <div className="glass-elevated p-8 mb-8 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <button
                onClick={onClose}
                className="flex items-center px-6 py-3 text-white/70 hover:text-white mr-6 transition-colors hover-scale"
              >
                <ArrowLeft className="w-6 h-6 mr-2" />
                חזור למסך הראשי
              </button>
              <div className="glass-card p-4 mr-6 hover-glow">
                <BarChart3 className="w-10 h-10 text-accent" />
              </div>
              <div>
                <h1 className="text-headline text-white">סריקה מתקדמת</h1>
                <p className="text-body text-white/70">חשבון: {accountLabel}</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              {!isScanning ? (
                <>
                  <button
                    onClick={() => onStartScan(false, batchSize)}
                    className="btn-primary hover-float flex items-center"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    התחל סריקה
                  </button>
                  <button
                    onClick={() => onStartScan(true, 0)}
                    className="btn-destructive hover-float flex items-center"
                  >
                    <RotateCcw className="w-5 h-5 mr-2" />
                    סריקה מלאה
                  </button>
                </>
              ) : (
                <button
                  onClick={onStopScan}
                  disabled={!onStopScan}
                  className="btn-destructive hover-float flex items-center"
                >
                  <Square className="w-5 h-5 mr-2" />
                  עצור סריקה
                </button>
              )}
            </div>
          </div>

          {/* Revolutionary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-6 mt-8">
            <div className="glass-card p-6 text-center hover-lift">
              <div className="text-3xl font-bold text-accent mb-2">{stats.total}</div>
              <div className="text-caption text-white/70">סה"כ קבוצות</div>
            </div>
            <div className="glass-card p-6 text-center hover-lift">
              <div className="text-3xl font-bold text-green-400 mb-2">{stats.completed}</div>
              <div className="text-caption text-white/70">הושלמו</div>
            </div>
            <div className="glass-card p-6 text-center hover-lift">
              <div className="text-3xl font-bold text-yellow-400 mb-2">{stats.skipped}</div>
              <div className="text-caption text-white/70">דולגו</div>
            </div>
            <div className="glass-card p-6 text-center hover-lift">
              <div className="text-3xl font-bold text-red-400 mb-2">{stats.errors}</div>
              <div className="text-caption text-white/70">שגיאות</div>
            </div>
            <div className="glass-card p-6 text-center hover-lift">
              <div className="text-3xl font-bold text-purple-400 mb-2">{stats.totalMessages}</div>
              <div className="text-caption text-white/70">הודעות נמצאו</div>
            </div>
            <div className="glass-card p-6 text-center hover-lift">
              <div className="text-3xl font-bold text-orange-400 mb-2">{stats.totalDeleted}</div>
              <div className="text-caption text-white/70">הודעות נמחקו</div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {chatsWithMessages.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleSelectAllChats}
                  className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-all duration-200 transform hover:scale-105"
                >
                  {allChatsSelected ? (
                    <CheckSquare className="w-4 h-4 mr-2" />
                  ) : (
                    <SquareIcon className="w-4 h-4 mr-2" />
                  )}
                  {allChatsSelected ? 'הסר בחירה' : 'בחר הכל'} ({selectedChats.size}/{chatsWithMessages.length})
                </button>
                
                <span className="text-sm text-gray-600">
                  נבחרו {totalSelectedMessages} הודעות
                </span>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedMessages.size === 0 || isDeleting}
                  className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {isDeleting ? 'מוחק...' : `מחק הודעות נבחרות (${totalSelectedMessages})`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Continue Scanning Button */}
        {!isScanning && chatsWithMessages.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">המשך סריקה</h3>
                <p className="text-sm text-gray-600">סרוק עוד 20 קבוצות כדי למצוא הודעות נוספות</p>
              </div>
              <button
                onClick={handleContinueScanning}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 transform hover:scale-105"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                המשך לסרוק עוד 20
              </button>
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
                  <div key={chat.id} className="p-4 transition-all duration-200 hover:bg-gray-50">
                    {/* Chat Header */}
                    <div 
                      className={`transition-all duration-300 ${
                        chat.status === 'completed' 
                          ? 'bg-green-50 border-l-4 border-green-500' 
                          : chat.status === 'skipped' 
                          ? 'bg-yellow-50 border-l-4 border-yellow-500'
                          : chat.status === 'error'
                          ? 'bg-red-50 border-l-4 border-red-500'
                          : 'hover:bg-gray-50'
                      } p-3 rounded-lg`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center flex-1">
                          {chat.status === 'completed' && chat.messages && chat.messages.length > 0 && (
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
                            className="flex items-center mr-3 hover:bg-gray-100 p-1 rounded transition-colors"
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
                          <div key={message.id} className="bg-gray-50 p-3 rounded-lg border-r-2 border-blue-200 transition-all duration-200 hover:bg-gray-100">
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
      </div>

      {/* Scanning Window */}
      <ScanningWindow
        isVisible={showScanningWindow}
        scanningItems={scanningItems}
        isPaused={isPaused}
        scanProgress={globalScanProgress}
        onClose={() => {}} // No close button - only stop scan can close it
      />
    </div>
  );
};

export default AdvancedScanInterface;
