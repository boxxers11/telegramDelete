import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  MessageSquare,
  Users,
  CheckCircle,
  Save,
  Trash2,
  Edit,
  History,
  Loader2,
  Check,
  AlertTriangle,
  AtSign,
  UserCircle,
  ExternalLink,
  Send,
  RefreshCw,
  X
} from 'lucide-react';
import SharedGroupsList from './ui/SharedGroupsList';
import HeaderFullScreen from './ui/HeaderFullScreen';
import { groupsStore } from '../state/groups.store';
import { saveResumeSnapshot, clearResumeSnapshot } from '../state/resumeState';

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
  folder_id?: number | null;
  folder_name?: string;
  messages_found?: number;
  messages_deleted?: number;
  progress_percent?: number;
  has_unscanned_dates?: boolean;
  user_joined_at?: string | null;
  status?: string;
  messages?: Message[];
  last_sent_at?: string | null;
  is_blocked?: boolean;
}

type SendStatusType = 'pending' | 'sent' | 'failed' | 'dry_run' | 'blocked' | 'skipped_rules' | 'flood_wait';

interface SendStatusEntry {
  chatId: number;
  chatTitle: string;
  status: SendStatusType;
  timestamp: string;
  durationMs?: number;
  message?: string;
  error?: string;
  rules?: string;
  reasons?: string[];
  forced?: boolean;
}

type DirectSendStatusType = 'pending' | 'sent' | 'failed' | 'dry_run';

interface DirectSendStatusEntry {
  id: string;
  input: string;
  displayName: string;
  status: DirectSendStatusType;
  timestamp: string;
  userId?: number;
  username?: string;
  phone?: string;
  error?: string;
  durationMs?: number;
  matchedBy?: string;
}

type DirectTargetStatus = 'pending' | 'verified' | 'ready' | 'error';

interface DirectTargetEntry {
  id: string;
  value: string;
  displayName?: string;
  status: DirectTargetStatus;
  matchedBy?: string;
  error?: string;
}

interface MentionEntry {
  id: string;
  chat_id: number;
  chat_name: string;
  mention_message_id: number;
  mention_text: string;
  mention_timestamp: string;
  sender_id?: number;
  sender_username?: string;
  sender_display: string;
  reply_message_id?: number;
  reply_text?: string;
  reply_timestamp?: string;
  reply_from_me?: boolean;
  was_direct_reply?: boolean;
  responded?: boolean;
  respondedAt?: string;
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
  const [selfDestruct, setSelfDestruct] = useState(false);
  const [availableChats, setAvailableChats] = useState<ChatInfo[]>([]);
  const [folderGroups, setFolderGroups] = useState<Record<string, { name: string; chatIds: number[]; totalMembers: number }>>({});
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [sendStatuses, setSendStatuses] = useState<SendStatusEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | SendStatusType>('all');
  const [statusSort, setStatusSort] = useState<'recent' | 'status'>('recent');
  const [hideBlocked, setHideBlocked] = useState(false);
  const [cooldownFilterEnabled, setCooldownFilterEnabled] = useState(false);
  const [cooldownMinutes, setCooldownMinutes] = useState(50);
  const [isSending, setIsSending] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [blockedChats, setBlockedChats] = useState<Set<number>>(new Set());
  const [lastSentMap, setLastSentMap] = useState<Record<number, string>>({});
  const [rawGroupList, setRawGroupList] = useState<ChatInfo[]>([]);
  const [scanGroupList, setScanGroupList] = useState<ChatInfo[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const notificationTimeoutRef = useRef<number | null>(null);
  const blockedChatsRef = useRef<Set<number>>(blockedChats);
  const lastSentMapRef = useRef<Record<number, string>>(lastSentMap);
  const scanSignatureRef = useRef<string>('');
  const selectedChatsCount = selectedChats.size;

  const normalizeScanChat = useCallback((chat: any): ChatInfo => {
    const rawId = chat?.id ?? chat?.chat_id;
    const id = typeof rawId === 'number' ? rawId : Number(rawId ?? 0);
    const normalizedMessages: Message[] = Array.isArray(chat?.messages)
      ? chat.messages.map((msg: any) => {
          const rawMsgId = msg?.id ?? msg?.message_id;
          const messageId = typeof rawMsgId === 'number' ? rawMsgId : Number(rawMsgId ?? 0);
          return {
            id: Number.isNaN(messageId) ? 0 : messageId,
            content: msg?.content ?? msg?.message ?? '',
            date: msg?.date ?? msg?.timestamp ?? new Date().toISOString(),
            foundAt: msg?.found_at ?? msg?.foundAt ?? undefined,
            sender: msg?.sender,
            link: msg?.link ?? null,
            status: msg?.status ?? (msg?.deleted ? 'deleted' : 'pending'),
            selected: false,
            key: msg?.key
          };
        })
      : [];

    return {
      id: Number.isNaN(id) ? 0 : id,
      title: chat?.title ?? chat?.chat_title ?? 'ללא שם',
      member_count: chat?.member_count ?? 0,
      messages_found: chat?.messages_found ?? chat?.candidates_found ?? normalizedMessages.length,
      messages_deleted: chat?.messages_deleted ?? chat?.deleted ?? 0,
      progress_percent: chat?.progress_percent ?? 0,
      has_unscanned_dates: chat?.has_unscanned_dates ?? false,
      user_joined_at: chat?.user_joined_at ?? null,
      status: chat?.status ?? 'completed',
      folder_id: chat?.folder_id ?? null,
      folder_name: chat?.folder_name,
      group_rules: chat?.group_rules,
      lastMessageTime: chat?.lastMessageTime,
      lastMessageContent: chat?.lastMessageContent,
      messages: normalizedMessages,
      last_sent_at: chat?.last_sent_at ?? null,
      type: chat?.type ?? 'group',
      is_blocked: Boolean(chat?.is_blocked)
    };
  }, []);

  const fetchLastScanGroups = useCallback(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/scan-status`);
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'שגיאה בטעינת קבוצות הסריקה האחרונות');
      }

      const scannedList = data.result?.scanned_chats || data.result?.scan_progress?.scanned_chats || [];
      const normalized = Array.isArray(scannedList)
        ? scannedList
            .map(normalizeScanChat)
            .filter((chat) => chat.id !== 0)
        : [];

      setScanGroupList(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה בטעינת קבוצות הסריקה האחרונות';
      setGroupsError((prev) => prev ?? message);
      setScanGroupList([]);
    }
  }, [accountId, normalizeScanChat]);

  const scanGroupMap = useMemo(() => {
    const map = new Map<number, ChatInfo>();
    scanGroupList.forEach((chat) => {
      if (chat.id) {
        map.set(chat.id, chat);
      }
    });
    return map;
  }, [scanGroupList]);

  const combinedGroups = useMemo<ChatInfo[]>(() => {
    const source = rawGroupList.length > 0 ? rawGroupList : scanGroupList;
    if (source.length === 0) {
      return [];
    }

    return source.map((chat) => {
      const scanData = scanGroupMap.get(chat.id);
      const merged: ChatInfo = {
        ...chat,
        messages_found: scanData?.messages_found ?? chat.messages_found ?? 0,
        messages_deleted: scanData?.messages_deleted ?? chat.messages_deleted ?? 0,
        progress_percent: scanData?.progress_percent ?? chat.progress_percent ?? 0,
        has_unscanned_dates: scanData?.has_unscanned_dates ?? chat.has_unscanned_dates ?? false,
        user_joined_at: scanData?.user_joined_at ?? chat.user_joined_at ?? null,
        messages: scanData?.messages ?? chat.messages ?? [],
        last_sent_at: lastSentMap?.[chat.id] ?? chat.last_sent_at ?? scanData?.last_sent_at ?? null,
        is_blocked: blockedChats.has(chat.id) || Boolean(chat.is_blocked) || Boolean(scanData?.is_blocked),
        folder_id: chat.folder_id ?? scanData?.folder_id ?? null,
        folder_name: chat.folder_name ?? scanData?.folder_name,
        type: chat.type ?? scanData?.type ?? 'group'
      };

      return merged;
    });
  }, [rawGroupList, scanGroupList, scanGroupMap, lastSentMap, blockedChats]);

  useEffect(() => {
    const enhancedGroups = combinedGroups;
    setAvailableChats(enhancedGroups);

    const grouped: Record<string, { name: string; chatIds: number[]; totalMembers: number }> = {};
    enhancedGroups.forEach((chat) => {
      const key = folderKeyForChat(chat);
      const name = chat.folder_name || (chat.folder_id !== null && chat.folder_id !== undefined ? `תיקייה ${chat.folder_id}` : 'ללא תיקייה');
      if (!grouped[key]) {
        grouped[key] = { name, chatIds: [], totalMembers: 0 };
      }
      grouped[key].chatIds.push(chat.id);
      grouped[key].totalMembers += chat.member_count ?? 0;
    });

    Object.values(grouped).forEach((folder) => folder.chatIds.sort((a, b) => a - b));
    setFolderGroups(grouped);

    if (activeFolder && !grouped[activeFolder]) {
      setActiveFolder(null);
    }
  }, [combinedGroups, activeFolder]);

  useEffect(() => {
    if (combinedGroups.length === 0) {
      if (selectedChatsCount === 0) {
        return;
      }
      setSelectedChats(new Set());
      return;
    }

    const validIds = new Set(combinedGroups.map((chat) => chat.id));
    setSelectedChats((prev) => {
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [combinedGroups, selectedChatsCount]);

  useEffect(() => {
    const sig = JSON.stringify(scanGroupList.map((chat) => [chat.id, chat.messages_found]));
    if (sig === scanSignatureRef.current) {
      return;
    }
    scanSignatureRef.current = sig;

    if (scanGroupList.length === 0) {
      return;
    }

    if (selectedChatsCount > 0) {
      return;
    }

    const autoSelect = new Set<number>();
    scanGroupList.forEach((chat) => {
      const count = chat.messages_found ?? chat.messages?.length ?? 0;
      if (count > 0) {
        autoSelect.add(chat.id);
      }
    });

    if (autoSelect.size > 0) {
      setSelectedChats(autoSelect);
    }
  }, [scanGroupList, selectedChatsCount]);
  const [activeTab, setActiveTab] = useState<'groups' | 'direct' | 'mentions'>('groups');
  const [directTargets, setDirectTargets] = useState<DirectTargetEntry[]>([]);
  const [directTargetInput, setDirectTargetInput] = useState('');
  const [directDryRun, setDirectDryRun] = useState(true);
  const [directDelay, setDirectDelay] = useState(1);
  const [directStatuses, setDirectStatuses] = useState<DirectSendStatusEntry[]>([]);
  const [isDirectSending, setIsDirectSending] = useState(false);
  const directVerificationTimers = useRef<Record<string, number>>({});
  const [mentionDays, setMentionDays] = useState(3);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [mentionsError, setMentionsError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const [replyingMention, setReplyingMention] = useState<MentionEntry | null>(null);
  const [mentionReplyText, setMentionReplyText] = useState('');
  const [mentionReplyStatus, setMentionReplyStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [mentionReplyProgress, setMentionReplyProgress] = useState(0);
  const [mentionReplyError, setMentionReplyError] = useState<string | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  const folderEntries = useMemo(() => {
    return Object.entries(folderGroups).sort((a, b) => {
      const aName = a[1].name.toLocaleLowerCase('he-IL');
      const bName = b[1].name.toLocaleLowerCase('he-IL');
      return aName.localeCompare(bName, 'he-IL');
    });
  }, [folderGroups]);

  const activeFolderName = useMemo(() => {
    if (!activeFolder) return null;
    return folderGroups[activeFolder]?.name ?? null;
  }, [activeFolder, folderGroups]);

  const persistBlockedChats = useCallback((nextSet: Set<number>) => {
    setBlockedChats(new Set(nextSet));
    blockedChatsRef.current = new Set(nextSet);
    localStorage.setItem(`blocked_chats_${accountId}`, JSON.stringify(Array.from(nextSet)));
  }, [accountId]);

  const persistLastSentMap = useCallback((nextMap: Record<number, string>) => {
    setLastSentMap({ ...nextMap });
    lastSentMapRef.current = { ...nextMap };
    localStorage.setItem(`last_sent_map_${accountId}`, JSON.stringify(nextMap));
  }, [accountId]);

  const playSuccessTone = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.4);
      setTimeout(() => ctx.close(), 500);
    } catch (error) {
      console.error('Audio tone error:', error);
    }
  }, []);

  const triggerNotification = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    setNotification({ type, text });
    if (notificationTimeoutRef.current) {
      window.clearTimeout(notificationTimeoutRef.current);
    }
    notificationTimeoutRef.current = window.setTimeout(() => {
      setNotification(null);
      notificationTimeoutRef.current = null;
    }, 5000);
  }, []);

  const upsertSendStatus = useCallback((entry: SendStatusEntry) => {
    setSendStatuses((prev) => {
      const existingIndex = prev.findIndex((item) => item.chatId === entry.chatId && item.timestamp === entry.timestamp && item.status === entry.status);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], ...entry };
        return updated.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }
      return [...prev, entry].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    });
  }, []);

  useEffect(() => {
    loadMessageHistory();
    loadGroupPresets();
    try {
      const storedBlocked = localStorage.getItem(`blocked_chats_${accountId}`);
      if (storedBlocked) {
        const parsed: number[] = JSON.parse(storedBlocked);
        const initialSet = new Set(parsed);
        setBlockedChats(initialSet);
        blockedChatsRef.current = initialSet;
      }
    } catch {}

    try {
      const storedLastSent = localStorage.getItem(`last_sent_map_${accountId}`);
      if (storedLastSent) {
        const parsed = JSON.parse(storedLastSent);
        setLastSentMap(parsed);
        lastSentMapRef.current = parsed;
      }
    } catch {}

    // Load selected chats from localStorage
    try {
      const storedSelected = localStorage.getItem(`selected_chats_${accountId}`);
      if (storedSelected) {
        const parsed: number[] = JSON.parse(storedSelected);
        setSelectedChats(new Set(parsed));
      }
    } catch {}

    // Load active folder from localStorage
    try {
      const storedFolder = localStorage.getItem(`active_folder_${accountId}`);
      if (storedFolder) {
        setActiveFolder(storedFolder);
      }
    } catch {}
  }, [accountId]);

  useEffect(() => {
    blockedChatsRef.current = blockedChats;
  }, [blockedChats]);

  useEffect(() => {
    lastSentMapRef.current = lastSentMap;
  }, [lastSentMap]);

  // Save selected chats to localStorage
  useEffect(() => {
    localStorage.setItem(`selected_chats_${accountId}`, JSON.stringify(Array.from(selectedChats)));
  }, [selectedChats, accountId]);

  // Save active folder to localStorage
  useEffect(() => {
    if (activeFolder) {
      localStorage.setItem(`active_folder_${accountId}`, activeFolder);
    } else {
      localStorage.removeItem(`active_folder_${accountId}`);
    }
  }, [activeFolder, accountId]);

  useEffect(() => {
    setActiveTab('groups');
    Object.values(directVerificationTimers.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    directVerificationTimers.current = {};
    setDirectTargets([]);
    setDirectStatuses([]);
    setDirectTargetInput('');
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

  useEffect(() => {
    return () => {
      if (notificationTimeoutRef.current) {
        window.clearTimeout(notificationTimeoutRef.current);
        notificationTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const source = new EventSource(`http://127.0.0.1:8001/accounts/${accountId}/scan-events`);

    let lastEventAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - lastEventAt > 15000) {
        console.log('EventSource timeout, reconnecting...');
        source.close();
        // Reconnect after timeout
        setTimeout(() => {
          const newSource = new EventSource(`http://127.0.0.1:8001/accounts/${accountId}/scan-events`);
          setupEventSource(newSource);
        }, 1000);
      }
    }, 5000);

    const setupEventSource = (eventSource: EventSource) => {
      eventSource.onmessage = (event) => {
        lastEventAt = Date.now();
        try {
          const payload = JSON.parse(event.data);
          if (payload.type !== 'message_send_status') {
            return;
          }

          const statusEntry: SendStatusEntry = {
            chatId: payload.chat_id,
            chatTitle: payload.chat_title || payload.chat_id?.toString() || '',
            status: (payload.status || 'pending') as SendStatusType,
            timestamp: payload.timestamp || new Date().toISOString(),
            durationMs: payload.duration_ms,
            message: payload.message,
            error: payload.error,
            rules: payload.group_rules,
            reasons: payload.rules_reasons,
            forced: payload.forced
          };

          upsertSendStatus(statusEntry);

          if (payload.status === 'sent') {
            playSuccessTone();
            triggerNotification('success', `ההודעה נשלחה ל-${statusEntry.chatTitle}`);
            const updatedMap = {
              ...lastSentMapRef.current,
              [payload.chat_id]: statusEntry.timestamp
            };
            persistLastSentMap(updatedMap);
            if (blockedChatsRef.current.has(payload.chat_id)) {
              const nextBlocked = new Set(blockedChatsRef.current);
              nextBlocked.delete(payload.chat_id);
              persistBlockedChats(nextBlocked);
            }
          }

          if (payload.status === 'blocked') {
            const nextBlocked = new Set(blockedChatsRef.current);
            nextBlocked.add(payload.chat_id);
            persistBlockedChats(nextBlocked);
          }

        } catch (error) {
          console.error('Failed to parse send status event', error);
        }
      };

      eventSource.onerror = () => {
        console.log('EventSource error, will reconnect...');
        eventSource.close();
      };
    };

    setupEventSource(source);

    return () => {
      clearInterval(timer);
      source.close();
    };
  }, [accountId, persistBlockedChats, persistLastSentMap, playSuccessTone, triggerNotification, upsertSendStatus]);

  useEffect(() => {
    const resumeTab = localStorage.getItem('telegram_messages_resume_tab');
    if (resumeTab === 'direct') {
      setActiveTab('direct');
    }
    if (resumeTab) {
      localStorage.removeItem('telegram_messages_resume_tab');
    }
  }, [accountId]);

  useEffect(() => {
    if (!isAuthenticated) {
      setRawGroupList([]);
      setScanGroupList([]);
      setSelectedChats(new Set());
      return;
    }

    let cancelled = false;
    setGroupsLoading(true);
    setGroupsError(null);

    // Clear previous data when switching accounts
    setRawGroupList([]);
    setScanGroupList([]);
    setSelectedChats(new Set());

    groupsStore
      .refresh(accountId)
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'שגיאה ברענון רשימת הקבוצות';
          setGroupsError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setGroupsLoading(false);
        }
      });

    void fetchLastScanGroups();

    return () => {
      cancelled = true;
    };
  }, [accountId, isAuthenticated, fetchLastScanGroups]);

  const saveGroupPresets = (presets: GroupPreset[]) => {
    localStorage.setItem(`group_presets_${accountId}`, JSON.stringify(presets));
    setGroupPresets(presets);
  };

  const folderKeyForChat = (chat: ChatInfo) => String(chat.folder_id ?? 'none');

  const handleGroupsLoaded = useCallback((groups: ChatInfo[]) => {
    setRawGroupList(groups);
  }, []);

  const selectedCountForFolder = (folderKey: string) => {
    const folder = folderGroups[folderKey];
    if (!folder) return 0;
    return folder.chatIds.reduce((count, chatId) => (selectedChats.has(chatId) ? count + 1 : count), 0);
  };

  const isFolderFullySelected = (folderKey: string) => {
    const folder = folderGroups[folderKey];
    if (!folder || folder.chatIds.length === 0) return false;
    return folder.chatIds.every((chatId) => selectedChats.has(chatId));
  };

  const toggleFolderSelection = (folderKey: string, selectAll: boolean) => {
    const folder = folderGroups[folderKey];
    if (!folder) return;
    const updated = new Set(selectedChats);
    folder.chatIds.forEach((chatId) => {
      if (selectAll) {
        updated.add(chatId);
      } else {
        updated.delete(chatId);
      }
    });
    setSelectedChats(updated);
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

  const performSend = useCallback(async (targets: number[], overrides: number[] = []) => {
    if (!message.trim() || targets.length === 0) return;
    setIsSending(true);
    const startedAt = Date.now();
    try {
      const targetChats = availableChats.filter((chat) => targets.includes(chat.id));
      saveResumeSnapshot({
        id: `group-${accountId}-${startedAt}`,
        type: 'group_send',
        accountId,
        path: `/messages/${accountId}`,
        description: `שליחת הודעה ל-${targetChats.length} קבוצות`,
        operations: targetChats.map((chat) => chat.title),
        startedAt,
        status: 'pending',
        metadata: {
          chatIds: targets,
          overrides,
          dryRun,
          messagePreview: message.slice(0, 120)
        }
      });

      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/send-batch-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          chat_ids: targets,
          delay_seconds: delay,
          dry_run: dryRun,
          force_chat_ids: overrides,
          self_destruct: selfDestruct && !dryRun
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        triggerNotification('error', data.error || 'שליחה נכשלה');
        return;
      }

      if (Array.isArray(data.results)) {
        data.results.forEach((result: any) => {
          const statusEntry: SendStatusEntry = {
            chatId: result.chat_id,
            chatTitle: result.chat_title || availableChats.find((c) => c.id === result.chat_id)?.title || result.chat_id.toString(),
            status: (result.status || 'pending') as SendStatusType,
            timestamp: result.timestamp || new Date().toISOString(),
            durationMs: result.duration_ms,
            message: result.message,
            error: result.error,
            rules: result.group_rules,
            reasons: result.rules_reasons,
            forced: overrides.includes(result.chat_id)
          };
          upsertSendStatus(statusEntry);

          if (statusEntry.status === 'sent' || statusEntry.status === 'dry_run') {
            const updatedMap = {
              ...lastSentMapRef.current,
              [result.chat_id]: statusEntry.timestamp
            };
            persistLastSentMap(updatedMap);
            if (statusEntry.status === 'sent') {
              playSuccessTone();
              if (blockedChatsRef.current.has(result.chat_id)) {
                const nextBlocked = new Set(blockedChatsRef.current);
                nextBlocked.delete(result.chat_id);
                persistBlockedChats(nextBlocked);
              }
            }
          }

          if (statusEntry.status === 'blocked') {
            const nextBlocked = new Set(blockedChatsRef.current);
            nextBlocked.add(result.chat_id);
            persistBlockedChats(nextBlocked);
          }
        });
      }

      if (!dryRun && data.sent_count > 0) {
        addMessageToHistory(message);
      }

      triggerNotification('info', `תהליך השליחה הסתיים (נשלחו ${data.sent_count}, נכשלו ${data.failed_count}, דולגו ${data.skipped_count || 0})`);

    } catch (error) {
      console.error('Error sending messages:', error);
      triggerNotification('error', 'שגיאה בשליחת הודעות');
    } finally {
      setIsSending(false);
      clearResumeSnapshot();
    }
  }, [accountId, addMessageToHistory, availableChats, delay, dryRun, message, persistBlockedChats, persistLastSentMap, playSuccessTone, triggerNotification, upsertSendStatus]);

  const sendMessages = async () => {
    if (isSending || !message.trim() || selectedChats.size === 0) return;
    await performSend(Array.from(selectedChats));
  };

  const handleSendOverride = async (chatId: number) => {
    await performSend([chatId], [chatId]);
  };

  const verifyDirectTarget = useCallback((entry: DirectTargetEntry) => {
    setDirectTargets((prev) => prev.map((target) => (
      target.id === entry.id
        ? { ...target, status: 'pending', error: undefined }
        : target
    )));

    const performVerification = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/resolve-direct-target`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ target: entry.value })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'הנמען לא נמצא או אינו זמין');
        }

        const result = data.result || {};
        const displayName = result.display_name || entry.value;
        const matchedBy = result.matched_by || undefined;

        if (directVerificationTimers.current[entry.id]) {
          window.clearTimeout(directVerificationTimers.current[entry.id]);
        }

        setDirectTargets((prev) => prev.map((target) => (
          target.id === entry.id
            ? {
                ...target,
                status: 'verified',
                displayName,
                matchedBy,
                error: undefined
              }
            : target
        )));

        triggerNotification('success', `הנמען ${displayName} מאומת ומוכן לשליחה`);

        directVerificationTimers.current[entry.id] = window.setTimeout(() => {
          setDirectTargets((prev) => prev.map((target) => (
            target.id === entry.id
              ? {
                  ...target,
                  status: 'ready',
                  displayName
                }
              : target
          )));
          delete directVerificationTimers.current[entry.id];
        }, 5000);
      } catch (error) {
        if (directVerificationTimers.current[entry.id]) {
          window.clearTimeout(directVerificationTimers.current[entry.id]);
          delete directVerificationTimers.current[entry.id];
        }

        const message = error instanceof Error ? error.message : 'הנמען לא נמצא או אינו זמין';
        setDirectTargets((prev) => prev.map((target) => (
          target.id === entry.id
            ? {
                ...target,
                status: 'error',
                error: message
              }
            : target
        )));
      }
    };

    void performVerification();
  }, [accountId]);

  const addDirectTarget = () => {
    const trimmed = directTargetInput.trim();
    if (!trimmed) {
      return;
    }

    const normalized = trimmed.toLowerCase();
    if (directTargets.some((target) => target.value.toLowerCase() === normalized)) {
      triggerNotification('error', 'הנמען כבר קיים ברשימה');
      setDirectTargetInput('');
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: DirectTargetEntry = {
      id,
      value: trimmed,
      displayName: trimmed,
      status: 'pending'
    };

    setDirectTargets((prev) => [...prev, entry]);
    setDirectTargetInput('');
    verifyDirectTarget(entry);
  };

  const removeDirectTarget = (targetId: string) => {
    if (directVerificationTimers.current[targetId]) {
      window.clearTimeout(directVerificationTimers.current[targetId]);
      delete directVerificationTimers.current[targetId];
    }
    setDirectTargets((prev) => prev.filter((item) => item.id !== targetId));
  };

  const sendDirectMessages = async () => {
    const validTargets = directTargets.filter((target) => target.status === 'ready' || target.status === 'verified');
    const hasPendingTargets = directTargets.some((target) => target.status === 'pending');

    if (isDirectSending || !message.trim() || validTargets.length === 0) {
      triggerNotification('error', hasPendingTargets ? 'מתבצעת בדיקת נמענים, המתן לסיום האימות' : 'יש למלא הודעה ולבחור נמענים מאומתים');
      return;
    }

    setIsDirectSending(true);
    try {
      const startedAt = Date.now();
      saveResumeSnapshot({
        id: `direct-${accountId}-${startedAt}`,
        type: 'direct_send',
        accountId,
        path: `/messages/${accountId}`,
        description: `שליחת הודעה ל-${validTargets.length} נמענים פרטיים`,
        operations: validTargets.map((target) => target.displayName || target.value),
        startedAt,
        status: 'pending',
        metadata: {
          targets: validTargets.map((target) => target.value),
          dryRun: directDryRun,
          delay: directDelay,
          messagePreview: message.slice(0, 120)
        }
      });

      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/send-direct-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          targets: validTargets.map((target) => target.value),
          delay_seconds: directDelay,
          dry_run: directDryRun
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        triggerNotification('error', data.error || 'שליחת ההודעה נכשלה');
        return;
      }

      const normalized: DirectSendStatusEntry[] = Array.isArray(data.results)
        ? data.results.map((item: any) => {
            const timestamp = item.timestamp || new Date().toISOString();
            const status = (item.status || 'failed') as DirectSendStatusType;
            return {
              id: `${item.user_id ?? item.input ?? timestamp}_${timestamp}`,
              input: item.input ?? '',
              displayName: item.display_name ?? item.input ?? 'לא זוהה',
              status,
              timestamp,
              userId: item.user_id,
              username: item.username,
              phone: item.phone,
              error: item.error,
              durationMs: item.duration_ms,
              matchedBy: item.matched_by
            };
          })
        : [];

      if (!directDryRun && data.sent_count > 0) {
        addMessageToHistory(message);
      }

      setDirectStatuses((prev) => {
        const combined = [...normalized, ...prev];
        return combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      });

      triggerNotification(
        'info',
        `תהליך השליחה הסתיים (נשלחו ${data.sent_count}, נכשלו ${data.failed_count || 0})`
      );
    } catch (error) {
      console.error('Error sending direct messages:', error);
      triggerNotification('error', 'אירעה שגיאה בעת שליחת הודעות פרטיות');
    } finally {
      setIsDirectSending(false);
      clearResumeSnapshot();
    }
  };

  const handleDeleteAll = () => {
    setShowDeleteAllConfirm(true);
  };

  const confirmDeleteAll = () => {
    setSelectedChats(new Set());
    setShowDeleteAllConfirm(false);
    triggerNotification('success', 'כל הקבוצות בוטלו מהבחירה');
  };

  const cancelDeleteAll = () => {
    setShowDeleteAllConfirm(false);
  };

  const sendMentionReply = async () => {
    if (!replyingMention) {
      return;
    }

    const trimmed = mentionReplyText.trim();
    if (!trimmed) {
      setMentionReplyError('אנא הזן טקסט לתגובה');
      return;
    }

    setMentionReplyError(null);
    setMentionReplyStatus('sending');
    setMentionReplyProgress(35);

    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/mentions/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mention_id: replyingMention.id,
          user_id: replyingMention.sender_id,
          username: replyingMention.sender_username,
          reply_text: trimmed,
          original_text: replyingMention.reply_text || '',
          mention_text: replyingMention.mention_text,
          chat_id: replyingMention.chat_id,
          chat_name: replyingMention.chat_name
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'שגיאה בשליחת התגובה');
      }

      setMentionReplyProgress(100);
      setMentionReplyStatus('success');
      setMentions((prev) => prev.map((entry) => (
        entry.id === replyingMention.id
          ? { ...entry, responded: true, respondedAt: data.sent_at ?? new Date().toISOString() }
          : entry
      )));
      setNotification({ type: 'success', text: 'התגובה נשלחה בהצלחה' });
      playSuccessTone();
      setTimeout(() => {
        setReplyingMention(null);
      }, 800);
    } catch (error) {
      setMentionReplyProgress(100);
      setMentionReplyStatus('error');
      const messageText = (error as Error).message || 'שגיאה בשליחת התגובה';
      setMentionReplyError(messageText);
      setNotification({ type: 'error', text: messageText });
    }
  };

  const filteredStatuses = useMemo(() => {
    const base = statusFilter === 'all'
      ? sendStatuses
      : sendStatuses.filter((status) => status.status === statusFilter);

    if (statusSort === 'status') {
      return [...base].sort((a, b) => {
        if (a.status === b.status) {
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        }
        return a.status.localeCompare(b.status);
      });
    }

    return base;
  }, [sendStatuses, statusFilter, statusSort]);

  const directStatusLabels: Record<DirectSendStatusType, string> = useMemo(() => ({
    pending: 'בהמתנה',
    sent: 'נשלח',
    failed: 'נכשל',
    dry_run: 'בדיקה'
  }), []);

  const directStatusColors: Record<DirectSendStatusType, string> = useMemo(() => ({
    pending: 'bg-yellow-500/20 text-yellow-200',
    sent: 'bg-green-500/20 text-green-200',
    failed: 'bg-red-500/20 text-red-200',
    dry_run: 'bg-blue-500/20 text-blue-200'
  }), []);

  const directMatchedByLabels: Record<string, string> = useMemo(() => ({
    username: 'שם משתמש',
    username_lookup: 'חיפוש שם משתמש',
    phone: 'טלפון',
    phone_import: 'טלפון (ייבוא זמני)',
    id: 'מזהה',
    id_lookup: 'חיפוש מזהה'
  }), []);

  const loadMentions = useCallback(async () => {
    if (!isAuthenticated) {
      setMentions([]);
      return;
    }
    setMentionsLoading(true);
    setMentionsError(null);
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/mentions?days=${mentionDays}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'שגיאה בטעינת התיוגים');
      }
      setMentions(Array.isArray(data.mentions) ? data.mentions : []);
    } catch (error) {
      setMentions([]);
      setMentionsError((error as Error).message || 'שגיאה בטעינת התיוגים');
    } finally {
      setMentionsLoading(false);
    }
  }, [accountId, mentionDays, isAuthenticated]);

  const hasValidDirectTargets = directTargets.some((target) => target.status === 'ready' || target.status === 'verified');
  const hasPendingDirectTargets = directTargets.some((target) => target.status === 'pending');

  useEffect(() => () => {
    Object.values(directVerificationTimers.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    directVerificationTimers.current = {};
  }, []);

  useEffect(() => {
    if (activeTab === 'mentions') {
      loadMentions();
    }
  }, [activeTab, loadMentions]);

  useEffect(() => {
    if (!replyingMention) {
      setMentionReplyText('');
      setMentionReplyStatus('idle');
      setMentionReplyProgress(0);
      setMentionReplyError(null);
    }
  }, [replyingMention]);

  const headerTitle = useMemo(() => {
    if (activeTab === 'groups') {
      return 'שליחת הודעות';
    }
    if (activeTab === 'direct') {
      return 'שליחת הודעות לפרטי';
    }
    return 'שליחה למתייגים';
  }, [activeTab]);

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-white/80">
        {activeTab === 'groups'
          ? `נבחרו ${selectedChats.size} מתוך ${availableChats.length}`
          : activeTab === 'direct'
            ? `${directTargets.length} נמענים`
            : `${mentions.length} אזכורים`}
      </span>
      {activeTab === 'groups' && (
        <>
          <button
            type="button"
            onClick={() => {
              setGroupsLoading(true);
              groupsStore.refresh(accountId).finally(() => setGroupsLoading(false));
              fetchLastScanGroups();
            }}
            className="btn-secondary flex items-center gap-2"
            disabled={groupsLoading}
          >
            <RefreshCw className={`h-4 w-4 ${groupsLoading ? 'animate-spin' : ''}`} />
            רענן קבוצות
          </button>
        <button
          type="button"
          onClick={() => setShowPresetModal(true)}
          className="btn-secondary flex items-center gap-2"
        >
          <Save className="h-4 w-4" />
          שמור הקבצה
        </button>
        </>
      )}
    </div>
  );

  const renderMessageComposer = () => (
    <>
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
    </>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden" dir="rtl">
      <HeaderFullScreen
        title={headerTitle}
        onBack={onBack}
        description={`חשבון: ${accountLabel}`}
        actions={headerActions}
      />
      <div className="border-b border-white/10 bg-white/5">
        <div className="flex justify-center px-6 pb-4">
          <div className="inline-flex rounded-xl bg-white/10 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('groups')}
              className={`min-w-[140px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'groups'
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              שליחה לקבוצות
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('direct')}
              className={`min-w-[140px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'direct'
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              שליחה לפרטי
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('mentions')}
              className={`min-w-[160px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'mentions'
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              שליחה למתייגים
            </button>
          </div>
        </div>
      </div>

      {notification && (
        <div
          className={`mx-6 mt-4 rounded-xl border px-4 py-3 text-sm ${
            notification.type === 'success'
              ? 'border-green-400/60 bg-green-500/10 text-green-100'
              : notification.type === 'error'
                ? 'border-red-400/60 bg-red-500/10 text-red-100'
                : 'border-blue-400/60 bg-blue-500/10 text-blue-100'
          }`}
        >
          {notification.text}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'groups' && (
          <div className="h-full overflow-y-auto p-6">
          <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left Column - Message */}
            <div className="space-y-6">
              {renderMessageComposer()}

              {folderEntries.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">תיקיות קבוצות</h3>
                    <button
                      onClick={() => setActiveFolder(null)}
                      className="text-xs text-blue-300 hover:text-blue-200 disabled:opacity-40"
                      disabled={!activeFolder}
                    >
                      הצג הכל
                    </button>
                  </div>
                  <div className="space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-3 max-h-64">
                    {folderEntries.map(([key, folder]) => {
                      const selectedInFolder = selectedCountForFolder(key);
                      const totalInFolder = folder.chatIds.length;
                      const fullySelected = isFolderFullySelected(key);
                      const partiallySelected = !fullySelected && selectedInFolder > 0;

                      return (
                        <div
                          key={key}
                          className={`rounded-lg border p-3 transition-colors ${
                            activeFolder === key
                              ? 'border-blue-500 bg-blue-500/10'
                              : 'border-white/10 bg-white/5 hover:bg-white/10'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <button
                              onClick={() => setActiveFolder(activeFolder === key ? null : key)}
                              className="flex-1 text-right text-sm font-medium text-white transition-colors hover:text-blue-300"
                            >
                              <div>{folder.name}</div>
                              <div className="text-xs text-white/60">
                                {selectedInFolder} / {totalInFolder} קבוצות • {folder.totalMembers.toLocaleString()} חברים
                              </div>
                            </button>
                            <button
                              onClick={() => toggleFolderSelection(key, !fullySelected)}
                              className="btn-secondary px-3 py-1 text-xs"
                            >
                              {fullySelected ? 'נקה' : 'בחר'}
                            </button>
                          </div>
                          {partiallySelected && (
                            <div className="mt-2 text-xs text-yellow-400">
                              נבחרו {selectedInFolder} מתוך {totalInFolder}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setShowPresetModal(true)}
                      className="btn-secondary flex items-center px-3 py-2 text-sm"
                    >
                      <Save className="mr-1 h-4 w-4" />
                      שמור הקבצה
                    </button>
                    <button
                      onClick={() => {
                        const allIds = new Set(availableChats.map(chat => chat.id));
                        setSelectedChats(allIds);
                      }}
                      className="btn-secondary flex items-center px-3 py-2 text-sm"
                      disabled={availableChats.length === 0}
                    >
                      <CheckCircle className="mr-1 h-4 w-4" />
                      בחר הכל
                    </button>
                    <button
                      onClick={() => setSelectedChats(new Set())}
                      className="btn-secondary flex items-center px-3 py-2 text-sm"
                      disabled={selectedChats.size === 0}
                    >
                      <X className="mr-1 h-4 w-4" />
                      נקה הכל
                    </button>
                  </div>
                  <div className="text-sm text-white/60 text-left">
                    <div>נבחרו {selectedChats.size} מתוך {availableChats.length}</div>
                    {activeFolderName && (
                      <div className="text-xs text-white/40">תצוגה: {activeFolderName}</div>
                    )}
                  </div>
                </div>

                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/60">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-white/30 bg-transparent"
                        checked={hideBlocked}
                        onChange={(e) => setHideBlocked(e.target.checked)}
                      />
                      הסתר קבוצות חסומות
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-white/30 bg-transparent"
                        checked={cooldownFilterEnabled}
                        onChange={(e) => setCooldownFilterEnabled(e.target.checked)}
                      />
                      הצג רק קבוצות שלא קיבלו הודעה ב-
                    </label>
                    {cooldownFilterEnabled && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={5}
                          max={720}
                          value={cooldownMinutes}
                          onChange={(event) => setCooldownMinutes(Math.max(5, Math.min(720, Number(event.target.value) || 0)))}
                          className="w-16 rounded border border-white/20 bg-transparent px-2 py-1 text-right text-white focus:outline-none"
                        />
                        <span>דקות</span>
                      </div>
                    )}
                  </div>
                  {blockedChats.size > 0 && (
                    <span className="text-red-300">{blockedChats.size} חסומות</span>
                  )}
                </div>

                <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
                  <div className="mb-2">
                    <strong>מקור נתונים:</strong> {scanGroupList.length > 0 
                      ? `קבוצות מהסריקה האחרונה (${scanGroupList.length} קבוצות)`
                      : rawGroupList.length > 0 
                        ? `כל הקבוצות בחשבון (${rawGroupList.length} קבוצות)`
                        : 'אין קבוצות זמינות'
                    }
                  </div>
                  <div>
                  טיפים: מומלץ לשלוח הודעות בקבוצות לפי התיקיות שלך, ולעקוב אחרי סטטוס השליחה בחלון התוצאות כאן למטה בזמן אמת.
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
                  folderFilter={activeFolder}
                  blockedChats={blockedChats}
                  hideBlocked={hideBlocked}
                  lastSentMap={lastSentMap}
                  onDeleteAll={handleDeleteAll}
                  showDeleteAll={selectedChats.size > 0}
                  minMinutesSinceLastSend={cooldownFilterEnabled ? cooldownMinutes : undefined}
                />
              </div>
            </div>
          </div>

          {/* Send Status Panel */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-semibold text-white">תוצאות השליחה</h3>
              <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
                <span className="opacity-80">מתעדכן בזמן אמת</span>
                <div className="flex items-center gap-2">
                  <label>סטטוס:</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as 'all' | SendStatusType)}
                    className="rounded-lg border border-white/20 bg-transparent px-2 py-1 text-xs text-white focus:outline-none"
                  >
                    <option value="all">הכל</option>
                    <option value="pending">בהמתנה</option>
                    <option value="sent">נשלח</option>
                    <option value="dry_run">בדיקה</option>
                    <option value="skipped_rules">דולג (חוקים)</option>
                    <option value="blocked">חסום</option>
                    <option value="failed">נכשל</option>
                    <option value="flood_wait">Flood Wait</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label>מיון:</label>
                  <select
                    value={statusSort}
                    onChange={(e) => setStatusSort(e.target.value as 'recent' | 'status')}
                    className="rounded-lg border border-white/20 bg-transparent px-2 py-1 text-xs text-white focus:outline-none"
                  >
                    <option value="recent">לפי זמן</option>
                    <option value="status">לפי סטטוס</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {filteredStatuses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/20 p-6 text-center text-sm text-white/50">
                  עדיין אין סטטוסי שליחה. בחר קבוצות ולחץ על "{dryRun ? 'בדיקה' : 'שלח הודעות'}" כדי להתחיל.
                </div>
              ) : (
                filteredStatuses.map((status) => {
                  const statusClasses: Record<SendStatusType, string> = {
                    pending: 'bg-blue-500/10 border-blue-500/40 text-blue-100',
                    sent: 'bg-green-500/10 border-green-500/40 text-green-100',
                    dry_run: 'bg-purple-500/10 border-purple-500/40 text-purple-100',
                    blocked: 'bg-red-500/10 border-red-500/40 text-red-100',
                    failed: 'bg-red-500/10 border-red-500/40 text-red-100',
                    skipped_rules: 'bg-yellow-500/10 border-yellow-500/40 text-yellow-100',
                    flood_wait: 'bg-orange-500/10 border-orange-500/40 text-orange-100'
                  };

                  const statusTexts: Record<SendStatusType, string> = {
                    pending: 'בהמתנה',
                    sent: 'נשלח',
                    dry_run: 'בדיקה (Dry Run)',
                    blocked: 'חסום',
                    failed: 'נכשל',
                    skipped_rules: 'דולג (חוקי קבוצה)',
                    flood_wait: 'המתנה ל-Telegram'
                  };

                  return (
                    <div
                      key={`${status.chatId}-${status.timestamp}-${status.status}`}
                      className={`rounded-xl border p-3 transition-colors ${statusClasses[status.status]}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold">{status.chatTitle}</div>
                          <div className="text-xs opacity-80">
                            סטטוס: {statusTexts[status.status]} • {new Date(status.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          {status.durationMs && (
                            <div className="text-xs opacity-70">זמן שליחה: {(status.durationMs / 1000).toFixed(1)} שניות</div>
                          )}
                          {status.reasons && status.reasons.length > 0 && (
                            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs opacity-90">
                              {status.reasons.map((reason, idx) => (
                                <li key={idx}>{reason}</li>
                              ))}
                            </ul>
                          )}
                          {status.error && (
                            <div className="mt-2 text-xs opacity-90">שגיאה: {status.error}</div>
                          )}
                          {status.rules && status.status === 'skipped_rules' && (
                            <details className="mt-2 text-xs">
                              <summary className="cursor-pointer">הצג חוקי קבוצה</summary>
                              <div className="mt-1 whitespace-pre-wrap opacity-80">{status.rules}</div>
                            </details>
                          )}
                        </div>
                        {status.status === 'skipped_rules' && (
                          <button
                            onClick={() => handleSendOverride(status.chatId)}
                            className="btn-primary text-xs disabled:opacity-50"
                            disabled={isSending}
                          >
                            שלח בכל זאת
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
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
            <div className="flex flex-col gap-3">
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
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="selfDestruct"
                  checked={selfDestruct}
                  onChange={(e) => setSelfDestruct(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-blue-500"
                  disabled={dryRun}
                />
                <label htmlFor="selfDestruct" className={`text-sm ${dryRun ? 'text-white/40' : 'text-white/80'}`}>
                  הודעות זמניות (תימחקנה אוטומטית אחרי שעה)
                </label>
              </div>
            </div>
          </div>
          </div>
        )}

        {activeTab === 'direct' && (
          <div className="h-full overflow-y-auto p-6 space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-6">
                {renderMessageComposer()}

                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                  ניתן להזין שם משתמש עם או בלי @, מספר טלפון בינלאומי עם קידומת +, או מזהה משתמש מספרי.
                </div>

                <div>
                  <h3 className="mb-3 text-lg font-semibold text-white">ניהול נמענים</h3>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={directTargetInput}
                      onChange={(e) => setDirectTargetInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addDirectTarget();
                        }
                      }}
                      className="flex-1 rounded-lg border border-white/20 bg-white/10 p-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="לדוגמה: @user, +972501234567 או 123456789"
                    />
                    <button
                      onClick={addDirectTarget}
                      className="btn-primary px-4 py-2 text-sm"
                    >
                      הוסף נמען
                    </button>
                  </div>
                  {directTargets.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {directTargets.map((target) => {
                        const displayName = target.displayName || target.value;
                        const statusClasses: Record<DirectTargetStatus, string> = {
                          pending: 'border border-orange-400/60 bg-orange-500/20 text-orange-100 animate-pulse',
                          verified: 'border border-green-400/70 bg-green-500/25 text-green-100 transition-colors duration-500',
                          ready: 'border border-white/30 text-white/90 bg-transparent transition-colors duration-500',
                          error: 'border border-red-400/70 bg-red-500/25 text-red-100'
                        };

                        const icon = target.status === 'pending'
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : target.status === 'error'
                            ? <AlertTriangle className="w-4 h-4" />
                            : <Check className={`w-4 h-4 ${target.status === 'ready' ? 'text-white' : 'text-green-100'}`} />;

                        return (
                          <div key={target.id} className="flex flex-col gap-1">
                            <span
                              className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm transition-all ${statusClasses[target.status]}`}
                            >
                              <span>{displayName}</span>
                              {target.matchedBy && target.status !== 'error' && (
                                <span className="text-[10px] text-white/80 bg-white/15 px-2 py-0.5 rounded-full">
                                  {directMatchedByLabels[target.matchedBy] ?? target.matchedBy}
                                </span>
                              )}
                              {icon}
                              <button
                                onClick={() => removeDirectTarget(target.id)}
                                className="ml-1 text-white/70 transition-colors hover:text-red-300"
                                title="הסר"
                              >
                                ×
                                <span className="sr-only">הסר נמען</span>
                              </button>
                            </span>
                            {target.error && (
                              <span className="text-xs text-red-200">
                                {target.error}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-white/50">
                      טרם נוספו נמענים. ניתן להזין כמה נמענים אחד אחרי השני וללחוץ אנטר או על הכפתור.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-white/80">
                      עיכוב בין שליחות (שניות)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={directDelay}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isNaN(value)) {
                          setDirectDelay(0);
                          return;
                        }
                        setDirectDelay(Math.min(Math.max(0, value), 60));
                      }}
                      className="w-full rounded-lg border border-white/20 bg-white/10 p-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <label className="mt-4 flex items-center gap-2 text-sm text-white/80 md:mt-0">
                    <input
                      type="checkbox"
                      checked={directDryRun}
                      onChange={(e) => setDirectDryRun(e.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-blue-500"
                    />
                    מצב בדיקה (לא תישלח הודעה אמיתית)
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-lg font-semibold text-white">תוצאות השליחה</h3>
                    <span className="text-xs text-white/60">
                      {directStatuses.length > 0 ? `נמענים מטופלים: ${directStatuses.length}` : 'עדיין לא נשלחו הודעות'}
                    </span>
                  </div>
                  {directStatuses.length === 0 ? (
                    <p className="text-sm text-white/60">
                      לאחר השליחה תראה כאן את סטטוס ההודעות והתאמות שבוצעו.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-white/10 text-right text-sm text-white/90">
                        <thead className="bg-white/10 text-white">
                          <tr>
                            <th className="px-3 py-2 font-semibold">זמן</th>
                            <th className="px-3 py-2 font-semibold">נמען</th>
                            <th className="px-3 py-2 font-semibold">סטטוס</th>
                            <th className="px-3 py-2 font-semibold">פרטים</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          {directStatuses.map((status) => (
                            <tr key={status.id} className="bg-white/5">
                              <td className="whitespace-nowrap px-3 py-2 text-white/70">
                                {new Date(status.timestamp).toLocaleString('he-IL')}
                              </td>
                              <td className="px-3 py-2">
                                <div className="text-white">{status.displayName}</div>
                                <div className="text-xs text-white/50">
                                  {status.username ? `@${status.username}` : status.phone ? `+${status.phone}` : status.input}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${directStatusColors[status.status]}`}>
                                  {directStatusLabels[status.status]}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs text-white/70">
                                {status.error
                                  ? status.error
                                  : status.matchedBy
                                    ? `זוהה לפי ${directMatchedByLabels[status.matchedBy] ?? status.matchedBy}`
                                    : 'נשלח בהצלחה'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mentions' && (
          <div className="h-full overflow-y-auto p-6 space-y-6" dir="rtl">
            {!isAuthenticated ? (
              <div className="rounded-xl border border-yellow-400/50 bg-yellow-500/10 p-4 text-sm text-yellow-100">
                יש להתחבר לחשבון כדי להציג תיוגים.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                      <AtSign className="h-5 w-5 text-blue-300" />
                      תיוגים אחרונים
                    </h3>
                    <p className="text-sm text-white/60">
                      הצגת הודעות שבהן תויגת במהלך {mentionDays} הימים האחרונים.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-white/80">
                    <label className="font-medium" htmlFor="mention-days">טווח ימים</label>
                    <input
                      id="mention-days"
                      type="number"
                      min={1}
                      max={14}
                      value={mentionDays}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        if (Number.isNaN(parsed)) {
                          setMentionDays(1);
                        } else {
                          setMentionDays(Math.max(1, Math.min(14, parsed)));
                        }
                      }}
                      className="w-20 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-right text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={loadMentions}
                      className="btn-secondary flex items-center gap-2"
                      disabled={mentionsLoading}
                    >
                      <RefreshCw className={`h-4 w-4 ${mentionsLoading ? 'animate-spin' : ''}`} />
                      רענן
                    </button>
                  </div>
                </div>

                {mentionsError && (
                  <div className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    {mentionsError}
                  </div>
                )}

                {mentionsLoading ? (
                  <div className="flex h-64 flex-col items-center justify-center gap-3 text-white/70">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-300" />
                    <span>טוען תיוגים...</span>
                    <span className="text-xs text-white/50 text-center">
                      אנחנו עוברים על קבוצות שבהן היית פעיל לאחרונה כדי להעלות רק תיוגים רלוונטיים. תהליך זה עשוי להימשך מספר שניות.
                    </span>
                  </div>
                ) : mentions.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center text-sm text-white/60">
                    לא נמצאו תיוגים בטווח הימים המבוקש.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
                    <table className="min-w-full divide-y divide-white/10 text-sm text-white/80">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-white/50">
                          <th className="px-4 py-3 text-right">קבוצה</th>
                          <th className="px-4 py-3 text-right">משתמש</th>
                          <th className="px-4 py-3 text-right">תאריך</th>
                          <th className="px-4 py-3 text-right">שעה</th>
                          <th className="px-4 py-3 text-right">הודעה שלו</th>
                          <th className="px-4 py-3 text-right">ההודעה שלך</th>
                          <th className="px-4 py-3 text-right">פעולה</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {mentions.map((mention) => {
                          const mentionDate = new Date(mention.mention_timestamp);
                          const dateLabel = mentionDate.toLocaleDateString('he-IL');
                          const timeLabel = mentionDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
                          const username = mention.sender_username ? mention.sender_username.replace(/^@/, '') : null;
                          const isSendingThis = replyingMention?.id === mention.id && mentionReplyStatus === 'sending';
                          const responded = mention.responded;
                          return (
                            <tr key={mention.id} className={responded ? 'bg-green-500/10' : ''}>
                              <td className="px-4 py-3 align-top text-sm font-semibold text-white">
                                {mention.chat_name}
                              </td>
                              <td className="px-4 py-3 align-top text-sm text-white">
                                <div className="font-medium text-white">{mention.sender_display}</div>
                                {username ? (
                                  <a
                                    href={`https://t.me/${username}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1 inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"
                                  >
                                    @{username}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="mt-1 block text-xs text-white/40">אין שם משתמש</span>
                                )}
                              </td>
                              <td className="px-4 py-3 align-top text-xs text-white/70">{dateLabel}</td>
                              <td className="px-4 py-3 align-top text-xs text-white/70">{timeLabel}</td>
                              <td className="px-4 py-3 align-top text-sm text-white/80">
                                {mention.mention_text}
                              </td>
                              <td className="px-4 py-3 align-top text-sm text-white/80">
                                {mention.reply_text ? mention.reply_text : <span className="text-white/40">—</span>}
                              </td>
                              <td className="px-4 py-3 align-top text-xs text-white">
                                <button
                                  onClick={() => {
                                    setReplyingMention(mention);
                                    setMentionReplyText('');
                                    setMentionReplyStatus('idle');
                                    setMentionReplyProgress(0);
                                    setMentionReplyError(null);
                                  }}
                                  className="btn-primary flex items-center gap-2 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={isSendingThis}
                                >
                                  <Send className="h-4 w-4" />
                                  מענה
                                </button>
                                {responded && (
                                  <div className="mt-2 text-[10px] text-green-300">נשלח</div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {activeTab === 'groups' && (
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
              disabled={isSending || !message.trim() || selectedChats.size === 0}
              className="btn-primary flex items-center px-6 py-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MessageSquare className="mr-2 h-5 w-5" />
              {isSending ? 'שולח...' : dryRun ? 'בדיקה' : 'שלח הודעות'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'direct' && (
        <div className="flex items-center justify-between border-t border-white/10 p-6">
          <div className="text-sm text-white/60">
            {directTargets.length > 0
              ? hasPendingDirectTargets
                ? `מתבצע אימות ל-${directTargets.length} נמענים`
                : `נבחרו ${directTargets.length} נמענים`
              : 'הוסף נמענים לשליחה'}
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
              onClick={sendDirectMessages}
              disabled={isDirectSending || !message.trim() || !hasValidDirectTargets || hasPendingDirectTargets}
              className="btn-primary flex items-center px-6 py-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MessageSquare className="mr-2 h-5 w-5" />
              {isDirectSending ? 'שולח...' : directDryRun ? 'בדיקה' : 'שלח הודעות'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'mentions' && (
        <div className="flex items-center justify-end border-t border-white/10 p-6">
          <button
            onClick={onBack}
            className="btn-secondary flex items-center px-6 py-3"
          >
            <ArrowLeft className="mr-2 h-5 w-5" />
            חזור
          </button>
        </div>
      )}

      {replyingMention && (
        <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" dir="rtl">
          <div className="relative w-full max-w-3xl rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl">
            <button
              onClick={() => {
                if (mentionReplyStatus === 'sending') {
                  return;
                }
                setReplyingMention(null);
              }}
              className="absolute left-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-red-500/70"
              title="סגור"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="space-y-5 pr-4">
              <div className="flex items-center gap-3">
                <UserCircle className="h-10 w-10 text-blue-300" />
                <div>
                  <div className="text-lg font-semibold text-white">{replyingMention.sender_display}</div>
                  {replyingMention.sender_username ? (
                    <a
                      href={`https://t.me/${replyingMention.sender_username.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200"
                    >
                      @{replyingMention.sender_username.replace(/^@/, '')}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : (
                    <span className="mt-1 block text-xs text-white/50">אין שם משתמש ציבורי</span>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
                <div>
                  <div className="text-xs text-white/50">ההודעה שלו</div>
                  <div className="mt-2 rounded-xl border border-white/10 bg-white/10 p-3 text-sm text-white/80">
                    {replyingMention.mention_text}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/50">התגובה שלך בשיחה</div>
                  <div className="mt-2 rounded-xl border border-blue-400/30 bg-blue-500/10 p-3 text-sm text-blue-100">
                    {replyingMention.reply_text ? replyingMention.reply_text : 'לא נמצאה הודעה קודמת'}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-white/80" htmlFor="mention-reply-text">
                  תגובה חדשה
                </label>
                <textarea
                  id="mention-reply-text"
                  value={mentionReplyText}
                  onChange={(event) => setMentionReplyText(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="כתוב כאן את התגובה שתישלח בפרטי"
                  disabled={mentionReplyStatus === 'sending'}
                />
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full transition-all duration-500 ${
                      mentionReplyStatus === 'error'
                        ? 'bg-red-400'
                        : mentionReplyStatus === 'success'
                          ? 'bg-green-400'
                          : 'bg-blue-400'
                    }`}
                    style={{ width: `${mentionReplyProgress}%` }}
                  />
                </div>
                {mentionReplyError && (
                  <div className="text-xs text-red-200">{mentionReplyError}</div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-white/60">
                  {mentionReplyStatus === 'sending' && (
                    <span className="inline-flex items-center gap-2 text-blue-200">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      שולח תגובה...
                    </span>
                  )}
                  {mentionReplyStatus === 'success' && (
                    <span className="inline-flex items-center gap-2 text-green-300">
                      <CheckCircle className="h-4 w-4" />
                      התגובה נשלחה!
                    </span>
                  )}
                  {mentionReplyStatus === 'error' && (
                    <span className="inline-flex items-center gap-2 text-red-300">
                      <AlertTriangle className="h-4 w-4" />
                      ניסיון השליחה נכשל
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setReplyingMention(null)}
                    className="btn-secondary px-4 py-2"
                    disabled={mentionReplyStatus === 'sending'}
                  >
                    ביטול
                  </button>
                  <button
                    onClick={sendMentionReply}
                    disabled={mentionReplyStatus === 'sending' || mentionReplyText.trim().length === 0}
                    className="btn-primary flex items-center gap-2 px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    שלח תגובה
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preset Modal */}
      {activeTab === 'groups' && showPresetModal && (
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

      {/* Delete All Confirmation Modal */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="glass-advanced mx-4 w-full max-w-md rounded-2xl p-6">
            <h3 className="mb-4 text-xl font-bold text-white">אישור מחיקה</h3>
            <div className="space-y-4">
              <p className="text-sm text-white/80">
                האם אתה בטוח שברצונך לבטל את כל הקבוצות שנבחרו?
              </p>
              <div className="text-sm text-white/60">
                יבוטלו {selectedChats.size} קבוצות מהבחירה
              </div>
            </div>
            <div className="mt-6 flex space-x-3">
              <button
                onClick={cancelDeleteAll}
                className="flex-1 rounded-lg bg-white/10 px-4 py-2 text-white transition-colors hover:bg-white/20"
              >
                ביטול
              </button>
              <button
                onClick={confirmDeleteAll}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700"
              >
                מחיקה
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageWizard;
