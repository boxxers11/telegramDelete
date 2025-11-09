import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ClipboardList,
  Plus,
  X,
  Edit,
  Trash2,
  CheckCircle2,
  Loader,
  MessageCircle,
  Rocket
} from 'lucide-react';
import {
  BacklogComplexity,
  BacklogPriority,
  BacklogQuestion,
  BacklogStatus,
  BacklogTask,
  BacklogAttachment,
  useBacklog
} from '../hooks/useBacklog';

const API_BASE_URL = 'http://127.0.0.1:8001';

const priorityOptions: BacklogPriority[] = ['נמוך', 'רגיל', 'דחוף'];
const statusOptions: { value: BacklogStatus; label: string }[] = [
  { value: 'pending', label: 'ממתין' },
  { value: 'in_progress', label: 'בתהליך' },
  { value: 'completed', label: 'הושלם' }
];
const complexityOptions: BacklogComplexity[] = ['קל מאוד', 'קל', 'בינוני', 'מורכב', 'מורכב מאוד'];

interface TaskEditState {
  subject: string;
  priority: BacklogPriority;
  status: BacklogStatus;
  effort_minutes: number;
  complexity: BacklogComplexity;
}

const BacklogWidget: React.FC = () => {
  const { tasks, questions, loading, error, addTask, updateTask, deleteTask, executeTask, addQuestion, uploadAttachment, setError } = useBacklog();
  const [isOpen, setIsOpen] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
  const [priorityInput, setPriorityInput] = useState<BacklogPriority>('רגיל');
  const [questionInput, setQuestionInput] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskEditState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [newAttachments, setNewAttachments] = useState<BacklogAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);

  const sortedTasks = useMemo(() => {
    const priorityRank: Record<BacklogPriority, number> = { דחוף: 0, רגיל: 1, נמוך: 2 } as const;
    const statusRank: Record<BacklogStatus, number> = { in_progress: 0, pending: 1, completed: 2 };
    return [...tasks].sort((a, b) => {
      const statusDiff = statusRank[a.status] - statusRank[b.status];
      if (statusDiff !== 0) return statusDiff;
      const priorityDiff = priorityRank[a.priority] - priorityRank[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [tasks]);

  useEffect(() => {
    if (!isOpen) {
      setSubjectInput('');
      setPriorityInput('רגיל');
      setEditingTaskId(null);
      setTaskDraft(null);
      setQuestionInput('');
      setError(null);
      setNewAttachments([]);
      setUploadingAttachments(false);
      setIsDragActive(false);
      setExecutingTaskId(null);
    }
  }, [isOpen, setError]);

  const resolveAttachmentUrl = useCallback((attachment: BacklogAttachment) => {
    if (!attachment?.url) {
      return '';
    }
    return attachment.url.startsWith('http') ? attachment.url : `${API_BASE_URL}${attachment.url}`;
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files instanceof FileList ? Array.from(files) : files).filter(Boolean);
      if (fileArray.length === 0) {
        return;
      }
      setUploadingAttachments(true);
      setError(null);
      try {
        for (const file of fileArray) {
          const attachment = await uploadAttachment(file);
          setNewAttachments((prev) => [...prev, attachment]);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploadingAttachments(false);
        setIsDragActive(false);
      }
    },
    [uploadAttachment, setError]
  );

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLDivElement>) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }
      if (files.length > 0) {
        event.preventDefault();
        await handleFiles(files);
      }
    },
    [handleFiles]
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        await handleFiles(files);
      }
      setIsDragActive(false);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  }, []);

  const removeNewAttachment = useCallback((filename: string) => {
    setNewAttachments((prev) => prev.filter((attachment) => attachment.filename !== filename));
  }, []);

  const startEditing = (task: BacklogTask) => {
    setEditingTaskId(task.id);
    setTaskDraft({
      subject: task.subject,
      priority: task.priority,
      status: task.status,
      effort_minutes: task.effort_minutes,
      complexity: task.complexity
    });
  };

  const handleUpdateTask = async (taskId: string) => {
    if (!taskDraft) return;
    setSubmitting(true);
    try {
      const original = tasks.find((task) => task.id === taskId);
      if (!original) return;
      const payload: Partial<{ subject: string; priority: BacklogPriority; status: BacklogStatus; effort_minutes: number; complexity: BacklogComplexity }> = {};
      if (taskDraft.subject !== original.subject) payload.subject = taskDraft.subject;
      if (taskDraft.priority !== original.priority) payload.priority = taskDraft.priority;
      if (taskDraft.status !== original.status) payload.status = taskDraft.status;
      if (taskDraft.effort_minutes !== original.effort_minutes) payload.effort_minutes = taskDraft.effort_minutes;
      if (taskDraft.complexity !== original.complexity) payload.complexity = taskDraft.complexity;

      if (Object.keys(payload).length === 0) {
        setEditingTaskId(null);
        setTaskDraft(null);
        return;
      }

      await updateTask(taskId, payload);
      setEditingTaskId(null);
      setTaskDraft(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddTask = async () => {
    if (!subjectInput.trim()) {
      setError('אנא הזן נושא למשימה החדשה.');
      return;
    }
    setSubmitting(true);
    try {
      await addTask(subjectInput.trim(), priorityInput, newAttachments.map((attachment) => attachment.filename));
      setSubjectInput('');
      setPriorityInput('רגיל');
      setNewAttachments([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTask = async (task: BacklogTask) => {
    if (task.status !== 'completed') {
      setError('ניתן למחוק רק משימה שהושלמה ומאושרת.');
      return;
    }
    if (!window.confirm('האם למחוק את המשימה לצמיתות?')) {
      return;
    }
    setSubmitting(true);
    try {
      await deleteTask(task.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddQuestion = async () => {
    if (!questionInput.trim()) {
      setError('אנא כתוב שאלה לפני השליחה.');
      return;
    }
    setQuestionSubmitting(true);
    try {
      await addQuestion(questionInput.trim());
      setQuestionInput('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setQuestionSubmitting(false);
    }
  };

  const renderTaskCard = (task: BacklogTask) => {
    const isEditing = editingTaskId === task.id && taskDraft;
    const attachmentPreviews = Array.isArray(task.attachments) ? task.attachments : [];

    return (
      <div key={task.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start justify-between gap-3">
          {!isEditing ? (
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-lg font-semibold text-white">{task.subject}</h4>
                <span className="rounded-full bg-blue-500/20 px-2 py-1 text-xs text-blue-100">{task.priority}</span>
                <span className="rounded-full bg-purple-500/20 px-2 py-1 text-xs text-purple-100">{task.complexity}</span>
                <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-100">{task.effort_minutes} דק׳</span>
              </div>
              <div className="mt-1 text-xs text-white/50">
                נוצר: {new Date(task.created_at).toLocaleString('he-IL')} • עודכן: {new Date(task.updated_at).toLocaleString('he-IL')}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/70">
                {task.subtasks.map((subtask, index) => (
                  <span key={index} className="rounded-full border border-white/15 bg-white/10 px-2 py-1">
                    {subtask}
                  </span>
                ))}
              </div>
              {task.last_executed_at && (
                <div className="mt-2 text-xs text-emerald-200">
                  בוצע לאחרונה: {new Date(task.last_executed_at).toLocaleString('he-IL')}
                </div>
              )}
              <div className="mt-3 grid gap-2 text-sm text-white/80">
                <div>
                  <span className="font-semibold text-white/70">מעצב ראשי:</span> {task.expert_review.design_lead}
                </div>
                <div>
                  <span className="font-semibold text-white/70">מתכנת ראשי:</span> {task.expert_review.dev_lead}
                </div>
                <div>
                  <span className="font-semibold text-white/70">פרודקט:</span> {task.expert_review.product_lead}
                </div>
                <div>
                  <span className="font-semibold text-white/70">Microcopy:</span> {task.expert_review.microcopy}
                </div>
              </div>
              {attachmentPreviews.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-white/60 mb-2">קבצים מצורפים ({attachmentPreviews.length})</div>
                  <div className="grid grid-cols-2 gap-2">
                    {attachmentPreviews.map((attachment) => {
                      const url = resolveAttachmentUrl(attachment);
                      return (
                        <a
                          key={`${task.id}-${attachment.filename}`}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5"
                        >
                          <img
                            src={url}
                            alt={attachment.original_name || attachment.filename}
                            className="h-24 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/80">
                            {attachment.original_name || 'צילום מסך'}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="w-full space-y-3">
              <div>
                <label className="mb-1 block text-xs text-white/60">נושא</label>
                <input
                  value={taskDraft.subject}
                  onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, subject: event.target.value } : prev))}
                  className="w-full rounded-xl border border-white/20 bg-white/10 p-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="mb-1 block text-xs text-white/60">תעדוף</label>
                  <select
                    value={taskDraft.priority}
                    onChange={(event) =>
                      setTaskDraft((prev) => (prev ? { ...prev, priority: event.target.value as BacklogPriority } : prev))
                    }
                    className="w-full rounded-xl border border-white/20 bg-white/10 p-2 text-white focus:outline-none"
                  >
                    {priorityOptions.map((option) => (
                      <option key={option} value={option} className="text-black">
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">סטטוס</label>
                  <select
                    value={taskDraft.status}
                    onChange={(event) =>
                      setTaskDraft((prev) => (prev ? { ...prev, status: event.target.value as BacklogStatus } : prev))
                    }
                    className="w-full rounded-xl border border-white/20 bg-white/10 p-2 text-white focus:outline-none"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value} className="text-black">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="mb-1 block text-xs text-white/60">מורכבות</label>
                  <select
                    value={taskDraft.complexity}
                    onChange={(event) =>
                      setTaskDraft((prev) => (prev ? { ...prev, complexity: event.target.value as BacklogComplexity } : prev))
                    }
                    className="w-full rounded-xl border border-white/20 bg-white/10 p-2 text-white focus:outline-none"
                  >
                    {complexityOptions.map((option) => (
                      <option key={option} value={option} className="text-black">
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">היקף (דקות)</label>
                  <input
                    type="number"
                    value={taskDraft.effort_minutes}
                    min={15}
                    step={15}
                    onChange={(event) =>
                      setTaskDraft((prev) => (prev ? { ...prev, effort_minutes: Number(event.target.value) } : prev))
                    }
                    className="w-full rounded-xl border border-white/20 bg-white/10 p-2 text-sm text-white focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 text-sm">
            {!isEditing ? (
              <>
                <button
                  onClick={() => handleExecuteTask(task)}
                  className="btn-primary flex items-center justify-center gap-2"
                  disabled={submitting || executingTaskId === task.id}
                >
                  {executingTaskId === task.id ? (
                    <Loader className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                  בצע עכשיו
                </button>
                <button
                  onClick={() => startEditing(task)}
                  className="btn-secondary flex items-center justify-center gap-2"
                  disabled={submitting}
                >
                  <Edit className="h-4 w-4" />
                  ערוך
                </button>
                <button
                  onClick={() => handleDeleteTask(task)}
                  className="btn-secondary flex items-center justify-center gap-2 text-red-200 hover:text-red-100"
                  disabled={submitting}
                >
                  <Trash2 className="h-4 w-4" />
                  מחק משימה
                </button>
                {task.status !== 'completed' && (
                  <button
                    onClick={() => updateTask(task.id, { status: 'completed' })}
                    className="btn-primary flex items-center justify-center gap-2"
                    disabled={submitting}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    סמן כהושלם
                  </button>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleUpdateTask(task.id)}
                  className="btn-primary flex items-center justify-center gap-2"
                  disabled={submitting}
                >
                  {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  שמור
                </button>
                <button
                  onClick={() => {
                    setEditingTaskId(null);
                    setTaskDraft(null);
                  }}
                  className="btn-secondary flex items-center justify-center gap-2"
                >
                  <X className="h-4 w-4" />
                  בטל
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const portalRoot = typeof document !== 'undefined' ? document.body : null;

  return (
    <>
      {createPortal(
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-[2000] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-white shadow-2xl transition-transform hover:scale-105 focus:outline-none"
        >
          <ClipboardList className="h-6 w-6" />
        </button>,
        portalRoot as HTMLElement
      )}

      {isOpen &&
        portalRoot &&
        createPortal(
          <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/70 p-4">
            <div className="glass-elevated relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10">
              <div className="flex items-center justify-between border-b border-white/10 p-6">
                <div className="flex items-center gap-3">
                  <div className="glass-card rounded-2xl p-3">
                    <ClipboardList className="h-6 w-6 text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">בקלוג ענן</h2>
                    <p className="text-sm text-white/70">ניהול משימות חוצה מוצר – עם מיפוי מורכבות, היקף וחוות דעת של צוות הליבה.</p>
                  </div>
                </div>
                <button onClick={() => setIsOpen(false)} className="glass-card rounded-xl p-3 hover:bg-white/10">
                  <X className="h-5 w-5 text-white" />
                </button>
              </div>

              <div className="grid flex-1 grid-cols-[320px,1fr] divide-x divide-white/10 overflow-hidden">
                <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
                  <div
                    className={`space-y-3 rounded-2xl p-2 ${isDragActive ? 'border border-dashed border-blue-400 bg-blue-500/10' : ''}`}
                    onPaste={handlePaste}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragOver}
                    onDragLeave={handleDragLeave}
                  >
                    <h3 className="text-lg font-semibold text-white">הוספת משימה חדשה</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs text-white/60">נושא</label>
                        <textarea
                          value={subjectInput}
                          onChange={(event) => setSubjectInput(event.target.value)}
                          rows={3}
                          placeholder="לדוגמה: אוטומציה לתיעוד תוצאות סריקה"
                          className="w-full rounded-2xl border border-white/20 bg-white/10 p-3 text-sm text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={submitting}
                        />
                        <p className="mt-1 text-[11px] text-white/40">אפשר להדביק צילום מסך או לגרור תמונה ישירות לכאן.</p>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-white/60">תעדוף</label>
                        <select
                          value={priorityInput}
                          onChange={(event) => setPriorityInput(event.target.value as BacklogPriority)}
                          className="w-full rounded-2xl border border-white/20 bg-white/10 p-3 text-sm text-white focus:outline-none"
                          disabled={submitting}
                        >
                          {priorityOptions.map((option) => (
                            <option key={option} value={option} className="text-black">
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                      {uploadingAttachments && (
                        <div className="text-xs text-blue-200">מעלה קבצים מצורפים...</div>
                      )}
                      {newAttachments.length > 0 && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <div className="mb-2 text-xs text-white/60">קבצים מצורפים חדשים ({newAttachments.length})</div>
                          <div className="grid grid-cols-2 gap-2">
                            {newAttachments.map((attachment) => {
                              const url = resolveAttachmentUrl(attachment);
                              return (
                                <div key={attachment.filename} className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5">
                                  <img
                                    src={url}
                                    alt={attachment.original_name || attachment.filename}
                                    className="h-24 w-full object-cover"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeNewAttachment(attachment.filename)}
                                    className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-xs text-white/80 hover:bg-black/90"
                                  >
                                    ✕
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <button
                        onClick={handleAddTask}
                        disabled={submitting || uploadingAttachments}
                        className="btn-primary flex w-full items-center justify-center gap-2 disabled:opacity-70"
                      >
                        {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        הוסף לבקלוג
                      </button>
                      {error && (
                        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold text-white">שאל את Codex</h3>
                    <p className="text-xs text-white/60">כתוב כאן שאלות או הערות על המשימות – אני אשמור ואעבור עליהן בריצה הבאה.</p>
                    <textarea
                      value={questionInput}
                      onChange={(event) => setQuestionInput(event.target.value)}
                      rows={3}
                      placeholder="איך כדאי לפרק את המשימה הבאה?"
                      className="w-full rounded-2xl border border-white/20 bg-white/10 p-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      disabled={questionSubmitting}
                    />
                    <button
                      onClick={handleAddQuestion}
                      disabled={questionSubmitting}
                      className="btn-secondary flex items-center justify-center gap-2"
                    >
                      {questionSubmitting ? <Loader className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                      שלח לי את השאלה
                    </button>
                    {questions.length > 0 && (
                      <div className="space-y-2 text-xs text-white/60">
                        <div className="text-white/70">שאלות אחרונות:</div>
                        {questions
                          .slice(-5)
                          .reverse()
                          .map((question: BacklogQuestion) => (
                            <div key={question.id} className="rounded-xl border border-white/10 bg-white/5 p-2">
                              <div className="text-[11px] text-white/40">
                                {new Date(question.created_at).toLocaleString('he-IL')}
                              </div>
                              <div>{question.content}</div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex h-full flex-col overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/10 p-4 text-sm text-white/60">
                    <div>סה"כ משימות: {tasks.length}</div>
                    <div>פתוחות: {tasks.filter((task) => task.status !== 'completed').length}</div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                      <div className="flex h-full items-center justify-center text-white/60">
                        <Loader className="h-6 w-6 animate-spin" />
                        <span className="ml-2">טוען משימות...</span>
                      </div>
                    ) : sortedTasks.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-white/50">
                        עדיין אין משימות. הוסף משימה חדשה כדי להתחיל.
                      </div>
                    ) : (
                      <div className="space-y-4">{sortedTasks.map((task) => renderTaskCard(task))}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>,
          portalRoot
        )}
    </>
  );
};

export default BacklogWidget;
  const handleExecuteTask = async (task: BacklogTask) => {
    if (executingTaskId) return;
    setExecutingTaskId(task.id);
    setError(null);
    try {
      await executeTask(task.id, `Triggered from backlog UI for "${task.subject}"`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExecutingTaskId(null);
    }
  };
