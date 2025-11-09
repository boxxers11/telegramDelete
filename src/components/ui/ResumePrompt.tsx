import React from 'react';
import { ArrowLeftCircle, Repeat, X } from 'lucide-react';
import { ResumeSnapshot } from '../../state/resumeState';

interface ResumePromptProps {
  snapshot: ResumeSnapshot;
  onContinue: () => void;
  onDismiss: () => void;
  isRTL: boolean;
}

const ResumePrompt: React.FC<ResumePromptProps> = ({ snapshot, onContinue, onDismiss, isRTL }) => {
  const operations = snapshot.operations.slice(0, 5);
  const remaining = snapshot.operations.length - operations.length;
  const title = isRTL ? 'להמשיך את הפעולה האחרונה?' : 'Resume last action?';
  const description = isRTL
    ? 'האם להמשיך מהמקום בו עצרת?'
    : 'Would you like to pick up where you left off?';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className={`w-full max-w-lg rounded-3xl border border-white/10 bg-[#0F172A]/95 p-6 text-white shadow-2xl ${isRTL ? 'text-right' : 'text-left'}`}>
        <div className={`mb-4 flex items-center justify-between ${isRTL ? 'flex-row-reverse' : ''}`}>
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-white/60">{description}</p>
          </div>
          <button
            onClick={onDismiss}
            className="rounded-full border border-white/15 p-2 text-white/60 transition hover:text-white"
            aria-label={isRTL ? 'סגור' : 'Close'}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
          <div className="flex items-center gap-2">
            <Repeat className="h-5 w-5 text-blue-300" />
            <span>{snapshot.description}</span>
          </div>
          <ul className="mt-3 space-y-1 text-white/70">
            {operations.map((item) => (
              <li key={item} className="rounded-lg bg-white/5 px-3 py-2">
                {item}
              </li>
            ))}
            {remaining > 0 && (
              <li className="text-xs text-white/40">
                {isRTL ? `ועוד ${remaining} פריטים נוספים` : `+ ${remaining} more`}
              </li>
            )}
          </ul>
        </div>

        <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
          <button
            onClick={onContinue}
            className="btn-primary flex flex-1 items-center justify-center gap-2"
          >
            <ArrowLeftCircle className="h-4 w-4" />
            {isRTL ? 'המשך מהנקודה האחרונה' : 'Resume'}
          </button>
          <button
            onClick={onDismiss}
            className="btn-secondary flex flex-1 items-center justify-center"
          >
            {isRTL ? 'אפס' : 'Dismiss'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResumePrompt;
