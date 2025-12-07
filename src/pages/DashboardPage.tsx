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
      <div className="container mx-auto px-4 py-4">
        <div className={`${isRTL ? 'text-right' : 'text-left'} mb-4`}>
          <div
            className={`flex items-center justify-between gap-3 ${
              isRTL ? 'flex-row-reverse' : ''
            }`}
          >
            <div className={`flex items-center gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
              <img src="/icon-512.png" alt="Gramanager Logo" className="w-[60px] h-[50px] object-contain" />
              <h1 className="text-xl font-semibold text-white">
                Gramanager
              </h1>
            </div>
            <div
              className={`flex gap-2 ${
                isRTL ? 'flex-row-reverse' : ''
              }`}
            >
                   <button
                     onClick={() => void connectAllAccounts()}
                     disabled={loading || isBulkConnecting || accounts.length === 0}
                     className={`btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm ${isRTL ? 'flex-row-reverse' : ''} ${
                       loading || isBulkConnecting || accounts.length === 0 ? 'opacity-60 cursor-not-allowed' : ''
                     }`}
                   >
                     {isBulkConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                     {isRTL ? 'חבר הכל' : 'Connect All'}
                   </button>
              <button
                onClick={() => setShowUserLookup(true)}
                className={`btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm ${isRTL ? 'flex-row-reverse' : ''}`}
              >
                <Search className="w-3.5 h-3.5" />
                {isRTL ? 'משתמש' : 'User'}
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className={`btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm ${isRTL ? 'flex-row-reverse' : ''}`}
              >
                <Settings className="w-3.5 h-3.5" />
                {isRTL ? 'הגדרות' : 'Settings'}
              </button>
              <button
                onClick={() => openGroupsManager()}
                className={`btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm ${isRTL ? 'flex-row-reverse' : ''}`}
              >
                <Users className="w-3.5 h-3.5" />
                {isRTL ? 'ניהול קבוצות' : 'Manage Groups'}
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
               <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50" style={{ maxWidth: '470px', width: 'calc(100% - 2rem)' }}>
                 <button
                   onClick={() => setShowAddForm(true)}
                   disabled={accounts.length >= 10}
                   className="w-full glass-elevated p-3 hover-lift disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl"
                 >
                   <div className={`flex items-center justify-center gap-2 ${isRTL ? 'flex-row-reverse' : ''}`}>
                     <Plus className="w-5 h-5 text-blue-400" />
                     <span className="text-base font-semibold text-white">
                       {isRTL ? `הוסף חשבון (${accounts.length}/10)` : `Add Account (${accounts.length}/10)`}
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
