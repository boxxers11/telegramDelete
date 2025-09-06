import React, { useState, useEffect } from 'react';
import { MessageSquare, Users, Settings, Trash2, Search, Plus, X, AlertTriangle, CheckCircle, Clock, Phone, Key, User, Server } from 'lucide-react';

interface Account {
  id: string;
  label: string;
  phone: string;
  api_id: string;
  api_hash: string;
  is_authenticated: boolean;
  username?: string;
}

interface ChatResult {
  id: number;
  title: string;
  type: string;
  participants_count: number;
  candidates_found: number;
  deleted: number;
  error?: string;
  skipped_reason?: string;
}

interface OperationResult {
  chats: ChatResult[];
  summary: {
    total_chats_processed: number;
    total_chats_skipped: number;
    total_candidates: number;
    total_deleted: number;
  };
  logs: string[];
}

function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<OperationResult | null>(null);
  
  // Form states
  const [newAccount, setNewAccount] = useState({
    label: '',
    api_id: '',
    api_hash: '',
    phone: ''
  });
  
  const [loginData, setLoginData] = useState({
    code: '',
    password: ''
  });
  
  const [filters, setFilters] = useState({
    include_private: false,
    chat_name_filters: '',
    after: '',
    before: '',
    limit_per_chat: '',
    revoke: true,
    test_mode: false
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    checkServerConnection();
  }, []);

  const checkServerConnection = async () => {
    try {
      const response = await fetch('/api/accounts');
      
      if (response.ok) {
        const accountsData = await response.json();
        setAccounts(accountsData);
        setIsDemoMode(false);
        setError('');
        setSuccess('');
        // Clear any demo data from localStorage
        localStorage.removeItem('telegram_accounts_demo');
        console.log('✅ Server mode active - connected to Python backend');
      } else {
        throw new Error(`Server responded with ${response.status}`);
      }
    } catch (err) {
      console.log('❌ Server connection failed, switching to demo mode:', err);
      setIsDemoMode(true);
      loadAccountsFromStorage();
    }
  };

  const loadAccountsFromStorage = () => {
    try {
      const stored = localStorage.getItem('telegram_accounts_demo');
      if (stored) {
        setAccounts(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Error loading accounts from localStorage:', err);
    }
  };

  const loadAccounts = () => {
    if (isDemoMode) {
      loadAccountsFromStorage();
    } else {
      // Load from server
      checkServerConnection();
    }
  };

  const saveAccountsToStorage = (accountsToSave: Account[]) => {
    try {
      localStorage.setItem('telegram_accounts_demo', JSON.stringify(accountsToSave));
      setAccounts(accountsToSave);
    } catch (err) {
      console.error('Error saving accounts to localStorage:', err);
      setError('Failed to save accounts to local storage');
    }
  };

  const saveAccountsToServer = async (accountData: any) => {
    try {
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(accountData)
      });

      if (!response.ok) {
        throw new Error(`Server error ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        await checkServerConnection();
        return true;
      } else {
        throw new Error(data.error || 'Failed to add account');
      }
    } catch (err) {
      throw err;
    }
  };

  const addAccount = () => {
    if (!newAccount.label || !newAccount.api_id || !newAccount.api_hash || !newAccount.phone) {
      setError('Please fill in all fields');
      return;
    }

    if (accounts.length >= 5) {
      setError('Maximum of 5 accounts allowed');
      return;
    }

    setError('');
    setSuccess('');
    
    const newId = `acc_${Date.now()}`;
    const account: Account = {
      id: newId,
      label: newAccount.label,
      api_id: newAccount.api_id,
      api_hash: newAccount.api_hash,
      phone: newAccount.phone,
      is_authenticated: false
    };

    if (isDemoMode) {
      // Demo mode - save to localStorage
      const updatedAccounts = [...accounts, account];
      saveAccountsToStorage(updatedAccounts);
      setSuccess('Account added to demo! To actually use Telegram functionality, run the Python server locally.');
    } else {
      // Server mode - save to server
      saveAccountsToServer({
        label: newAccount.label,
        api_id: parseInt(newAccount.api_id),
        api_hash: newAccount.api_hash,
        phone: newAccount.phone
      }).then(() => {
        setSuccess('Account added successfully!');
      }).catch((err) => {
        setError(`Failed to add account: ${err.message}`);
      });
    }
    
    setNewAccount({ label: '', api_id: '', api_hash: '', phone: '' });
    setShowAddAccount(false);
  };

  const removeAccount = (accountId: string) => {
    if (!confirm('Are you sure you want to remove this account?')) return;

    if (isDemoMode) {
      const updatedAccounts = accounts.filter(acc => acc.id !== accountId);
      saveAccountsToStorage(updatedAccounts);
      setSuccess('Account removed from demo');
    } else {
      removeAccountFromServer(accountId);
    }
  };

  const connectAccount = (accountId: string) => {
    if (isDemoMode) {
      setError('This is a demo version. To actually connect to Telegram, you need to run the Python server locally.');
      return;
    }
    
    // Real server connection logic would go here
    setError('Server connection functionality will be implemented here');
  };

  const scanAccount = (accountId: string) => {
    if (isDemoMode) {
      setError('This is a demo version. To actually scan messages, you need to run the Python server locally.');
      return;
    }
    
    // Real scan logic would go here
    setError('Scan functionality will be implemented here');
  };

  const deleteAccount = (accountId: string) => {
    if (isDemoMode) {
      setError('This is a demo version. To actually delete messages, you need to run the Python server locally.');
      return;
    }
    
    // Real delete logic would go here
    setError('Delete functionality will be implemented here');
  };

  const scanAllAccounts = () => {
    if (isDemoMode) {
      setError('This is a demo version. To actually scan messages, you need to run the Python server locally.');
      return;
    }
    
    // Real scan all logic would go here
    setError('Scan all functionality will be implemented here');
  };

  const deleteAllAccounts = () => {
    if (isDemoMode) {
      setError('This is a demo version. To actually delete messages, you need to run the Python server locally.');
      return;
    }
    
    // Real delete all logic would go here
    setError('Delete all functionality will be implemented here');
  };

  const authenticatedAccounts = accounts.filter(acc => acc.is_authenticated);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <MessageSquare className="w-12 h-12 text-blue-600 mr-3" />
            <h1 className="text-4xl font-bold text-gray-900">Telegram Message Manager</h1>
          </div>
          <p className="text-gray-600 text-lg">Safely manage your Telegram messages across multiple accounts</p>
          
          {/* Warning Banner */}
          <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg max-w-4xl mx-auto">
            <div className="flex items-start">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold mb-1">Important Safety Notice</p>
                <p>This tool only deletes YOUR messages and automatically skips groups with 10 or fewer members. You are responsible for compliance with Telegram's Terms of Service.</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Demo Mode Notice */}
        {isDemoMode && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start">
              <Server className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">Demo Mode Active</p>
                <p>Python server not detected. You're viewing the demo interface. To use actual Telegram functionality, download the project and run the Python server locally using <code className="bg-blue-100 px-1 rounded">run.sh</code> (Mac/Linux) or <code className="bg-blue-100 px-1 rounded">run.bat</code> (Windows).</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Server Mode Notice */}
        {!isDemoMode && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 mr-3 flex-shrink-0" />
              <div className="text-sm text-green-800">
                <p className="font-semibold mb-1">Server Mode Active</p>
                <p>Successfully connected to Python backend. You can now add accounts and use all Telegram functionality.</p>
              </div>
            </div>
          </div>
        )}

        {/* Alerts */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center">
              <X className="w-5 h-5 text-red-600 mr-2" />
              <span className="text-red-800">{error}</span>
              <button onClick={() => setError('')} className="ml-auto text-red-600 hover:text-red-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center">
              <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
              <span className="text-green-800">{success}</span>
              <button onClick={() => setSuccess('')} className="ml-auto text-green-600 hover:text-green-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column - Account Management */}
          <div className="xl:col-span-2 space-y-6">
            {/* Accounts Section */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <Users className="w-6 h-6 text-blue-600 mr-2" />
                  <h2 className="text-2xl font-semibold text-gray-900">Accounts</h2>
                  <span className="ml-3 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
                    {accounts.length}/5
                  </span>
                </div>
                {accounts.length < 5 && (
                  <button
                    onClick={() => setShowAddAccount(true)}
                    className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Account
                  </button>
                )}
              </div>

              {/* Accounts List */}
              {accounts.length > 0 ? (
                <div className="space-y-4">
                  {accounts.map((account) => (
                    <div key={account.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <h3 className="font-semibold text-gray-900 mr-3">{account.label}</h3>
                            <span className="flex items-center px-2 py-1 bg-gray-100 text-gray-600 text-sm rounded-full">
                              <Clock className="w-3 h-3 mr-1" />
                              {isDemoMode ? 'Demo Mode' : 'Server Mode'}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 flex items-center">
                            <Phone className="w-3 h-3 mr-1" />
                            {account.phone}
                          </p>
                          <p className="text-sm text-gray-600 flex items-center mt-1">
                            <Key className="w-3 h-3 mr-1" />
                            API ID: {account.api_id}
                          </p>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => connectAccount(account.id)}
                            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                          >
                            Connect
                          </button>
                          <button
                            onClick={() => scanAccount(account.id)}
                            className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
                          >
                            <Search className="w-3 h-3 mr-1 inline" />
                            Scan
                          </button>
                          <button
                            onClick={() => deleteAccount(account.id)}
                            className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors"
                          >
                            <Trash2 className="w-3 h-3 mr-1 inline" />
                            Delete
                          </button>
                          <button
                            onClick={() => removeAccount(account.id)}
                            className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No accounts added yet</p>
                  <p className="text-sm">Add your first Telegram account to get started</p>
                </div>
              )}
            </div>

            {/* Global Operations */}
            {accounts.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center mb-6">
                  <Settings className="w-6 h-6 text-blue-600 mr-2" />
                  <h2 className="text-2xl font-semibold text-gray-900">Global Operations</h2>
                </div>

                <div className="flex flex-wrap gap-4">
                  <button
                    onClick={scanAllAccounts}
                    className="flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Search className="w-4 h-4 mr-2" />
                    Scan All Accounts
                  </button>
                  
                  <button
                    onClick={deleteAllAccounts}
                    className="flex items-center px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete All Accounts
                  </button>
                </div>

                <p className="text-sm text-gray-600 mt-3">
                  {isDemoMode ? 'Demo mode - no real functionality' : 'Server mode - full functionality available'} - {accounts.length} account{accounts.length !== 1 ? 's' : ''} configured
                </p>
              </div>
            )}

            {/* Instructions */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">How to Use the Full Version</h3>
              <div className="space-y-3 text-sm text-gray-700">
                <div className="flex items-start">
                  <span className="bg-blue-100 text-blue-800 rounded-full w-6 h-6 flex items-center justify-center text-xs font-semibold mr-3 mt-0.5">1</span>
                  <div>
                    <p className="font-medium">Download the project files</p>
                    <p className="text-gray-600">Get all the Python server files and dependencies</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <span className="bg-blue-100 text-blue-800 rounded-full w-6 h-6 flex items-center justify-center text-xs font-semibold mr-3 mt-0.5">2</span>
                  <div>
                    <p className="font-medium">Get Telegram API credentials</p>
                    <p className="text-gray-600">Visit <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">my.telegram.org</a> to get your API ID and Hash</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <span className="bg-blue-100 text-blue-800 rounded-full w-6 h-6 flex items-center justify-center text-xs font-semibold mr-3 mt-0.5">3</span>
                  <div>
                    <p className="font-medium">Run the application locally</p>
                    <p className="text-gray-600">Execute <code className="bg-gray-100 px-1 rounded">run.sh</code> (Mac/Linux) or <code className="bg-gray-100 px-1 rounded">run.bat</code> (Windows)</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <span className="bg-blue-100 text-blue-800 rounded-full w-6 h-6 flex items-center justify-center text-xs font-semibold mr-3 mt-0.5">4</span>
                  <div>
                    <p className="font-medium">Connect your accounts</p>
                    <p className="text-gray-600">Add your Telegram accounts and authenticate with verification codes</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Filters & Results */}
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">Filters & Options</h3>
              
              <div className="space-y-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.include_private}
                    onChange={(e) => setFilters({...filters, include_private: e.target.checked})}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Include private chats</span>
                </label>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Chat name filter</label>
                  <input
                    type="text"
                    value={filters.chat_name_filters}
                    onChange={(e) => setFilters({...filters, chat_name_filters: e.target.value})}
                    placeholder="work, project (comma-separated)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">After date</label>
                    <input
                      type="date"
                      value={filters.after}
                      onChange={(e) => setFilters({...filters, after: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Before date</label>
                    <input
                      type="date"
                      value={filters.before}
                      onChange={(e) => setFilters({...filters, before: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Messages per chat limit</label>
                  <input
                    type="number"
                    value={filters.limit_per_chat}
                    onChange={(e) => setFilters({...filters, limit_per_chat: e.target.value})}
                    placeholder="Optional"
                    min="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.revoke}
                    onChange={(e) => setFilters({...filters, revoke: e.target.checked})}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Delete for everyone (revoke)</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.test_mode}
                    onChange={(e) => setFilters({...filters, test_mode: e.target.checked})}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Test mode (first 5 chats)</span>
                </label>
              </div>
            </div>

            {/* Demo Results */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">Demo Results</h3>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-blue-50 p-3 rounded">
                    <div className="font-medium text-blue-900">Accounts Configured</div>
                    <div className="text-2xl font-bold text-blue-600">{accounts.length}</div>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <div className="font-medium text-gray-900">Status</div>
                    <div className="text-sm text-gray-600">Demo Mode</div>
                  </div>
                </div>

                <div className="text-sm text-gray-600">
                  <p>This is a demonstration interface. To see actual results:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>Download and run the Python server locally</li>
                    <li>Add your Telegram API credentials</li>
                    <li>Connect your accounts with verification codes</li>
                    <li>Run scan or delete operations</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Add Account Modal */}
        {showAddAccount && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Add New Account</h3>
                <button onClick={() => setShowAddAccount(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                  <input
                    type="text"
                    value={newAccount.label}
                    onChange={(e) => setNewAccount({...newAccount, label: e.target.value})}
                    placeholder="Personal, Work, etc."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API ID</label>
                  <input
                    type="number"
                    value={newAccount.api_id}
                    onChange={(e) => setNewAccount({...newAccount, api_id: e.target.value})}
                    placeholder="123456789"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Hash</label>
                  <input
                    type="text"
                    value={newAccount.api_hash}
                    onChange={(e) => setNewAccount({...newAccount, api_hash: e.target.value})}
                    placeholder="abcdef1234567890..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={newAccount.phone}
                    onChange={(e) => setNewAccount({...newAccount, phone: e.target.value})}
                    placeholder="+1234567890"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="text-xs text-gray-500">
                  Get your API credentials from <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">my.telegram.org</a>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowAddAccount(false)}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={addAccount}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Add Account (Demo)
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Demo Mode Welcome Modal */}
        {showDemoModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-lg w-full p-6">
              <div className="flex items-center mb-4">
                <Server className="w-8 h-8 text-blue-600 mr-3" />
                <h3 className="text-xl font-semibold">Welcome to the Demo!</h3>
              </div>

              <div className="space-y-4 text-sm text-gray-700">
                <p>You're currently viewing the <strong>demo version</strong> of the Telegram Message Manager.</p>
                
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="font-medium text-blue-900 mb-2">What you can do in demo mode:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-800">
                    <li>Add and remove accounts (stored locally)</li>
                    <li>Explore the user interface</li>
                    <li>See how the filters and options work</li>
                  </ul>
                </div>
                
                <p><strong>To actually use Telegram functionality:</strong> Download the project files and run the Python server locally using the provided scripts.</p>
              </div>

              <div className="flex justify-end mt-6">
                <button 
                  onClick={() => setShowDemoModal(false)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Got it, let's explore!
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;