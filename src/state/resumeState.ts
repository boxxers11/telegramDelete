export type ResumeOperationType = 'scan' | 'group_send' | 'direct_send';

export interface ResumeSnapshot {
  id: string;
  type: ResumeOperationType;
  accountId: string;
  path: string;
  description: string;
  operations: string[];
  startedAt: number;
  status: 'pending' | 'completed';
  metadata?: Record<string, unknown>;
}

const STORAGE_KEY = 'telegram_app_resume_snapshot_v1';

const safeParse = (value: string | null): ResumeSnapshot | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as ResumeSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('Failed to parse resume snapshot:', error);
    return null;
  }
};

export const getResumeSnapshot = (): ResumeSnapshot | null => {
  return safeParse(localStorage.getItem(STORAGE_KEY));
};

export const saveResumeSnapshot = (snapshot: ResumeSnapshot) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.error('Failed to save resume snapshot:', error);
  }
};

export const clearResumeSnapshot = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear resume snapshot:', error);
  }
};

export const markResumeSnapshotCompleted = () => {
  const snapshot = getResumeSnapshot();
  if (!snapshot) {
    return;
  }
  saveResumeSnapshot({
    ...snapshot,
    status: 'completed'
  });
};
