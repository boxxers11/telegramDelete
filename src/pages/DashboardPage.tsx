import { useEffect } from 'react';
import { AlertCircle, CheckCircle, Loader, Loader2, Plus, Search, Settings, Users, Wifi } from 'lucide-react';
import AccountsList from '../components/ui/AccountsList';
import { useAppContext } from '../App';
import { groupsStore } from '../state/groups.store';

const DashboardPage: React.FC = () => {
  const {
    accountsState,
    scanController,
    language,
    setShowAddForm,
    setShowSettings,
    setShowUserLookup,
    openGroupsManager,
    openScan,
    openSendMessages,
    openSemanticSearch,
    isRTL
  } = useAppContext();

  const {
    accounts,
    loading,
    error,
    success,
    connectAccount,
    connectAllAccounts,
    bulkConnectState,
    isBulkConnecting,
    deleteAccount,
    clearMessages
  } = accountsState;

  const { loadScanHistory } = scanController;

  useEffect(() => {
    loadScanHistory();
  }, [loadScanHistory]);

  useEffect(() => {
    if (accounts.length === 0) {
      return;
    }
    accounts.forEach((account) => {
      groupsStore.initialise(account.id, Boolean(account.is_authenticated));
    });
  }, [accounts]);

  return (
    <div className="relative z-10 flex-1">
      <div className="container mx-auto px-4 py-8">
        <div className={`${isRTL ? 'text-right' : 'text-left md:text-center'} mb-12`}>
          <div
            className={`flex flex-col gap-4 md:items-center md:justify-between ${
              isRTL ? 'md:flex-row-reverse' : 'md:flex-row'
            }`}
          >
            <div
              className={`flex items-center gap-4 ${
                isRTL ? 'flex-row-reverse text-right md:text-right' : 'text-left'
              }`}
            >
              <div className="glass-elevated p-3 rounded-3xl shadow-xl">
                <img src="/logo.png" alt="Messages Manager Logo" className="w-10 h-10 rounded-lg" />
              </div>
              <div>
                <h1 className="text-headline text-white hebrew-semibold">
                  {isRTL ? 'מנהל הודעות' : 'Messages Manager'}
                </h1>
                <p className="text-subtitle mt-1 max-w-xl">
                  {isRTL
                    ? 'נהל את הודעות הטלגרם שלך בבטחה על פני מספר חשבונות'
                    : 'Safely manage your Telegram messages across multiple accounts'}
                </p>
              </div>
            </div>
            <div
              className={`flex gap-3 ${
                isRTL ? 'justify-end md:justify-start md:flex-row-reverse' : 'justify-start'
              }`}
            >
              <button
                onClick={() => void connectAllAccounts()}
                disabled={loading || isBulkConnecting || accounts.length === 0}
                className={`btn-primary flex items-center gap-2 ${isRTL ? 'flex-row-reverse' : ''} ${
                  loading || isBulkConnecting || accounts.length === 0 ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                {isBulkConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                {isRTL ? 'חבר את כל החשבונות' : 'Connect all accounts'}
              </button>
              <button
                onClick={() => setShowUserLookup(true)}
                className={`btn-secondary flex items-center gap-2 ${isRTL ? 'flex-row-reverse' : ''}`}
              >
                <Search className="w-4 h-4" />
                {isRTL ? 'בדיקת משתמש' : 'User Lookup'}
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className={`btn-secondary flex items-center gap-2 ${isRTL ? 'flex-row-reverse' : ''}`}
              >
                <Settings className="w-4 h-4" />
                {isRTL ? 'הגדרות' : 'Settings'}
              </button>
              <button
                onClick={() => openGroupsManager()}
                className={`btn-secondary flex items-center gap-2 ${isRTL ? 'flex-row-reverse' : ''}`}
              >
                <Users className="w-4 h-4" />
                ניהול קבוצות
              </button>
            </div>
          </div>
        </div>

        {(error || success) && (
          <div className="max-w-4xl mx-auto mb-6">
            {error && (
              <div className={`status-error status-banner mb-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
                <div className={`flex items-center gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-body">{error}</span>
                </div>
                <button onClick={clearMessages} className="text-white hover:text-gray-200">
                  ×
                </button>
              </div>
            )}
            {success && (
              <div className={`status-success status-banner mb-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
                <div className={`flex items-center gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
                  <CheckCircle className="w-5 h-5" />
                  <span className="text-body">{success}</span>
                </div>
                <button onClick={clearMessages} className="text-white hover:text-gray-200">
                  ×
                </button>
              </div>
            )}
            {isBulkConnecting && bulkConnectState && (
              <div className={`glass-elevated mb-4 p-4 text-white/80 ${isRTL ? 'text-right' : 'text-left'}`}>
                <div className={`flex items-center gap-3 ${isRTL ? 'flex-row-reverse justify-end' : ''}`}>
                  <Loader2 className="w-5 h-5 animate-spin text-blue-300" />
                  <span>
                    {isRTL
                      ? `מחבר חשבונות (${bulkConnectState.completed}/${bulkConnectState.total})`
                      : `Connecting accounts (${bulkConnectState.completed}/${bulkConnectState.total})`}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="max-w-4xl mx-auto mb-8">
            <div className="glass-elevated p-6 text-center">
              <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-400" />
              <span className="text-title text-white">Loading accounts...</span>
            </div>
          </div>
        )}

        {!loading && (
          <div className="max-w-4xl mx-auto mb-8">
            <button
              onClick={() => setShowAddForm(true)}
              disabled={accounts.length >= 5}
              className="w-full glass-elevated p-6 hover-lift disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className={`flex items-center justify-center ${isRTL ? 'flex-row-reverse gap-3' : 'gap-3'}`}>
                <div className={`glass-card p-3 rounded-2xl ${isRTL ? 'ml-3' : 'mr-3'}`}>
                  <Plus className="w-8 h-8 text-blue-400" />
                </div>
                <span className="text-title text-white">
                  {isRTL ? `הוסף חשבון (${accounts.length}/5)` : `Add Account (${accounts.length}/5)`}
                </span>
              </div>
            </button>
          </div>
        )}

        <AccountsList
          accounts={accounts}
          loading={loading}
          onConnect={connectAccount}
          onDelete={deleteAccount}
          onScan={openScan}
          onSendMessage={openSendMessages}
          onSemanticSearch={openSemanticSearch}
          language={language}
          isBulkConnecting={isBulkConnecting}
          bulkConnectState={bulkConnectState}
        />
      </div>
    </div>
  );
};

export default DashboardPage;
