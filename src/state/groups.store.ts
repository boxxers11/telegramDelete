import { useSyncExternalStore } from 'react';
import { groupsRepo } from '../services/groupsRepo';
import type { GroupRecord, JoinRequestResult, LeaveResult } from '../types/groups';
import type { GroupsSnapshot } from '../services/groupsRepo';

interface AccountState {
  groups: GroupRecord[];
  loading: boolean;
  refreshing: boolean;
  joining: boolean;
  leaving: boolean;
  error: string | null;
  lastUpdated?: string;
  syncedAt?: string | null;
  lastOperationSummary?: string | null;
  lastJoinResults?: JoinRequestResult[];
  lastLeaveResults?: LeaveResult[];
  loaded: boolean;
}

interface InternalState {
  accounts: Record<string, AccountState>;
}

const defaultAccountState = (): AccountState => ({
  groups: [],
  loading: false,
  refreshing: false,
  joining: false,
  leaving: false,
  error: null,
  lastUpdated: undefined,
  syncedAt: null,
  lastOperationSummary: null,
  lastJoinResults: undefined,
  lastLeaveResults: undefined,
  loaded: false
});

const state: InternalState = {
  accounts: {}
};

type Listener = () => void;
const listeners = new Set<Listener>();

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

const ensureAccount = (accountId: string): AccountState => {
  if (!state.accounts[accountId]) {
    state.accounts[accountId] = defaultAccountState();
  }
  return state.accounts[accountId];
};

const updateAccount = (accountId: string, patch: Partial<AccountState>) => {
  const next = { ...ensureAccount(accountId), ...patch };
  state.accounts[accountId] = next;
  emit();
};

const reloadGroups = async (accountId: string): Promise<GroupsSnapshot> => {
  const snapshot = await groupsRepo.list(accountId);
  updateAccount(accountId, {
    groups: snapshot.groups,
    error: null,
    lastUpdated: snapshot.synced_at ?? new Date().toISOString(),
    syncedAt: snapshot.synced_at ?? null,
    loaded: true
  });
  return snapshot;
};

export const groupsStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getAccount(accountId: string): AccountState {
    return ensureAccount(accountId);
  },

  async load(accountId: string) {
    const account = ensureAccount(accountId);
    if (account.loading) {
      return;
    }
    updateAccount(accountId, { loading: true, error: null });
    try {
      await reloadGroups(accountId);
    } catch (error) {
      updateAccount(accountId, {
        error: error instanceof Error ? error.message : 'שגיאה בטעינת הקבוצות'
      });
    } finally {
      updateAccount(accountId, { loading: false });
    }
  },

  async refresh(accountId: string) {
    updateAccount(accountId, { refreshing: true, error: null });
    try {
      await groupsRepo.refresh(accountId);
      await reloadGroups(accountId);
    } catch (error) {
      updateAccount(accountId, {
        error: error instanceof Error ? error.message : 'שגיאה ברענון רשימת הקבוצות'
      });
    } finally {
      updateAccount(accountId, { refreshing: false });
    }
  },

  async joinFromText(accountId: string, text: string) {
    updateAccount(accountId, { joining: true, error: null });
    try {
      const { results, queued } = await groupsRepo.joinFromText(accountId, text);
      await reloadGroups(accountId);
      updateAccount(accountId, {
        joining: false,
        lastJoinResults: results,
        lastOperationSummary:
          queued === 0
            ? 'לא נמצאו קישורים להצטרפות'
            : `עיבדנו ${queued} קישורים להצטרפות`
      });
      return results;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'שגיאה בתהליך ההצטרפות לקבוצות';
      updateAccount(accountId, { joining: false, error: message });
      throw error;
    }
  },

  async joinLinks(accountId: string, links: string[]) {
    updateAccount(accountId, { joining: true, error: null });
    try {
      const results = await groupsRepo.joinLinks(accountId, links);
      await reloadGroups(accountId);
      updateAccount(accountId, {
        joining: false,
        lastJoinResults: results,
        lastOperationSummary: `עיבדנו ${links.length} קישורים`
      });
      return results;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'שגיאה בתהליך ההצטרפות לקבוצות';
      updateAccount(accountId, { joining: false, error: message });
      throw error;
    }
  },

  async leave(accountId: string, chatIds: string[]) {
    updateAccount(accountId, { leaving: true, error: null });
    try {
      const { results } = await groupsRepo.leave(accountId, chatIds);
      await reloadGroups(accountId);
      updateAccount(accountId, {
        leaving: false,
        lastLeaveResults: results,
        lastOperationSummary: `בוצע ניסיון עזיבה עבור ${chatIds.length} קבוצות`
      });
      return results;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'שגיאה בעזיבת הקבוצות';
      updateAccount(accountId, { leaving: false, error: message });
      throw error;
    }
  },

  async initialise(accountId: string, autoRefresh = true) {
    const account = ensureAccount(accountId);
    if (account.loaded || account.loading) {
      if (autoRefresh && !account.refreshing) {
        void groupsStore.refresh(accountId);
      }
      return;
    }
    await groupsStore.load(accountId);
    if (autoRefresh) {
      void groupsStore.refresh(accountId);
    }
  },

  async export(accountId: string) {
    const account = ensureAccount(accountId);
    const groups = account.groups;
    
    // Add required fields for each group
    const exportData = groups.map(group => ({
      ...group,
      openInTelegram: group.username 
        ? `https://t.me/${group.username}` 
        : group.invite_link || `tg://resolve?domain=${group.id}`,
      openInAppLink: `app://open/group/${group.id}`
    }));

    // Add archived groups at the bottom
    const archivedGroups = groups.filter(group => 
      ['left', 'banned', 'failed', 'rejected'].includes(group.lifecycle_status)
    );

    const exportPayload = {
      metadata: {
        timestamp: new Date().toISOString(),
        appVersion: '0.0.0',
        accountId,
        totalGroups: groups.length,
        archivedGroups: archivedGroups.length
      },
      groups: exportData,
      archivedGroups: archivedGroups.map(group => ({
        ...group,
        openInTelegram: group.username 
          ? `https://t.me/${group.username}` 
          : group.invite_link || `tg://resolve?domain=${group.id}`,
        openInAppLink: `app://open/group/${group.id}`
      }))
    };

    // Create and download the file
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { 
      type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `telegram_groups_export_${accountId}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};

export const useGroupsAccountState = (accountId: string): AccountState =>
  useSyncExternalStore(
    groupsStore.subscribe,
    () => groupsStore.getAccount(accountId),
    () => groupsStore.getAccount(accountId)
  );
