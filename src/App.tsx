import { useState, useEffect } from 'react';
import { Plus, Settings, CheckCircle, AlertCircle, Loader } from 'lucide-react';

// Import custom hooks
import { useAccounts } from './hooks/useAccounts';
import { useSemanticSearch } from './hooks/useSemanticSearch';

// Import UI components
import AccountsList from './components/ui/AccountsList';
import AddAccountForm from './components/ui/AddAccountForm';
import LoginModal from './components/ui/LoginModal';
import SettingsModal from './components/ui/SettingsModal';
import ScanModal from './components/ui/ScanModal';
import MessageWizardModal from './components/ui/MessageWizardModal';
import SemanticSearchModal from './components/SemanticSearchModal';

// --- Main App Component ---
function App() {
    // State for managing UI modals and global settings
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [showMessageWizard, setShowMessageWizard] = useState(false);
  const [showSemanticSearch, setShowSemanticSearch] = useState(false);
  const [selectedAccountForScan, setSelectedAccountForScan] = useState<{id: string, label: string} | null>(null);
  const [selectedAccountForMessage, setSelectedAccountForMessage] = useState<{id: string, label: string} | null>(null);
  const [selectedAccountForSemanticSearch, setSelectedAccountForSemanticSearch] = useState<{id: string, label: string} | null>(null);
  const [language, setLanguage] = useState<'he' | 'en'>(() => {
    const saved = localStorage.getItem('telegram_app_language');
    return (saved as 'he' | 'en') || 'he';
  });
  const [uiMode, setUiMode] = useState<'simple' | 'advanced' | 'diamond'>(() => {
    const saved = localStorage.getItem('telegram_app_ui_mode');
    return (saved as 'simple' | 'advanced' | 'diamond') || 'diamond';
  });

    // Custom hooks
    const {
        accounts,
        loading,
        error,
        success,
        showLoginModal,
        loadAccounts,
        addAccount,
        connectAccount,
        verifyCode,
        deleteAccount,
        clearMessages,
        closeLoginModal
    } = useAccounts();
    
    const { 
        startSearch, 
        stopSearch, 
        searchProgress, 
        searchResults, 
        isSearching 
    } = useSemanticSearch();


    // Load accounts and restore state on component mount
  useEffect(() => {
        const loadData = async () => {
            try {
                console.log('🚀 App.tsx: Starting to load accounts and restore state...');
                await loadAccounts();
                
                // Restore modal states from localStorage
                const savedModalState = localStorage.getItem('telegram_app_modal_state');
                console.log('🔍 Checking for saved modal state:', savedModalState);
                if (savedModalState) {
                    try {
                        const modalState = JSON.parse(savedModalState);
                        console.log('📱 Restoring modal state:', modalState);
                        if (modalState.showScanModal && modalState.selectedAccountForScan) {
                            console.log('🔍 Restoring scan modal for account:', modalState.selectedAccountForScan);
                            setSelectedAccountForScan(modalState.selectedAccountForScan);
                            setShowScanModal(true);
                        }
                        if (modalState.showMessageWizard && modalState.selectedAccountForMessage) {
                            console.log('💬 Restoring message wizard for account:', modalState.selectedAccountForMessage);
                            setSelectedAccountForMessage(modalState.selectedAccountForMessage);
                            setShowMessageWizard(true);
                        }
                        if (modalState.showSemanticSearch && modalState.selectedAccountForSemanticSearch) {
                            console.log('🔍 Restoring semantic search for account:', modalState.selectedAccountForSemanticSearch);
                            setSelectedAccountForSemanticSearch(modalState.selectedAccountForSemanticSearch);
                            setShowSemanticSearch(true);
                        }
                    } catch (error) {
                        console.error('❌ Error parsing modal state:', error);
                    }
                } else {
                    console.log('ℹ️ No saved modal state found');
                }
    } catch (error) {
                console.error('App.tsx: Error loading accounts:', error);
            }
        };
        loadData();
    }, []); // Empty dependency array - only run once on mount

    // Update groups data when accounts are loaded (NOT restore!)
    useEffect(() => {
        if (accounts.length > 0) {
            const updateGroupsData = async () => {
                const authenticatedAccounts = accounts.filter(acc => acc.is_authenticated);
                for (const account of authenticatedAccounts) {
                    try {
                        console.log(`📋 Updating groups data for account ${account.label}...`);
                        
                        // Get current groups from server
                        const response = await fetch(`http://127.0.0.1:8001/accounts/${account.id}/chats`);
                        if (response.ok) {
                            const currentGroups = await response.json();
                            
                            // Check if we have saved groups to compare
                            const savedGroups = localStorage.getItem(`groups_${account.id}`);
                            if (savedGroups) {
                                const savedGroupsData = JSON.parse(savedGroups);
                                
                                // Compare to detect changes
                                if (currentGroups.length !== savedGroupsData.length) {
                                    console.log(`🔄 Groups changed for account ${account.label}: ${savedGroupsData.length} → ${currentGroups.length}`);
                                } else {
                                    console.log(`✅ Groups unchanged for account ${account.label}`);
                                }
                            }
                            
                            // Always update with latest data (this is UPDATE, not restore!)
                            localStorage.setItem(`groups_${account.id}`, JSON.stringify(currentGroups));
                            console.log(`✅ Updated groups data for account ${account.label}: ${currentGroups.length} groups`);
                        }
                    } catch (error) {
                        console.error(`Failed to update groups for account ${account.label}:`, error);
                    }
                }
            };
            updateGroupsData();
        }
    }, [accounts]);

    // Event handlers
    const handleAddAccount = async (accountData: {
        label: string;
        api_id: string;
        api_hash: string;
        phone: string;
    }) => {
        const result = await addAccount(accountData);
        if (result.success) {
        setShowAddForm(false);
        }
        return result;
  };

  const handleConnect = async (accountId: string) => {
        await connectAccount(accountId);
    };

    const handleVerifyCode = async (code: string, password?: string) => {
        const result = await verifyCode(code, password);
        if (result.success) {
            closeLoginModal();
        }
        return result;
  };

  const handleDeleteAccount = async (accountId: string) => {
    if (!confirm('Are you sure you want to delete this account?')) return;
        await deleteAccount(accountId);
    };

    const handleScan = async (accountId: string) => {
        const account = accounts.find(acc => acc.id === accountId);
        if (account) {
            const accountData = { id: accountId, label: account.label };
            setSelectedAccountForScan(accountData);
            setShowScanModal(true);
            
            // Save modal state to localStorage
            const modalState = {
                showScanModal: true,
                selectedAccountForScan: accountData,
                showMessageWizard: showMessageWizard,
                selectedAccountForMessage: selectedAccountForMessage,
                showSemanticSearch: showSemanticSearch,
                selectedAccountForSemanticSearch: selectedAccountForSemanticSearch
            };
            console.log('💾 Saving scan modal state:', modalState);
            localStorage.setItem('telegram_app_modal_state', JSON.stringify(modalState));
            console.log('✅ Scan modal state saved to localStorage');
        }
    };

    const handleSendMessage = (accountId: string) => {
        const account = accounts.find(acc => acc.id === accountId);
        if (account) {
            const accountData = { id: accountId, label: account.label };
            setSelectedAccountForMessage(accountData);
            setShowMessageWizard(true);
            
            // Save modal state to localStorage
            const modalState = {
                showScanModal: showScanModal,
                selectedAccountForScan: selectedAccountForScan,
                showMessageWizard: true,
                selectedAccountForMessage: accountData,
                showSemanticSearch: showSemanticSearch,
                selectedAccountForSemanticSearch: selectedAccountForSemanticSearch
            };
            localStorage.setItem('telegram_app_modal_state', JSON.stringify(modalState));
        }
    };

    const handleSemanticSearch = (accountId: string) => {
        const account = accounts.find(acc => acc.id === accountId);
        if (account) {
            const accountData = { id: accountId, label: account.label };
            setSelectedAccountForSemanticSearch(accountData);
            setShowSemanticSearch(true);
            
            // Save modal state to localStorage
            const modalState = {
                showScanModal: showScanModal,
                selectedAccountForScan: selectedAccountForScan,
                showMessageWizard: showMessageWizard,
                selectedAccountForMessage: selectedAccountForMessage,
                showSemanticSearch: true,
                selectedAccountForSemanticSearch: accountData
            };
            localStorage.setItem('telegram_app_modal_state', JSON.stringify(modalState));
        }
    };

    
    return (
        <div className="min-h-screen relative" dir={language === 'he' ? 'rtl' : 'ltr'}>
            {/* Background */}
            <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: 'url("/cosmic-background.jpg")' }} />
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
            

            <div className="relative z-10 container mx-auto px-4 py-8">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="flex items-center justify-center mb-4">
                        <div className="glass-elevated p-3 mr-4">
                            <img src="/logo.png" alt="Messages Manager Logo" className="w-10 h-10 rounded-lg" />
                        </div>
                        <h1 className="text-headline text-white">
                            {language === 'he' ? 'מנהל הודעות' : 'Messages Manager'}
                        </h1>
                        <div className="flex space-x-2 ml-4">
                <button
                                onClick={() => setShowSettings(true)}
                                className="btn-secondary flex items-center"
                            >
                                <Settings className="w-4 h-4 mr-2" />
                                {language === 'he' ? 'הגדרות' : 'Settings'}
                </button>
              </div>
            </div>
                    <p className="text-subtitle max-w-2xl mx-auto">
                        {language === 'he' 
                            ? 'נהל את הודעות הטלגרם שלך בבטחה על פני מספר חשבונות'
                            : 'Safely manage your Telegram messages across multiple accounts'
                        }
          </p>
        </div>

        {/* Messages */}
        {(error || success) && (
                    <div className="max-w-4xl mx-auto mb-6">
            {error && (
                            <div className="status-error glass-card p-4 mb-4 flex items-center justify-between">
                <div className="flex items-center">
                  <AlertCircle className="w-5 h-5 mr-3" />
                                    <span className="text-body">{error}</span>
                </div>
                                <button onClick={clearMessages} className="text-white hover:text-gray-300">
                  ×
                </button>
              </div>
            )}
            {success && (
                            <div className="status-success glass-card p-4 mb-4 flex items-center justify-between">
                <div className="flex items-center">
                  <CheckCircle className="w-5 h-5 mr-3" />
                                    <span className="text-body">{success}</span>
                </div>
                                <button onClick={clearMessages} className="text-white hover:text-gray-300">
                  ×
                </button>
              </div>
            )}
          </div>
        )}

                {/* Loading State */}
                {loading && (
                    <div className="max-w-4xl mx-auto mb-8">
                        <div className="glass-elevated p-6 text-center">
                            <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-400" />
                            <span className="text-title text-white">Loading accounts...</span>
                        </div>
                    </div>
                )}

        {/* Add Account Button */}
                {!loading && (
                    <div className="max-w-4xl mx-auto mb-8">
          <button
            onClick={() => setShowAddForm(true)}
            disabled={accounts.length >= 5}
                            className="w-full glass-elevated p-6 hover-lift disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center justify-center">
                                <div className="glass-card p-3 mr-3">
                                    <Plus className="w-8 h-8 text-blue-400" />
              </div>
                                <span className="text-title text-white">
                Add Account ({accounts.length}/5)
              </span>
            </div>
          </button>
        </div>
                )}

        {/* Add Account Form */}
                <AddAccountForm
                    isOpen={showAddForm}
                    onClose={() => setShowAddForm(false)}
                    onAdd={handleAddAccount}
                    loading={loading}
                />

                {/* Login Modal */}
                <LoginModal
                    data={showLoginModal}
                    onClose={closeLoginModal}
                    onVerify={handleVerifyCode}
                    loading={loading}
                />


                {/* Accounts List */}
                <AccountsList
                    accounts={accounts}
                    loading={loading}
                    onConnect={handleConnect}
                    onDelete={handleDeleteAccount}
                    onScan={handleScan}
                    onSendMessage={handleSendMessage}
                    onSemanticSearch={handleSemanticSearch}
                />

            </div>

            {/* Settings Modal */}
            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                language={language}
                onLanguageChange={(newLanguage) => {
                    setLanguage(newLanguage);
                    localStorage.setItem('telegram_app_language', newLanguage);
                }}
                uiMode={uiMode}
                onUiModeChange={(newUiMode) => {
                    setUiMode(newUiMode);
                    localStorage.setItem('telegram_app_ui_mode', newUiMode);
                }}
            />

            {/* Scan Modal */}
            {selectedAccountForScan && (
                <ScanModal
                    isOpen={showScanModal}
                    onClose={() => {
                        setShowScanModal(false);
                        setSelectedAccountForScan(null);
                        // Clear modal state from localStorage
                        localStorage.removeItem('telegram_app_modal_state');
                    }}
                    accountId={selectedAccountForScan.id}
                    accountLabel={selectedAccountForScan.label}
                />
            )}

            {/* Message Wizard Modal */}
            {selectedAccountForMessage && (
                <MessageWizardModal
                    isOpen={showMessageWizard}
                    onClose={() => {
                        setShowMessageWizard(false);
                        setSelectedAccountForMessage(null);
                        // Clear modal state from localStorage
                        localStorage.removeItem('telegram_app_modal_state');
                    }}
                    accountId={selectedAccountForMessage.id}
                    accountLabel={selectedAccountForMessage.label}
                />
            )}

            {/* Semantic Search Modal */}
            {selectedAccountForSemanticSearch && (
                <SemanticSearchModal
                    isOpen={showSemanticSearch}
                    onClose={() => {
                        setShowSemanticSearch(false);
                        setSelectedAccountForSemanticSearch(null);
                        // Clear modal state from localStorage
                        localStorage.removeItem('telegram_app_modal_state');
                    }}
                    accountId={selectedAccountForSemanticSearch.id}
                    onSearchStart={startSearch}
                    onSearchStop={stopSearch}
                    isSearching={isSearching}
                    searchProgress={searchProgress || undefined}
                    searchResults={searchResults}
                />
            )}
        </div>
    );
}

export default App;
