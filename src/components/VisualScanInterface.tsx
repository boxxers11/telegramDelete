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
  Minus,
  RotateCcw,
  Eye,
  AlertTriangle as Warning
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
}

interface VisualScanInterfaceProps {
  accountId: string;
  accountLabel: string;
  onClose: () => void;
  onStartScan: () => void;
  onStopScan: () => void;
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
  isScanning,
  scanProgress,
  lastScanResults
}) => {
  const [chats, setChats] = useState<ChatInfo[]>(lastScanResults || []);
  const [currentScanningId, setCurrentScanningId] = useState<number | null>(null);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [showFullScanWarning, setShowFullScanWarning] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    skipped: 0,
    errors: 0,
    totalMessages: 0,
    totalDeleted: 0
  });

  // Update chats based on scan progress
  useEffect(() => {
    if (!scanProgress) return;

    switch (scanProgress.type) {
      case 'chat_list':
        if (scanProgress.chats) {
          setChats(scanProgress.chats.map(chat => ({ ...chat, expanded: false })));
          setStats(prev => ({ ...prev, total: scanProgress.chats!.length }));
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
                  messages: scanProgress.messages || chat.messages,
                  error: scanProgress.error,
                  reason: scanProgress.reason
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
        }
        break;
    }
  }, [scanProgress]);

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
    const completedChats = chats.filter(chat => chat.status === 'completed');
    if (selectedChats.size === completedChats.length) {
      setSelectedChats(new Set());
    } else {
      setSelectedChats(new Set(completedChats.map(chat => chat.id)));
    }
  };

  const handleSelectChat = (chatId: number) => {
    const newSelected = new Set(selectedChats);
    if (newSelected.has(chatId)) {
      newSelected.delete(chatId);
    } else {
      newSelected.add(chatId);
    }
    setSelectedChats(newSelected);
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

  const handleDeleteSelected = () => {
    if (selectedMessages.size === 0 && selectedChats.size === 0) return;
    
    const messageCount = selectedMessages.size;
    const chatCount = selectedChats.size;
    
    if (confirm(`האם אתה בטוח שברצונך למחוק ${messageCount} הודעות נבחרות מ-${chatCount} קבוצות?`)) {
      // TODO: Implement delete logic
      console.log('Deleting selected messages:', Array.from(selectedMessages));
      console.log('From selected chats:', Array.from(selectedChats));
    }
  };

  const handleDeleteAll = () => {
    const totalMessages = chats.reduce((sum, chat) => sum + (chat.messages_found || 0), 0);
    
    if (confirm(`⚠️ אזהרה! פעולה זו תמחק את כל ${totalMessages} ההודעות שנסרקו מכל הקבוצות. האם אתה בטוח?`)) {
      // TODO: Implement delete all logic
      console.log('Deleting all scanned messages');
    }
  };

  const handleFullScan = () => {
    if (confirm('⚠️ סריקה מלאה תסרוק את כל הקבוצות עד 5 שנים אחורה. זה עלול לקחת זמן רב. האם להמשיך?')) {
      // TODO: Implement full scan
      console.log('Starting full scan');
      onStartScan();
    }
  };

  const completedChats = chats.filter(chat => chat.status === 'completed');
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
              {lastScanResults && lastScanResults.length > 0 && (
                <button
                  onClick={() => setChats(lastScanResults)}
                  className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  תוצאות אחרונות
                </button>
              )}
              
              <button
                onClick={handleFullScan}
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
                  className="flex items-center px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Square className="w-4 h-4 mr-2" />
                  עצור סריקה
                </button>
              )}
            </div>
          </div>

          {/* Full Scan Warning */}
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="flex items-start">
              <Warning className="w-4 h-4 text-orange-500 mr-2 mt-0.5" />
              <div className="text-sm text-orange-800">
                <strong>סריקה מלאה:</strong> סורקת את כל הקבוצות עד 5 שנים אחורה או מאז ההצטרפות. 
                עלולה לקחת זמן רב ולמצוא אלפי הודעות.
              </div>
            </div>
          </div>

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
        {completedChats.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleSelectAllChats}
                  className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {selectedChats.size === completedChats.length ? (
                    <CheckSquare className="w-4 h-4 mr-2" />
                  ) : (
                    <Minus className="w-4 h-4 mr-2" />
                  )}
                  בחר הכל ({selectedChats.size}/{completedChats.length})
                </button>
                
                <span className="text-sm text-gray-600">
                  נבחרו {totalSelectedMessages} הודעות
                </span>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedMessages.size === 0}
                  className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  מחק הודעות נבחרות ({totalSelectedMessages})
                </button>
                
                <button
                  onClick={handleDeleteAll}
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
                <h3 className="text-lg font-medium text-gray-900 mb-2">טוען רשימת קבוצות...</h3>
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
                          {chat.status === 'completed' && (
                            <input
                              type="checkbox"
                              checked={selectedChats.has(chat.id)}
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
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
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