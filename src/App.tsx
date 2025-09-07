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
    password: '',
    accountId: ''
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
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [accountOperations, setAccountOperations] = useState<{[key: string]: any}>({});
  const [operationStatus, setOperationStatus] = useState<{[key: string]: string}>({});
  const [operationProgress, setOperationProgress] = useState<{[key: string]: any}>({});
  const [previewMessages, setPreviewMessages] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    // ניקוי localStorage ו-sessionStorage ברענון הדף
    localStorage.removeItem('telegram_accounts_demo');
    sessionStorage.clear();

    checkServerConnection();
  }, []);

  // Mock data for demo mode
  const generateMockResults = () => {
    return {
      chats: [
        {
          id: 1,
          title: "Work Group",
          type: "Group",
          participants_count: 25,
          candidates_found: 15,
          deleted: 0
        },
        {
          id: 2,
          title: "Family Chat",
          type: "Group", 
          participants_count: 8,
          candidates_found: 0,
          deleted: 0,
          skipped_reason: "Group has ≤10 members (safety protection)"
        },
        {
          id: 3,
          title: "John Doe",
          type: "User",
          participants_count: 1,
          candidates_found: 23,
          deleted: 0
        }
      ],
      summary: {
        total_chats_processed: 3,
        total_chats_skipped: 1,
        total_candidates: 38,
        total_deleted: 0
      },
      logs: [
        "[14:30:15] Starting message scan...",
        "[14:30:16] Connected to Telegram successfully",
        "[14:30:17] Scanning Work Group - found 15 messages",
        "[14:30:18] Skipping Family Chat - only 8 members (safety protection)",
        "[14:30:19] Scanning John Doe - found 23 messages",
        "[14:30:20] Scan completed - 38 messages found across 3 chats"
      ]
    };
  };

  const checkServerConnection = async () => {
    try {
      const response = await fetch('/api/accounts');
      
      if (response.ok) {
        const accountsData = await response.json();
        setAccounts(accountsData);
        setIsDemoMode(false);
        setError('');
        setSuccess('');
        console.log('✅ Server mode active - connected to Python backend', accountsData);
      } else {
        throw new Error(`Server responded with ${response.status}`);
      }
    } catch (err) {
      console.log('❌ Server connection failed, switching to demo mode.');
      setIsDemoMode(true);
      loadAccountsFromStorage();
      setShowDemoModal(true);
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
    

    if (isDemoMode) {
      const newId = `acc_${Date.now()}`;
      const account: Account = {
        id: newId,
        label: newAccount.label,
        api_id: newAccount.api_id,
        api_hash: newAccount.api_hash,
        phone: newAccount.phone,
        is_authenticated: false
      };
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

  const removeAccountFromServer = async (accountId: string) => {
    try {
      const response = await fetch(`/api/accounts/${accountId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        await checkServerConnection();
        setSuccess('Account removed successfully');
      } else {
        setError(data.error || 'Failed to remove account');
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    }
  };
  const connectAccount = (accountId: string) => {
    connectAccountToServer(accountId);
  };

  const connectAccountToServer = async (accountId: string) => {
    setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], connecting: true}}));
    setOperationStatus(prev => ({...prev, [accountId]: 'Connecting to Telegram...'}));
    setError('');
    setSuccess('');
    
    try {
      const response = await fetch(`/api/accounts/${accountId}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
      });
      
      const data = await response.json();
      
      if (data.success) {
        if (data.status === 'CODE_SENT') {
          setLoginData({...loginData, accountId});
          setShowLoginModal(true);
          setSuccess(data.message || 'Verification code sent to your Telegram app!');
          setOperationStatus(prev => ({...prev, [accountId]: 'Code sent - check Telegram app'}));
        } else if (data.status === 'AUTHENTICATED') {
          await checkServerConnection();
          setSuccess(`Connected successfully as @${data.username}`);
          setOperationStatus(prev => ({...prev, [accountId]: `Connected as @${data.username}`}));
        }
      } else {
        if (data.error === '2FA_REQUIRED') {
          setError('Two-factor authentication required. Please enter your 2FA password.');
        } else {
          setError(data.error || 'Connection failed');
        }
        setOperationStatus(prev => ({...prev, [accountId]: 'Connection failed'}));
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
      setOperationStatus(prev => ({...prev, [accountId]: 'Network error'}));
    } finally {
      setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], connecting: false}}));
    }
  };

  const completeLogin = async () => {
    if (!loginData.code) {
      setError('Please enter verification code');
      return;
    }
    
    // Clean the code input
    const cleanCode = loginData.code.replace(/\s/g, '');
    if (cleanCode.length !== 5) {
      setError('Verification code must be exactly 5 digits');
      return;
    }
    
    setError('');
    setSuccess('');
    
    try {
      const response = await fetch(`/api/accounts/${loginData.accountId}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: cleanCode,
          password: loginData.password || null
        })
      });
      
      const data = await response.json();
      
      if (data.success && data.status === 'AUTHENTICATED') {
        setShowLoginModal(false);
        setLoginData({ code: '', password: '', accountId: '' });
        await checkServerConnection();
        setSuccess(`Connected successfully as @${data.username}`);
      } else {
        if (data.error === '2FA_REQUIRED') {
          setError('Please enter your 2FA password below and try again');
        } else {
          setError(data.error || 'Login failed');
        }
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    }
  };
  const scanAccount = (accountId: string) => {
    if (isDemoMode) {
      // Demo mode - show mock results
      setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], scanning: true}}));
      setOperationStatus(prev => ({...prev, [accountId]: 'Demo scan in progress...'}));
      
      setTimeout(() => {
        const mockResults = generateMockResults();
        setResults(mockResults);
        setSuccess('Demo scan completed! This shows what real results would look like.');
        setOperationStatus(prev => ({...prev, [accountId]: `Demo scan complete - ${mockResults.summary.total_candidates} messages found`}));
        setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], scanning: false}}));
      }, 2000);
    } else {
      scanAccountMessages(accountId);
    }
  };

  const scanAccountMessages = async (accountId: string) => {
    setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], scanning: true}}));
    setOperationStatus(prev => ({...prev, [accountId]: 'Starting scan...'}));
    setError('');
    setSuccess('');
    
    const payload = {
      include_private: filters.include_private,
      chat_name_filters: filters.chat_name_filters,
      after: filters.after || null,
      before: filters.before || null,
      limit_per_chat: filters.limit_per_chat ? parseInt(filters.limit_per_chat) : null,
      revoke: filters.revoke,
      test_mode: filters.test_mode
    };
    
    try {
      const response = await fetch(`/api/accounts/${accountId}/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setResults(data.result);
        // If messages are available, show preview option
        if (data.result.messages && data.result.messages.length > 0) {
          setPreviewMessages(data.result.messages);
        }
        setSuccess('Scan completed successfully');
        setOperationStatus(prev => ({...prev, [accountId]: `Scan complete - ${data.result.summary.total_candidates} messages found`}));
      } else {
        setError(data.error || 'Scan failed');
        setOperationStatus(prev => ({...prev, [accountId]: 'Scan failed'}));
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
      setOperationStatus(prev => ({...prev, [accountId]: 'Network error'}));
    } finally {
      setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], scanning: false}}));
    }
  };
  const deleteAccount = (accountId: string) => {
    if (isDemoMode) {
      if (!confirm('This is demo mode - no real deletion will occur. Continue with demo?')) {
        return;
      }
      // Demo mode - show mock results
      setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], deleting: true}}));
      setOperationStatus(prev => ({...prev, [accountId]: 'Demo deletion in progress...'}));
      
      setTimeout(() => {
        const mockResults = generateMockResults();
        mockResults.summary.total_deleted = 38;
        mockResults.chats.forEach(chat => {
          if (chat.candidates_found > 0) {
            chat.deleted = chat.candidates_found;
          }
        });
        mockResults.logs = [
          "[14:35:15] Starting message deletion...",
          "[14:35:16] Connected to Telegram successfully", 
          "[14:35:17] Deleting 15 messages from Work Group",
          "[14:35:18] Skipping Family Chat - only 8 members (safety protection)",
          "[14:35:19] Deleting 23 messages from John Doe",
          "[14:35:20] Deletion completed - 38 messages deleted"
        ];
        setResults(mockResults);
        setSuccess('Demo deletion completed! This shows what real results would look like.');
        setOperationStatus(prev => ({...prev, [accountId]: `Demo deletion complete - ${mockResults.summary.total_deleted} messages deleted`}));
        setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], deleting: false}}));
      }, 3000);
    } else {
      if (!confirm('Are you sure you want to delete messages from this account? This cannot be undone.')) {
        return;
      }
      deleteAccountMessages(accountId);
    }
  };

  const deleteAccountMessages = async (accountId: string) => {
    setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], deleting: true}}));
    setOperationStatus(prev => ({...prev, [accountId]: 'Starting deletion...'}));
    setError('');
    setSuccess('');
    
    const payload = {
      include_private: filters.include_private,
      chat_name_filters: filters.chat_name_filters,
      after: filters.after || null,
      before: filters.before || null,
      limit_per_chat: filters.limit_per_chat ? parseInt(filters.limit_per_chat) : null,
      revoke: filters.revoke,
      test_mode: filters.test_mode
    };
    
    try {
      const response = await fetch(`/api/accounts/${accountId}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setResults(data.result);
        setSuccess('Delete operation completed successfully');
        setOperationStatus(prev => ({...prev, [accountId]: `Deletion complete - ${data.result.summary.total_deleted} messages deleted`}));
      } else {
        setError(data.error || 'Delete failed');
        setOperationStatus(prev => ({...prev, [accountId]: 'Deletion failed'}));
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
      setOperationStatus(prev => ({...prev, [accountId]: 'Network error'}));
    } finally {
      setAccountOperations(prev => ({...prev, [accountId]: {...prev[accountId], deleting: false}}));
    }
  };
  const scanAllAccounts = () => {
    if (isDemoMode) {
      setLoading(true);
      setTimeout(() => {
        const mockResults = generateMockResults();
        mockResults.summary.total_chats_processed = 6;
        mockResults.summary.total_candidates = 76;
        setResults(mockResults);
        setSuccess('Demo scan all completed! This shows results from multiple accounts.');
        setLoading(false);
      }, 3000);
    } else {
      scanAllAccountsMessages();
    }
  };

  const scanAllAccountsMessages = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    
    const payload = {
      include_private: filters.include_private,
      chat_name_filters: filters.chat_name_filters,
      after: filters.after || null,
      before: filters.before || null,
      limit_per_chat: filters.limit_per_chat ? parseInt(filters.limit_per_chat) : null,
      revoke: filters.revoke,
      test_mode: filters.test_mode
    };
    
    try {
      const response = await fetch('/api/scan_all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setResults(data);
        setSuccess('Scan all completed successfully');
      } else {
        setError(data.error || 'Scan all failed');
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  const deleteAllAccounts = () => {
    if (isDemoMode) {
      if (!confirm('This is demo mode - no real deletion will occur. Continue with demo?')) {
        return;
      }
      setLoading(true);
      setTimeout(() => {
        const mockResults = generateMockResults();
        mockResults.summary.total_chats_processed = 6;
        mockResults.summary.total_candidates = 76;
        mockResults.summary.total_deleted = 76;
        mockResults.chats.forEach(chat => {
          if (chat.candidates_found > 0) {
            chat.deleted = chat.candidates_found;
          }
        });
        setResults(mockResults);
        setSuccess('Demo delete all completed! This shows results from multiple accounts.');
        setLoading(false);
      }, 4000);
    } else {
      if (!confirm('Are you sure you want to delete messages from ALL authenticated accounts? This cannot be undone.')) {
        return;
      }
      deleteAllAccountsMessages();
    }
  };

  const deleteAllAccountsMessages = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    
    const payload = {
      include_private: filters.include_private,
      chat_name_filters: filters.chat_name_filters,
      after: filters.after || null,
      before: filters.before || null,
      limit_per_chat: filters.limit_per_chat ? parseInt(filters.limit_per_chat) : null,
      revoke: filters.revoke,
      test_mode: filters.test_mode
    };
    
    try {
      const response = await fetch('/api/delete_all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setResults(data);
        setSuccess('Delete all completed successfully');
      } else {
        setError(data.error || 'Delete all failed');
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
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
                <p>Python server not detected. You're viewing the demo interface only. <strong>To use actual Telegram functionality:</strong></p>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                  <li>Download the project files from GitHub</li>
                  <li>Install Python 3.10+ and Node.js</li>
                  <li>Run <code className="bg-blue-100 px-1 rounded">run.sh</code> (Mac/Linux) or <code className="bg-blue-100 px-1 rounded">run.bat</code> (Windows)</li>
                  <li>Get your Telegram API credentials from <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">my.telegram.org</a></li>
                </ol>
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
                            disabled={accountOperations[account.id]?.connecting || account.is_authenticated}
                            className={`px-3 py-1 text-white text-sm rounded transition-colors flex items-center ${
                              account.is_authenticated 
                                ? 'bg-green-600 cursor-not-allowed' 
                                : accountOperations[account.id]?.connecting
                                  ? 'bg-blue-400 cursor-not-allowed'
                                  : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                          >
                            {accountOperations[account.id]?.connecting && (
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                            )}
                            {account.is_authenticated 
                              ? `✓ @${account.username}` 
                              : accountOperations[account.id]?.connecting 
                                ? 'Connecting...' 
                                : 'Connect'
                            }
                          </button>
                          <button
                            onClick={() => scanAccount(account.id)}
                            disabled={accountOperations[account.id]?.scanning || !account.is_authenticated}
                            className={`px-3 py-1 text-white text-sm rounded transition-colors flex items-center ${
                              accountOperations[account.id]?.scanning || (!account.is_authenticated && !isDemoMode)
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-green-600 hover:bg-green-700'
                            }`}
                          >
                            {accountOperations[account.id]?.scanning && (
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                            )}
                            <Search className="w-3 h-3 mr-1 inline" />
                            {accountOperations[account.id]?.scanning ? 'Scanning...' : 'Scan'}
                          </button>
                          <button
                            onClick={() => deleteAccount(account.id)}
                            disabled={accountOperations[account.id]?.deleting || !account.is_authenticated}
                            className={`px-3 py-1 text-white text-sm rounded transition-colors flex items-center ${
                              accountOperations[account.id]?.deleting || (!account.is_authenticated && !isDemoMode)
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-red-600 hover:bg-red-700'
                            }`}
                          >
                            {accountOperations[account.id]?.deleting && (
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                            )}
                            <Trash2 className="w-3 h-3 mr-1 inline" />
                            {accountOperations[account.id]?.deleting ? 'Deleting...' : 'Delete'}
                          </button>
                          <button
                            onClick={() => removeAccount(account.id)}
                            className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      {operationStatus[account.id] && (
                        <div className="mt-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                          {operationStatus[account.id]}
                        </div>
                      )}
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
                    disabled={loading}
                    className={`flex items-center px-6 py-3 text-white rounded-lg transition-colors ${
                      loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {loading && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    )}
                    <Search className="w-4 h-4 mr-2" />
                    {loading ? 'Scanning...' : 'Scan All Accounts'}
                  </button>
                  
                  <button
                    onClick={deleteAllAccounts}
                    disabled={loading}
                    className={`flex items-center px-6 py-3 text-white rounded-lg transition-colors ${
                      loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {loading && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    )}
                    <Trash2 className="w-4 h-4 mr-2" />
                    {loading ? 'Deleting...' : 'Delete All Accounts'}
                  </button>
                </div>

                <p className="text-sm text-gray-600 mt-3">
                  {isDemoMode ? 'Demo mode - showing mock results for demonstration' : 'Server mode - full functionality available'} - {accounts.length} account{accounts.length !== 1 ? 's' : ''} configured
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
                    <div className="text-sm text-gray-600">{isDemoMode ? 'Demo Mode' : 'Server Mode'}</div>
                  </div>
                </div>

                {isDemoMode ? (
                  <div className="text-sm text-gray-600">
                    <p className="font-medium text-blue-900 mb-2">Try the demo:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Add demo accounts above</li>
                      <li>Click "Scan" or "Delete" to see mock results</li>
                      <li>All operations show realistic demonstrations</li>
                      <li>No real Telegram connections are made</li>
                    </ul>
                    <p className="mt-3 text-xs text-gray-500">
                      For real functionality, download and run the Python server locally.
                    </p>
                  </div>
                ) : (
                  <div className="text-sm text-gray-600">
                    <p className="font-medium text-green-900 mb-2">Server connected:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Add your real Telegram accounts</li>
                      <li>Connect with verification codes</li>
                      <li>Scan and delete actual messages</li>
                      <li>Full functionality available</li>
                    </ul>
                  </div>
                )}
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
        
        {/* Login Modal */}
        {showLoginModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Complete Login</h3>
                <button onClick={() => setShowLoginModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">
                  Enter the verification code sent to your Telegram app:
                </p>
                <p className="text-xs text-blue-600">
                  Check your Telegram app for a message from Telegram with a 5-digit code
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Verification Code</label>
                  <input
                    type="text"
                    value={loginData.code}
                    onChange={(e) => setLoginData({...loginData, code: e.target.value})}
                    placeholder="12345"
                    maxLength={5}
                    pattern="[0-9]{5}"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Enter the 5-digit code from your Telegram app (without spaces)
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">2FA Password (if enabled)</label>
                  <input
                    type="password"
                    value={loginData.password}
                    onChange={(e) => setLoginData({...loginData, password: e.target.value})}
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Only required if you have two-factor authentication enabled
                  </p>
                </div>
              </div>
              
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowLoginModal(false)}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={completeLogin}
                  disabled={!loginData.code}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                >
                  Complete Login
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Results Display */}
        {results && (
          <div className="mt-8 bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Operation Results</h3>
            
            {/* Summary */}
            {results.summary && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">Summary</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Processed:</span>
                    <span className="font-medium ml-1">{results.summary.total_chats_processed || 0}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Skipped:</span>
                    <span className="font-medium ml-1">{results.summary.total_chats_skipped || 0}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Candidates:</span>
                    <span className="font-medium ml-1">{results.summary.total_candidates || 0}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Deleted:</span>
                    <span className="font-medium text-red-600 ml-1">{results.summary.total_deleted || 0}</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Chat Results */}
            {results.chats && results.chats.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-medium">Processed Chats</h4>
                {results.chats.map((chat) => (
                  <div key={chat.id} className="p-3 border border-gray-200 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h5 className="font-medium">{chat.title}</h5>
                        <div className="flex space-x-4 text-sm text-gray-600 mt-1">
                          <span>{chat.type}</span>
                          <span>{chat.participants_count} members</span>
                          <span>{chat.candidates_found} candidates</span>
                          {chat.deleted > 0 && (
                            <span className="text-red-600 font-medium">{chat.deleted} deleted</span>
                          )}
                        </div>
                        {chat.error && (
                          <div className="text-red-600 text-sm mt-1">{chat.error}</div>
                        )}
                        {chat.skipped_reason && (
                          <div className="text-orange-600 text-sm mt-1">
                            Skipped: {chat.skipped_reason}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Logs */}
            {results.logs && results.logs.length > 0 && (
              <div className="mt-6">
                <h4 className="font-medium mb-2">Operation Log</h4>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-lg max-h-64 overflow-y-auto text-sm font-mono">
                  {results.logs.map((log, index) => (
                    <div key={index}>{log}</div>
                  ))}
                </div>
              </div>
            )}
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