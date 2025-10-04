import React, { useState, useEffect } from 'react';
import { Users, CheckCircle, XCircle, Loader } from 'lucide-react';

interface ChatInfo {
  id: number;
  title: string;
  member_count: number;
  type?: string;
  status?: string;
  messages_found?: number;
  messages_deleted?: number;
  progress_percent?: number;
  has_unscanned_dates?: boolean;
  selected?: boolean;
  messages?: any[];
  lastMessageTime?: number;
  lastMessageContent?: string;
  lastSendTime?: number;
}

interface SharedGroupsListProps {
  accountId: string;
  onGroupsLoaded?: (groups: ChatInfo[]) => void;
  showSelection?: boolean;
  selectedChats?: Set<number>;
  onSelectionChange?: (selected: Set<number>) => void;
  showLastMessageTime?: boolean;
}

const SharedGroupsList: React.FC<SharedGroupsListProps> = ({
  accountId,
  onGroupsLoaded,
  showSelection = false,
  selectedChats = new Set(),
  onSelectionChange,
  showLastMessageTime = false
}) => {
  const [allChats, setAllChats] = useState<ChatInfo[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Check if all chats are selected
  const allSelected = allChats.length > 0 && selectedChats.size === allChats.length;

  const loadAllChats = async () => {
    setLoadingChats(true);
    setError(null);
    try {
      console.log(`Loading chats for account: ${accountId}`);
      
      // First, get quick summary
      const summaryResponse = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/chats/summary`);
      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        console.log(`Found ${summaryData.total} groups, loading details...`);
        setChats([]); // Clear existing chats
        setTotalGroups(summaryData.total);
      }
      
      // Then load full details
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/chats`);
      console.log(`Fetching chats for account: ${accountId}`);
      if (response.ok) {
        const data = await response.json();
        console.log('Loaded chats:', data);
        const chats = (data.chats || []).map((chat: any) => ({
          ...chat,
          status: 'pending',
          messages_found: 0,
          messages_deleted: 0,
          progress_percent: 0,
          has_unscanned_dates: false,
          selected: false,
          messages: []
        }));
        setAllChats(chats);
        // Save groups to localStorage for persistence
        localStorage.setItem(`groups_${accountId}`, JSON.stringify(chats));
        onGroupsLoaded?.(chats);
      } else {
        console.error('Failed to load chats:', response.status, response.statusText);
        // Try to load from localStorage as fallback
        const savedGroups = localStorage.getItem(`groups_${accountId}`);
        if (savedGroups) {
          try {
            const groups = JSON.parse(savedGroups);
            setAllChats(groups);
            onGroupsLoaded?.(groups);
            console.log('Loaded groups from localStorage as fallback:', groups.length);
            return;
          } catch (error) {
            console.error('Error loading saved groups:', error);
          }
        }
        setError('שגיאה בטעינת רשימת קבוצות');
      }
    } catch (error) {
      console.error('Error loading chats:', error);
      // Try to load from localStorage as fallback
      const savedGroups = localStorage.getItem(`groups_${accountId}`);
      if (savedGroups) {
        try {
          const groups = JSON.parse(savedGroups);
          setAllChats(groups);
          onGroupsLoaded?.(groups);
          console.log('Loaded groups from localStorage as fallback:', groups.length);
          return;
        } catch (error) {
          console.error('Error loading saved groups:', error);
        }
      }
      setError('שגיאה בטעינת רשימת קבוצות');
    } finally {
      setLoadingChats(false);
    }
  };

  // Load chats on mount
  useEffect(() => {
    // Always load from server first, then fallback to localStorage
    loadAllChats();
  }, [accountId]);

  const formatLastMessageTime = (timestamp?: number) => {
    if (!timestamp) return 'לא ידוע';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return 'פחות משעה';
    if (diffHours < 24) return `${diffHours} שעות`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} ימים`;
    return date.toLocaleDateString('he-IL');
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

  const selectAllChats = () => {
    if (!onSelectionChange) return;
    const allIds = new Set(allChats.map(chat => chat.id));
    onSelectionChange(allIds);
  };

  const deselectAllChats = () => {
    if (!onSelectionChange) return;
    onSelectionChange(new Set());
  };

  if (loadingChats) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
          <div className="text-white/80 mt-4">טוען רשימת קבוצות...</div>
          <div className="text-white/60 text-sm mt-2">אנא המתן בזמן שאנו טוענים את הקבוצות שלך</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-red-400 mb-4">{error}</div>
          <button 
            onClick={loadAllChats}
            className="btn-secondary px-4 py-2"
          >
            נסה שוב
          </button>
        </div>
      </div>
    );
  }

  if (allChats.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-white/60">לא נמצאו קבוצות</div>
          <button 
            onClick={loadAllChats}
            className="btn-secondary mt-4 px-4 py-2"
          >
            נסה שוב
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-white/80 text-sm">
          {allChats.length} קבוצות זמינות
        </div>
        <button 
          onClick={loadAllChats}
          className="btn-secondary flex items-center px-3 py-2 text-sm"
        >
          <Users className="w-4 h-4 mr-1" /> רענן קבוצות
        </button>
      </div>
      
      {showSelection && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <button 
              onClick={allSelected ? deselectAllChats : selectAllChats} 
              className={`w-6 h-6 rounded flex items-center justify-center transition-all duration-200 ${
                allSelected 
                  ? 'bg-blue-500 border-2 border-blue-500' 
                  : 'border-2 border-white/30 hover:border-white/60'
              }`}
              title={allSelected ? "בטל בחירת הכל" : "בחר הכל"}
            >
              {allSelected && <CheckCircle className="w-4 h-4 text-white" />}
            </button>
            <span className="text-white/60 text-sm">
              {allSelected ? "כל הקבוצות נבחרו" : `${selectedChats.size} קבוצות נבחרו`}
            </span>
          </div>
        </div>
      )}
      
        <div className="h-[600px] overflow-y-auto space-y-2">
        {allChats.map((chat) => (
          <div key={chat.id} className="flex items-center justify-between p-2 bg-white/5 rounded-lg">
            <div className="flex items-center space-x-2">
              {showSelection && (
                <input
                  type="checkbox"
                  checked={selectedChats.has(chat.id)}
                  onChange={(e) => handleChatSelection(chat.id, e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-white/10 border-white/20 rounded focus:ring-blue-500"
                />
              )}
              <div>
                <div className="text-white font-medium text-sm">{chat.title}</div>
                <div className="text-white/60 text-xs">
                  {chat.member_count} חברים
                  {showLastMessageTime && (
                    <>
                      {' • '}
                      <span className="mr-1">זמן שליחה אחרונה:</span>
                      {formatLastMessageTime(chat.lastSendTime || chat.lastMessageTime)}
                    </>
                  )}
                  {chat.lastMessageContent && (
                    <div className="text-white/40 text-xs mt-1 truncate">
                      {chat.lastMessageContent}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {chat.status === 'scanning' && (
              <Loader className="w-4 h-4 text-yellow-400 animate-spin" />
            )}
            {chat.status === 'completed' && (
              <CheckCircle className="w-4 h-4 text-green-400" />
            )}
            {chat.status === 'error' && (
              <XCircle className="w-4 h-4 text-red-400" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SharedGroupsList;
