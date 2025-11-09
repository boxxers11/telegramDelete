import type { GroupRecord, JoinRequestResult, LeaveResult } from '../../types/groups';

const BASE_URL = 'http://127.0.0.1:8001';

const handleResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || 'שגיאה בפעולת הטלגרם');
  }
  return data as T;
};

export const fetchGroups = async (
  accountId: string
): Promise<{ groups: GroupRecord[]; synced_at?: string | null }> => {
  const response = await fetch(`${BASE_URL}/accounts/${accountId}/groups`);
  const data = await handleResponse<{
    success: boolean;
    groups: GroupRecord[];
    synced_at?: string | null;
  }>(response);
  return {
    groups: data.groups ?? [],
    synced_at: data.synced_at ?? null
  };
};

export const refreshGroups = async (accountId: string): Promise<void> => {
  const response = await fetch(`${BASE_URL}/accounts/${accountId}/groups/refresh`, {
    method: 'POST'
  });
  await handleResponse<{ success: boolean }>(response);
};

export const joinByLinks = async (
  accountId: string,
  links: string[]
): Promise<JoinRequestResult[]> => {
  const response = await fetch(`${BASE_URL}/accounts/${accountId}/groups/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links, platform: 'user' })
  });
  const data = await handleResponse<{ success: boolean; results: JoinRequestResult[] }>(response);
  return data.results ?? [];
};

export const leaveChats = async (
  accountId: string,
  chatIds: string[]
): Promise<LeaveResult[]> => {
  const response = await fetch(`${BASE_URL}/accounts/${accountId}/groups/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_ids: chatIds })
  });
  const data = await handleResponse<{ success: boolean; results: LeaveResult[] }>(response);
  return data.results ?? [];
};
