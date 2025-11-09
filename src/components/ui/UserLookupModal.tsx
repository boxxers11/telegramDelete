import React, { useMemo, useState, useCallback } from 'react';
import { X, Search, AlertTriangle, Loader, Users, Info } from 'lucide-react';
import type { Account } from '../../hooks/useAccounts';

interface LookupMessage {
  id: number;
  timestamp: string | null;
  from_me: boolean;
  text: string;
  raw_type: string;
}

interface LookupResult {
  account_id: string;
  account_label: string;
  status: 'pending' | 'ok' | 'error' | 'not_connected';
  conversation_state:
    | 'unknown'
    | 'no_conversation'
    | 'no_messages'
    | 'history_deleted'
    | 'active'
    | 'not_authenticated';
  target_user?: {
    id: number;
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    is_bot?: boolean;
  } | null;
  matched_by?: string | null;
  messages: LookupMessage[];
  summary_text?: string | null;
  last_message?: LookupMessage | null;
  last_message_at?: string | null;
  notes?: string | null;
  error?: string | null;
  lookup_errors?: string[] | null;
}

interface UserLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
}

const statusLabels: Record<string, { label: string; className: string }> = {
  ok: { label: 'נבדק', className: 'bg-green-500/20 text-green-200 border-green-500/30' },
  error: { label: 'שגיאה', className: 'bg-red-500/20 text-red-200 border-red-500/30' },
  not_connected: { label: 'לא מחובר', className: 'bg-yellow-500/20 text-yellow-200 border-yellow-500/30' },
  pending: { label: 'בהמתנה', className: 'bg-gray-500/20 text-gray-200 border-gray-500/30' }
};

const conversationLabels: Record<string, { title: string; description: string; accent: string }> = {
  active: {
    title: 'נמצאה שיחה פעילה',
    description: 'נמצאו הודעות אחרונות עם המשתמש שביקשת',
    accent: 'text-green-300'
  },
  history_deleted: {
    title: 'נמצא צ׳אט, אך אין הודעות',
    description: 'יתכן שההודעות נמחקו או שהצ׳אט ריק כרגע',
    accent: 'text-yellow-300'
  },
  no_messages: {
    title: 'נמצא משתמש ללא היסטוריה',
    description: 'המשתמש קיים אך אין היסטוריית הודעות זמינה',
    accent: 'text-blue-200'
  },
  no_conversation: {
    title: 'לא נמצאה שיחה',
    description: 'אין אינטראקציה ידועה בחשבון זה עם המשתמש המבוקש',
    accent: 'text-gray-300'
  },
  not_authenticated: {
    title: 'החשבון לא מחובר לטלגרם',
    description: 'יש להיכנס לחשבון כדי לבצע בדיקות',
    accent: 'text-yellow-300'
  },
  unknown: {
    title: 'לא ידוע',
    description: 'לא התאפשר לקבוע את מצב השיחה',
    accent: 'text-gray-300'
  }
};

const parseUserIds = (input: string): string[] => {
  return input
    .split(/[\s,\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'לא ידוע';
  try {
    return new Date(value).toLocaleString('he-IL');
  } catch (error) {
    return value;
  }
};

const UserLookupModal: React.FC<UserLookupModalProps> = ({ isOpen, onClose, accounts }) => {
  const [username, setUsername] = useState('');
  const [userIdText, setUserIdText] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<LookupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<{ username?: string | null; user_ids?: string[] } | null>(null);
  const [activityLog, setActivityLog] = useState<string[]>([]);

  const appendLog = useCallback((...entries: string[]) => {
    setActivityLog((prev) => [...entries, ...prev].slice(0, 25));
  }, []);

  const userIdList = useMemo(() => parseUserIds(userIdText), [userIdText]);

  if (!isOpen) return null;

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  const resetForm = () => {
    setUsername('');
    setUserIdText('');
    setSelectedAccounts(new Set());
    setResults([]);
    setLoading(false);
    setError(null);
    setLastQuery(null);
    setActivityLog([]);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleLookup = async () => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername && userIdList.length === 0) {
      setError('אנא הזן שם משתמש או מזהה משתמש לפחות.');
      return;
    }

    const chosenAccounts = accounts
      .filter((account) => selectedAccounts.has(account.id))
      .map((account) => account.label);

    const summaryParts: string[] = [];
    if (trimmedUsername) summaryParts.push(`שם משתמש: @${trimmedUsername}`);
    if (userIdList.length > 0) summaryParts.push(`מזהים: ${userIdList.join(', ')}`);
    summaryParts.push(
      chosenAccounts.length > 0 ? `חשבונות: ${chosenAccounts.join(', ')}` : 'חשבונות: כל המחוברים'
    );

    appendLog(`🚀 מתחיל בדיקה (${summaryParts.join(' | ')})`);

    setLoading(true);
    setError(null);
    setResults([]);

    const payload: Record<string, unknown> = {
      max_messages: 6
    };

    if (trimmedUsername) {
      payload.username = trimmedUsername;
    }

    if (userIdList.length > 0) {
      payload.user_ids = userIdList;
    }

    if (selectedAccounts.size > 0) {
      payload.account_ids = Array.from(selectedAccounts);
    }

    try {
      appendLog('📡 שולח בקשה לשרת…');
      const response = await fetch('http://127.0.0.1:8001/user-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.detail || data.error || 'בקשה נכשלה');
      }

      setResults(data.results || []);
      setLastQuery({ username: data.query?.username, user_ids: data.query?.user_ids });

      const perAccount =
        Array.isArray(data.results) && data.results.length > 0
          ? data.results.map(
              (result: LookupResult) =>
                `🔎 ${result.account_label}: ${statusLabels[result.status]?.label ?? 'מצב לא ידוע'}`
            )
          : ['ℹ️ לא נמצאו תוצאות בחשבונות שנבחרו'];

      appendLog(`✅ התקבלו תוצאות עבור ${(data.results || []).length} חשבונות`, ...perAccount);
    } catch (fetchError) {
      const message = (fetchError as Error).message || 'שגיאת רשת בבדיקת המשתמש';
      setError(message);
      appendLog(`❌ ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-elevated w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/10 p-6">
          <div className="flex items-center gap-3">
            <div className="glass-card rounded-xl p-3">
              <Users className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">בדיקת משתמש בכל החשבונות</h2>
              <p className="text-sm text-white/70">
                הזן שם משתמש (עם או בלי @) או מזהה משתמש, והמערכת תבדוק בכל החשבונות אם התקיימה שיחה.
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="glass-card rounded-xl p-3 hover:bg-white/10">
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        <div className="grid h-[calc(90vh-140px)] grid-cols-[360px,1fr] divide-x divide-white/10">
          <div className="flex flex-col gap-6 overflow-y-auto p-6">
            <div>
              <label className="mb-2 block text-sm font-semibold text-white">שם משתמש</label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="לדוגמה: username או @username"
                className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-white">מזהה משתמש (ID)</label>
              <textarea
                value={userIdText}
                onChange={(event) => setUserIdText(event.target.value)}
                placeholder="לדוגמה: 994904781 או 994,904,781"
                rows={3}
                className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
              {userIdList.length > 0 && (
                <div className="mt-1 text-xs text-white/50">
                  מזוהים {userIdList.length} מזהים: {userIdList.join(', ')}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/70">
              <div className="mb-2 flex items-center gap-2 text-sm text-white">
                <Info className="h-4 w-4 text-blue-300" />
                טיפים
              </div>
              <ul className="list-disc space-y-1 pr-4">
                <li>ניתן להזין גם שם משתמש וגם מזהה – החיפוש ייעשה לפי כל האפשרויות.</li>
                <li>אם לא תבחר חשבונות, כל החשבונות המחוברים ייסרקו אוטומטית.</li>
                <li>במקרה שהשיחה קיימת אך ההודעות נמחקו, תקבל אינדיקציה על כך.</li>
              </ul>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-white">סינון חשבונות (אופציונלי)</h4>
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3 max-h-48 overflow-y-auto">
                {accounts.length === 0 ? (
                  <div className="text-sm text-white/50">אין חשבונות במערכת.</div>
                ) : (
                  accounts.map((account) => (
                    <label key={account.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
                      <div>
                        <div className="font-medium">{account.label}</div>
                        <div className="text-xs text-white/50">{account.phone}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={selectedAccounts.has(account.id)}
                        onChange={() => toggleAccount(account.id)}
                        disabled={loading}
                        className="h-4 w-4 rounded border-white/30 bg-transparent"
                      />
                    </label>
                  ))
                )}
              </div>
              <div className="mt-1 text-xs text-white/50">ללא בחירה = כל החשבונות הפעילים.</div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleLookup}
                disabled={loading}
                className="btn-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                הפעל בדיקה
              </button>
              <button
                onClick={resetForm}
                disabled={loading}
                className="btn-secondary flex items-center justify-center gap-2"
              >
                איפוס
              </button>
            </div>
          </div>

          <div className="overflow-y-auto p-6">
            {activityLog.length > 0 && (
              <div className="mb-4 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
                <h4 className="text-sm font-semibold text-blue-200 mb-2">לוג בזמן אמת</h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {activityLog.map((entry, index) => (
                    <div
                      key={index}
                      className={`text-xs ${index === 0 ? 'text-blue-100' : 'text-white/60'}`}
                    >
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-white/70">
                  <Loader className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-300" />
                  מבצע בדיקה בכל החשבונות...
                </div>
              </div>
            )}

            {!loading && lastQuery && (
              <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                <div className="mb-1 text-white/90">סיכום הבדיקה האחרונה:</div>
                {lastQuery.username && <div>שם משתמש: @{lastQuery.username}</div>}
                {lastQuery.user_ids && lastQuery.user_ids.length > 0 && (
                  <div>מזהים שנבדקו: {lastQuery.user_ids.join(', ')}</div>
                )}
              </div>
            )}

            {!loading && results.length === 0 && !error && (
              <div className="flex h-full items-center justify-center text-center text-white/50">
                <div>
                  <Search className="mx-auto mb-3 h-10 w-10 text-white/30" />
                  <p>הזן שם משתמש או מזהה והפעל בדיקה כדי לראות תוצאות.</p>
                </div>
              </div>
            )}

            {!loading && results.length > 0 && (
              <div className="space-y-4">
                {results.map((result) => {
                  const statusMeta = statusLabels[result.status] || statusLabels.pending;
                  const conversationMeta = conversationLabels[result.conversation_state] || conversationLabels.unknown;

                  return (
                    <div key={result.account_id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold text-white">{result.account_label}</h3>
                            <span className={`rounded-full border px-3 py-1 text-xs ${statusMeta.className}`}>
                              {statusMeta.label}
                            </span>
                          </div>
                          <div className={`text-sm ${conversationMeta.accent}`}>{conversationMeta.title}</div>
                          <div className="text-xs text-white/50">{conversationMeta.description}</div>
                          {result.target_user && (
                            <div className="mt-2 text-xs text-white/60">
                              מזהה: {result.target_user.id}
                              {result.target_user.username && ` • @${result.target_user.username}`}
                              {result.target_user.is_bot && ' • בוט'}
                            </div>
                          )}
                          {result.matched_by && (
                            <div className="text-xs text-white/40">התאמה לפי: {result.matched_by}</div>
                          )}
                        </div>
                      </div>

                      {result.summary_text && (
                        <div className="mb-4 rounded-xl border border-white/10 bg-white/10 p-3 text-sm text-white/80">
                          <div className="mb-2 text-xs text-white/50">תקציר אחרון:</div>
                          <pre className="whitespace-pre-line text-sm">{result.summary_text}</pre>
                        </div>
                      )}

                      {result.notes && (
                        <div className="mb-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-100">
                          {result.notes}
                        </div>
                      )}

                      {result.error && (
                        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                          {result.error}
                        </div>
                      )}

                      {Array.isArray(result.lookup_errors) && result.lookup_errors.length > 0 && (
                        <details className="mb-3">
                          <summary className="cursor-pointer text-xs text-white/50 hover:text-white/70">
                            שגיאות חיפוש נוספות
                          </summary>
                          <ul className="mt-2 space-y-1 text-xs text-red-200">
                            {result.lookup_errors.map((lookupError, index) => (
                              <li key={index}>{lookupError}</li>
                            ))}
                          </ul>
                        </details>
                      )}

                      {result.messages.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs text-white/40">
                            {result.last_message_at ? `הודעה אחרונה: ${formatTimestamp(result.last_message_at)}` : 'הודעות שנמצאו'}
                          </div>
                          <div className="space-y-2">
                            {result.messages.map((message) => (
                              <div
                                key={message.id}
                                className={`rounded-xl border p-3 text-sm ${
                                  message.from_me ? 'border-blue-500/30 bg-blue-500/10 text-blue-100' : 'border-white/10 bg-white/5 text-white/80'
                                }`}
                              >
                                <div className="mb-1 text-xs text-white/50">{formatTimestamp(message.timestamp)}</div>
                                <div className="font-medium">{message.from_me ? 'אתה:' : 'איש הקשר:'}</div>
                                <div>{message.text}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {result.messages.length === 0 && !result.error && (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                          אין הודעות להצגה עבור חשבון זה.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserLookupModal;
