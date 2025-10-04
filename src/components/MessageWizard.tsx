import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  MessageSquare,
  Users,
  CheckCircle,
  Save,
  Trash2,
  Edit,
  History
} from 'lucide-react';
import SharedGroupsList from './ui/SharedGroupsList';

interface MessageHistory {
  id: string;
  content: string;
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
  isAuthenticated: boolean;
  onBack: () => void;
}

const MessageWizard: React.FC<MessageWizardProps> = ({ accountId, accountLabel, isAuthenticated, onBack }) => {
  const [message, setMessage] = useState('');
  const [messageHistory, setMessageHistory] = useState<MessageHistory[]>([]);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [groupPresets, setGroupPresets] = useState<GroupPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [delay, setDelay] = useState(2);
  const [dryRun, setDryRun] = useState(true);
  const [availableChats, setAvailableChats] = useState<ChatInfo[]>([]);

  useEffect(() => {
    loadMessageHistory();
    loadGroupPresets();
  }, [accountId]);

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
    setAvailableChats(groups);
  };

  const addMessageToHistory = (content: string) => {
    const newMessage: MessageHistory = {
      id: Date.now().toString(),
      content,
      timestamp: Date.now()
    };
    const updatedHistory = [newMessage, ...messageHistory.slice(0, 9)];
    saveMessageHistory(updatedHistory);
  };

  const editMessage = (id: string, content: string) => {
    const updatedHistory = messageHistory.map((msg) =>
      msg.id === id ? { ...msg, content } : msg
    );
    saveMessageHistory(updatedHistory);
    setEditingMessage(null);
  };

  const deleteMessage = (id: string) => {
    const updatedHistory = messageHistory.filter((msg) => msg.id !== id);
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
    const updatedPresets = groupPresets.filter((preset) => preset.id !== id);
    saveGroupPresets(updatedPresets);
  };

  const sendMessages = async () => {
    if (!message.trim() || selectedChats.size === 0) return;

    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/send-batch-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          chat_ids: Array.from(selectedChats),
          delay_seconds: delay,
          dry_run: dryRun
        })
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

  return (
    <div className="flex h-full flex-col overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 p-6">
        <button
          onClick={onBack}
          className="flex items-center text-white/80 transition-colors hover:text-white"
        >
          <ArrowLeft className="mr-2 h-5 w-5" />
          חזור
        </button>
        <h1 className="flex items-center text-2xl font-bold text-white">
          <MessageSquare className="mr-3 h-6 w-6" />
          שליחת הודעות לקבוצות
        </h1>
        <div className="text-white/60">חשבון: {accountLabel}</div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto p-6">
          <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left Column - Message */}
            <div className="space-y-6">
              <div>
                <h2 className="mb-4 flex items-center text-xl font-bold text-white">
                  <MessageSquare className="mr-2 h-5 w-5" />
                  הודעה לשליחה
                </h2>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-white/10 p-4 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={6}
                  placeholder="הזן את ההודעה שברצונך לשלוח..."
                />
              </div>

              {/* Message History */}
              {messageHistory.length > 0 && (
                <div>
                  <h3 className="mb-4 flex items-center text-lg font-semibold text-white">
                    <History className="mr-2 h-5 w-5" />
                    היסטוריית הודעות
                  </h3>
                  <div className="max-h-40 space-y-2 overflow-y-auto">
                    {messageHistory.map((msg) => (
                      <div key={msg.id} className="flex items-center justify-between rounded-lg bg-white/5 p-3">
                        <div className="flex-1">
                          <div className="text-sm text-white">
                            {editingMessage === msg.id ? (
                              <input
                                type="text"
                                value={msg.content}
                                onChange={(e) => {
                                  const updated = messageHistory.map((m) =>
                                    m.id === msg.id ? { ...m, content: e.target.value } : m
                                  );
                                  setMessageHistory(updated);
                                }}
                                onBlur={() => editMessage(msg.id, msg.content)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    editMessage(msg.id, msg.content);
                                  }
                                }}
                                className="w-full border-b border-white/30 bg-transparent text-white focus:outline-none"
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
                          <div className="text-xs text-white/50">
                            {new Date(msg.timestamp).toLocaleString('he-IL')}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => setEditingMessage(editingMessage === msg.id ? null : msg.id)}
                            className="text-white/60 transition-colors hover:text-white"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => deleteMessage(msg.id)}
                            className="text-red-400 transition-colors hover:text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column - Groups */}
            <div className="flex h-full flex-col space-y-6 overflow-hidden">
              <div>
                <h2 className="mb-4 flex items-center text-xl font-bold text-white">
                  <Users className="mr-2 h-5 w-5" />
                  בחירת קבוצות
                </h2>

                {/* Group Presets */}
                {groupPresets.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-3 text-lg font-semibold text-white">הקבצות שמורות</h3>
                    <div className="grid grid-cols-1 gap-2">
                      {groupPresets.map((preset) => (
                        <div key={preset.id} className="flex items-center justify-between rounded-lg bg-white/5 p-2">
                          <div>
                            <div className="text-sm font-medium text-white">{preset.name}</div>
                            <div className="text-xs text-white/60">{preset.chatIds.length} קבוצות</div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => loadPreset(preset)}
                              className="text-blue-400 transition-colors hover:text-blue-300"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => deletePreset(preset.id)}
                              className="text-red-400 transition-colors hover:text-red-300"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Selection Controls */}
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setShowPresetModal(true)}
                      className="btn-secondary flex items-center px-3 py-2 text-sm"
                    >
                      <Save className="mr-1 h-4 w-4" />
                      שמור הקבצה
                    </button>
                  </div>
                  <div className="text-sm text-white/60">
                    נבחרו {selectedChats.size} מתוך {availableChats.length}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <SharedGroupsList
                  accountId={accountId}
                  isAuthenticated={isAuthenticated}
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
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-white/80">
                עיכוב בין שליחות (שניות)
              </label>
              <input
                type="number"
                value={delay}
                onChange={(e) => setDelay(Number(e.target.value))}
                className="w-full rounded-lg border border-white/20 bg-white/10 p-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="h-4 w-4 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="dryRun" className="text-sm text-white/80">
                מצב בדיקה (לא ישלח הודעות אמיתיות)
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/10 p-6">
        <div className="text-sm text-white/60">
          {selectedChats.size > 0 && `נבחרו ${selectedChats.size} קבוצות`}
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="btn-secondary flex items-center px-6 py-3"
          >
            <ArrowLeft className="mr-2 h-5 w-5" />
            ביטול
          </button>
          <button
            onClick={sendMessages}
            disabled={!message.trim() || selectedChats.size === 0}
            className="btn-primary flex items-center px-6 py-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageSquare className="mr-2 h-5 w-5" />
            {dryRun ? 'בדיקה' : 'שלח הודעות'}
          </button>
        </div>
      </div>

      {/* Preset Modal */}
      {showPresetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="glass-advanced mx-4 w-full max-w-md rounded-2xl p-6">
            <h3 className="mb-4 text-xl font-bold text-white">שמירת הקבצה</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-white/80">
                  שם ההקבצה
                </label>
                <input
                  type="text"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-white/10 p-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="הזן שם להקבצה..."
                />
              </div>
              <div className="text-sm text-white/60">
                יישמרו {selectedChats.size} קבוצות
              </div>
            </div>
            <div className="mt-6 flex space-x-3">
              <button
                onClick={() => setShowPresetModal(false)}
                className="flex-1 rounded-lg bg-white/10 px-4 py-2 text-white transition-colors hover:bg-white/20"
              >
                ביטול
              </button>
              <button
                onClick={savePreset}
                disabled={!newPresetName.trim() || selectedChats.size === 0}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageWizard;
