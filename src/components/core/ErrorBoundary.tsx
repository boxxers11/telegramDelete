import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  handleReload = () => {
    try {
      localStorage.removeItem('telegram_app_route_state');
    } catch {
      // ignore storage errors
    }
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-white" dir="rtl">
          <div className="max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
            <h1 className="mb-4 text-2xl font-semibold">התרחשה תקלה בלתי צפויה</h1>
            <p className="mb-6 text-white/70">
              המערכת נתקלה בשגיאה שלא ניתן היה לטפל בה. ניתן לרענן את הדף כדי לחזור למסך הראשי.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm font-medium transition hover:bg-white/20"
            >
              חזרה למסך הבית
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
