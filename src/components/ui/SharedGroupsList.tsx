import React, { useState, useEffect, useMemo } from 'react';
import { Users, CheckCircle, XCircle, Loader, RefreshCw } from 'lucide-react';

interface ChatInfo {
  id: number;
  title: string;
  member_count: number;
  type?: string;
  lastMessageTime?: number;
  lastMessageContent?: string;
}

interface SharedGroupsListProps {
  accountId: string;
  isAuthenticated: boolean; // Prop to check connection status
  onGroupsLoaded?: (groups: ChatInfo[]) => void;
  showSelection?: boolean;
  selectedChats?: Set<number>;
  onSelectionChange?: (selected: Set<number>) => void;
  showLastMessageTime?: boolean;
}

const SharedGroupsList: React.FC<SharedGroupsListProps> = ({
  accountId,
  isAuthenticated,
  onGroupsLoaded,
  showSelection = false,
  selectedChats = new Set(),
  onSelectionChange,
  showLastMessageTime = false
}) => {
  const [allChats, setAllChats] = useState<ChatInfo[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  const loadAllChats = async () => {
    // **THE FIX**: Don't fetch if the account is not connected
    if (!isAuthenticated) {
      setError("Account is not connected. Please connect the account first.");
      setLoadingChats(false);
      return;
    }
    setLoadingChats(true);
    setError(null);
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/chats`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const chats = data.chats || [];
          setAllChats(chats);
          localStorage.setItem(`groups_${accountId}`, JSON.stringify(chats));
          onGroupsLoaded?.(chats);
        } else {
           throw new Error(data.error || 'Failed to load chats');
        }
      } else {
        throw new Error(`Failed to load chats: ${response.statusText}`);
      }
    } catch (err) {
      const error = err as Error;
      console.error('Error loading chats:', error);
      const savedGroups = localStorage.getItem(`groups_${accountId}`);
      if (savedGroups) {
        try {
          const groups = JSON.parse(savedGroups);
          setAllChats(groups);
          onGroupsLoaded?.(groups);
          setError("Couldn't refresh list, showing saved data.");
        } catch {
          setError('שגיאה בטעינת רשימת קבוצות.');
        }
      } else {
        setError('שגיאה בטעינת רשימת קבוצות.');
      }
    } finally {
      setLoadingChats(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadAllChats();
    } else {
      const savedGroups = localStorage.getItem(`groups_${accountId}`);
      if (savedGroups) {
          try {
              const groups = JSON.parse(savedGroups);
              setAllChats(groups);
              onGroupsLoaded?.(groups);
          } catch {}
      }
      setLoadingChats(false);
    }
  }, [accountId, isAuthenticated]);

  const filteredChats = useMemo(() => {
    if (!filterText) return allChats;
    return allChats.filter(chat =>
      chat.title.toLowerCase().includes(filterText.toLowerCase())
    );
  }, [allChats, filterText]);

  const formatLastMessageTime = (timestamp?: number) => {
    if (!timestamp) return 'לא ידוע';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return <span className="text-green-400">פחות משעה</span>;
    if (diffHours < 24) return `${diffHours} שעות`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} ימים`;
  };

  const handleChatSelection = (chatId: number, checked: boolean) => {
    if (!onSelectionChange) return;
    const newSelected = new Set(selectedChats);
    if (checked) {
      newSelected.add(chatId);
    } else {
      newSelected.delete(chatId);
    }
    onSelectionChange(newSelected);
  };
  
  const allVisibleSelected = filteredChats.length > 0 && filteredChats.every(chat => selectedChats.has(chat.id));

  const handleSelectAllVisible = () => {
    if (!onSelectionChange) return;
    const newSelected = new Set(selectedChats);
    if (allVisibleSelected) {
        filteredChats.forEach(chat => newSelected.delete(chat.id));
    } else {
        filteredChats.forEach(chat => newSelected.add(chat.id));
    }
    onSelectionChange(newSelected);
  };


  if (loadingChats && allChats.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader className="w-8 h-8 text-blue-400 animate-spin mx-auto" />
          <div className="text-white/80 mt-4">טוען רשימת קבוצות...</div>
        </div>
      </div>
    );
  }
  
  if (error && allChats.length === 0) {
    return (
        <div className="text-center py-10 text-red-400">
            <p>{error}</p>
            <button onClick={loadAllChats} className="btn-secondary mt-4" disabled={!isAuthenticated}>נסה שוב</button>
        </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
         <input
          type="text"
          placeholder="חפש קבוצה..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full p-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/50"
        />
        <button 
          onClick={loadAllChats}
          className="btn-secondary p-2 ml-2"
          disabled={!isAuthenticated || loadingChats}
          title="רענן רשימה"
        >
          <RefreshCw className={`w-4 h-4 ${loadingChats ? 'animate-spin' : ''}`} />
        </button>
      </div>
      
      {showSelection && (
        <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <button 
              onClick={handleSelectAllVisible} 
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              {allVisibleSelected ? "בטל בחירת הנראות" : "בחר את כל הנראות"}
            </button>
          </div>
           <span className="text-white/60 text-sm">
              {selectedChats.size} / {allChats.length} נבחרו
            </span>
        </div>
      )}
      
      {/* **THE CSS FIX**: This div will now scroll correctly within the modal */}
      <div className="flex-grow overflow-y-auto space-y-2 pr-2">
        {filteredChats.map((chat) => (
          <div key={chat.id} className="flex items-center justify-between p-2 bg-white/10 rounded-lg">
            <div className="flex items-center space-x-2 overflow-hidden">
              {showSelection && (
                <input
                  type="checkbox"
                  checked={selectedChats.has(chat.id)}
                  onChange={(e) => handleChatSelection(chat.id, e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded"
                />
              )}
              <div className="overflow-hidden">
                <div className="text-white font-medium text-sm truncate">{chat.title}</div>
                <div className="text-white/60 text-xs">
                  {chat.member_count.toLocaleString()} חברים
                  {showLastMessageTime && ` • ${formatLastMessageTime(chat.lastMessageTime)}`}
                </div>
              </div>
            </div>
          </div>
        ))}
         {filteredChats.length === 0 && !loadingChats && (
            <div className="text-center py-10 text-white/50">
                לא נמצאו קבוצות התואמות לחיפוש.
            </div>
        )}
      </div>
    </div>
  );
};

export default SharedGroupsList;
