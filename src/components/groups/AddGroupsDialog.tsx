import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Loader2, ClipboardCheck, Link2, ListChecks, AlertCircle, XCircle, CheckCircle2, Clock, X } from 'lucide-react';
import HeaderFullScreen from '../ui/HeaderFullScreen';
import FileDropzone from './FileDropzone';
import { extractTelegramLinks, uniqueLinks } from '../../services/linkExtractor';
import { groupsStore, useGroupsAccountState } from '../../state/groups.store';

interface AddGroupsDialogProps {
  accountId: string;
  accountLabel?: string;
  isOpen: boolean;
  onClose: () => void;
}

type ImportedLink = {
  id: string;
  raw: string;
  normalized: string;
  type: 'invite' | 'username';
  selected: boolean;
  sourceFile?: string;
  error?: string;
};

const AddGroupsDialog: React.FC<AddGroupsDialogProps> = ({
  accountId,
  accountLabel,
  isOpen,
  onClose
}) => {
  const accountState = useGroupsAccountState(accountId);
  const [activeTab, setActiveTab] = useState<'links' | 'import'>('links');
  const [linkInput, setLinkInput] = useState('');
  const [importedLinks, setImportedLinks] = useState<ImportedLink[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [joinProgress, setJoinProgress] = useState<{
    isActive: boolean;
    currentIndex: number;
    total: number;
    currentLink: string | null;
    progressPercent: number;
    results: Array<{
      link: string;
      status: string;
      info: any;
      index: number;
      total: number;
    }>;
  } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setActiveTab('links');
      setLinkInput('');
      setImportedLinks([]);
      setFeedback(null);
      setError(null);
      setJoinProgress(null);
      // Close SSE connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  }, [isOpen]);

  // Listen to SSE events for join progress
  useEffect(() => {
    if (!isOpen || !joinProgress?.isActive) {
      return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(
      `http://127.0.0.1:8001/accounts/${accountId}/join-groups-events`
    );
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          console.log('Connected to join groups events');
        } else if (data.type === 'join_progress') {
          setJoinProgress((prev) =>
            prev
              ? {
                  ...prev,
                  currentIndex: data.current_index || 0,
                  total: data.total || 0,
                  currentLink: data.current_link || null,
                  progressPercent: data.progress_percent || 0
                }
              : null
          );
        } else if (data.type === 'join_result') {
          setJoinProgress((prev) => {
            if (!prev) return null;
            const existingResults = prev.results || [];
            const newResults = [...existingResults];
            const existingIndex = newResults.findIndex(
              (r) => r.index === data.index
            );
            if (existingIndex >= 0) {
              newResults[existingIndex] = data.result;
            } else {
              newResults.push(data.result);
            }
            return {
              ...prev,
              results: newResults
            };
          });
        } else if (data.type === 'join_complete') {
          setJoinProgress((prev) =>
            prev
              ? {
                  ...prev,
                  isActive: false,
                  results: data.results || []
                }
              : null
          );
          setFeedback(
            `התהליך הושלם: ${data.success_count || 0} הצטרפו, ${data.pending_count || 0} ממתינות לאישור, ${data.failed_count || 0} נכשלו`
          );
          eventSource.close();
          eventSourceRef.current = null;
        } else if (data.type === 'join_error') {
          setError(data.error || 'שגיאה בהצטרפות לקבוצות');
          setJoinProgress((prev) => (prev ? { ...prev, isActive: false } : null));
          eventSource.close();
          eventSourceRef.current = null;
        }
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      // Don't close on error, let it reconnect
    };

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [isOpen, accountId, joinProgress?.isActive]);

  const linkMatches = useMemo(() => {
    if (!linkInput.trim()) {
      return [];
    }
    return uniqueLinks(extractTelegramLinks(linkInput));
  }, [linkInput]);

  const selectedImported = useMemo(
    () => importedLinks.filter((link) => link.selected && !link.error).map((link) => link.raw),
    [importedLinks]
  );

  const handleSubmitLinks = async () => {
    if (!linkInput.trim()) {
      setError('הזן לפחות קישור אחד');
      return;
    }
    setError(null);
    setFeedback(null);
    const links = uniqueLinks(extractTelegramLinks(linkInput));

    // Initialize join progress
    setJoinProgress({
      isActive: true,
      currentIndex: 0,
      total: links.length,
      currentLink: null,
      progressPercent: 0,
      results: []
    });

    try {
      await groupsStore.joinFromText(accountId, linkInput);
      // Results will come via SSE
      setLinkInput('');
    } catch (joinError) {
      setError(
        joinError instanceof Error ? joinError.message : 'נכשלה ההצטרפות לקבוצות'
      );
      setJoinProgress(null);
    }
  };

  const handleImportFiles = async (files: FileList) => {
    setIsProcessingImport(true);
    setError(null);
    try {
      const collected: ImportedLink[] = [];
      for (const file of Array.from(files)) {
        try {
          const text = await file.text();
          const extracted = uniqueLinks(extractTelegramLinks(text));
          if (extracted.length === 0) {
            collected.push({
              id: `${file.name}-none`,
              raw: '',
              normalized: '',
              type: 'username',
              selected: false,
              sourceFile: file.name,
              error: 'לא נמצאו קישורים בקובץ'
            });
            continue;
          }
          extracted.forEach((link, index) => {
            collected.push({
              id: `${file.name}-${link.normalized}-${index}`,
              raw: link.raw,
              normalized: link.normalized,
              type: link.type,
              selected: true,
              sourceFile: file.name
            });
          });
        } catch (fileError) {
          collected.push({
            id: `${file.name}-error`,
            raw: '',
            normalized: '',
            type: 'username',
            selected: false,
            sourceFile: file.name,
            error:
              fileError instanceof Error
                ? fileError.message
                : 'שגיאה בקריאת הקובץ'
          });
        }
      }
      setImportedLinks((prev) => [...prev, ...collected]);
    } finally {
      setIsProcessingImport(false);
    }
  };

  const handleToggleImported = (id: string) => {
    setImportedLinks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item))
    );
  };

  const handleSubmitImport = async () => {
    if (selectedImported.length === 0) {
      setError('בחר לפחות קישור אחד מהייבוא');
      return;
    }
    setError(null);
    setFeedback(null);

    // Initialize join progress
    setJoinProgress({
      isActive: true,
      currentIndex: 0,
      total: selectedImported.length,
      currentLink: null,
      progressPercent: 0,
      results: []
    });

    try {
      await groupsStore.joinLinks(accountId, selectedImported);
      // Results will come via SSE
      setImportedLinks([]);
    } catch (joinError) {
      setError(
        joinError instanceof Error ? joinError.message : 'שגיאה במהלך ההצטרפות'
      );
      setJoinProgress(null);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[2300] bg-black/85 backdrop-blur-lg">
      <div className="flex min-h-screen flex-col">
        <HeaderFullScreen
          title="הוספת קבוצות"
          onBack={onClose}
          description={
            accountLabel ? `חשבון פעיל: ${accountLabel}` : 'בחר קבוצות להוספה או ייבוא'
          }
          actions={
            <div className="flex gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-white/70">
                {linkMatches.length} קישורים בטקסט
              </span>
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-white/70">
                {selectedImported.length} קישורים מיובאים
              </span>
            </div>
          }
        />

        <div className="border-b border-white/10 bg-white/5">
          <div className="flex justify-center px-6 pb-4">
            <div className="inline-flex rounded-xl bg-white/10 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('links')}
                className={`min-w-[140px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'links'
                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                לפי קישור
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('import')}
                className={`min-w-[180px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'import'
                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                מרשימה (ייבוא קובץ)
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8">
          {activeTab === 'links' ? (
            <div className="mx-auto max-w-4xl space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                  <Link2 className="h-5 w-5 text-blue-300" />
                  הדבקת קישורי קבוצות
                </h3>
                <p className="mb-4 text-sm text-white/60">
                  הדבק כאן קישורי t.me או @username — אפשר להדביק כמה שורות יחד. נבצע ניקוי כפילויות אוטומטי.
                </p>
                <textarea
                  value={linkInput}
                  onChange={(event) => setLinkInput(event.target.value)}
                  className="min-h-[160px] w-full rounded-3xl border border-white/15 bg-black/30 p-4 text-sm text-white placeholder-white/40 focus:border-white/40 focus:outline-none"
                  placeholder="@example או https://t.me/joinchat/..."
                />
                {linkMatches.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-white/70">
                    נמצאו {linkMatches.length} קישורים תקינים. לחיצה על "הצטרף לקבוצות" תפעיל תור הצטרפות אוטומטי עם הגנה מפני FLOOD_WAIT.
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleSubmitLinks}
                  disabled={accountState.joining}
                  className="mt-4 flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-500/90 disabled:opacity-60"
                >
                  {accountState.joining ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ClipboardCheck className="h-5 w-5" />
                  )}
                  הצטרף לקבוצות
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                  <ListChecks className="h-5 w-5 text-blue-300" />
                  ייבוא מקבצים
                </h3>
                <FileDropzone onFiles={handleImportFiles} />
                {isProcessingImport && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-white/60">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    קורא קבצים...
                  </div>
                )}
              </div>

              {importedLinks.length > 0 && (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-lg font-semibold text-white">
                      קישורים שזוהו ({importedLinks.filter((link) => !link.error).length})
                    </h4>
                    <div className="flex gap-2 text-xs text-white/60">
                      <span>נבחרו {selectedImported.length} קישורים</span>
                      <button
                        type="button"
                        onClick={() =>
                          setImportedLinks((prev) =>
                            prev.map((item) =>
                              item.error ? item : { ...item, selected: true }
                            )
                          )
                        }
                        className="underline hover:text-white"
                      >
                        בחר הכל
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setImportedLinks((prev) =>
                            prev.map((item) =>
                              item.error ? item : { ...item, selected: false }
                            )
                          )
                        }
                        className="underline hover:text-white"
                      >
                        נקה בחירה
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-white/10 bg-black/20">
                    <table className="min-w-full text-xs text-white">
                      <thead className="bg-white/10 text-white/60">
                        <tr>
                          <th className="px-4 py-2 text-right">קישור</th>
                          <th className="px-4 py-2 text-right">סוג</th>
                          <th className="px-4 py-2 text-right">קובץ מקור</th>
                          <th className="px-4 py-2 text-center">בחירה</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {importedLinks.map((link) => (
                          <tr key={link.id} className="hover:bg-white/5">
                            <td className="px-4 py-2">
                              {link.error ? (
                                <div className="flex items-center gap-2 text-rose-300">
                                  <XCircle className="h-4 w-4" />
                                  {link.error}
                                </div>
                              ) : (
                                <div>
                                  <div className="font-medium text-white">{link.raw}</div>
                                  <div className="text-white/40">{link.normalized}</div>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2">{link.type === 'invite' ? 'קישור הזמנה' : '@username'}</td>
                            <td className="px-4 py-2">{link.sourceFile || '—'}</td>
                            <td className="px-4 py-2 text-center">
                              {!link.error ? (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                                  checked={link.selected}
                                  onChange={() => handleToggleImported(link.id)}
                                />
                              ) : (
                                <span className="text-xs text-rose-300">שגיאה</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button
                    type="button"
                    onClick={handleSubmitImport}
                    disabled={accountState.joining || selectedImported.length === 0}
                    className="mt-4 flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-500/90 disabled:opacity-60"
                  >
                    {accountState.joining ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <ClipboardCheck className="h-5 w-5" />
                    )}
                    הצטרף לקבוצות הנבחרות
                  </button>
                </div>
              )}
            </div>
          )}

          {joinProgress?.isActive && (
            <div className="mx-auto mt-8 max-w-4xl">
              <div className="rounded-3xl border border-blue-400/30 bg-blue-500/10 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-white">
                    מצטרף לקבוצות...
                  </h4>
                  <span className="text-sm text-white/60">
                    {joinProgress.currentIndex}/{joinProgress.total}
                  </span>
                </div>
                <div className="mb-4 h-2 overflow-hidden rounded-full bg-black/30">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${joinProgress.progressPercent}%` }}
                  />
                </div>
                {joinProgress.currentLink && (
                  <div className="mb-4 text-sm text-white/80">
                    <span className="font-medium">מטפל כרגע ב:</span>{' '}
                    <span className="text-blue-300">{joinProgress.currentLink}</span>
                  </div>
                )}
                {joinProgress.results.length > 0 && (
                  <div className="max-h-[300px] overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="space-y-2">
                      {joinProgress.results.map((result, idx) => {
                        const statusIcon = {
                          joined: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
                          pending: <Clock className="h-4 w-4 text-yellow-400" />,
                          waiting: <Clock className="h-4 w-4 text-yellow-400" />,
                          failed: <X className="h-4 w-4 text-rose-400" />
                        }[result.status] || <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;

                        const statusText = {
                          joined: 'הצטרף בהצלחה',
                          pending: 'ממתין לאישור',
                          waiting: 'בהמתנה',
                          failed: 'נכשל'
                        }[result.status] || 'מעבד...';

                        return (
                          <div
                            key={idx}
                            className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm"
                          >
                            {statusIcon}
                            <div className="flex-1">
                              <div className="font-medium text-white">
                                {result.link}
                              </div>
                              <div className="text-xs text-white/60">
                                {statusText}
                                {result.info?.title && ` • ${result.info.title}`}
                                {result.info?.error && (
                                  <span className="text-rose-300">
                                    {' '}
                                    • {result.info.error}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {(feedback || error) && (
            <div className="mx-auto mt-8 max-w-4xl">
              {feedback && (
                <div className="rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                  {feedback}
                </div>
              )}
              {error && (
                <div className="mt-3 flex items-center gap-2 rounded-3xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddGroupsDialog;
