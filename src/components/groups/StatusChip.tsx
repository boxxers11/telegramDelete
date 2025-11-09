import React from 'react';
import type { LifecycleStatus } from '../../types/groups';

const STATUS_STYLES: Record<LifecycleStatus, { label: string; className: string }> = {
  active: { label: 'פעילה', className: 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30' },
  pending: { label: 'ממתינה לאישור', className: 'bg-amber-500/15 text-amber-200 border border-amber-400/30' },
  waiting: { label: 'ממתינה', className: 'bg-blue-500/15 text-blue-200 border border-blue-400/30' },
  rejected: { label: 'נדחתה', className: 'bg-rose-500/15 text-rose-200 border border-rose-400/30' },
  failed: { label: 'נכשלה', className: 'bg-red-500/15 text-red-200 border border-red-400/30' },
  left: { label: 'עזבתי', className: 'bg-slate-500/20 text-slate-200 border border-slate-400/30' },
  banned: { label: 'נחסמתי', className: 'bg-slate-700/40 text-slate-200 border border-slate-500/40' },
  unknown: { label: 'לא ידוע', className: 'bg-slate-500/20 text-slate-200 border border-slate-400/30' }
};

interface StatusChipProps {
  status: LifecycleStatus;
}

const StatusChip: React.FC<StatusChipProps> = ({ status }) => {
  const { label, className } = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
};

export default StatusChip;
