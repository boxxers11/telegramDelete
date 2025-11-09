import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import AddAccountForm from './components/ui/AddAccountForm';
import BacklogWidget from './components/BacklogWidget';
import LoginModal from './components/ui/LoginModal';
import SettingsModal from './components/ui/SettingsModal';
import UserLookupModal from './components/ui/UserLookupModal';
import ErrorBoundary from './components/core/ErrorBoundary';
import { useAccounts } from './hooks/useAccounts';
import { useScan } from './hooks/useScan';
import { useSemanticSearch } from './hooks/useSemanticSearch';
import ResumePrompt from './components/ui/ResumePrompt';
import GlobalOperationsStatus from './components/ui/GlobalOperationsStatus';
import { clearResumeSnapshot, getResumeSnapshot, ResumeSnapshot } from './state/resumeState';
import DashboardPage from './pages/DashboardPage';
import GroupsManagerPage from './pages/GroupsManagerPage';
import ScanPage from './pages/ScanPage';
import SemanticSearchPage from './pages/SemanticSearchPage';
import SendMessagesPage from './pages/SendMessagesPage';
import DirectMessagePage from './pages/direct/DirectMessagePage';
import GroupChannelPage from './pages/groups/GroupChannelPage';
import NotFoundPage from './pages/NotFoundPage';

const ROUTE_STATE_KEY = 'telegram_app_route_state';

type LanguageOption = 'he' | 'en';
type UiModeOption = 'simple' | 'advanced' | 'diamond';

interface AppContextValue {
  accountsState: ReturnType<typeof useAccounts>;
  scanController: ReturnType<typeof useScan>;
  semanticSearch: ReturnType<typeof useSemanticSearch>;
  language: LanguageOption;
  setLanguage: (lang: LanguageOption) => void;
  uiMode: UiModeOption;
  setUiMode: (mode: UiModeOption) => void;
  showAddForm: boolean;
  setShowAddForm: (flag: boolean) => void;
  showSettings: boolean;
  setShowSettings: (flag: boolean) => void;
  showUserLookup: boolean;
  setShowUserLookup: (flag: boolean) => void;
  openScan: (accountId: string) => void;
  openSendMessages: (accountId: string) => void;
  openSemanticSearch: (accountId: string) => void;
  openGroupsManager: (accountId?: string) => void;
  isRTL: boolean;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export const useAppContext = (): AppContextValue => {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used within AppStateProvider');
  }
  return ctx;
};

const restoreLegacyModalState = (): string | null => {
  const stored = localStorage.getItem('telegram_app_modal_state');
  if (!stored) {
    return null;
  }

  try {
    const modalState = JSON.parse(stored);
    if (modalState.showScanModal && modalState.selectedAccountForScan?.id) {
      return `/scan/${modalState.selectedAccountForScan.id}`;
    }
    if (modalState.showMessageWizard && modalState.selectedAccountForMessage?.id) {
      return `/messages/${modalState.selectedAccountForMessage.id}`;
    }
    if (modalState.showSemanticSearch && modalState.selectedAccountForSemanticSearch?.id) {
      return `/semantic/${modalState.selectedAccountForSemanticSearch.id}`;
    }
  } catch (error) {
    console.warn('Failed to parse legacy modal state', error);
  } finally {
    localStorage.removeItem('telegram_app_modal_state');
  }

  return null;
};

const readStoredRoute = (): string | null => {
  const stored = localStorage.getItem(ROUTE_STATE_KEY);
  if (!stored) {
    return null;
  }
  try {
    const data = JSON.parse(stored);
    if (typeof data?.path === 'string' && data.path.length > 0) {
      return data.path;
    }
  } catch (error) {
    console.warn('Failed to parse route state', error);
  }
  return null;
};

const AppStateProvider: React.FC = () => {
  const accountsState = useAccounts();
  const scanController = useScan();
  const semanticSearch = useSemanticSearch();
  const navigate = useNavigate();
  const location = useLocation();

  const [language, setLanguageState] = useState<LanguageOption>(() => {
    const saved = localStorage.getItem('telegram_app_language');
    return (saved === 'he' || saved === 'en') ? saved : 'he';
  });
  const [uiMode, setUiModeState] = useState<UiModeOption>(() => {
    const saved = localStorage.getItem('telegram_app_ui_mode');
    return saved === 'simple' || saved === 'advanced' ? saved : saved === 'diamond' ? saved : 'diamond';
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUserLookup, setShowUserLookup] = useState(false);
  const [routeRestored, setRouteRestored] = useState(false);
  const [resumeSnapshot, setResumeSnapshot] = useState<ResumeSnapshot | null>(null);

  useEffect(() => {
    void accountsState.loadAccounts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (routeRestored || accountsState.loading) {
      return;
    }

    let targetPath: string | null = restoreLegacyModalState();
    if (!targetPath) {
      targetPath = readStoredRoute();
    }

    setRouteRestored(true);

    if (targetPath && targetPath !== location.pathname) {
      navigate(targetPath, { replace: true });
    }
  }, [accountsState.loading, location.pathname, navigate, routeRestored]);

  useEffect(() => {
    if (!routeRestored) {
      return;
    }
    const snapshot = getResumeSnapshot();
    if (!snapshot || snapshot.status !== 'pending') {
      return;
    }
    const maxAgeMs = 6 * 60 * 60 * 1000; // 6 hours
    if (Date.now() - snapshot.startedAt > maxAgeMs) {
      clearResumeSnapshot();
      return;
    }
    setResumeSnapshot(snapshot);
  }, [routeRestored]);

  useEffect(() => {
    if (!routeRestored) {
      return;
    }
    if (location.pathname === '/') {
      localStorage.removeItem(ROUTE_STATE_KEY);
    } else {
      localStorage.setItem(
        ROUTE_STATE_KEY,
        JSON.stringify({ path: location.pathname + location.search, timestamp: Date.now() })
      );
    }
  }, [location.pathname, location.search, routeRestored]);

  const setLanguage = useCallback((next: LanguageOption) => {
    setLanguageState(next);
    localStorage.setItem('telegram_app_language', next);
  }, []);

  const setUiMode = useCallback((next: UiModeOption) => {
    setUiModeState(next);
    localStorage.setItem('telegram_app_ui_mode', next);
  }, []);

  const openScan = useCallback((accountId: string) => {
    navigate(`/scan/${accountId}`);
  }, [navigate]);

  const openSendMessages = useCallback((accountId: string) => {
    navigate(`/messages/${accountId}`);
  }, [navigate]);

  const openSemanticSearch = useCallback((accountId: string) => {
    navigate(`/semantic/${accountId}`);
  }, [navigate]);

  const openGroupsManager = useCallback((accountId?: string) => {
    const suffix = accountId ? `?account=${encodeURIComponent(accountId)}` : '';
    navigate(`/groups${suffix}`);
  }, [navigate]);

  const handleResumeContinue = useCallback(() => {
    if (!resumeSnapshot) {
      return;
    }
    const snapshot = resumeSnapshot;
    clearResumeSnapshot();
    setResumeSnapshot(null);

    if (snapshot.type === 'scan') {
      openScan(snapshot.accountId);
      return;
    }

    if (snapshot.type === 'direct_send') {
      localStorage.setItem('telegram_messages_resume_tab', 'direct');
    }
    openSendMessages(snapshot.accountId);
  }, [resumeSnapshot, openScan, openSendMessages]);

  const handleResumeDismiss = useCallback(() => {
    clearResumeSnapshot();
    setResumeSnapshot(null);
  }, []);

  const contextValue = useMemo<AppContextValue>(() => ({
    accountsState,
    scanController,
    semanticSearch,
    language,
    setLanguage,
    uiMode,
    setUiMode,
    showAddForm,
    setShowAddForm,
    showSettings,
    setShowSettings,
    showUserLookup,
    setShowUserLookup,
    openScan,
    openSendMessages,
    openSemanticSearch,
    openGroupsManager,
    isRTL: language === 'he'
  }), [
    accountsState,
    scanController,
    semanticSearch,
    language,
    setLanguage,
    uiMode,
    setUiMode,
    showAddForm,
    showSettings,
    showUserLookup,
    openScan,
    openSendMessages,
    openSemanticSearch,
    openGroupsManager
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      <div className="min-h-screen w-full" dir={contextValue.isRTL ? 'rtl' : 'ltr'}>
        <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: 'url("/cosmic-background.jpg")' }} />
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
        <div className="relative z-10 flex min-h-screen flex-col">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>

      <AddAccountForm
        isOpen={contextValue.showAddForm}
        onClose={() => setShowAddForm(false)}
        onAdd={accountsState.addAccount}
        loading={accountsState.loading}
      />

      <LoginModal
        data={accountsState.showLoginModal}
        onClose={accountsState.closeLoginModal}
        onVerify={accountsState.verifyCode}
        loading={accountsState.loading}
      />

      <SettingsModal
        isOpen={contextValue.showSettings}
        onClose={() => setShowSettings(false)}
        language={language}
        onLanguageChange={setLanguage}
        uiMode={uiMode}
        onUiModeChange={setUiMode}
      />

      <UserLookupModal
        isOpen={contextValue.showUserLookup}
        onClose={() => setShowUserLookup(false)}
        accounts={accountsState.accounts}
      />

      <BacklogWidget />
      <GlobalOperationsStatus
        onAccountClick={(accountId, operationType) => {
          if (operationType === 'scan') {
            openScan(accountId);
          } else if (operationType === 'join_groups') {
            openGroupsManager(accountId);
          }
        }}
      />
      {resumeSnapshot && (
        <ResumePrompt
          snapshot={resumeSnapshot}
          onContinue={handleResumeContinue}
          onDismiss={handleResumeDismiss}
          isRTL={contextValue.isRTL}
        />
      )}
    </AppContext.Provider>
  );
};

const App: React.FC = () => {
  return (
    <Routes>
      <Route element={<AppStateProvider />}>
        <Route index element={<DashboardPage />} />
        <Route path="scan/:accountId" element={<ScanPage />} />
        <Route path="messages/:accountId" element={<SendMessagesPage />} />
        <Route path="semantic/:accountId" element={<SemanticSearchPage />} />
        <Route path="groups" element={<GroupsManagerPage />} />
        <Route path="dm/:accountId/:userId" element={<DirectMessagePage />} />
        <Route path="group/:accountId/:chatId" element={<GroupChannelPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
};

export default App;
