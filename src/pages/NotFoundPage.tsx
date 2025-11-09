import React from 'react';
import { Home, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import HeaderFullScreen from '../components/ui/HeaderFullScreen';

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/');
  };

  const handleGoHome = () => {
    navigate('/');
  };

  return (
    <div className="relative z-10 flex min-h-screen flex-col bg-slate-950/95" dir="rtl">
      <HeaderFullScreen
        title="דף לא נמצא"
        onBack={handleBack}
        description="הדף שחיפשת לא קיים"
      />

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="text-center">
          <div className="mb-8">
            <div className="text-8xl font-bold text-white/20 mb-4">404</div>
            <h1 className="text-3xl font-semibold text-white mb-4">
              דף לא נמצא
            </h1>
            <p className="text-white/60 text-lg max-w-md mx-auto">
              הדף שחיפשת לא קיים או הועבר למיקום אחר.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={handleBack}
              className="flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-white transition hover:bg-white/10"
            >
              <ArrowRight className="h-4 w-4" />
              חזרה
            </button>
            
            <button
              onClick={handleGoHome}
              className="flex items-center justify-center gap-2 rounded-full border border-blue-500/50 bg-blue-500/10 px-6 py-3 text-blue-200 transition hover:bg-blue-500/20"
            >
              <Home className="h-4 w-4" />
              דף הבית
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;
