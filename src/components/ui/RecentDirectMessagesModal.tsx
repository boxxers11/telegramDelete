import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  Clock,
  FileText,
  History,
  Image,
  Loader,
  Loader2,
  Mic,
  Music,
  Paperclip,
  RefreshCw,
  User,
  Video,
  X
} from 'lucide-react';
import { apiFetch } from '../../config/api';

interface DirectMessageEntry {
  message_id: number;
  chat_id: number;
  chat_name: string;
  message_text: string;
  timestamp: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

type ActiveTab = 'incoming' | 'history';

interface UserHistoryMedia {
  type: string;
  file_name?: string | null;
  size_bytes?: number | null;
  mime_type?: string | null;
  caption?: string | null;
}

interface UserHistoryMessage {
  message_id: number;
  chat_id: number;
  timestamp: string;
  direction: 'incoming' | 'outgoing';
  text?: string | null;
  is_service?: boolean;
  service_text?: string | null;
  media?: UserHistoryMedia | null;
  via_bot?: string | null;
}

interface UserHistoryMetadata {
  id: number;
  username?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  is_bot?: boolean;
}

interface UserHistoryResponse {
  success: boolean;
  messages?: UserHistoryMessage[];
  chat?: UserHistoryMetadata | null;
  requested?: {
    username?: string;
    from_date?: string | null;
    to_date?: string | null;
    limit?: number;
  };
  stats?: {
    total: number;
    has_more: boolean;
  };
  error?: string;
}

interface RecentDirectMessagesModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
}

const mediaTypeLabels: Record<string, string> = {
  photo: 'תמונה',
  image: 'תמונה',
  video: 'וידאו',
  animation: 'אנימציה',
  gif: 'אנימציה',
  document: 'מסמך',
  file: 'קובץ',
  audio: 'אודיו',
  music: 'אודיו',
  voice: 'הודעת קול',
  sticker: 'סטיקר',
  contact: 'איש קשר',
  geo: 'מיקום',
  poll: 'סקר',
  unknown: 'מדיה'
};

type MediaIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

const resolveMediaIcon = (type?: string): MediaIcon => {
  switch ((type || '').toLowerCase()) {
    case 'photo':
    case 'image':
      return Image;
    case 'video':
    case 'animation':
    case 'gif':
      return Video;
    case 'audio':
    case 'music':
      return Music;
    case 'voice':
      return Mic;
    case 'document':
    case 'file':
      return FileText;
    case 'sticker':
      return Image;
    default:
      return Paperclip;
  }
};

const formatFileSize = (bytes?: number | null): string | null => {
  if (!bytes || bytes <= 0) {
    return null;
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value < 10 && unitIndex > 0 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const sanitizeUsernameInput = (value: string): string =>
  value.replace(/\s+/g, '').replace(/^@+/, '').trim().toLowerCase();

const isValidTelegramUsername = (value: string): boolean =>
  /^[a-zA-Z][\w]{3,31}$/.test(value);

const DAY_MS = 24 * 60 * 60 * 1000;

interface HistoryRangeOption {
  value: number;
  label: string;
}

const HISTORY_RANGE_OPTIONS: HistoryRangeOption[] = [
  { value: 7, label: 'שבוע אחרון' },
  { value: 30, label: 'חודש אחרון' },
  { value: 90, label: '3 חודשים אחרונים' },
  { value: 180, label: 'חצי שנה אחרונה' },
  { value: 365, label: 'שנה אחרונה' },
  { value: 730, label: 'שנתיים אחרונות' }
];

const DEFAULT_HISTORY_RANGE = 30;

type VerificationStatus = 'idle' | 'pending' | 'verified_user' | 'verified_history' | 'not_found' | 'error';

const RecentDirectMessagesModal: React.FC<RecentDirectMessagesModalProps> = ({
  isOpen,
  onClose,
  accountId
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('incoming');

  const [incomingMessages, setIncomingMessages] = useState<DirectMessageEntry[]>([]);
  const [incomingLoading, setIncomingLoading] = useState(false);
  const [incomingError, setIncomingError] = useState<string | null>(null);
  const [incomingLimitInput, setIncomingLimitInput] = useState(20);
  const [incomingActiveLimit, setIncomingActiveLimit] = useState(20);
  const [incomingLoadedAt, setIncomingLoadedAt] = useState<string | null>(null);

  const [historyUsername, setHistoryUsername] = useState('');
  const [historyRangeDays, setHistoryRangeDays] = useState<number>(DEFAULT_HISTORY_RANGE);
  const [historyLimit, setHistoryLimit] = useState(200);
  const [historyMessages, setHistoryMessages] = useState<UserHistoryMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyMeta, setHistoryMeta] = useState<UserHistoryMetadata | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState<boolean | null>(null);
  const [historyChatId, setHistoryChatId] = useState('');
  const [historyRequestInfo, setHistoryRequestInfo] = useState<{
    username?: string;
    chat_id?: string;
    fromDate?: string | null;
    toDate?: string | null;
    rangeLabel?: string;
  }>({});
  const [lastHistoryLoadedAt, setLastHistoryLoadedAt] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationDetails, setVerificationDetails] = useState<{ displayName?: string | null; matchedBy?: string | null } | null>(null);

  const portalRoot = typeof document !== 'undefined' ? document.body : null;

  useEffect(() => {
    if (!portalRoot || !isOpen) {
      return;
    }
    const previousBodyOverflow = portalRoot.style.overflow;
    portalRoot.style.overflow = 'hidden';
    return () => {
      portalRoot.style.overflow = previousBodyOverflow;
    };
  }, [isOpen, portalRoot]);

  useEffect(() => {
    if (!isOpen) {
      setActiveTab('incoming');
      setHistoryError(null);
      setHistoryLoading(false);
      setVerificationStatus('idle');
      setVerificationMessage(null);
      setVerificationDetails(null);
    }
  }, [isOpen]);

  useEffect(() => {
    setVerificationStatus('idle');
    setVerificationMessage(null);
    setVerificationDetails(null);
  }, [historyUsername]);

  const formatTimestamp = useCallback(
    (value?: string | null, options?: Intl.DateTimeFormatOptions) => {
      if (!value) {
        return '—';
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return date.toLocaleString('he-IL', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        ...options
      });
    },
    []
  );

  const incomingUsernameLabel = useMemo(
    () => (incomingMessages.length === 0 ? '—' : 'שם משתמש'),
    [incomingMessages.length]
  );

  const selectedHistoryRange = useMemo(
    () => HISTORY_RANGE_OPTIONS.find((option) => option.value === historyRangeDays) ?? HISTORY_RANGE_OPTIONS[0],
    [historyRangeDays]
  );

  const computeHistoryRange = useCallback(() => {
    const now = new Date();
    const toIso = now.toISOString();
    const fromBoundary = new Date(now.getTime() - Math.max(historyRangeDays, 1) * DAY_MS);
    return {
      fromIso: fromBoundary.toISOString(),
      toIso
    };
  }, [historyRangeDays]);

  const loadIncomingMessages = useCallback(
    async (requestedLimit?: number) => {
      const limit = requestedLimit ?? incomingLimitInput;
      const clampedLimit = Math.max(1, Math.min(limit, 50));
      setIncomingActiveLimit(clampedLimit);
      setIncomingLoading(true);
      setIncomingError(null);
      try {
        const response = await apiFetch(`/accounts/${accountId}/recent-direct-messages?limit=${clampedLimit}`);
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'שגיאה בטעינת הודעות');
        }
        setIncomingMessages(Array.isArray(data.messages) ? data.messages : []);
        setIncomingLoadedAt(new Date().toISOString());
      } catch (err) {
        setIncomingError((err as Error).message || 'שגיאה בטעינת הודעות');
        setIncomingMessages([]);
      } finally {
        setIncomingLoading(false);
      }
    },
    [accountId, incomingLimitInput]
  );

  const loadUserHistory = useCallback(async () => {
    const normalizedUsername = historyUsername ? sanitizeUsernameInput(historyUsername) : null;
    const normalizedChatId = historyChatId.trim();
    
    // Validate that at least one identifier is provided
    if (!normalizedUsername && !normalizedChatId) {
      setHistoryError('יש להזין שם משתמש או Chat ID');
      setHistoryMessages([]);
      setHistoryMeta(null);
      setHistoryHasMore(null);
      setHistoryRequestInfo({});
      return;
    }
    
    // Validate username if provided
    if (normalizedUsername && !isValidTelegramUsername(normalizedUsername)) {
      setHistoryError('שם משתמש בטלגרם חייב להיות באותיות לטיניות, מספרים או קו תחתון (לדוגמה: example_user)');
      setHistoryMessages([]);
      setHistoryMeta(null);
      setHistoryHasMore(null);
      setHistoryRequestInfo({});
      return;
    }
    
    // Validate chat_id if provided
    if (normalizedChatId) {
      const chatIdNum = parseInt(normalizedChatId, 10);
      if (isNaN(chatIdNum) || chatIdNum <= 0) {
        setHistoryError('Chat ID חייב להיות מספר חיובי תקף');
        setHistoryMessages([]);
        setHistoryMeta(null);
        setHistoryHasMore(null);
        setHistoryRequestInfo({});
        return;
      }
    }
    
    const { fromIso, toIso } = computeHistoryRange();
    const clampedLimit = Math.max(1, Math.min(historyLimit, 1000));

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const params = new URLSearchParams();
      if (normalizedUsername) {
      params.set('username', normalizedUsername);
      }
      if (normalizedChatId) {
        params.set('chat_id', normalizedChatId);
      }
      params.set('limit', String(clampedLimit));
      params.set('to_date', toIso);
      params.set('from_date', fromIso);

      const response = await apiFetch(`/accounts/${accountId}/user-history?${params.toString()}`);
      const data: UserHistoryResponse = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'שגיאה בטעינת היסטוריית המשתמש');
      }

      setHistoryMessages(Array.isArray(data.messages) ? data.messages : []);
      setHistoryMeta(data.chat ?? null);
      setHistoryHasMore(data.stats?.has_more ?? null);
      setHistoryRequestInfo({
        username: data.requested?.username,
        chat_id: data.requested?.chat_id,
        fromDate: data.requested?.from_date ?? fromIso,
        toDate: data.requested?.to_date ?? toIso,
        rangeLabel: selectedHistoryRange?.label
      });
      setLastHistoryLoadedAt(new Date().toISOString());
      if (data.chat) {
        setVerificationDetails({
          displayName: data.chat.display_name || data.chat.username || undefined,
          matchedBy: data.chat.username ? `@${data.chat.username}` : undefined
        });
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setVerificationStatus('verified_history');
          setVerificationMessage(null);
        } else if (verificationStatus !== 'verified_history') {
          setVerificationStatus('verified_user');
          setVerificationMessage(null);
        }
      }
    } catch (err) {
      const error = err as Error;
      if (error.message?.includes('HTTP 404')) {
        setHistoryError('לא נמצא משתמש בשם זה או שאין היסטוריית שיחה זמינה.');
        setVerificationStatus('not_found');
        setVerificationMessage('לא נמצאה התאמה למשתמש בחשבון זה.');
      } else if (error.message?.includes('HTTP 400')) {
        setHistoryError('הבקשה נדחתה. בדקו שהשם או Chat ID מוזנים בצורה תקינה.');
        setVerificationStatus('error');
        setVerificationMessage('הבקשה נדחתה – בדקו את שם המשתמש, Chat ID או הטווח שנבחר.');
      } else {
        setHistoryError(error.message || 'שגיאה בטעינת היסטוריית המשתמש');
        setVerificationStatus('error');
        setVerificationMessage(error.message || 'שגיאה בטעינת היסטוריה');
      }
      setHistoryMessages([]);
      setHistoryMeta(null);
      setHistoryHasMore(null);
      setHistoryRequestInfo({});
      setLastHistoryLoadedAt(null);
    } finally {
      setHistoryLoading(false);
    }
  }, [
    accountId,
    computeHistoryRange,
    historyLimit,
    historyUsername,
    historyChatId,
    selectedHistoryRange?.label,
    verificationStatus
  ]);

  const verifyHistoryUsername = useCallback(async () => {
    const normalizedUsername = sanitizeUsernameInput(historyUsername);
    if (!normalizedUsername) {
      setVerificationStatus('error');
      setVerificationMessage('יש להזין שם משתמש לפני האימות.');
      setVerificationDetails(null);
      return;
    }
    if (!isValidTelegramUsername(normalizedUsername)) {
      setVerificationStatus('error');
      setVerificationMessage('שם משתמש בטלגרם חייב להיות באותיות לטיניות, מספרים או קו תחתון (לדוגמה: example_user).');
      setVerificationDetails(null);
      return;
    }

    setVerificationStatus('pending');
    setVerificationMessage(null);
    setVerificationDetails(null);

    try {
      const response = await apiFetch('/user-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalizedUsername,
          account_ids: [accountId],
          max_messages: 1
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'לא ניתן לאמת את המשתמש');
      }

      const targetResult = Array.isArray(data.results)
        ? data.results.find((item) => item.account_id === accountId)
        : undefined;

      if (!targetResult || targetResult.status !== 'ok' || !targetResult.target_user) {
        setVerificationStatus('not_found');
        setVerificationMessage('לא נמצאה התאמה למשתמש בחשבון זה.');
        setVerificationDetails(null);
        return;
      }

      const displayNameParts = [
        targetResult.target_user.first_name,
        targetResult.target_user.last_name
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      const displayName =
        displayNameParts || (targetResult.target_user.username ? `@${targetResult.target_user.username}` : null);

      setVerificationDetails({
        displayName,
        matchedBy: targetResult.matched_by || undefined
      });

      const conversationState = targetResult.conversation_state;
      const hasMessages =
        Array.isArray(targetResult.messages) && targetResult.messages.length > 0;

      if (
        hasMessages ||
        conversationState === 'active' ||
        conversationState === 'history_deleted'
      ) {
        setVerificationStatus('verified_history');
        setVerificationMessage(null);
      } else {
        setVerificationStatus('verified_user');
        setVerificationMessage(
          targetResult.notes || 'המשתמש מאומת. לא נמצאה היסטוריה בטווח שנבחר.'
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה באימות המשתמש';
      setVerificationStatus('error');
      setVerificationMessage(message);
      setVerificationDetails(null);
    }
  }, [accountId, historyUsername]);

  const verificationFeedback = useMemo(() => {
    const trimmed = historyUsername.trim();
    const baseClasses = 'flex items-center gap-1 text-xs';

    switch (verificationStatus) {
      case 'pending':
        return (
          <span className={`${baseClasses} text-white/70`}>
            <Loader2 className="h-3 w-3 animate-spin" />
            מאמת משתמש...
          </span>
        );
      case 'verified_history':
        return (
          <span className={`${baseClasses} text-emerald-300`}>
            <CheckCircle className="h-3 w-3" />
            <CheckCircle2 className="h-3 w-3" />
            {verificationDetails?.displayName
              ? `נמצאה היסטוריה עם ${verificationDetails.displayName}`
              : 'נמצאה היסטוריית שיחה'}
          </span>
        );
      case 'verified_user':
        return (
          <span className={`${baseClasses} text-emerald-200`}>
            <CheckCircle className="h-3 w-3" />
            {verificationDetails?.displayName
              ? `המשתמש ${verificationDetails.displayName} מאומת`
              : 'המשתמש מאומת'}
            {verificationMessage && (
              <span className="text-white/60"> · {verificationMessage}</span>
            )}
          </span>
        );
      case 'not_found':
        return (
          <span className={`${baseClasses} text-red-300`}>
            <AlertCircle className="h-3 w-3" />
            {verificationMessage || 'המשתמש לא נמצא בחשבון זה'}
          </span>
        );
      case 'error':
        return (
          <span className={`${baseClasses} text-orange-300`}>
            <AlertCircle className="h-3 w-3" />
            {verificationMessage || 'אירעה שגיאה באימות המשתמש'}
          </span>
        );
      case 'idle':
      default:
        if (!trimmed) {
          return (
            <span className={`${baseClasses} text-white/40`}>
              הזינו שם משתמש ולחצו על אימות כדי לוודא את הנמען.
            </span>
          );
        }
        return (
          <span className={`${baseClasses} text-white/50`}>
            לחצו על אימות כדי לוודא שהמשתמש קיים ונגיש.
          </span>
        );
    }
  }, [historyUsername, verificationDetails, verificationMessage, verificationStatus]);
  useEffect(() => {
    if (isOpen && activeTab === 'incoming') {
      loadIncomingMessages(incomingLimitInput);
    }
  }, [isOpen, activeTab, loadIncomingMessages, incomingLimitInput]);

  const handleHistorySubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      loadUserHistory();
    },
    [loadUserHistory]
  );

  const historyTargetDisplay = useMemo(() => {
    if (!historyMeta) {
      return null;
    }
    if (historyMeta.display_name && historyMeta.display_name.trim()) {
      return historyMeta.display_name;
    }
    const fullName = [historyMeta.first_name, historyMeta.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) {
      return fullName;
    }
    if (historyMeta.username) {
      return `@${historyMeta.username}`;
    }
    return `משתמש ${historyMeta.id}`;
  }, [historyMeta]);

  const historyMessageList = useMemo(() => {
    if (historyMessages.length === 0) {
      return null;
    }
    let currentDateLabel: string | null = null;
    return historyMessages.map((message) => {
      const key = `${message.chat_id}-${message.message_id}`;
      const hasTimestamp = Boolean(message.timestamp);
      const dateLabel = hasTimestamp
        ? formatTimestamp(message.timestamp, {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: undefined,
            minute: undefined
          })
        : null;
      const showDateSeparator = dateLabel && dateLabel !== currentDateLabel;
      currentDateLabel = dateLabel || currentDateLabel;

      if (message.is_service) {
        return (
          <React.Fragment key={key}>
            {showDateSeparator && dateLabel && (
              <div className="flex justify-center py-2">
                <div className="rounded-full border border-white/10 bg-white/10 px-4 py-1 text-xs text-white/70">
                  {dateLabel}
                </div>
              </div>
            )}
            <div className="flex justify-center py-1">
              <div className="rounded-full bg-slate-800/70 px-3 py-1 text-xs text-white/70">
                {message.service_text || message.text || 'פעולת מערכת'}
              </div>
            </div>
          </React.Fragment>
        );
      }

      const alignment = message.direction === 'outgoing' ? 'justify-end' : 'justify-start';
      const bubbleColors =
        message.direction === 'outgoing'
          ? 'bg-blue-600/80 text-white border border-blue-400/20 rounded-l-3xl rounded-tr-xl'
          : 'bg-white/10 text-white border border-white/15 rounded-r-3xl rounded-tl-xl';
      const timestampClass = message.direction === 'outgoing' ? 'text-blue-100/80' : 'text-white/60';

      const media = message.media;
      const mediaType = media?.type ? mediaTypeLabels[media.type] || media.type : 'מדיה';
      const mediaIcon = resolveMediaIcon(media?.type);
      const mediaSize = formatFileSize(media?.size_bytes);

      const textToRender =
        media && media.caption && media.caption === message.text ? null : message.text;

      return (
        <React.Fragment key={key}>
          {showDateSeparator && dateLabel && (
            <div className="flex justify-center py-2">
              <div className="rounded-full border border-white/10 bg-white/10 px-4 py-1 text-xs text-white/70">
                {dateLabel}
              </div>
            </div>
          )}
          <div className={`flex ${alignment}`}>
            <div className={`max-w-[75%] space-y-2 px-4 py-3 shadow-xl ${bubbleColors}`}>
              {message.via_bot && (
                <div className="text-xs text-white/70">נשלח דרך בוט: @{message.via_bot}</div>
              )}
              {textToRender && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{textToRender}</p>
              )}
              {media && (
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/10 px-3 py-2">
                  {React.createElement(mediaIcon, { className: 'mt-0.5 h-5 w-5 shrink-0' })}
                  <div className="flex flex-col gap-1 text-xs text-white/90">
                    <span className="font-medium">{mediaType}</span>
                    {media.file_name && <span className="text-white/70">{media.file_name}</span>}
                    {(mediaSize || media.mime_type) && (
                      <span className="text-white/50">
                        {mediaSize}
                        {mediaSize && media.mime_type ? ' · ' : ''}
                        {media.mime_type}
                      </span>
                    )}
                    {media.caption && <span className="text-white/70 whitespace-pre-wrap">{media.caption}</span>}
                  </div>
                </div>
              )}
              <div className={`mt-1 flex items-center justify-between text-xs ${timestampClass}`}>
                <span>{message.direction === 'outgoing' ? 'אתה' : 'איש הקשר'}</span>
                <span>
                  {hasTimestamp
                    ? formatTimestamp(message.timestamp, { hour: '2-digit', minute: '2-digit', second: undefined })
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </React.Fragment>
      );
    });
  }, [formatTimestamp, historyMessages]);

  if (!portalRoot || !isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1900] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[90vw] max-h-[90vh] overflow-hidden rounded-3xl border border-white/10 glass-elevated"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/10 bg-white/5 px-6 py-4" dir="rtl">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500/20 text-blue-300">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">הודעות אחרונות</h2>
              <p className="text-sm text-white/60">
                מעבר מהיר בין הודעות נכנסות לבין היסטוריית משתמש פרטנית.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-red-500/70 hover:text-white"
            title="סגור חלון"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <section className="border-b border-white/10 bg-white/5 px-6 py-4" dir="rtl">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('incoming')}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm transition ${
                activeTab === 'incoming'
                  ? 'bg-blue-500/80 text-white shadow-lg shadow-blue-500/40'
                  : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              <Clock className="h-4 w-4" />
              הודעות נכנסות
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm transition ${
                activeTab === 'history'
                  ? 'bg-purple-500/80 text-white shadow-lg shadow-purple-500/40'
                  : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              <History className="h-4 w-4" />
              הסטוריית משתמש
            </button>
          </div>

          {activeTab === 'incoming' ? (
            <>
              <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-3 text-sm text-white/80">
                  <label htmlFor="recent-dm-limit" className="font-medium">
                    מספר הודעות לטעינה (1-50)
                  </label>
                  <input
                    id="recent-dm-limit"
                    type="number"
                    min={1}
                    max={50}
                    value={incomingLimitInput}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      if (Number.isNaN(parsed)) {
                        setIncomingLimitInput(1);
                      } else {
                        setIncomingLimitInput(Math.max(1, Math.min(50, parsed)));
                      }
                    }}
                    className="w-24 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-right text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-white/50">
                    הטעינה האחרונה:{' '}
                    {incomingLoadedAt
                      ? formatTimestamp(incomingLoadedAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => loadIncomingMessages(incomingLimitInput)}
                    className="btn-secondary flex items-center gap-2"
                    disabled={incomingLoading}
                  >
                    <RefreshCw className={`h-4 w-4 ${incomingLoading ? 'animate-spin' : ''}`} />
                    טען הודעות
                  </button>
                </div>
              </div>
              <div className="mt-3 rounded-xl bg-white/10 px-4 py-3 text-xs text-white/60">
                הרצה ראשונה עשויה להימשך מעט כיוון שאנו עוברים על כל הדיאלוגים הפעילים ומדלגים על הודעות שנשלחו על־ידך. בפעם הבאה נטען מהר יותר באמצעות המטמון המקומי.
              </div>
            </>
          ) : (
            <>
              <form onSubmit={handleHistorySubmit} className="mt-4 flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="history-username" className="flex items-center gap-1 text-sm font-medium text-white">
                      <User className="h-4 w-4 text-white/70" />
                      שם משתמש
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="history-username"
                        type="text"
                        placeholder="לדוגמה: example_user"
                        value={historyUsername}
                        onChange={(event) => setHistoryUsername(event.target.value)}
                        className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-right text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                      <button
                        type="button"
                        onClick={() => verifyHistoryUsername()}
                        className="btn-secondary whitespace-nowrap px-4 py-2 text-sm"
                        disabled={verificationStatus === 'pending'}
                      >
                        {verificationStatus === 'pending' ? (
                          <span className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            מאמת...
                          </span>
                        ) : (
                          'אימות'
                        )}
                      </button>
                    </div>
                    <div className="min-h-[18px] pt-1 text-right">
                      {verificationFeedback}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="history-chat-id" className="flex items-center gap-1 text-sm font-medium text-white">
                      <User className="h-4 w-4 text-white/70" />
                      Chat ID (אופציונלי)
                    </label>
                    <input
                      id="history-chat-id"
                      type="text"
                      placeholder="לדוגמה: 123456789"
                      value={historyChatId}
                      onChange={(event) => setHistoryChatId(event.target.value)}
                      className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-right text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <div className="min-h-[18px] pt-1 text-right text-xs text-white/50">
                      או הזן Chat ID במקום שם משתמש
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="history-range" className="text-sm font-medium text-white">
                      טווח היסטוריה
                    </label>
                    <select
                      id="history-range"
                      value={historyRangeDays}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        if (Number.isNaN(parsed)) {
                          setHistoryRangeDays(DEFAULT_HISTORY_RANGE);
                        } else {
                          setHistoryRangeDays(Math.max(1, parsed));
                        }
                      }}
                      className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-right text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      {HISTORY_RANGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="history-limit" className="text-sm font-medium text-white">
                      מספר הודעות (1-1000)
                    </label>
                    <input
                      id="history-limit"
                      type="number"
                      min={1}
                      max={1000}
                      value={historyLimit}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        if (Number.isNaN(parsed)) {
                          setHistoryLimit(50);
                        } else {
                          setHistoryLimit(Math.max(1, Math.min(1000, parsed)));
                        }
                      }}
                      className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-right text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/60">
                  <span>
                    התאריך והשעה מגדירים את נקודת העצירה. ללא שעה נטען עד סוף היום הנבחר.
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      className="btn-secondary flex items-center gap-2"
                      disabled={historyLoading}
                    >
                      <History className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
                      הצג היסטוריה
                    </button>
                  </div>
                </div>
              </form>
              <div className="mt-3 rounded-xl bg-white/10 px-4 py-3 text-xs text-white/60">
                ההיסטוריה שתיטען כוללת הודעות נכנסות ויוצאות, כולל מדיה, עבור {selectedHistoryRange?.label || 'הטווח שנבחר'} (עד {historyLimit} הודעות). ניתן להתנסות בטווחים שונים כדי למצוא את ההתכתבות הרצויה.
              </div>
            </>
          )}
        </section>

        <main className="h-[60vh] overflow-y-auto px-6 py-4" dir="rtl">
          {activeTab === 'incoming' ? (
            incomingLoading ? (
              <div className="flex h-full flex-col items-center justify-center space-y-3 text-white/70">
                <Loader className="h-8 w-8 animate-spin text-blue-300" />
                <p>טוען הודעות נכנסות...</p>
              </div>
            ) : incomingError ? (
              <div className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-center text-sm text-red-100">
                {incomingError}
              </div>
            ) : incomingMessages.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center text-sm text-white/60">
                לא נמצאו הודעות בפרק הזמן המבוקש.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-white/10 text-sm text-white/80">
                <thead>
                  <tr className="text-right text-xs uppercase tracking-wide text-white/50">
                    <th className="py-3 pr-3 font-medium">תאריך ושעה</th>
                    <th className="py-3 font-medium">שולח</th>
                    <th className="py-3 font-medium">{incomingUsernameLabel}</th>
                    <th className="py-3 font-medium">Chat ID</th>
                    <th className="py-3 font-medium">תוכן ההודעה</th>
                    <th className="py-3 font-medium">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {incomingMessages.map((message) => {
                    const displayName =
                      message.chat_name ||
                      [message.first_name, message.last_name].filter(Boolean).join(' ') ||
                      'ללא שם';
                    const username = message.username ? `@${message.username}` : '—';
                    return (
                      <tr
                        key={`${message.chat_id}-${message.message_id}`}
                        className="transition hover:bg-white/5"
                      >
                        <td className="py-3 pr-3 align-top text-xs text-white/70">
                          {formatTimestamp(message.timestamp)}
                        </td>
                        <td className="py-3 align-top font-semibold text-white">{displayName}</td>
                        <td className="py-3 align-top text-xs text-white/60">{username}</td>
                        <td className="py-3 align-top text-xs text-white/50 font-mono">
                          {message.chat_id}
                        </td>
                        <td className="py-3 align-top text-sm text-white/80">
                          {message.message_text || '—'}
                        </td>
                        <td className="py-3 align-top">
                          <button
                            onClick={() => {
                              setActiveTab('history');
                              // Set username and chat_id
                              if (message.username) {
                                setHistoryUsername(message.username);
                              } else {
                                setHistoryUsername('');
                              }
                              if (message.chat_id) {
                                setHistoryChatId(String(message.chat_id));
                              } else {
                                setHistoryChatId('');
                              }
                              // Trigger search after a short delay to let state update
                              setTimeout(() => {
                                loadUserHistory();
                              }, 100);
                            }}
                            className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                            title="חפש היסטוריה עבור משתמש זה"
                          >
                            היסטוריה
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : historyLoading ? (
            <div className="flex h-full flex-col items-center justify-center space-y-3 text-white/70">
              <Loader className="h-8 w-8 animate-spin text-purple-300" />
              <p>טוען היסטוריית משתמש...</p>
            </div>
          ) : historyError ? (
            <div className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-center text-sm text-red-100">
              {historyError}
            </div>
          ) : historyMessages.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center text-sm text-white/60">
              {historyMeta
                ? `לא נמצאו הודעות ב${historyRequestInfo.rangeLabel || 'טווח שנבחר'}. נסו להרחיב את הטווח או להגדיל את מספר ההודעות.`
                : 'הזינו שם משתמש, אימתו אותו ובחרו טווח כדי להציג היסטוריה.'}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {historyMeta && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
                  <div className="flex items-center gap-2 text-sm text-white">
                    <User className="h-4 w-4 text-white/60" />
                    <span>{historyTargetDisplay}</span>
                    {historyMeta.username && <span className="text-white/60">@{historyMeta.username}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-right">
                    {lastHistoryLoadedAt && (
                      <span>
                        עודכן{' '}
                        {formatTimestamp(lastHistoryLoadedAt, {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </span>
                    )}
                    {historyRequestInfo.fromDate && historyRequestInfo.toDate && (
                      <span>
                        {formatTimestamp(historyRequestInfo.fromDate, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                        {' – '}
                        {formatTimestamp(historyRequestInfo.toDate, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    )}
                    {historyRequestInfo.rangeLabel && (
                      <span>({historyRequestInfo.rangeLabel})</span>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3">{historyMessageList}</div>
            </div>
          )}
        </main>

        <footer className="border-t border-white/10 bg-white/5 px-6 py-3 text-right text-xs text-white/40" dir="rtl">
          {activeTab === 'incoming' ? (
            <>
              מציג {incomingMessages.length} הודעות נכנסות אחרונות (בקשה אחרונה: {incomingActiveLimit} הודעות
              {incomingLoadedAt
                ? `, עודכן ${formatTimestamp(incomingLoadedAt, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}`
                : ''}).
            </>
          ) : historyMessages.length > 0 ? (
            <>
              נשלפו {historyMessages.length} הודעות{historyRequestInfo.rangeLabel ? ` ב${historyRequestInfo.rangeLabel}` : ''}.
              {historyRequestInfo.fromDate && historyRequestInfo.toDate
                ? ` (${formatTimestamp(historyRequestInfo.fromDate, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })} – ${formatTimestamp(historyRequestInfo.toDate, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })})`
                : ''}
              {historyHasMore ? ' קיימות הודעות נוספות מעבר להגבלה שנקבעה.' : ''}
            </>
          ) : (
            <>הזינו שם משתמש מאומת ובחרו טווח כדי להציג את ההיסטוריה.</>
          )}
        </footer>
      </div>
    </div>,
    portalRoot
  );
};

export default RecentDirectMessagesModal;
