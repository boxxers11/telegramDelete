import React from 'react';
import { Users, ShieldCheck, Timer, ChevronUp, ChevronDown } from 'lucide-react';
import StatusChip from './StatusChip';
import type { GroupRecord } from '../../types/groups';

export type GroupsSortKey =
  | 'title'
  | 'sent_count_total'
  | 'deleted_ratio'
  | 'last_post_at'
  | 'joined_at'
  | 'member_count';

interface GroupsTableProps {
  groups: GroupRecord[];
  sortKey: GroupsSortKey;
  sortDirection: 'asc' | 'desc';
  onSort: (key: GroupsSortKey) => void;
  deleteMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('he-IL');
};

const formatDateTime = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('he-IL');
};

const computeDeleteRatio = (group: GroupRecord) => {
  if (!group.sent_count_total) return 0;
  const ratio = group.deleted_count_total / Math.max(1, group.sent_count_total);
  return Math.round(ratio * 100);
};

const PermissionBadges: React.FC<{ group: GroupRecord }> = ({ group }) => {
  const items: React.ReactNode[] = [];
  if (group.can_send) {
    items.push(
      <span key="send" className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-xs text-emerald-200">
        <ShieldCheck className="h-3 w-3" />
        שליחת הודעות
      </span>
    );
  } else if (group.can_send === false) {
    items.push(
      <span key="no-send" className="flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-1 text-xs text-rose-200">
        <ShieldCheck className="h-3 w-3" />
        חסומה לשליחה
      </span>
    );
  }
  if (typeof group.slow_mode_delay === 'number' && group.slow_mode_delay > 0) {
    items.push(
      <span key="slow-mode" className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-xs text-amber-200">
        <Timer className="h-3 w-3" />
        {group.slow_mode_delay} שניות
      </span>
    );
  }

  if (items.length === 0) {
    return <span className="text-xs text-white/40">ללא נתונים</span>;
  }

  return <div className="flex flex-wrap gap-2">{items}</div>;
};

const SortChevron: React.FC<{ active: boolean; direction: 'asc' | 'desc' }> = ({ active, direction }) => {
  if (!active) {
    return <ChevronDown className="h-3 w-3 opacity-40" />;
  }
  return direction === 'asc' ? (
    <ChevronUp className="h-3 w-3 opacity-80" />
  ) : (
    <ChevronDown className="h-3 w-3 opacity-80" />
  );
};

const GroupsTable: React.FC<GroupsTableProps> = ({
  groups,
  sortKey,
  sortDirection,
  onSort,
  deleteMode,
  selected,
  onToggleSelect
}) => {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30">
      <table className="min-w-full text-sm text-white">
        <thead className="bg-white/5 text-xs uppercase text-white/60">
          <tr>
            <th className="px-4 py-3 text-right">
              <button
                type="button"
                className="flex w-full items-center justify-end gap-2"
                onClick={() => onSort('title')}
              >
                שם הקבוצה
                <SortChevron active={sortKey === 'title'} direction={sortDirection} />
              </button>
            </th>
            <th className="px-4 py-3">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2"
                onClick={() => onSort('sent_count_total')}
              >
                הודעות ששלחתי
                <SortChevron active={sortKey === 'sent_count_total'} direction={sortDirection} />
              </button>
            </th>
            <th className="px-4 py-3">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2"
                onClick={() => onSort('deleted_ratio')}
              >
                הודעות שמחקתי
                <SortChevron active={sortKey === 'deleted_ratio'} direction={sortDirection} />
              </button>
            </th>
            <th className="px-4 py-3">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2"
                onClick={() => onSort('last_post_at')}
              >
                הודעה אחרונה
                <SortChevron active={sortKey === 'last_post_at'} direction={sortDirection} />
              </button>
            </th>
            <th className="px-4 py-3">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2"
                onClick={() => onSort('joined_at')}
              >
                תאריך הצטרפות
                <SortChevron active={sortKey === 'joined_at'} direction={sortDirection} />
              </button>
            </th>
            <th className="px-4 py-3">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2"
                onClick={() => onSort('member_count')}
              >
                גודל קבוצה
                <SortChevron active={sortKey === 'member_count'} direction={sortDirection} />
              </button>
            </th>
            <th className="px-4 py-3 text-center">סטטוס</th>
            <th className="px-4 py-3 text-center">הרשאות</th>
            <th className="px-4 py-3 text-center">פעולה</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {groups.map((group) => {
            const ratio = computeDeleteRatio(group);
            const isSelected = selected.has(group.id);
            const isNew = Boolean(group.is_new);

            return (
              <tr key={group.id} className="hover:bg-white/5">
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col">
                    <span className="font-medium text-white">{group.title || group.username || group.id}</span>
                    {group.username && (
                      <span className="text-xs text-white/50">@{group.username}</span>
                    )}
                    {isNew && (
                      <span className="mt-1 inline-flex items-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                        חדש • 24 שעות
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">{group.sent_count_total}</td>
                <td className="px-4 py-3 text-center">
                  {group.deleted_count_total} ({ratio}%)
                </td>
                <td className="px-4 py-3 text-center">{formatDateTime(group.last_post_at)}</td>
                <td className="px-4 py-3 text-center">{formatDate(group.joined_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-2">
                    <Users className="h-4 w-4 text-white/40" />
                    {typeof group.member_count === 'number' ? group.member_count : '—'}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusChip status={group.lifecycle_status} />
                </td>
                <td className="px-4 py-3 text-center">
                  <PermissionBadges group={group} />
                </td>
                <td className="px-4 py-3 text-center">
                  {deleteMode ? (
                    <button
                      type="button"
                      onClick={() => onToggleSelect(group.id)}
                      className={`flex items-center justify-center gap-1 rounded-full border px-3 py-1 text-xs ${
                        isSelected
                          ? 'border-rose-400/60 bg-rose-500/20 text-rose-100'
                          : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
                      }`}
                    >
                      בחר למחיקה
                    </button>
                  ) : (
                    <span className="text-xs text-white/50">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {groups.length === 0 && (
        <div className="p-10 text-center text-sm text-white/60">לא נמצאו קבוצות תואמות.</div>
      )}
    </div>
  );
};

export default GroupsTable;
