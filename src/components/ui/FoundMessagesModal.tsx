import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Loader, Trash2, ExternalLink, MessageSquare } from 'lucide-react';

interface FoundMessagesModalProps {
  accountId: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigateToGroup: (chatId: number, chatTitle: string) => void;
}

interface FoundMessageRow {
  key: string;
  chatId: number;
  chatTitle: string;
  messageId: number;
  content: string;
  date: string;
  foundAt?: string;
  link?: string | null;
  status: 'pending' | 'deleted' | 'failed';
}

interface GlobalDeleteItem {
  key: string;
  chatId: number;
  chatTitle: string;
  messageId: number;
  status: 'deleted' | 'failed';
  error?: string;
}

const FoundMessagesModal: React.FC<FoundMessagesModalProps> = ({
  accountId,
  isOpen,
  onClose,
  onNavigateToGroup
}) => {
  const [items, setItems] = useState<FoundMessageRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState<'foundAt:desc' | 'foundAt:asc'>('foundAt:desc');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [summary, setSummary] = useState<{
    totalMessages: number;
    groups: Array<{ chatId: number; chatTitle: string; total: number }>;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteQueue, setDeleteQueue] = useState<GlobalDeleteItem[]>([]);
  const [deleteProcessed, setDeleteProcessed] = useState(0);
  const [deleteSummary, setDeleteSummary] = useState<{
    totalDeleted: number;
    totalFailed: number;
    failedMessages: Array<{ chat_id: number; message_id: number; reason: string }>;
  } | null>(null);

  const resetModalState = useCallback(() => {
    setItems([]);
    setNextCursor(null);
    setError(null);
    setDeleteQueue([]);
    setDeleteProcessed(0);
    setDeleteSummary(null);
    setIsDeleting(false);
  }, []);

  const loadMessages = useCallback(
    async (reset: boolean, cursorValue: string | null = null, overrideSearch?: string, overrideGroup?: string, overrideSort?: string) => {
      const effectiveSearch = overrideSearch ?? searchTerm;
      const effectiveGroup = overrideGroup ?? groupFilter;
      const effectiveSort = overrideSort ?? sort;

      setLoading(true);
      if (reset) {
        setItems([]);
        setNextCursor(null);
        setDeleteSummary(null);
      }

      const params = new URLSearchParams();
      params.set('limit', '100');
      params.set('sort', effectiveSort);
      if (effectiveSearch) {
        params.set('query', effectiveSearch);
      }
      if (effectiveGroup && effectiveGroup !== 'all') {
        params.set('groupId', effectiveGroup);
      }
      if (cursorValue) {
        params.set('cursor', cursorValue);
      }

      try {
        const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/found-messages?${params.toString()}`);
        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'טעינת ההודעות נכשלה');
        }

        const mapped: FoundMessageRow[] = (data.items || []).map((item: any) => ({
          key: item.key ?? `${item.chatId}:${item.messageId}`,
          chatId: item.chatId,
          chatTitle: item.chatTitle,
          messageId: item.messageId,
          content: item.content ?? '',
          date: item.date ?? item.foundAt ?? new Date().toISOString(),
          foundAt: item.foundAt ?? undefined,
          link: item.link ?? null,
          status: item.status ?? (item.deleted ? 'deleted' : 'pending')
        }));

        setItems(prev => (reset ? mapped : [...prev, ...mapped]));
        setNextCursor(data.next_cursor ?? null);
        setSummary(data.summary ?? null);
        setError(null);
      } catch (fetchError: any) {
        setError(fetchError?.message || 'שגיאה בטעינת ההודעות');
      } finally {
        setLoading(false);
      }
    },
    [accountId, groupFilter, searchTerm, sort]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    resetModalState();
    loadMessages(true, null, searchTerm, groupFilter, sort);
  }, [isOpen, loadMessages, resetModalState, searchTerm, groupFilter, sort]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput, isOpen]);

  const canLoadMore = Boolean(nextCursor);

  const handleLoadMore = () => {
    if (!nextCursor || loading) {
      return;
    }
    loadMessages(false, nextCursor);
  };

  const toggleSort = () => {
    setSort(prev => (prev === 'foundAt:desc' ? 'foundAt:asc' : 'foundAt:desc'));
  };

  const groupOptions = useMemo(() => {
    const base = [{ value: 'all', label: 'כל הקבוצות' }];
    if (!summary?.groups) {
      return base;
    }
    return [
      ...base,
      ...summary.groups.map(group => ({
        value: String(group.chatId),
        label: `${group.chatTitle} (${group.total})`
      }))
    ];
  }, [summary]);

  const handleModalDeleteAll = useCallback(async () => {
    if (!items.length) {
      setError('אין הודעות למחיקה.');
      return;
    }
    if (!confirm('האם למחוק את כל ההודעות שנמצאו בכל הקבוצות?')) {
      return;
    }

    setIsDeleting(true);
    setDeleteQueue([]);
    setDeleteProcessed(0);
    setDeleteSummary(null);

    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/delete-all-found-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'שגיאה במחיקה הגלובלית');
      }

      const queue: GlobalDeleteItem[] = [];
      (data.chat_results || []).forEach((chatResult: any) => {
        const chatId = chatResult.chat_id;
        const chatTitle = chatResult.chat_title ?? '';
        (chatResult.results || []).forEach((result: any) => {
          if (typeof result.message_id === 'number') {
            queue.push({
              key: `${chatId}:${result.message_id}`,
              chatId,
              chatTitle,
              messageId: result.message_id,
              status: result.status === 'deleted' ? 'deleted' : 'failed',
              error: result.error
            });
          }
        });
      });

      setDeleteQueue(queue);
      setDeleteSummary({
        totalDeleted: data.total_deleted || 0,
        totalFailed: data.total_failed || 0,
        failedMessages: data.failed_messages || []
      });

      if (!queue.length) {
        setIsDeleting(false);
        setItems([]);
        setSummary(prev => prev ? { ...prev, totalMessages: 0 } : prev);
      }
    } catch (deleteError: any) {
      setError(deleteError?.message || 'שגיאה במחיקה');
      setIsDeleting(false);
    }
  }, [accountId, items.length]);

  useEffect(() => {
    if (!isDeleting) {
      return;
    }
    if (!deleteQueue.length) {
      return;
    }
    if (deleteProcessed >= deleteQueue.length) {
      setIsDeleting(false);
      setItems(prev => prev.filter(item => item.status !== 'deleted'));
      setSummary(prev => prev ? { ...prev, totalMessages: Math.max(0, prev.totalMessages - (deleteSummary?.totalDeleted || 0)) } : prev);
      return;
    }

    const timer = window.setTimeout(() => {
      setItems(prev =>
        prev.map(item => {
          const queueItem = deleteQueue[deleteProcessed];
          if (item.key === queueItem.key) {
            return {
              ...item,
              status: queueItem.status
            };
          }
          return item;
        })
      );
      setDeleteProcessed(prev => prev + 1);
    }, 40);

    return () => window.clearTimeout(timer);
  }, [deleteProcessed, deleteQueue, deleteSummary, isDeleting]);

  const totalPending = useMemo(() => items.filter(item => item.status !== 'deleted').length, [items]);

  const closeHandler = () => {
    if (isDeleting) {
      return;
    }
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-advanced relative max-h-[90vh] w-full max-w-5xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-white">כל ההודעות שנמצאו</h2>
            <p className="text-sm text-white/60">
              סה\"כ הודעות ממתינות: {summary?.totalMessages ?? totalPending}
            </p>
          </div>
          <button
            onClick={closeHandler}
            className="rounded-full border border-white/20 p-2 text-white/80 hover:text-white"
            disabled={isDeleting}
            title="סגור"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-white/10 px-6 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <div className="flex flex-1 items-center rounded-full border border-white/15 bg-white/5 px-3 py-2">
                <Search className="h-4 w-4 text-white/50" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="ml-2 w-full bg-transparent text-sm text-white placeholder-white/40 focus:outline-none"
                  placeholder="חפש טקסט הודעה..."
                  disabled={isDeleting}
                />
              </div>
              <button
                onClick={toggleSort}
                className="rounded-full border border-white/15 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                disabled={isDeleting}
              >
                סדר כרונולוגי: {sort === 'foundAt:desc' ? 'מהחדש לישן' : 'מהישן לחדש'}
              </button>
            </div>
            <div>
              <select
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                disabled={isDeleting}
              >
                {groupOptions.map(option => (
                  <option key={option.value} value={option.value} className="text-black">
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {deleteSummary && (
          <div className="mx-6 mt-4 rounded-xl border border-blue-400/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
            <p>סה\"כ נמחקו {deleteSummary.totalDeleted} הודעות.</p>
            {deleteSummary.totalFailed > 0 && (
              <p>כשלים: {deleteSummary.totalFailed}</p>
            )}
          </div>
        )}

        <div className="overflow-y-auto px-6 py-4" style={{ maxHeight: '55vh' }}>
          {loading && !items.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/70">
              <Loader className="mb-3 h-8 w-8 animate-spin" />
              טוען הודעות...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/60">
              <MessageSquare className="mb-2 h-10 w-10" />
              אין הודעות להצגה
            </div>
          ) : (
            <table className="min-w-full text-sm text-white">
              <thead className="sticky top-0 bg-[#0F172A]/80 backdrop-blur-sm">
                <tr className="text-xs uppercase text-white/60">
                  <th className="px-3 py-2 text-right">שעה</th>
                  <th className="px-3 py-2 text-right">ההודעה</th>
                  <th className="px-3 py-2 text-right">קבוצה</th>
                  <th className="px-3 py-2 text-right">תאריך</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr
                    key={item.key}
                    className={`border-b border-white/10 text-sm transition-colors ${item.status === 'deleted' ? 'opacity-60' : 'opacity-100'}`}
                  >
                    <td className="px-3 py-2 text-white/70">
                      {new Date(item.date).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 text-white">
                      <div className="max-w-xs whitespace-pre-wrap break-words">{item.content}</div>
                      {item.status === 'failed' && (
                        <div className="text-xs text-red-300">לא נמחקה</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-blue-300">
                      <button
                        onClick={() => onNavigateToGroup(item.chatId, item.chatTitle)}
                        className="flex items-center gap-1 underline-offset-2 hover:underline"
                        disabled={isDeleting}
                      >
                        {item.chatTitle}
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-white/70">
                      {new Date(item.date).toLocaleDateString('he-IL')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {canLoadMore && !loading && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={handleLoadMore}
                className="btn-secondary px-4 py-2"
                disabled={loading || isDeleting}
              >
                טען עוד
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handleModalDeleteAll}
              className="btn-destructive flex items-center gap-2 px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={isDeleting || !items.length}
            >
              {isDeleting ? <Loader className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              מחק את כל ההודעות
            </button>
            <span className="text-xs text-white/50">
              מציג {items.length} הודעות מתוך {summary?.totalMessages ?? items.length}
            </span>
          </div>

          {isDeleting && deleteQueue.length > 0 && (
            <div className="mt-4 rounded-xl border border-white/15 bg-white/5 p-4 text-xs text-white/70">
              <p className="mb-2">מתבצעת מחיקה... ({Math.min(deleteProcessed, deleteQueue.length)}/{deleteQueue.length})</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-400 to-purple-400 transition-all duration-150"
                  style={{ width: `${(Math.min(deleteProcessed, deleteQueue.length) / deleteQueue.length) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FoundMessagesModal;
