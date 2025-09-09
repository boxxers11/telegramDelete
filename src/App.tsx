import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Search, 
  Settings, 
  User, 
  Shield, 
  Wifi, 
  WifiOff,
  Loader,
  CheckCircle,
  AlertCircle,
  Eye,
  Play,
  Square
} from 'lucide-react';
import VisualScanInterface from './components/VisualScanInterface';
import MessagePreview from './components/MessagePreview';
import SmartSearchResults from './components/SmartSearchResults';

interface Account {
  id: string;
  label: string;
  phone: string;
  api_id: number;
  api_hash: string;
  is_authenticated: boolean;
  username?: string;
}

interface LoginData {
  accountId: string;
  phone_code_hash?: string;
  needsCode: boolean;
  needs2FA: boolean;
}

interface ScanProgress {
  type?: string;
  chat_id?: number;
  chat_name?: string;
  current_index?: number;
  total?: number;
  status?: string;
  chats?: any[];
  messages_found?: number;
  messages_deleted?: number;
  total_to_delete?: number;
}

function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [loginData, setLoginData] = useState<LoginData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Visual scan states
  const [showVisualScan, setShowVisualScan] = useState(false);
  const [selectedAccountForScan, setSelectedAccountForScan] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | undefined>();
  const [scanEventSource, setScanEventSource] = useState<EventSource | null>(null);
  
  // Message preview states
  const [showMessagePreview, setShowMessagePreview] = useState(false);
  const [previewMessages, setPreviewMessages] = useState<any[]>([]);
  
  // Smart search states
  const [showSmartSearch, setShowSmartSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<any>({});

  // Form states
  const [newAccount, setNewAccount] = useState({
    label: '',
    api_id: '',
    api_hash: '',
    phone: ''
  });
  
  const [verificationCode, setVerificationCode] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const response = await fetch('/api/accounts');
      if (response.ok) {
        const data = await response.json();
        setAccounts(data.map((acc: any) => ({
          ...acc,
          is_authenticated: acc.is_authenticated || false
        })));
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label: newAccount.label,
          api_id: parseInt(newAccount.api_id),
          api_hash: newAccount.api_hash,
          phone: newAccount.phone
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess('Account added successfully!');
        setNewAccount({ label: '', api_id: '', api_hash: '', phone: '' });
        setShowAddForm(false);
        await loadAccounts();
      } else {
        setError(data.error || 'Failed to add account');
      }
    } catch (error) {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (accountId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/accounts/${accountId}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (data.success) {
        if (data.status === 'CODE_SENT') {
          setLoginData({
            accountId,
            phone_code_hash: data.phone_code_hash,
            needsCode: true,
            needs2FA: false
          });
          setSuccess('Verification code sent! Check your Telegram app.');
        } else if (data.status === 'AUTHENTICATED') {
          setSuccess(`Connected successfully as @${data.username}!`);
          // Update the specific account's authentication status
          setAccounts(prev => prev.map(acc => 
            acc.id === accountId 
              ? { ...acc, is_authenticated: true, username: data.username }
              : acc
          ));
        }
      } else {
        if (data.error === '2FA_REQUIRED') {
          setLoginData(prev => prev ? { ...prev, needs2FA: true } : null);
          setError('Two-factor authentication required. Please enter your password.');
        } else {
          setError(data.error || 'Connection failed');
        }
      }
    } catch (error) {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!loginData || !verificationCode) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/accounts/${loginData.accountId}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: verificationCode,
          phone_code_hash: loginData.phone_code_hash,
          password: loginData.needs2FA ? twoFactorPassword : undefined
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`Connected successfully as @${data.username}!`);
        // Update the specific account's authentication status
        setAccounts(prev => prev.map(acc => 
          acc.id === loginData.accountId 
            ? { ...acc, is_authenticated: true, username: data.username }
            : acc
        ));
        setLoginData(null);
        setVerificationCode('');
        setTwoFactorPassword('');
      } else {
        if (data.error === '2FA_REQUIRED') {
          setLoginData(prev => prev ? { ...prev, needs2FA: true } : null);
          setError('Two-factor authentication required. Please enter your password.');
        } else {
          setError(data.error || 'Verification failed');
        }
      }
    } catch (error) {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    if (!confirm('Are you sure you want to delete this account?')) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/accounts/${accountId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setSuccess('Account deleted successfully!');
        await loadAccounts();
      } else {
        setError('Failed to delete account');
      }
    } catch (error) {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleStartVisualScan = (accountId: string) => {
    setSelectedAccountForScan(accountId);
    setShowVisualScan(true);
  };

  const handleScanStart = () => {
    setIsScanning(true);
    setScanProgress(undefined);
    
    if (!selectedAccountForScan) return;
    
    // Start the scan
    startScan(selectedAccountForScan);
  };

  const handleScanStop = () => {
    setIsScanning(false);
    setScanProgress(undefined);
    
    // Close event source if exists
    if (scanEventSource) {
      scanEventSource.close();
      setScanEventSource(null);
    }
  };

  const startScan = async (accountId: string) => {
    try {
      setError(null);
      
      // Start the scan request
      const response = await fetch(`/api/accounts/${accountId}/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_id: accountId,
          include_private: false,
          chat_name_filters: [],
          dry_run: true,
          test_mode: true // Start with test mode for safety
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Simulate progress updates for now
        simulateScanProgress(data.result);
      } else {
        setError(data.error || 'Scan failed');
        setIsScanning(false);
      }
    } catch (error) {
      setError('Network error occurred during scan');
      setIsScanning(false);
    }
  };

  const simulateScanProgress = (result: any) => {
    // Simulate chat list loading
    setTimeout(() => {
      setScanProgress({
        type: 'chat_list',
        chats: result.chats.map((chat: any) => ({
          id: chat.id,
          title: chat.title,
          type: chat.type,
          status: 'pending',
          last_deleted_count: 0
        })),
        total: result.chats.length
      });
    }, 1000);

    // Simulate scanning each chat
    result.chats.forEach((chat: any, index: number) => {
      setTimeout(() => {
        // Start scanning
        setScanProgress(prev => ({
          ...prev,
          type: 'chat_scanning',
          chat_id: chat.id,
          chat_name: chat.title,
          current_index: index,
          total: result.chats.length,
          status: 'scanning'
        }));

        // Complete scanning
        setTimeout(() => {
          setScanProgress(prev => ({
            ...prev,
            type: 'chat_completed',
            chat_id: chat.id,
            status: chat.error ? 'error' : (chat.skipped_reason ? 'skipped' : 'completed'),
            messages_found: chat.candidates_found,
            messages_deleted: chat.deleted,
            error: chat.error,
            reason: chat.skipped_reason
          }));
        }, 2000);
      }, (index + 1) * 3000);
    });

    // Complete scan
    setTimeout(() => {
      setIsScanning(false);
      setSuccess(`Scan completed! Found ${result.total_candidates} messages in ${result.total_chats_processed} chats`);
    }, (result.chats.length + 1) * 3000);
  };

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  // If showing visual scan interface
  if (showVisualScan && selectedAccountForScan) {
    const account = accounts.find(acc => acc.id === selectedAccountForScan);
    return (
      <VisualScanInterface
        accountId={selectedAccountForScan}
        accountLabel={account?.label || 'Unknown'}
        onClose={() => {
          setShowVisualScan(false);
          setSelectedAccountForScan(null);
          setIsScanning(false);
          setScanProgress(undefined);
        }}
        onStartScan={handleScanStart}
        onStopScan={handleScanStop}
        isScanning={isScanning}
        scanProgress={scanProgress}
      />
    );
  }

  // If showing message preview
  if (showMessagePreview) {
    return (
      <MessagePreview
        messages={previewMessages}
        onDeleteSelected={(messageIds) => {
          console.log('Delete messages:', messageIds);
          // Implement delete logic here
        }}
        onBack={() => {
          setShowMessagePreview(false);
          setPreviewMessages([]);
        }}
        isDeleting={false}
      />
    );
  }

  // If showing smart search results
  if (showSmartSearch && searchResults.messages) {
    return (
      <SmartSearchResults
        messages={searchResults.messages}
        prompt={searchResults.prompt || ''}
        keywords={searchResults.keywords || []}
        totalFound={searchResults.total_found || 0}
        onBack={() => {
          setShowSmartSearch(false);
          setSearchResults({});
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-4">
            <MessageSquare className="w-12 h-12 text-blue-600 mr-4" />
            <h1 className="text-4xl font-bold text-gray-900">Telegram Message Manager</h1>
          </div>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Safely manage your Telegram messages across multiple accounts
          </p>
        </div>

        {/* Messages */}
        {(error || success) && (
          <div className="max-w-4xl mx-auto mb-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex items-center justify-between">
                <div className="flex items-center">
                  <AlertCircle className="w-5 h-5 text-red-500 mr-3" />
                  <span className="text-red-700">{error}</span>
                </div>
                <button onClick={clearMessages} className="text-red-500 hover:text-red-700">
                  ×
                </button>
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 flex items-center justify-between">
                <div className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span className="text-green-700">{success}</span>
                </div>
                <button onClick={clearMessages} className="text-green-500 hover:text-green-700">
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {/* Add Account Button */}
        <div className="max-w-4xl mx-auto mb-8">
          <button
            onClick={() => setShowAddForm(true)}
            disabled={accounts.length >= 5}
            className="w-full bg-white rounded-xl shadow-lg p-6 border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center justify-center">
              <Plus className="w-8 h-8 text-blue-600 mr-3" />
              <span className="text-xl font-semibold text-gray-700">
                Add Account ({accounts.length}/5)
              </span>
            </div>
          </button>
        </div>

        {/* Add Account Form */}
        {showAddForm && (
          <div className="max-w-2xl mx-auto mb-8">
            <div className="bg-white rounded-xl shadow-lg p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Add New Account</h2>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ×
                </button>
              </div>
              
              <form onSubmit={handleAddAccount} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Account Label
                  </label>
                  <input
                    type="text"
                    value={newAccount.label}
                    onChange={(e) => setNewAccount(prev => ({ ...prev, label: e.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Personal, Work"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    API ID
                  </label>
                  <input
                    type="number"
                    value={newAccount.api_id}
                    onChange={(e) => setNewAccount(prev => ({ ...prev, api_id: e.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Your API ID from my.telegram.org"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    API Hash
                  </label>
                  <input
                    type="text"
                    value={newAccount.api_hash}
                    onChange={(e) => setNewAccount(prev => ({ ...prev, api_hash: e.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Your API Hash from my.telegram.org"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={newAccount.phone}
                    onChange={(e) => setNewAccount(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="+1234567890"
                    required
                  />
                </div>
                
                <div className="flex space-x-4">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors flex items-center justify-center"
                  >
                    {loading ? <Loader className="w-4 h-4 animate-spin mr-2" /> : null}
                    Add Account
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Login Form */}
        {loginData && (
          <div className="max-w-md mx-auto mb-8">
            <div className="bg-white rounded-xl shadow-lg p-8">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Verify Your Account</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter 5-digit code"
                    maxLength={5}
                  />
                </div>
                
                {loginData.needs2FA && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      2FA Password
                    </label>
                    <input
                      type="password"
                      value={twoFactorPassword}
                      onChange={(e) => setTwoFactorPassword(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter your 2FA password"
                    />
                  </div>
                )}
                
                <div className="flex space-x-4">
                  <button
                    onClick={() => setLoginData(null)}
                    className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleVerifyCode}
                    disabled={loading || !verificationCode}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors flex items-center justify-center"
                  >
                    {loading ? <Loader className="w-4 h-4 animate-spin mr-2" /> : null}
                    Verify
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Accounts List */}
        <div className="max-w-4xl mx-auto space-y-4">
          {accounts.map((account) => (
            <div key={account.id} className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                    <User className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{account.label}</h3>
                    <p className="text-gray-600">{account.phone}</p>
                    {account.is_authenticated && account.username && (
                      <p className="text-green-600 text-sm">Connected as {account.username}</p>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center space-x-3">
                  {/* Connection Status */}
                  <div className="flex items-center">
                    {account.is_authenticated ? (
                      <div className="flex items-center text-green-600">
                        <Wifi className="w-4 h-4 mr-1" />
                        <span className="text-sm">Connected</span>
                      </div>
                    ) : (
                      <div className="flex items-center text-gray-500">
                        <WifiOff className="w-4 h-4 mr-1" />
                        <span className="text-sm">Not connected</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Action Buttons */}
                  {account.is_authenticated ? (
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleStartVisualScan(account.id)}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center"
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        Scan Messages
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConnect(account.id)}
                      disabled={loading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors flex items-center"
                    >
                      {loading ? <Loader className="w-4 h-4 animate-spin mr-1" /> : null}
                      Connect
                    </button>
                  )}
                  
                  <button
                    onClick={() => handleDeleteAccount(account.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {accounts.length === 0 && !showAddForm && (
          <div className="max-w-2xl mx-auto text-center">
            <div className="bg-white rounded-xl shadow-lg p-12">
              <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No accounts added yet</h3>
              <p className="text-gray-600 mb-6">
                Add your first Telegram account to start managing your messages
              </p>
              <button
                onClick={() => setShowAddForm(true)}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center mx-auto"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Account
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;