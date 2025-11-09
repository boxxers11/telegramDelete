import React, { useEffect, useState, useMemo } from 'react';
import { X, Search, MessageCircle, Loader, UserX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface BlockedContact {
  user_id: number;
  username?: string;
  first_name: string;
  last_name: string;
  phone?: string;
  display_name: string;
  blocked_date?: string;
  is_bot: boolean;
}

interface SearchResult {
  type: 'username' | 'name' | 'message';
  contact: BlockedContact;
  message_preview?: string;
  message_date?: string;
}

interface BlockedContactsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
}

const BlockedContactsDialog: React.FC<BlockedContactsDialogProps> = ({
  isOpen,
  onClose,
  accountId
}) => {
  const navigate = useNavigate();
  const [blockedContacts, setBlockedContacts] = useState<BlockedContact[]>([]);
  const [totalBlocked, setTotalBlocked] = useState<number>(0);
  const [loadedCount, setLoadedCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && accountId) {
      loadBlockedContacts();
    } else {
      setBlockedContacts([]);
      setTotalBlocked(0);
      setLoadedCount(0);
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [isOpen, accountId]);

  const loadBlockedContacts = async () => {
    setLoading(true);
    setSearchError(null);
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/blocked-contacts`);
      const data = await response.json();
      if (data.success) {
        setBlockedContacts(data.blocked_contacts || []);
        setTotalBlocked(data.total || 0);
        setLoadedCount(data.loaded || 0);
      } else {
        setSearchError(data.error || 'Failed to load blocked contacts');
      }
    } catch (error) {
      console.error('Error loading blocked contacts:', error);
      setSearchError('Failed to load blocked contacts');
    } finally {
      setLoading(false);
    }
  };

  const searchInMessages = async (userId: number, query: string): Promise<SearchResult[]> => {
    try {
      const response = await fetch(
        `http://127.0.0.1:8001/accounts/${accountId}/user-history?chat_id=${userId}&limit=100`
      );
      const data = await response.json();
      if (data.success && data.messages) {
        const matchingMessages = data.messages.filter((msg: any) =>
          msg.text?.toLowerCase().includes(query.toLowerCase())
        );
        const contact = blockedContacts.find(c => c.user_id === userId);
        if (!contact) return [];
        
        return matchingMessages.slice(0, 5).map((msg: any) => ({
          type: 'message' as const,
          contact,
          message_preview: msg.text?.substring(0, 100),
          message_date: msg.date
        }));
      }
    } catch (error) {
      console.error('Error searching messages:', error);
    }
    return [];
  };

  const performSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setSearchError(null);
    const query = searchQuery.trim().toLowerCase();
    const results: SearchResult[] = [];

    try {
      // 1. Search by username first
      const usernameMatches = blockedContacts.filter(contact =>
        contact.username?.toLowerCase().includes(query)
      );
      usernameMatches.forEach(contact => {
        results.push({
          type: 'username',
          contact
        });
      });

      // 2. Search by name
      const nameMatches = blockedContacts.filter(contact =>
        !usernameMatches.includes(contact) &&
        (contact.first_name?.toLowerCase().includes(query) ||
         contact.last_name?.toLowerCase().includes(query) ||
         contact.display_name?.toLowerCase().includes(query))
      );
      nameMatches.forEach(contact => {
        results.push({
          type: 'name',
          contact
        });
      });

      // 3. Search in messages (for contacts not already found)
      const remainingContacts = blockedContacts.filter(
        contact => !usernameMatches.includes(contact) && !nameMatches.includes(contact)
      );
      
      for (const contact of remainingContacts.slice(0, 10)) { // Limit to 10 to avoid too many requests
        const messageResults = await searchInMessages(contact.user_id, query);
        results.push(...messageResults);
      }

      setSearchResults(results);
    } catch (error) {
      setSearchError('שגיאה בחיפוש');
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim()) {
        performSearch();
      } else {
        setSearchResults([]);
      }
    }, 500); // Debounce search

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const handleOpenChat = (userId: number) => {
    navigate(`/dm/${accountId}/${userId}`);
    onClose();
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'לא זמין';
    try {
      return new Date(dateString).toLocaleString('he-IL');
    } catch {
      return dateString;
    }
  };

  const displayContacts = searchQuery.trim() ? searchResults.map(r => r.contact) : blockedContacts;
  const uniqueDisplayContacts = Array.from(
    new Map(displayContacts.map(c => [c.user_id, c])).values()
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" dir="rtl">
      <div className="relative w-full max-w-6xl max-h-[90vh] bg-slate-900 rounded-xl border border-white/20 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <UserX className="h-6 w-6 text-red-400" />
            <h2 className="text-2xl font-bold text-white">אנשי קשר חסומים</h2>
            {totalBlocked > 0 && (
              <span className="text-sm text-white/60">
                ({loadedCount} מתוך {totalBlocked} חסומים)
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-white/70" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-6 border-b border-white/10">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="חיפוש לפי כינוי, שם או הודעות..."
              className="w-full pr-10 pl-4 py-3 rounded-xl border border-white/20 bg-black/40 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searching && (
              <Loader className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/40 animate-spin" />
            )}
          </div>
          {searchError && (
            <div className="mt-2 text-sm text-red-400">{searchError}</div>
          )}
          {searchQuery.trim() && searchResults.length > 0 && (
            <div className="mt-2 text-sm text-white/60">
              נמצאו {searchResults.length} תוצאות
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="h-8 w-8 animate-spin text-white/60" />
            </div>
          ) : uniqueDisplayContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/60">
              <UserX className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg">
                {searchQuery.trim() ? 'לא נמצאו תוצאות' : 'אין אנשי קשר חסומים'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/80">שם</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/80">כינוי</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/80">ID</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/80">תאריך חסימה</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-white/80">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {uniqueDisplayContacts.map((contact) => {
                    const searchResult = searchResults.find(r => r.contact.user_id === contact.user_id);
                    return (
                      <tr
                        key={contact.user_id}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors"
                      >
                        <td className="py-3 px-4 text-white">
                          <div className="flex flex-col">
                            <span>{contact.display_name}</span>
                            {searchResult?.type === 'name' && (
                              <span className="text-xs text-blue-400 mt-1">נמצא בשם</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-white/80">
                          <div className="flex flex-col">
                            {contact.username ? (
                              <span>@{contact.username}</span>
                            ) : (
                              <span className="text-white/40">-</span>
                            )}
                            {searchResult?.type === 'username' && (
                              <span className="text-xs text-blue-400 mt-1">נמצא בכינוי</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-white/60 font-mono text-sm">
                          {contact.user_id}
                        </td>
                        <td className="py-3 px-4 text-white/60 text-sm">
                          {formatDate(contact.blocked_date)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleOpenChat(contact.user_id)}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
                            >
                              <MessageCircle className="h-4 w-4" />
                              פתח שיחה
                            </button>
                            {searchResult?.type === 'message' && searchResult.message_preview && (
                              <div className="text-xs text-white/60 max-w-xs truncate">
                                {searchResult.message_preview}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Search Results - Messages */}
          {searchQuery.trim() && searchResults.filter(r => r.type === 'message').length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-white mb-4">תוצאות חיפוש בהודעות</h3>
              <div className="space-y-2">
                {searchResults
                  .filter(r => r.type === 'message')
                  .map((result, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleOpenChat(result.contact.user_id)}
                      className="p-4 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-medium">{result.contact.display_name}</span>
                        {result.message_date && (
                          <span className="text-xs text-white/60">
                            {formatDate(result.message_date)}
                          </span>
                        )}
                      </div>
                      {result.message_preview && (
                        <p className="text-sm text-white/80 line-clamp-2">
                          {result.message_preview}
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlockedContactsDialog;

