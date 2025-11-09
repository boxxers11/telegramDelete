import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, PlusCircle, Upload, Trash2, Search as SearchIcon, Filter, AlertCircle, Loader, ListMinus, ClipboardList, Users, UserX } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import HeaderFullScreen from '../components/ui/HeaderFullScreen';
import StatusChip from '../components/groups/StatusChip';
import type { LifecycleStatus } from '../types/groups';
import GroupsTable, { GroupsSortKey } from '../components/groups/GroupsTable';
import AddGroupsDialog from '../components/groups/AddGroupsDialog';
import ContactsExportDialog from '../components/ContactsExportDialog';
import BlockedContactsDialog from '../components/BlockedContactsDialog';
import { groupsStore, useGroupsAccountState } from '../state/groups.store';
import type { GroupRecord } from '../types/groups';
import { useAppContext } from '../App';


const ARCHIVED_STATUSES: LifecycleStatus[] = ['left', 'banned', 'failed', 'rejected'];

const filterGroups = (
  groups: GroupRecord[],
  search: string,
  statusFilter: 'all' | LifecycleStatus
) => {
  const term = search.trim().toLowerCase();
  return groups.filter((group) => {
    const matchesSearch =
      !term ||
      group.title?.toLowerCase().includes(term) ||
      group.username?.toLowerCase().includes(term) ||
      group.id.includes(term);
    const matchesStatus = statusFilter === 'all' || group.lifecycle_status === statusFilter;
    return matchesSearch && matchesStatus;
  });
};

const sortGroups = (
  groups: GroupRecord[],
  key: GroupsSortKey,
  direction: 'asc' | 'desc'
) => {
  const sorted = [...groups].sort((a, b) => {
    const compare = (valueA: number, valueB: number) => valueA - valueB;
    switch (key) {
      case 'title': {
        const aTitle = (a.title || a.username || '').toLowerCase();
        const bTitle = (b.title || b.username || '').toLowerCase();
        return aTitle.localeCompare(bTitle, 'he-IL');
      }
      case 'sent_count_total':
        return compare(a.sent_count_total, b.sent_count_total);
      case 'deleted_ratio': {
        const ratioA =
          a.sent_count_total > 0 ? a.deleted_count_total / a.sent_count_total : 0;
        const ratioB =
          b.sent_count_total > 0 ? b.deleted_count_total / b.sent_count_total : 0;
        return compare(ratioA, ratioB);
      }
      case 'last_post_at': {
        const timeA = a.last_post_at ? new Date(a.last_post_at).getTime() : 0;
        const timeB = b.last_post_at ? new Date(b.last_post_at).getTime() : 0;
        return compare(timeA, timeB);
      }
      case 'joined_at': {
        const timeA = a.joined_at ? new Date(a.joined_at).getTime() : 0;
        const timeB = b.joined_at ? new Date(b.joined_at).getTime() : 0;
        return compare(timeA, timeB);
      }
      case 'member_count':
        return compare(a.member_count ?? 0, b.member_count ?? 0);
      default:
        return 0;
    }
  });
  return direction === 'asc' ? sorted : sorted.reverse();
};

const countByStatus = (groups: GroupRecord[]): Record<LifecycleStatus, number> => {
  return groups.reduce<Record<LifecycleStatus, number>>((acc, group) => {
    acc[group.lifecycle_status] = (acc[group.lifecycle_status] || 0) + 1;
    return acc;
  }, {} as Record<LifecycleStatus, number>);
};

const GroupsManagerPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { accountsState } = useAppContext();
  const accounts = accountsState.accounts;

  const defaultAccountId = useMemo(() => {
    if (accounts.length === 0) {
      return '';
    }
    const fromQuery = searchParams.get('account');
    if (fromQuery && accounts.some((account) => account.id === fromQuery)) {
      return fromQuery;
    }
    const authenticated = accounts.find((account) => account.is_authenticated);
    return (authenticated ?? accounts[0]).id;
  }, [accounts, searchParams]);

  const [activeAccountId, setActiveAccountId] = useState<string>(defaultAccountId);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LifecycleStatus>('all');
  const [sortKey, setSortKey] = useState<GroupsSortKey>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForLeave, setSelectedForLeave] = useState<Set<string>>(new Set());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showContactsExport, setShowContactsExport] = useState(false);
  const [showBlockedContacts, setShowBlockedContacts] = useState(false);
  const [quickJoinInput, setQuickJoinInput] = useState('');
  const [quickJoinFeedback, setQuickJoinFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (defaultAccountId) {
      setActiveAccountId(defaultAccountId);
    }
  }, [defaultAccountId]);

  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId),
    [accounts, activeAccountId]
  );

  useEffect(() => {
    if (!activeAccountId) {
      return;
    }
    groupsStore.initialise(activeAccountId, Boolean(activeAccount?.is_authenticated));
  }, [activeAccountId, activeAccount?.is_authenticated]);

  const accountState = useGroupsAccountState(activeAccountId);

  const lastSynced = useMemo(() => {
    if (!accountState.syncedAt) {
      return null;
    }
    try {
      return new Date(accountState.syncedAt).toLocaleString('he-IL');
    } catch {
      return accountState.syncedAt;
    }
  }, [accountState.syncedAt]);

  const filteredGroups = useMemo(() => {
    const filtered = filterGroups(accountState.groups, search, statusFilter);
    return sortGroups(filtered, sortKey, sortDir);
  }, [accountState.groups, search, statusFilter, sortKey, sortDir]);

  const archivedGroups = useMemo(
    () => accountState.groups.filter((group) => ARCHIVED_STATUSES.includes(group.lifecycle_status)),
    [accountState.groups]
  );

  const statusCounts = useMemo(() => countByStatus(accountState.groups), [accountState.groups]);

  const toggleSort = (key: GroupsSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleLeaveSelection = (chatId: string) => {
    setSelectedForLeave((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  };

  const handleRefresh = () => groupsStore.refresh(activeAccountId);

  const handleLeaveSelected = async () => {
    if (selectedForLeave.size === 0) {
      setQuickJoinFeedback('לא נבחרו קבוצות לעזיבה.');
      return;
    }
    try {
      await groupsStore.leave(activeAccountId, Array.from(selectedForLeave));
      setSelectedForLeave(new Set());
      setDeleteMode(false);
      setQuickJoinFeedback('בוצע ניסיון עזיבה לקבוצות שנבחרו.');
    } catch (error) {
      setQuickJoinFeedback(
        error instanceof Error ? error.message : 'שגיאה בניסיון העזיבה'
      );
    }
  };

  const handleBack = () => {
    navigate('/');
  };

  if (accountsState.loading && accounts.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950/95 text-white">
        <Loader className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950/95 text-white" dir="rtl">
        <p className="text-lg">אין חשבונות מחוברים להצגה.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-4 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
        >
          חזרה למסך הראשי
        </button>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex min-h-screen flex-col bg-slate-950/95" dir="rtl">
      <HeaderFullScreen
        title="ניהול קבוצות"
        onBack={handleBack}
        description={activeAccount ? `חשבון: ${activeAccount.label}` : 'בחר חשבון כדי לצפות בקבוצות'}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              רענון
            </button>
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <PlusCircle className="h-4 w-4" />
              הוספת קישורים
            </button>
          </div>
        }
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-white/10 bg-white/5 px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <label className="text-sm text-white/70">בחר חשבון:</label>
              <select
                value={activeAccountId}
                onChange={(event) => setActiveAccountId(event.target.value)}
                className="rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="rounded-xl border border-white/20 bg-black/40 py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="חיפוש קבוצות..."
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | LifecycleStatus)}
                className="rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">כל המצבים</option>
                <option value="active">פעיל</option>
                <option value="pending">ממתין</option>
                <option value="waiting">בהמתנה</option>
                <option value="rejected">נדחה</option>
                <option value="failed">כשל</option>
                <option value="left">עזב</option>
                <option value="banned">נחסם</option>
              </select>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDeleteMode((prev) => !prev)}
                className={`btn-secondary flex items-center gap-2 ${deleteMode ? 'border-red-500/50 text-red-300' : ''}`}
              >
                <Trash2 className="h-4 w-4" />
                מצב עזיבה
              </button>
              <button
                type="button"
                onClick={() => setShowContactsExport(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <Users className="h-4 w-4" />
                ייצוא אנשי קשר
              </button>
              <button
                type="button"
                onClick={() => setShowBlockedContacts(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <UserX className="h-4 w-4" />
                חסומים
              </button>
              <button
                type="button"
                onClick={() => groupsStore.export(activeAccountId)}
                className="btn-secondary flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                ייצוא קבוצות
              </button>
            </div>
          </div>

          {quickJoinFeedback && (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white/80">
              {quickJoinFeedback}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <GroupsTable
            groups={filteredGroups}
            archivedGroups={archivedGroups}
            statusCounts={statusCounts}
            sortKey={sortKey}
            sortDirection={sortDir}
            onToggleSort={toggleSort}
            deleteMode={deleteMode}
            selectedForLeave={selectedForLeave}
            onToggleLeaveSelection={toggleLeaveSelection}
          />
        </div>
      </div>

      <AddGroupsDialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        accountId={activeAccountId}
        quickJoinInput={quickJoinInput}
        onQuickJoinInputChange={setQuickJoinInput}
        onQuickJoinFeedback={setQuickJoinFeedback}
      />

      <ContactsExportDialog
        isOpen={showContactsExport}
        onClose={() => setShowContactsExport(false)}
        accountId={activeAccountId}
      />

      <BlockedContactsDialog
        isOpen={showBlockedContacts}
        onClose={() => setShowBlockedContacts(false)}
        accountId={activeAccountId}
      />
    </div>
  );
};

export default GroupsManagerPage;
