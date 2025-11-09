import React, { useState, useEffect } from 'react';
import { Activity, Scan, Users, Loader2, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { apiFetch } from '../../config/api';

interface ActiveOperation {
  type: 'scan' | 'join_groups';
  account_id: string;
  account_label: string;
  status: string;
  current_chat?: string;
  current_link?: string;
  current_index: number;
  total_chats?: number;
  total?: number;
  progress_percent: number;
  messages_found?: number;
  results_count?: number;
  started_at?: string;
}

interface GlobalOperationsStatusProps {
  onAccountClick?: (accountId: string, operationType: 'scan' | 'join_groups') => void;
}

const GlobalOperationsStatus: React.FC<GlobalOperationsStatusProps> = ({ onAccountClick }) => {
  const [operations, setOperations] = useState<ActiveOperation[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await apiFetch('/system/operation-status');
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (data.success && Array.isArray(data.active_operations)) {
          setOperations(data.active_operations);
        }
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Error fetching operation status:', error);
        }
      }
    };

    // Fetch immediately
    fetchStatus();

    // Poll every 2 seconds
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  if (operations.length === 0) {
    return null; // Don't render anything if no active operations
  }

  const formatTimeAgo = (timestamp?: string) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'עכשיו';
      if (diffMins === 1) return 'לפני דקה';
      return `לפני ${diffMins} דקות`;
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      <div className="glass-card rounded-2xl border border-white/10 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">פעולות ברקע</h3>
          </div>
          <span className="text-xs text-white/60">{operations.length} פעולות</span>
        </div>

        <div className="space-y-3">
          {operations.map((op, idx) => (
            <div
              key={`${op.account_id}-${op.type}-${idx}`}
              className="rounded-xl border border-white/10 bg-white/5 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {op.type === 'scan' ? (
                    <Scan className="h-4 w-4 text-blue-400" />
                  ) : (
                    <Users className="h-4 w-4 text-emerald-400" />
                  )}
                  <span className="text-xs font-medium text-white">{op.account_label}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70">
                    {op.type === 'scan' ? 'סריקה' : 'הצטרפות'}
                  </span>
                </div>
                {op.status === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                )}
              </div>

              {op.type === 'scan' ? (
                <>
                  <div className="mb-2 text-xs text-white/80">
                    {op.current_chat || 'מתכונן...'}
                  </div>
                  <div className="mb-1 flex items-center justify-between text-xs text-white/60">
                    <span>
                      {op.current_index} / {op.total_chats || 0} קבוצות
                    </span>
                    <span>{op.progress_percent}%</span>
                  </div>
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-black/30">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${op.progress_percent}%` }}
                    />
                  </div>
                  {op.messages_found !== undefined && op.messages_found > 0 && (
                    <div className="text-xs text-emerald-300">
                      ✅ נמצאו {op.messages_found} הודעות
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-2 text-xs text-white/80">
                    {op.current_link ? (
                      <span className="truncate">{op.current_link}</span>
                    ) : (
                      'מתכונן...'
                    )}
                  </div>
                  <div className="mb-1 flex items-center justify-between text-xs text-white/60">
                    <span>
                      {op.current_index} / {op.total || 0} קישורים
                    </span>
                    <span>{op.progress_percent}%</span>
                  </div>
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-black/30">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${op.progress_percent}%` }}
                    />
                  </div>
                  {op.results_count !== undefined && (
                    <div className="text-xs text-white/60">
                      {op.results_count} תוצאות • {formatTimeAgo(op.started_at)}
                    </div>
                  )}
                </>
              )}

              {onAccountClick && (
                <button
                  onClick={() => onAccountClick(op.account_id, op.type)}
                  className="mt-2 w-full rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                >
                  צפה בפרטים
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GlobalOperationsStatus;
