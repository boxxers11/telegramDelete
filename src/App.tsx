import React, { useState, useEffect } from 'react';
import VisualScanInterface from './components/VisualScanInterface';
import MessagePreview from './components/MessagePreview';
import { 
  Plus, 
  Trash2, 
  Search, 
  Settings, 
  Users, 
  MessageSquare, 
  Shield, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Loader,
  Play,
  Square,
  BarChart3,
  Eye,
  X
} from 'lucide-react';

// Types
interface Account {
  id: string;
  label: string;
  phone: string;
  api_id: number;
  api_hash: string;
  is_authenticated: boolean;
  username?: string;
}

interface ScanResult {
  chats: Array<{
    id: number;
    title: string;
    type: string;
    participants: number;
    candidates: number;
    deleted: number;
    error?: string;
    skipped_reason?: string;
  }>;
  summary: {
    total_processed: number;
    total_skipped: number;
    total_candidates: number;
    total_deleted: number;
  };
  logs: string[];
}

interface ScanProgress {
  currentChat: string;
  processed: number;
  total: number;
  status: string;
}

// Check if we're in a deployed environment (no backend available)
const isDeployedEnvironment = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const API_BASE = isDeployedEnvironment ? null : 'http://127.0.0.1:8000';

const App: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accountStatuses, setAccountStatuses] = useState<Record<string, string>>({});
  const [operationStates, setOperationStates] = useState<Record<string, boolean>>({});
  
  // Scan page states
  const [showScanPage, setShowScanPage] = useState(false);
  const [showVisualScan, setShowVisualScan] = useState(false);
  const [showMessagePreview, setShowMessagePreview] = useState(false);
  const [scanningAccount, setScanningAccount] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanAborted, setScanAborted] = useState(false);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [previewMessages, setPreviewMessages] = useState<any[]>([]);
  const [isDeletingMessages, setIsDeletingMessages] = useState(false);

  // Form states
  const [newAccount, setNewAccount] = useState({
    label: '',
    api_id: '',
    api_hash: '',
    phone: ''
  });
  const [loginData, setLoginData] = useState<Record<string, any>>({});

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      
      // If no backend available (deployed environment), show demo data
      if (!API_BASE) {
        setAccounts([
          {
            id: 'demo_1',
            label: 'Demo Account',
            phone: '+1234567890',
            api_id: 12345,
            api_hash: 'demo_hash',
            is_authenticated: false
          }
        ]);
        return;
      }
      
      // Try to connect to local backend
      const response = await fetch(`${API_BASE}/accounts`);
      if (response.ok) {
        const data = await response.json();
        // Map the backend response to include proper authentication status
        const accountsWithStatus = data.map((account: any) => ({
          ...account,
          is_authenticated: account.is_authenticated || false
        }));
        setAccounts(accountsWithStatus);
      } else {
        console.error('Failed to load accounts:', response.status);
        // Show demo data if API fails
        setAccounts([
          {
            id: 'demo_1',
            label: 'Demo Account',
            phone: '+1234567890',
            api_id: 12345,
            api_hash: 'demo_hash',
            is_authenticated: false
          }
        ]);
      }
    } catch (error) {
      console.error('Error loading accounts:', error);
      // Show demo data on error
      setAccounts([
        {
          id: 'demo_1',
          label: 'Demo Account',
          phone: '+1234567890',
          api_id: 12345,
          api_hash: 'demo_hash',
          is_authenticated: false
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const updateAccountStatus = (accountId: string, status: string) => {
    setAccountStatuses(prev => ({ ...prev, [accountId]: status }));
  };

  const setOperationState = (accountId: string, state: boolean) => {
    setOperationStates(prev => ({ ...prev, [accountId]: state }));
  };

  const addAccount = async () => {
    if (!newAccount.label || !newAccount.api_id || !newAccount.api_hash || !newAccount.phone) {
      alert('Please fill all fields');
      return;
    }

    // Check if backend is available
    if (!API_BASE) {
      alert('This feature requires running the application locally. Please download and run the app from GitHub to add real accounts.');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newAccount.label,
          api_id: parseInt(newAccount.api_id),
          api_hash: newAccount.api_hash,
          phone: newAccount.phone
        })
      });

      if (response.ok) {
        setNewAccount({ label: '', api_id: '', api_hash: '', phone: '' });
        setShowAddAccount(false);
        loadAccounts();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error || 'Failed to add account'}`);
      }
    } catch (error) {
      console.error('Error adding account:', error);
      alert('Failed to add account. Check console for details.');
    }
  };

  const connectAccount = async (accountId: string) => {
    // Check if backend is available
    if (!API_BASE) {
      alert('This feature requires running the application locally. Please download and run the app from GitHub to connect to Telegram.');
      return;
    }

    setOperationState(accountId, true);
    updateAccountStatus(accountId, 'Connecting...');

    try {
      const response = await fetch(`${API_BASE}/accounts/${accountId}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const result = await response.json();
      
      if (result.success) {
        if (result.status === 'CODE_SENT') {
          updateAccountStatus(accountId, 'Code sent - check Telegram app');
          setLoginData(prev => ({ 
            ...prev, 
            [accountId]: { 
              phone_code_hash: result.phone_code_hash,
              step: 'code'
            }
          }));
        } else if (result.status === 'AUTHENTICATED') {
          updateAccountStatus(accountId, `Connected as ${result.username}`);
          // Update the account's authentication status in the accounts list
          setAccounts(prev => prev.map(acc => 
            acc.id === accountId 
              ? { ...acc, is_authenticated: true, username: result.username }
              : acc
          ));
          // Clear login data
          setLoginData(prev => {
            const newData = { ...prev };
            delete newData[accountId];
            return newData;
          });
        }
      } else {
        updateAccountStatus(accountId, `Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Connection error:', error);
      updateAccountStatus(accountId, 'Connection failed - check server');
    } finally {
      setOperationState(accountId, false);
    }
  };

  const submitCode = async (accountId: string, code: string, password?: string) => {
    // Check if backend is available
    if (!API_BASE) {
      alert('This feature requires running the application locally.');
      return;
    }

    setOperationState(accountId, true);
    updateAccountStatus(accountId, 'Verifying code...');

    try {
      const accountLoginData = loginData[accountId] || {};
      const response = await fetch(`${API_BASE}/accounts/${accountId}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code,
          phone_code_hash: accountLoginData.phone_code_hash,
          password: password
        })
      });

      const result = await response.json();
      
      if (result.success) {
        if (result.status === 'AUTHENTICATED') {
          updateAccountStatus(accountId, `Connected as ${result.username}`);
          // Update the account's authentication status in the accounts list
          setAccounts(prev => prev.map(acc => 
            acc.id === accountId 
              ? { ...acc, is_authenticated: true, username: result.username }
              : acc
          ));
          // Clear login data
          setLoginData(prev => {
            const newData = { ...prev };
            delete newData[accountId];
            return newData;
          });
        }
      } else {
        if (result.error === '2FA_REQUIRED') {
          updateAccountStatus(accountId, '2FA password required');
          setLoginData(prev => ({ 
            ...prev, 
            [accountId]: { 
              ...accountLoginData,
              step: '2fa',
              code: code
            }
          }));
        } else {
          updateAccountStatus(accountId, `Error: ${result.error}`);
        }
      }
    } catch (error) {
      console.error('Code verification error:', error);
      updateAccountStatus(accountId, 'Verification failed');
    } finally {
      setOperationState(accountId, false);
    }
  };

  const startScan = async (accountId: string) => {
    setScanningAccount(accountId);
    setShowVisualScan(true);
    setScanResult(null);
    setScanAborted(false);
    setScanProgress(null);
  };

  const startVisualScan = async () => {
    if (!scanningAccount) return;
    
    setScanningAccount(accountId);
    setShowScanPage(true);
    setScanResult(null);
    setScanAborted(false);
    
    // Simulate scan progress
    setScanProgress({
      currentChat: 'Initializing...',
      processed: 0,
      total: 0,
      status: 'Starting scan...'
    });

    try {
      // Check if this is demo mode (no backend or demo account)
      const isDemoMode = !API_BASE || scanningAccount.startsWith('demo_');
      
      if (isDemoMode) {
        // Demo mode - simulate scan
        await simulateScan();
      } else {
        // Real API call
        const response = await fetch(`${API_BASE}/accounts/${scanningAccount}/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            include_private: false,
            chat_name_filters: '',
            limit_per_chat: 1000,
            dry_run: true,
            test_mode: false
          })
        });

        if (response.ok) {
          const result = await response.json();
          setScanResult(result.result);
        } else {
          throw new Error('Scan failed');
        }
      }
    } catch (error) {
      console.error('Scan error:', error);
      setScanProgress({
        currentChat: 'Error occurred',
        processed: 0,
        total: 0,
        status: 'Scan failed'
      });
    }
  };

  const simulateScan = async () => {
    const chats = [
      { name: 'Work Group', members: 25, messages: 150 },
      { name: 'Family Chat', members: 8, messages: 0 }, // Will be skipped
      { name: 'Friends', members: 15, messages: 89 },
      { name: 'Tech Discussion', members: 45, messages: 234 },
      { name: 'Private Chat', members: 2, messages: 67 }
    ];

    setScanProgress({
      currentChat: 'Getting chat list...',
      processed: 0,
      total: chats.length,
      status: 'Connecting to Telegram...'
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    for (let i = 0; i < chats.length; i++) {
      if (scanAborted) return;
      
      const chat = chats[i];
      setScanProgress({
        currentChat: chat.name,
        processed: i,
        total: chats.length,
        status: `Scanning ${chat.name}...`
      });

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    if (!scanAborted) {
      setScanResult({
        chats: [
          {
            id: 1,
            title: 'Work Group',
            type: 'Group',
            participants: 25,
            candidates: 150,
            deleted: 0
          },
          {
            id: 2,
            title: 'Family Chat',
            type: 'Group',
            participants: 8,
            candidates: 0,
            deleted: 0,
            skipped_reason: 'Group too small (≤10 members) - skipped for safety'
          },
          {
            id: 3,
            title: 'Friends',
            type: 'Group',
            participants: 15,
            candidates: 89,
            deleted: 0
          },
          {
            id: 4,
            title: 'Tech Discussion',
            type: 'Group',
            participants: 45,
            candidates: 234,
            deleted: 0
          },
          {
            id: 5,
            title: 'Private Chat',
            type: 'User',
            participants: 2,
            candidates: 67,
            deleted: 0
          }
        ],
        summary: {
          total_processed: 4,
          total_skipped: 1,
          total_candidates: 540,
          total_deleted: 0
        },
        logs: [
          '[14:32:15] Starting message scan...',
          '[14:32:16] Connected to Telegram successfully',
          '[14:32:17] Found 5 chats to process',
          '[14:32:18] Scanning Work Group - found 150 messages',
          '[14:32:19] Skipping Family Chat - too few members (8)',
          '[14:32:20] Scanning Friends - found 89 messages',
          '[14:32:21] Scanning Tech Discussion - found 234 messages',
          '[14:32:22] Scanning Private Chat - found 67 messages',
          '[14:32:23] Scan complete! Found 540 messages across 4 chats'
        ]
      });

      setScanProgress({
        currentChat: 'Complete',
        processed: chats.length,
        total: chats.length,
        status: 'Scan completed successfully!'
      });
    }
  };

  const stopScan = () => {
    setScanAborted(true);
    setScanProgress({
      currentChat: 'Stopped',
      processed: 0,
      total: 0,
      status: 'Scan stopped by user'
    });
  };

  const closeScanPage = () => {
    setShowVisualScan(false);
    setShowScanPage(false);
    setShowMessagePreview(false);
    setScanningAccount(null);
    setScanProgress(null);
    setScanResult(null);
    setScanAborted(false);
    setSelectedChats(new Set());
    setPreviewMessages([]);
  };

  const handleChatSelection = (chatId: number, selected: boolean) => {
    const newSelected = new Set(selectedChats);
    if (selected) {
      newSelected.add(chatId);
    } else {
      newSelected.delete(chatId);
    }
    setSelectedChats(newSelected);
  };

  const handleSelectAllChats = () => {
    if (!scanResult) return;
    
    const allChatIds = scanResult.chats
      .filter(chat => chat.candidates > 0)
      .map(chat => chat.id);
    
    if (selectedChats.size === allChatIds.length) {
      setSelectedChats(new Set());
    } else {
      setSelectedChats(new Set(allChatIds));
    }
  };

  const showMessagesPreview = async () => {
    if (!scanningAccount || selectedChats.size === 0) return;
    
    // Simulate loading messages for selected chats
    const mockMessages = Array.from(selectedChats).flatMap(chatId => {
      const chat = scanResult?.chats.find(c => c.id === chatId);
      if (!chat) return [];
      
      return Array.from({ length: Math.min(chat.candidates, 5) }, (_, i) => ({
        id: chatId * 1000 + i,
        chat_id: chatId,
        chat_title: chat.title,
        chat_type: chat.type,
        date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        content: `הודעה דוגמה ${i + 1} מ${chat.title}`,
        participants_count: chat.participants
      }));
    });
    
    setPreviewMessages(mockMessages);
    setShowMessagePreview(true);
  };

  const deleteSelectedMessages = async (messageIds: number[]) => {
    setIsDeletingMessages(true);
    
    // Simulate deletion
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Remove deleted messages from preview
    setPreviewMessages(prev => prev.filter(msg => !messageIds.includes(msg.id)));
    setIsDeletingMessages(false);
  };

  const deleteAccount = async (accountId: string) => {
    if (!confirm('Are you sure you want to delete this account?')) return;

    // Check if backend is available
    if (!API_BASE) {
      alert('This feature requires running the application locally.');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/accounts/${accountId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        loadAccounts();
      }
    } catch (error) {
      console.error('Error deleting account:', error);
    }
  };

  // Message Preview Component
  if (showMessagePreview && previewMessages.length > 0) {
    return (
      <MessagePreview
        messages={previewMessages}
        onDeleteSelected={deleteSelectedMessages}
        onBack={() => setShowMessagePreview(false)}
        isDeleting={isDeletingMessages}
      />
    );
  }

  // Visual Scan Interface
  if (showVisualScan && scanningAccount) {
    const account = accounts.find(acc => acc.id === scanningAccount);
    
    return (
      <VisualScanInterface
        accountId={scanningAccount}
        accountLabel={account?.label || 'Unknown'}
        onClose={closeScanPage}
        onStartScan={startVisualScan}
        onStopScan={stopScan}
        isScanning={!!scanProgress && !scanResult && !scanAborted}
        scanProgress={scanProgress || undefined}
      />
    );
  }

  // Scan Page Component
  if (showScanPage) {
    const account = accounts.find(acc => acc.id === scanningAccount);
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <button
                  onClick={closeScanPage}
                  className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 mr-4"
                >
                  <X className="w-5 h-5 mr-1" />
                  Close
                </button>
                <BarChart3 className="w-8 h-8 text-blue-600 mr-3" />
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Scan Results</h1>
                  <p className="text-gray-600">Account: {account?.label}</p>
                </div>
              </div>
              
              {scanProgress && !scanResult && !scanAborted && (
                <button
                  onClick={stopScan}
                  className="flex items-center px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop Scan
                </button>
              )}
            </div>

            {/* Progress */}
            {scanProgress && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {scanProgress.status}
                  </span>
                  {!scanResult && !scanAborted && (
                    <Loader className="w-4 h-4 animate-spin text-blue-600" />
                  )}
                </div>
                
                {scanProgress.total > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(scanProgress.processed / scanProgress.total) * 100}%` }}
                    ></div>
                  </div>
                )}
                
                <p className="text-sm text-gray-600">
                  Current: {scanProgress.currentChat}
                  {scanProgress.total > 0 && (
                    <span className="ml-2">
                      ({scanProgress.processed}/{scanProgress.total})
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Results */}
          {scanResult && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <div className="flex items-center">
                    <Users className="w-8 h-8 text-blue-600 mr-3" />
                    <div>
                      <p className="text-sm text-gray-600">Chats Processed</p>
                      <p className="text-2xl font-bold text-gray-900">{scanResult.summary.total_processed}</p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <div className="flex items-center">
                    <Shield className="w-8 h-8 text-yellow-600 mr-3" />
                    <div>
                      <p className="text-sm text-gray-600">Chats Skipped</p>
                      <p className="text-2xl font-bold text-gray-900">{scanResult.summary.total_skipped}</p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <div className="flex items-center">
                    <MessageSquare className="w-8 h-8 text-green-600 mr-3" />
                    <div>
                      <p className="text-sm text-gray-600">Messages Found</p>
                      <p className="text-2xl font-bold text-gray-900">{scanResult.summary.total_candidates}</p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <div className="flex items-center">
                    <Trash2 className="w-8 h-8 text-red-600 mr-3" />
                    <div>
                      <p className="text-sm text-gray-600">Messages Deleted</p>
                      <p className="text-2xl font-bold text-gray-900">{scanResult.summary.total_deleted}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Selection Controls */}
              <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <button
                      onClick={handleSelectAllChats}
                      className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 mr-4"
                    >
                      {selectedChats.size === scanResult.chats.filter(chat => chat.candidates > 0).length ? (
                        <CheckSquare className="w-5 h-5 mr-2" />
                      ) : (
                        <Square className="w-5 h-5 mr-2" />
                      )}
                      בחר הכל ({scanResult.chats.filter(chat => chat.candidates > 0).length} קבוצות)
                    </button>
                    <span className="text-sm text-gray-600">
                      נבחרו {selectedChats.size} קבוצות
                    </span>
                  </div>
                  
                  <div className="flex space-x-3">
                    <button
                      onClick={showMessagesPreview}
                      disabled={selectedChats.size === 0}
                      className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      תצוגה מקדימה ({selectedChats.size})
                    </button>
                    
                    <button
                      disabled={selectedChats.size === 0}
                      className="flex items-center px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      מחק נבחרות ({selectedChats.size})
                    </button>
                  </div>
                </div>
              </div>

              {/* Chat Results */}
              <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Chat Details</h3>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          <button
                            onClick={handleSelectAllChats}
                            className="flex items-center text-gray-600 hover:text-gray-800"
                          >
                            {selectedChats.size === scanResult.chats.filter(chat => chat.candidates > 0).length ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Chat</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Members</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Messages Found</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Preview</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {scanResult.chats.map((chat) => (
                        <tr key={chat.id} className={`hover:bg-gray-50 transition-colors group ${
                          selectedChats.has(chat.id) ? 'bg-blue-50' : ''
                        }`}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {chat.candidates > 0 && (
                              <button
                                onClick={() => handleChatSelection(chat.id, !selectedChats.has(chat.id))}
                                className="text-gray-600 hover:text-gray-800"
                              >
                                {selectedChats.has(chat.id) ? (
                                  <CheckSquare className="w-4 h-4 text-blue-600" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{chat.title}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                              {chat.type}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {chat.participants}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {chat.candidates}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {chat.candidates > 0 && (
                              <div className="relative group">
                                <div className="text-xs text-gray-600 bg-gray-100 rounded px-2 py-1 cursor-pointer hover:bg-gray-200 transition-colors">
                                  {chat.candidates} הודעות
                                </div>
                                
                                {/* Hover Preview */}
                                <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-xl z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform translate-y-2 group-hover:translate-y-0">
                                  <div className="p-4">
                                    <h4 className="font-medium text-gray-900 mb-3">תצוגה מקדימה - {chat.title}</h4>
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                      {Array.from({ length: Math.min(chat.candidates, 3) }, (_, i) => (
                                        <div key={i} className="text-sm text-gray-700 bg-gray-50 rounded p-2">
                                          <div className="text-xs text-gray-500 mb-1">
                                            {new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toLocaleDateString('he-IL')}
                                          </div>
                                          הודעה דוגמה {i + 1} מהקבוצה {chat.title}
                                        </div>
                                      ))}
                                      {chat.candidates > 3 && (
                                        <div className="text-xs text-gray-500 text-center py-2">
                                          ועוד {chat.candidates - 3} הודעות...
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {chat.skipped_reason ? (
                              <div className="flex items-center">
                                <AlertTriangle className="w-4 h-4 text-yellow-500 mr-2" />
                                <span className="text-xs text-yellow-700">Skipped</span>
                              </div>
                            ) : chat.error ? (
                              <div className="flex items-center">
                                <XCircle className="w-4 h-4 text-red-500 mr-2" />
                                <span className="text-xs text-red-700">Error</span>
                              </div>
                            ) : (
                              <div className="flex items-center">
                                <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                                <span className="text-xs text-green-700">Processed</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {chat.candidates > 0 && (
                              <button
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                                onClick={() => {
                                  // Handle single chat deletion
                                  console.log('Delete messages from', chat.title);
                                }}
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                מחק
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Logs */}
              <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Operation Log</h3>
                </div>
                <div className="p-6">
                  <div className="bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto">
                    {scanResult.logs.map((log, index) => (
                      <div key={index} className="text-sm text-green-400 font-mono mb-1">
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Initialize selected chats when scan result is available
  useEffect(() => {
    if (scanResult && selectedChats.size === 0) {
      // Select all chats with messages by default
      const chatsWithMessages = scanResult.chats
        .filter(chat => chat.candidates > 0)
        .map(chat => chat.id);
      setSelectedChats(new Set(chatsWithMessages));
    }
  }, [scanResult]);

  // Main App Component
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <MessageSquare className="w-10 h-10 text-blue-600 mr-4" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Telegram Message Manager</h1>
                <p className="text-gray-600">
                  {isDeployedEnvironment 
                    ? "Demo interface - Download and run locally for full functionality" 
                    : "Safely manage your Telegram messages across multiple accounts"
                  }
                </p>
              </div>
            </div>
            
            {isDeployedEnvironment && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <div className="flex items-center">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 mr-2" />
                  <div>
                    <h3 className="text-sm font-medium text-yellow-800">Demo Mode</h3>
                    <p className="text-sm text-yellow-700">
                      This is a demo interface. To connect to Telegram and manage messages, 
                      <a href="https://github.com/your-repo" className="underline ml-1" target="_blank" rel="noopener noreferrer">
                        download and run the app locally
                      </a>.
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <button
              onClick={() => setShowAddAccount(true)}
              disabled={accounts.length >= 5}
              className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Account ({accounts.length}/5)
            </button>
          </div>
        </div>

        {/* Add Account Modal */}
        {showAddAccount && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Add New Account</h2>
              
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Account Label (e.g., Personal)"
                  value={newAccount.label}
                  onChange={(e) => setNewAccount({...newAccount, label: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                <input
                  type="number"
                  placeholder="API ID"
                  value={newAccount.api_id}
                  onChange={(e) => setNewAccount({...newAccount, api_id: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                <input
                  type="text"
                  placeholder="API Hash"
                  value={newAccount.api_hash}
                  onChange={(e) => setNewAccount({...newAccount, api_hash: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                <input
                  type="tel"
                  placeholder="Phone Number (with country code)"
                  value={newAccount.phone}
                  onChange={(e) => setNewAccount({...newAccount, phone: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setShowAddAccount(false)}
                  className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={addAccount}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Add Account
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Accounts Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-8 h-8 animate-spin text-blue-600" />
            <span className="ml-3 text-gray-600">Loading accounts...</span>
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No accounts added yet</h3>
            <p className="text-gray-600 mb-6">Add your first Telegram account to get started</p>
            <button
              onClick={() => setShowAddAccount(true)}
              className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Account
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                status={accountStatuses[account.id]}
                isOperating={operationStates[account.id]}
                loginData={loginData[account.id]}
                onConnect={() => connectAccount(account.id)}
                onSubmitCode={(code, password) => submitCode(account.id, code, password)}
                onScan={() => startScan(account.id)}
                onDelete={() => deleteAccount(account.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Account Card Component
interface AccountCardProps {
  account: Account;
  status?: string;
  isOperating?: boolean;
  loginData?: any;
  onConnect: () => void;
  onSubmitCode: (code: string, password?: string) => void;
  onScan: () => void;
  onDelete: () => void;
}

const AccountCard: React.FC<AccountCardProps> = ({
  account,
  status,
  isOperating,
  loginData,
  onConnect,
  onSubmitCode,
  onScan,
  onDelete
}) => {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchPrompt, setSearchPrompt] = useState('');

  const handleCodeSubmit = () => {
    if (loginData?.step === '2fa') {
      onSubmitCode(loginData.code, password);
    } else {
      onSubmitCode(code);
    }
    setCode('');
    setPassword('');
  };

  const handleSmartSearch = async () => {
    if (!searchPrompt.trim()) {
      alert('Please enter a search prompt');
      return;
    }
    
    // TODO: Implement smart search API call
    console.log('Smart search for:', searchPrompt);
    setShowSearchModal(false);
    setSearchPrompt('');
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
      {/* Account Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <div className={`w-3 h-3 rounded-full mr-3 ${
            account.is_authenticated ? 'bg-green-500' : 'bg-gray-400'
          }`} />
          <div>
            <h3 className="font-semibold text-gray-900">{account.label}</h3>
            <p className="text-sm text-gray-600">{account.phone}</p>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Status */}
      {status && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg">
          <p className="text-sm text-blue-800">{status}</p>
        </div>
      )}

      {/* Authentication Status */}
      <div className="mb-4">
        {account.is_authenticated ? (
          <div className="flex items-center text-green-600">
            <CheckCircle className="w-4 h-4 mr-2" />
            <span className="text-sm">Connected as {account.username}</span>
          </div>
        ) : (
          <div className="flex items-center text-gray-500">
            <XCircle className="w-4 h-4 mr-2" />
            <span className="text-sm">Not connected</span>
          </div>
        )}
      </div>

      {/* Login Form */}
      {loginData && (
        <div className="mb-4 space-y-3">
          {loginData.step === 'code' && (
            <div>
              <input
                type="text"
                placeholder="Enter verification code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                maxLength={5}
              />
            </div>
          )}
          
          {loginData.step === '2fa' && (
            <div>
              <input
                type="password"
                placeholder="Enter 2FA password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
          
          <button
            onClick={handleCodeSubmit}
            disabled={isOperating || (!code && loginData.step === 'code') || (!password && loginData.step === '2fa')}
            className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isOperating ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              'Submit'
            )}
          </button>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2">
        {!account.is_authenticated && !loginData && (
          <button
            onClick={onConnect}
            disabled={isOperating}
            className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isOperating ? (
              <Loader className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Settings className="w-4 h-4 mr-2" />
            )}
            Connect
          </button>
        )}

        {account.is_authenticated && (
          <>
            <button
              onClick={onScan}
              disabled={isOperating}
              className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isOperating ? (
                <Loader className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Eye className="w-4 h-4 mr-2" />
              )}
              Scan Messages
            </button>
            
            <button
              onClick={() => setShowSearchModal(true)}
              disabled={isOperating}
              className="w-full flex items-center justify-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isOperating ? (
                <Loader className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Search className="w-4 h-4 mr-2" />
              )}
              Smart Search
            </button>
            
            <button
              disabled={isOperating}
              className="w-full flex items-center justify-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isOperating ? (
                <Loader className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete Messages
            </button>
          </>
        )}
      </div>
      </div>

      {/* Smart Search Modal */}
      {showSearchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Smart Message Search</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Search Prompt
                </label>
                <textarea
                  placeholder="e.g., 'Find messages about looking for sweets or candy'"
                  value={searchPrompt}
                  onChange={(e) => setSearchPrompt(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 h-24 resize-none"
                />
              </div>
              
              <div className="bg-purple-50 p-3 rounded-lg">
                <p className="text-sm text-purple-800">
                  <strong>Examples:</strong><br/>
                  • "Messages about wanting to buy food"<br/>
                  • "Posts expressing sadness or depression"<br/>
                  • "Messages asking for help or advice"
                </p>
              </div>
            </div>
            
            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowSearchModal(false)}
                className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSmartSearch}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Search
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default App;