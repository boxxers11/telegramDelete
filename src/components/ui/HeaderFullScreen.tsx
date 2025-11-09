import React from 'react';
import { ArrowRight, X } from 'lucide-react';

interface HeaderFullScreenProps {
  title: string;
  onBack: () => void;
  actions?: React.ReactNode;
  description?: React.ReactNode;
  hideClose?: boolean;
}

const HeaderFullScreen: React.FC<HeaderFullScreenProps> = ({
  title,
  onBack,
  actions,
  description,
  hideClose = false
}) => {
  return (
    <header
      className="flex flex-row-reverse flex-wrap items-center gap-6 border-b border-white/10 bg-black/40 px-6 py-4 text-white"
      dir="rtl"
    >
      <div className="flex items-center">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm transition hover:bg-white/10"
          type="button"
        >
          <ArrowRight className="h-4 w-4" />
          חזרה
        </button>
      </div>
      <div className="flex-1 min-w-[200px] text-center sm:text-right">
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        {description && (
          <div className="mt-1 text-sm text-white/60" dir="rtl">
            {description}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-start gap-3" dir="ltr">
        {actions}
      </div>
    </header>
  );
};

export default HeaderFullScreen;
