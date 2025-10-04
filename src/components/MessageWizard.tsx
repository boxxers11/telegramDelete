import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft,
  ArrowRight,
  MessageSquare,
  Users,
  CheckCircle,
  Clock,
  Save,
  Trash2,
  X,
  Edit,
  Copy,
  Plus,
  History
} from 'lucide-react';
import SharedGroupsList from './SharedGroupsList';

interface MessageHistory {
  id: string;
  content: string;מהיום
  timestamp: number;
}

interface GroupPreset {
  id: string;
  name: string;
  chatIds: number[];
  timestamp: number;
}

interface ChatInfo {
  id: number;
  title: string;
  lastMessageTime?: number;
  member_count: number;
  type?: string;
  lastMessageContent?: string;
}

interface MessageWizardProps {
  accountId: string;
  accountLabel: string;
  onBack: () => void;
}

const MessageWizard: React.FC<MessageWizardProps> = ({ accountId, accountLabel, onBack }) => {
  const [message, setMessage] = useState('');
  const [messageHistory, setMessageHistory] = useState<MessageHistory[]>([]);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const [allChats, setAllChats] = useState<ChatInfo[]>([]);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [groupPresets, setGroupPresets] = useState<GroupPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [delay, setDelay] = useState(2);
  const [dryRun, setDryRun] = useState(true);
  const [showChatSelection, setShowChatSelection] = useState(false);

  // Load data on mount
  useEffect(() => {
    loadMessageHistory();
    loadGroupPresets();
  }, [accountId]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onBack();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onBack]);

  const loadMessageHistory = () => {
    const saved = localStorage.getItem(`message_history_${accountId}`);
    if (saved) {
      setMessageHistory(JSON.parse(saved));
    }
  };

  const saveMessageHistory = (history: MessageHistory[]) => {
    localStorage.setItem(`message_history_${accountId}`, JSON.stringify(history));
    setMessageHistory(history);
  };

  const loadGroupPresets = () => {
    const saved = localStorage.getItem(`group_presets_${accountId}`);
    if (saved) {
      setGroupPresets(JSON.parse(saved));
    }
  };

  const saveGroupPresets = (presets: GroupPreset[]) => {
    localStorage.setItem(`group_presets_${accountId}`, JSON.stringify(presets));
    setGroupPresets(presets);
  };

  const handleGroupsLoaded = (groups: ChatInfo[]) => {
    setAllChats(groups);
  };

  const addMessageToHistory = (content: string) => {
    const newMessage: MessageHistory = {
      id: Date.now().toString(),
      content,
      timestamp: Date.now()
    };
    const updatedHistory = [newMessage, ...messageHistory.slice(0, 9)]; // Keep last 10
    saveMessageHistory(updatedHistory);
  };

  const editMessage = (id: string, content: string) => {
    const updatedHistory = messageHistory.map(msg => 
      msg.id === id ? { ...msg, content } : msg
    );
    saveMessageHistory(updatedHistory);
    setEditingMessage(null);
  };

  const deleteMessage = (id: string) => {
    const updatedHistory = messageHistory.filter(msg => msg.id !== id);
    saveMessageHistory(updatedHistory);
  };


  const savePreset = () => {
    if (!newPresetName.trim() || selectedChats.size === 0) return;
    
    const newPreset: GroupPreset = {
      id: Date.now().toString(),
      name: newPresetName,
      chatIds: Array.from(selectedChats),
      timestamp: Date.now()
    };
    
    const updatedPresets = [...groupPresets, newPreset];
    saveGroupPresets(updatedPresets);
    setNewPresetName('');
    setShowPresetModal(false);
  };

  const loadPreset = (preset: GroupPreset) => {
    setSelectedChats(new Set(preset.chatIds));
  };

  const deletePreset = (id: string) => {
    const updatedPresets = groupPresets.filter(preset => preset.id !== id);
    saveGroupPresets(updatedPresets);
  };

  const sendMessages = async () => {
    if (!message.trim() || selectedChats.size === 0) return;

    try {
      console.log(`Sending message to account: ${accountId}`);
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/send-batch-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          chat_ids: Array.from(selectedChats),
          delay_seconds: delay,
          dry_run: dryRun
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          addMessageToHistory(message);
          alert(`הודעה נשלחה ל-${data.sent_count} קבוצות בהצלחה!`);
          onBack();
        } else {
          alert(`שגיאה: ${data.error}`);
        }
      }
    } catch (error) {
      console.error('Error sending messages:', error);
      alert('שגיאה בשליחת הודעות');
    }
  };

  const formatLastMessageTime = (timestamp?: number) => {
    if (!timestamp) return 'לא ידוע';
    
    const now = Date.now();
    const diff = now - timestamp;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    if (hours < 1) {
      return <span className="text-red-500">פחות משעה</span>;
    } else if (hours < 24) {
      return `${hours} שעות`;
    } else {
      const days = Math.floor(hours / 24);
      return `${days} ימים`;
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" 
      dir="rtl"
      onClick={onBack}
    >
      {/* Close button outside modal */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onBack();
        }}
        className="absolute top-4 right-4 z-60 bg-red-600 hover:bg-red-700 text-white rounded-full p-2 transition-colors"
        title="סגור חלון"
      >
        <X className="w-5 h-5" />
      </button>
      
      <div 
        className="glass-advanced max-w-6xl w-full h-[90vh] min-h-[600px] overflow-y-auto rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <button
            onClick={onBack}
            className="flex items-center text-white/80 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            חזור
          </button>
          <h1 className="text-2xl font-bold text-white flex items-center">
            <MessageSquare className="w-6 h-6 mr-3" />
            שליחת הודעות לקבוצות
          </h1>
          <div className="text-white/60">חשבון: {accountLabel}</div>
        </div>

        {/* Main Content */}
        <div className="p-6 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column - Message */}
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white mb-4 flex items-center">
                  <MessageSquare className="w-5 h-5 mr-2" />
                  הודעה לשליחה
                </h2>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full p-4 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={6}
                  placeholder="הזן את ההודעה שברצונך לשלוח..."
                />
              </div>

              {/* Message History */}
              {messageHistory.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                    <History className="w-5 h-5 mr-2" />
                    היסטוריית הודעות
                  </h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {messageHistory.map((msg) => (
                      <div key={msg.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                        <div className="flex-1">
                          <div className="text-white text-sm">
                            {editingMessage === msg.id ? (
                              <input
                                type="text"
                                value={msg.content}
                                onChange={(e) => {
                                  const updated = messageHistory.map(m => 
                                    m.id === msg.id ? { ...m, content: e.target.value } : m
                                  );
                                  setMessageHistory(updated);
                                }}
                                onBlur={() => editMessage(msg.id, msg.content)}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    editMessage(msg.id, msg.content);
                                  }
                                }}
                                className="w-full bg-transparent border-b border-white/30 text-white"
                                autoFocus
                              />
                            ) : (
                              <span 
                                className="cursor-pointer hover:text-blue-300"
                                onClick={() => setMessage(msg.content)}
                              >
                                {msg.content}
                              </span>
                            )}
                          </div>
                          <div className="text-white/50 text-xs">
                            {new Date(msg.timestamp).toLocaleString('he-IL')}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => setEditingMessage(editingMessage === msg.id ? null : msg.id)}
                            className="text-white/60 hover:text-white"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteMessage(msg.id)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column - Groups */}
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white mb-4 flex items-center">
                  <Users className="w-5 h-5 mr-2" />
                  בחירת קבוצות
                </h2>
                
                {/* Group Presets */}
                {groupPresets.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-white mb-3">הקבצות שמורות</h3>
                    <div className="grid grid-cols-1 gap-2">
                      {groupPresets.map((preset) => (
                        <div key={preset.id} className="flex items-center justify-between p-2 bg-white/5 rounded-lg">
                          <div>
                            <div className="text-white font-medium text-sm">{preset.name}</div>
                            <div className="text-white/60 text-xs">{preset.chatIds.length} קבוצות</div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => loadPreset(preset)}
                              className="text-blue-400 hover:text-blue-300"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deletePreset(preset.id)}
                              className="text-red-400 hover:text-red-300"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Selection Controls */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setShowPresetModal(true)}
                      className="btn-secondary flex items-center px-3 py-2 text-sm"
                    >
                      <Save className="w-4 h-4 mr-1" />
                      שמור הקבצה
                    </button>
                  </div>
                  <div className="text-white/60 text-sm">
                    נבחרו {selectedChats.size} קבוצות
                  </div>
                </div>

                {/* Groups List */}
                <SharedGroupsList
                  accountId={accountId}
                  onGroupsLoaded={handleGroupsLoaded}
                  showSelection={true}
                  selectedChats={selectedChats}
                  onSelectionChange={setSelectedChats}
                  showLastMessageTime={true}
                />
              </div>
            </div>
          </div>

          {/* Settings Row */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                עיכוב בין שליחות (שניות)
              </label>
              <input
                type="number"
                value={delay}
                onChange={(e) => setDelay(Number(e.target.value))}
                className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1"
                max="60"
              />
            </div>
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="dryRun"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-white/10 border-white/20 rounded focus:ring-blue-500"
              />
              <label htmlFor="dryRun" className="text-sm text-white/80">
                מצב בדיקה (לא ישלח הודעות אמיתיות)
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-white/10">
          <div className="text-white/60 text-sm">
            {selectedChats.size > 0 && `נבחרו ${selectedChats.size} קבוצות`}
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={onBack}
              className="btn-secondary flex items-center px-6 py-3"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              ביטול
            </button>
            <button
              onClick={sendMessages}
              disabled={!message.trim() || selectedChats.size === 0}
              className="btn-primary flex items-center px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MessageSquare className="w-5 h-5 mr-2" />
              {dryRun ? 'בדיקה' : 'שלח הודעות'}
            </button>
          </div>
        </div>

        {/* Preset Modal */}
        {showPresetModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="glass-advanced p-6 rounded-2xl max-w-md w-full mx-4">
              <h3 className="text-xl font-bold text-white mb-4">שמירת הקבצה</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    שם ההקבצה
                  </label>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="הזן שם להקבצה..."
                  />
                </div>
                <div className="text-sm text-white/60">
                  יישמרו {selectedChats.size} קבוצות
                </div>
              </div>
              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setShowPresetModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  ביטול
                </button>
                <button
                  onClick={savePreset}
                  disabled={!newPresetName.trim() || selectedChats.size === 0}
                  className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  שמור
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageWizard;
