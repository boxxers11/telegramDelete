import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  RefreshCw
} from 'lucide-react';
import type { ScanGuidance, GuidanceStage } from '../hooks/useScan';

interface ScanGuidancePanelProps {
  guidance: ScanGuidance;
  isScanning: boolean;
  stats?: {
    total: number;
    completed: number;
    skipped: number;
    errors: number;
  };
}

const stageMeta: Record<GuidanceStage, { title: string; icon: React.ReactNode; tone: string }> = {
  idle: {
    title: 'מוכן לסריקה',
    icon: <Info className="h-4 w-4 text-blue-200" />,
    tone: 'bg-white/5 border-blue-400/40'
  },
  preparing_cache: {
    title: 'מפיק תועלת מהמטמון',
    icon: <RefreshCw className="h-4 w-4 text-purple-200 animate-spin" />,
    tone: 'bg-purple-500/10 border-purple-400/40'
  },
  checking_previous: {
    title: 'בודק סריקות קודמות',
    icon: <Clock className="h-4 w-4 text-amber-200" />,
    tone: 'bg-amber-500/10 border-amber-400/40'
  },
  contacting_api: {
    title: 'מתחבר לטלגרם',
    icon: <Activity className="h-4 w-4 text-sky-200" />,
    tone: 'bg-sky-500/10 border-sky-400/40'
  },
  scanning: {
    title: 'סריקה מתבצעת',
    icon: <Loader2 className="h-4 w-4 text-green-200 animate-spin" />,
    tone: 'bg-green-500/10 border-green-400/40'
  },
  processing: {
    title: 'מעבד תוצאות',
    icon: <Activity className="h-4 w-4 text-purple-200" />,
    tone: 'bg-purple-500/10 border-purple-400/40'
  },
  completed: {
    title: 'סריקה הושלמה',
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-200" />,
    tone: 'bg-emerald-500/10 border-emerald-400/40'
  },
  error: {
    title: 'התרחשה שגיאה',
    icon: <AlertTriangle className="h-4 w-4 text-red-200" />,
    tone: 'bg-red-500/10 border-red-400/40'
  }
};

const ScanGuidancePanel: React.FC<ScanGuidancePanelProps> = ({ guidance, isScanning, stats }) => {
  const meta = stageMeta[guidance.stage];

  const batches = guidance.batches
    ? {
        total: Math.max(1, guidance.batches.total),
        completed: Math.min(
          guidance.batches.total,
          Math.max(0, guidance.batches.completed)
        )
      }
    : null;

  const estimatedProgress = React.useMemo(() => {
    if (!stats || !stats.total) {
      return null;
    }
    const completed = stats.completed + stats.skipped + stats.errors;
    return Math.min(100, Math.round((completed / stats.total) * 100));
  }, [stats]);

  return (
    <div
      className={`rounded-2xl border ${meta.tone} p-4 transition-all duration-500`}
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-1 items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
            {meta.icon}
          </div>
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                {meta.title}
              </h3>
              <p className="mt-1 text-sm text-white/70">{guidance.message}</p>
            </div>
            {guidance.tips?.length ? (
              <ul className="space-y-1 text-xs text-white/60">
                {guidance.tips.slice(0, 3).map((tip, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <span className="mt-[2px] block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white/30" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        {guidance.stage === 'completed' && (
          <CheckCircle2 className="h-6 w-6 text-emerald-300" />
        )}
      </div>

      {batches && (
        <div className="mt-4 grid grid-cols-1 gap-2 text-xs text-white/70 sm:grid-cols-3">
          <div className="rounded-xl bg-white/10 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-white/40">
              אצוות
            </div>
            <div className="text-sm font-semibold text-white">
              {batches.completed}/{batches.total}
            </div>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-white/40">
              גודל אצווה
            </div>
            <div className="text-sm font-semibold text-white">
              {guidance.batches?.size}
            </div>
          </div>
          {stats && (
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/40">
                קבוצות שטופלו
              </div>
              <div className="text-sm font-semibold text-white">
                {stats.completed + stats.skipped} / {stats.total}
              </div>
            </div>
          )}
        </div>
      )}

      {isScanning && estimatedProgress !== null && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>התקדמות כוללת</span>
            <span>{estimatedProgress}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 to-purple-400 transition-all duration-500"
              style={{ width: `${estimatedProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ScanGuidancePanel;
