import { useCallback, useEffect, useState } from 'react';

export type BacklogPriority = 'נמוך' | 'רגיל' | 'דחוף';
export type BacklogStatus = 'pending' | 'in_progress' | 'completed';
export type BacklogComplexity = 'קל מאוד' | 'קל' | 'בינוני' | 'מורכב' | 'מורכב מאוד';

export interface ExpertReview {
  design_lead: string;
  dev_lead: string;
  product_lead: string;
  microcopy: string;
}

export interface BacklogAttachment {
  filename: string;
  url: string;
  original_name?: string;
}

export interface BacklogTask {
  id: string;
  subject: string;
  subtasks: string[];
  expert_review: ExpertReview;
  priority: BacklogPriority;
  complexity: BacklogComplexity;
  effort_minutes: number;
  status: BacklogStatus;
  created_at: string;
  updated_at: string;
  attachments: BacklogAttachment[];
  last_executed_at?: string | null;
  execution_log?: BacklogExecutionEntry[];
}

export interface BacklogQuestion {
  id: string;
  content: string;
  created_at: string;
}

export interface BacklogExecutionEntry {
  timestamp: string;
  note: string;
}

interface BacklogResponse {
  success: boolean;
  tasks: BacklogTask[];
  questions: BacklogQuestion[];
}

export const useBacklog = () => {
  const [tasks, setTasks] = useState<BacklogTask[]>([]);
  const [questions, setQuestions] = useState<BacklogQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizeAttachment = useCallback((attachment: any): BacklogAttachment => ({
    filename: attachment?.filename || '',
    url: attachment?.url || '',
    original_name: attachment?.original_name || undefined
  }), []);

  const normalizeTask = useCallback(
    (task: any): BacklogTask => ({
      ...task,
      attachments: Array.isArray(task?.attachments)
        ? task.attachments.map((attachment: any) => normalizeAttachment(attachment))
        : [],
      last_executed_at: task?.last_executed_at ?? null,
      execution_log: Array.isArray(task?.execution_log)
        ? task.execution_log.map((entry: any) => ({
            timestamp: String(entry?.timestamp ?? ''),
            note: String(entry?.note ?? '')
          }))
        : []
    }),
    [normalizeAttachment]
  );

  const fetchBacklog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('http://127.0.0.1:8001/backlog');
      const data: BacklogResponse = await response.json();
      if (!response.ok || !data.success) {
        throw new Error((data as any)?.detail || 'שגיאה בטעינת הבקלוג');
      }
      const normalized = Array.isArray(data.tasks)
        ? data.tasks.map((task: any) => normalizeTask(task))
        : [];
      setTasks(normalized);
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
    } catch (err) {
      setError((err as Error).message || 'שגיאת רשת');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBacklog();
  }, [fetchBacklog]);

  const addTask = useCallback(
    async (subject: string, priority: BacklogPriority = 'רגיל', attachments: string[] = []) => {
      const response = await fetch('http://127.0.0.1:8001/backlog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, priority, attachments })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.detail || data?.error || 'שגיאה ביצירת המשימה');
      }
      const task = normalizeTask(data.task);
      setTasks((prev) => [...prev, task]);
      return task;
    },
    [normalizeTask]
  );

  const updateTask = useCallback(
    async (
      taskId: string,
      payload: Partial<{
        subject: string;
        priority: BacklogPriority;
        status: BacklogStatus;
        effort_minutes: number;
        complexity: BacklogComplexity;
        attachments: string[];
      }>
    ) => {
      const response = await fetch(`http://127.0.0.1:8001/backlog/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.detail || data?.error || 'שגיאה בעדכון המשימה');
      }
      const updatedTask = normalizeTask(data.task);
      setTasks((prev) => prev.map((task) => (task.id === taskId ? updatedTask : task)));
      return updatedTask;
    },
    [normalizeTask]
  );

  const executeTask = useCallback(
    async (taskId: string, note?: string) => {
      const response = await fetch(`http://127.0.0.1:8001/backlog/${taskId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.detail || data?.error || 'שגיאה בהפעלת המשימה');
      }
      const updatedTask = normalizeTask(data.task);
      setTasks((prev) => prev.map((task) => (task.id === taskId ? updatedTask : task)));
      return updatedTask;
    },
    [normalizeTask]
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      const response = await fetch(`http://127.0.0.1:8001/backlog/${taskId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.detail || data?.error || 'שגיאה במחיקת המשימה');
      }
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
    },
    []
  );

  const addQuestion = useCallback(async (content: string) => {
    const response = await fetch('http://127.0.0.1:8001/backlog/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data?.detail || data?.error || 'שגיאה בשליחת השאלה');
    }
    setQuestions((prev) => [...prev, data.entry]);
    return data.entry as BacklogQuestion;
  }, []);

  const uploadAttachment = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('http://127.0.0.1:8001/backlog/attachments', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data?.detail || data?.error || 'שגיאה בהעלאת הקובץ');
    }

    return data.attachment as BacklogAttachment;
  }, []);

  return {
    tasks,
    questions,
    loading,
    error,
    refresh: fetchBacklog,
    addTask,
    updateTask,
    deleteTask,
    executeTask,
    addQuestion,
    uploadAttachment,
    setError
  };
};
