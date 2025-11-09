import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Users, CheckCircle, XCircle, Loader, RefreshCw, Trash2 } from 'lucide-react';
import { groupsStore, useGroupsAccountState } from '../../state/groups.store';

interface ChatInfo {
  id: number;
  title: string;
  member_count: number;
  type?: string;
  lastMessageTime?: number;
  lastMessageContent?: string;
  folder_id?: number | null;
  folder_name?: string;
  group_rules?: string;
  last_sent_at?: string | null;
  is_blocked?: boolean;
  is_new?: boolean;
}

interface SharedGroupsListProps {
  accountId: string;
  isAuthenticated: boolean;
  onGroupsLoaded?: (groups: ChatInfo[]) => void;
  showSelection?: boolean;
  selectedChats?: Set<number>;
  onSelectionChange?: (selected: Set<number>) => void;
  showLastMessageTime?: boolean;
  folderFilter?: string | null;
  blockedChats?: Set<number>;
  hideBlocked?: boolean;
  lastSentMap?: Record<number, string>;
  onDeleteAll?: () => void;
  showDeleteAll?: boolean;
  minMinutesSinceLastSend?: number;
}

const SharedGroupsList: React.FC<SharedGroupsListProps> = ({
  accountId,
  isAuthenticated,
  onGroupsLoaded,
  showSelection = false,
  selectedChats = new Set(),
  onSelectionChange,
  showLastMessageTime = false,
  folderFilter = null,
  blockedChats,
  hideBlocked = false,
  lastSentMap,
  onDeleteAll,
  showDeleteAll = false,
  minMinutesSinceLastSend
}) => {
  const accountState = useGroupsAccountState(accountId);
  const [filterText, setFilterText] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      groupsStore.initialise(accountId, true);
    }
  }, [accountId, isAuthenticated]);

  const getFolderKey = (chat: ChatInfo) => String(chat.folder_id ?? 'none');

  const normalizedGroups = useMemo<ChatInfo[]>(() => {
    return accountState.groups.map((group) => {
      const metadata = (group.metadata ?? {}) as Record<string, unknown>;
      const numericId = Number(group.id);
      const folderIdRaw = metadata.folder_id ?? metadata.folderId;
      const folderId = typeof folderIdRaw === 'number' ? folderIdRaw : Number(folderIdRaw ?? NaN);
      const folderNameRaw = metadata.folder_name ?? metadata.folderName;
      const lastMessageTimeRaw = metadata.lastMessageTime ?? metadata.last_message_time;
      const lastMessageTime = typeof lastMessageTimeRaw === 'number'
        ? lastMessageTimeRaw
        : typeof lastMessageTimeRaw === 'string'
          ? Number(lastMessageTimeRaw)
          : undefined;
      const lastMessageContent = typeof metadata.lastMessageContent === 'string'
        ? metadata.lastMessageContent
        : typeof metadata.last_message_content === 'string'
          ? metadata.last_message_content as string
          : undefined;

      const mapped: ChatInfo = {
        id: Number.isNaN(numericId) ? 0 : numericId,
        title: group.title || group.username || String(group.id),
        member_count: group.member_count ?? 0,
        type: typeof metadata.type === 'string' ? metadata.type : 'group',
        lastMessageTime,
        lastMessageContent,
        folder_id: Number.isNaN(folderId) ? null : folderId,
        folder_name: typeof folderNameRaw === 'string' ? folderNameRaw : 'ללא תיקייה',
        group_rules: typeof metadata.group_rules === 'string' ? metadata.group_rules : undefined,
        last_sent_at: lastSentMap?.[numericId] ?? null,
        is_blocked: blockedChats?.has(numericId) ?? false,
        is_new: group.is_new ?? false
      };

      return mapped;
    });
  }, [accountState.groups, blockedChats, lastSentMap]);

  const prevSigRef = useRef<string>('');
  useEffect(() => {
    if (!onGroupsLoaded) return;
    const sig = JSON.stringify(normalizedGroups.map(g => [g.id, g.member_count, g.lastMessageTime]));
    if (sig !== prevSigRef.current) {
      prevSigRef.current = sig;
      onGroupsLoaded(normalizedGroups);
    }
  }, [normalizedGroups]);

  const filteredChats = useMemo(() => {
    return normalizedGroups.filter((chat) => {
      const matchesText = filterText
        ? chat.title.toLowerCase().includes(filterText.toLowerCase())
        : true;
      const matchesFolder = !folderFilter || folderFilter === getFolderKey(chat);
      const isBlocked = blockedChats?.has(chat.id) ?? chat.is_blocked ?? false;
      if (hideBlocked && isBlocked) {
        return false;
      }
      if (minMinutesSinceLastSend && minMinutesSinceLastSend > 0) {
        const lastSentAt = chat.last_sent_at ? Date.parse(chat.last_sent_at) : NaN;
        if (!Number.isNaN(lastSentAt)) {
          const minutesSince = (Date.now() - lastSentAt) / 60000;
          if (minutesSince < minMinutesSinceLastSend) {
            return false;
          }
        }
      }
      return matchesText && matchesFolder;
    });
  }, [normalizedGroups, filterText, folderFilter, blockedChats, hideBlocked, minMinutesSinceLastSend]);

  const sortedChats = useMemo(() => {
    const chatsCopy = [...filteredChats];
    return chatsCopy.sort((a, b) => {
      // Keep "new" groups first
      if (a.is_new && !b.is_new) return -1;
      if (!a.is_new && b.is_new) return 1;

      const aSent = a.last_sent_at ? new Date(a.last_sent_at).getTime() : 0;
      const bSent = b.last_sent_at ? new Date(b.last_sent_at).getTime() : 0;
      if (aSent !== bSent) {
        return bSent - aSent;
      }
      const aActivity = a.lastMessageTime ?? 0;
      const bActivity = b.lastMessageTime ?? 0;
      if (aActivity !== bActivity) {
        return bActivity - aActivity;
      }
      return a.title.localeCompare(b.title, 'he-IL');
    });
  }, [filteredChats]);

  const totalGroups = normalizedGroups.length;
  const lastUpdated = accountState.syncedAt ?? accountState.lastUpdated ?? null;
  const isInitialLoading = accountState.loading && !accountState.loaded;
  const isRefreshing = accountState.refreshing;
  const error = accountState.error;

  const toggleSelection = (chatId: number) => {
    if (!showSelection || !onSelectionChange) return;
    const updated = new Set(selectedChats);
    if (updated.has(chatId)) {
      updated.delete(chatId);
    } else {
      updated.add(chatId);
    }
    onSelectionChange(updated);
  };

  const handleRefresh = () => {
    groupsStore.refresh(accountId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Users className="h-4 w-4" />
          <span>סה"כ קבוצות: {totalGroups}</span>
          {lastUpdated && (
            <span className="text-xs text-white/40">
              עודכן: {new Date(lastUpdated).toLocaleString('he-IL')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white hover:bg-white/10 disabled:opacity-50"
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          רענן
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder="חיפוש לפי שם קבוצה או @username"
          className="w-full rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-white/40 focus:outline-none"
        />
        {showDeleteAll && onDeleteAll && (
          <button
            type="button"
            onClick={onDeleteAll}
            className="flex items-center gap-1 rounded-full border border-red-400/60 bg-red-500/20 px-3 py-2 text-xs text-red-200 hover:bg-red-500/30 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            מחיקת הכל
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          <XCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {!isAuthenticated ? (
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-sm text-white/60">
          <Users className="h-10 w-10" />
          <span>יש להתחבר לחשבון כדי להציג קבוצות</span>
        </div>
      ) : isInitialLoading ? (
        <div className="flex h-48 items-center justify-center text-white/70">
          <Loader className="mr-2 h-5 w-5 animate-spin" />
          טוען רשימת קבוצות...
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-3xl border border-white/10 bg-white/5">
          {sortedChats.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-sm text-white/60">
              <Users className="h-10 w-10" />
              <span>לא נמצאו קבוצות תואמות</span>
            </div>
          ) : (
            <ul className="divide-y divide-white/10">
              {sortedChats.map((chat) => {
                const selected = selectedChats.has(chat.id);
                return (
                  <li
                    key={chat.id}
                    className={`flex items-center justify-between px-4 py-3 text-sm transition hover:bg-white/5 ${selected ? 'bg-white/5' : ''}`}
                  >
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{chat.title}</span>
                        {chat.is_new && (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                            חדש • 24 שעות
                          </span>
                        )}
                        <span className="text-xs text-white/50">{chat.member_count} חברים</span>
                      </div>
                      {showLastMessageTime && chat.lastMessageTime && (
                        <span className="text-xs text-white/40">
                          פעילות אחרונה: {new Date(chat.lastMessageTime).toLocaleString('he-IL')}
                        </span>
                      )}
                      {chat.lastMessageContent && (
                        <span className="text-xs text-white/60">{chat.lastMessageContent}</span>
                      )}
                    </div>
                    {showSelection && (
                      <button
                        type="button"
                        onClick={() => toggleSelection(chat.id)}
                        className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${
                          selected
                            ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
                            : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
                        }`}
                      >
                        {selected ? <CheckCircle className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                        {selected ? 'נבחרה' : 'בחר'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default SharedGroupsList;
