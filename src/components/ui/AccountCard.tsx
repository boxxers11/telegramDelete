import React, { useState, useEffect } from 'react';
import { User, Wifi, WifiOff, Eye, MessageSquare, Search, MoreVertical, Loader, Cloud, CloudOff, Download, Upload, Database, Trash2 } from 'lucide-react';
import { Account } from '../../hooks/useAccounts';

interface AccountCardProps {
    account: Account;
    onConnect: (accountId: string) => void;
    onDelete: (accountId: string) => void;
    onScan: (accountId: string) => void;
    onSendMessage: (accountId: string) => void;
    onSemanticSearch: (accountId: string) => void;
    loading?: boolean;
}

interface DataStatus {
    checkpoints_count: number;
    scanned_chats_count: number;
    total_messages_found: number;
    completed_scans: number;
    last_scan_date: string | null;
}

interface BackupInfo {
    backup_count: number;
    latest_backup: any;
    all_backups: any[];
}

const AccountCard: React.FC<AccountCardProps> = ({
    account,
    onConnect,
    onDelete,
    onScan,
    onSendMessage,
    onSemanticSearch,
    loading = false
}) => {
    const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
    const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
    const [backupLoading, setBackupLoading] = useState(false);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);

    // Load data status and backup info when component mounts
    useEffect(() => {
        if (account.is_authenticated) {
            loadDataStatus();
            loadBackupInfo();
        }
    }, [account.is_authenticated, account.id]);

    // Close settings menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (showSettingsMenu) {
                const target = event.target as Element;
                if (!target.closest('.settings-menu-container')) {
                    setShowSettingsMenu(false);
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showSettingsMenu]);

    const loadDataStatus = async () => {
        try {
            const response = await fetch(`http://127.0.0.1:8001/accounts/${account.id}/data-status`);
            const data = await response.json();
            if (data.success) {
                setDataStatus(data.data_status);
            }
        } catch (error) {
            console.error('Error loading data status:', error);
        }
    };

    const loadBackupInfo = async () => {
        try {
            const response = await fetch(`http://127.0.0.1:8001/accounts/${account.id}/backup-info`);
            const data = await response.json();
            if (data.success) {
                setBackupInfo(data.backup_info);
            }
        } catch (error) {
            console.error('Error loading backup info:', error);
        }
    };

    const handleBackup = async () => {
        setBackupLoading(true);
        try {
            const response = await fetch(`http://127.0.0.1:8001/accounts/${account.id}/backup`, {
                method: 'POST'
            });
            const data = await response.json();
            if (data.success) {
                setBackupInfo(data.backup_info);
                alert('✅ נתונים נשמרו בהצלחה בענן!');
            } else {
                alert('❌ שגיאה בשמירה: ' + data.error);
            }
        } catch (error) {
            console.error('Error backing up:', error);
            alert('❌ שגיאת רשת בשמירה');
        } finally {
            setBackupLoading(false);
        }
    };

    const handleRestore = async () => {
        setBackupLoading(true);
        try {
            const response = await fetch(`http://127.0.0.1:8001/accounts/${account.id}/restore`, {
                method: 'POST'
            });
            const data = await response.json();
            if (data.success) {
                alert(`✅ נתונים שוחזרו בהצלחה! ${data.checkpoints_count} נקודות בדיקה, ${data.scanned_chats_count} צ'אטים נסרקו`);
                loadDataStatus();
            } else {
                alert('❌ שגיאה בשחזור: ' + data.error);
            }
        } catch (error) {
            console.error('Error restoring:', error);
            alert('❌ שגיאת רשת בשחזור');
        } finally {
            setBackupLoading(false);
        }
    };
    return (
        <div className="glass-elevated p-8 hover-lift">
            <div className="flex items-start justify-between">
                <div className="flex items-start space-x-6">
                    {/* Account Avatar */}
                    <div className="glass-card p-4 rounded-2xl">
                        <User className="w-8 h-8 text-blue-400" />
                    </div>
                    
                    {/* Account Info */}
                    <div className="flex-1 min-w-0">
                        <div className="mb-4">
                            <h3 className="text-2xl font-bold text-white mb-2">{account.label}</h3>
                            <p className="text-lg text-gray-300 font-medium">{account.phone}</p>
                            {account.is_authenticated && account.username && (
                                <p className="text-sm text-green-400 font-medium mt-1">
                                    ✅ מחובר כ-{account.username}
                                </p>
                            )}
                            
                            {/* Last Scan Info */}
                            {account.is_authenticated && dataStatus && (
                                <div className="mt-3 p-3 glass-card rounded-lg">
                                    <h4 className="text-sm font-semibold text-white mb-2 flex items-center">
                                        <Database className="w-4 h-4 mr-1" />
                                        פרטי סריקה אחרונה
                                    </h4>
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-gray-300">נקודות בדיקה:</span>
                                            <span className="text-blue-400 font-medium">{dataStatus.checkpoints_count}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-300">צ'אטים נסרקו:</span>
                                            <span className="text-purple-400 font-medium">{dataStatus.scanned_chats_count}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-300">הודעות נמצאו:</span>
                                            <span className="text-yellow-400 font-medium">{dataStatus.total_messages_found}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-300">סריקות הושלמו:</span>
                                            <span className="text-green-400 font-medium">{dataStatus.completed_scans}</span>
                                        </div>
                                        {dataStatus.last_scan_date && (
                                            <div className="col-span-2 flex justify-between">
                                                <span className="text-gray-300">תאריך סריקה אחרון:</span>
                                                <span className="text-gray-400 text-xs">
                                                    {new Date(dataStatus.last_scan_date).toLocaleDateString('he-IL')}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                
                <div className="flex items-center space-x-3">
                    {/* Connection Status */}
                    <div className="flex items-center">
                        {account.is_authenticated ? (
                            <div className="flex items-center text-green-400">
                                <Wifi className="w-4 h-4 mr-1" />
                                <span className="text-small">Connected</span>
                            </div>
                        ) : (
                            <div className="flex items-center text-gray-400">
                                <WifiOff className="w-4 h-4 mr-1" />
                                <span className="text-small">Not connected</span>
                            </div>
                        )}
                    </div>
                    
                    {/* Action Buttons */}
                    {account.is_authenticated ? (
                        <div className="flex flex-col space-y-2">
                            {/* Main Action Buttons */}
                            <div className="flex space-x-2">
                                <button
                                    onClick={() => onScan(account.id)}
                                    className="btn-primary hover-lift flex items-center"
                                    disabled={loading}
                                >
                                    <Eye className="w-4 h-4 mr-1" />
                                    Scan Messages
                                </button>
                                
                                <button
                                    onClick={() => onSendMessage(account.id)}
                                    className="btn-secondary hover-lift flex items-center"
                                    disabled={loading}
                                >
                                    <MessageSquare className="w-4 h-4 mr-1" />
                                    Send Messages
                                </button>
                                
                                <button
                                    onClick={() => onSemanticSearch(account.id)}
                                    className="btn-secondary hover-lift flex items-center"
                                    disabled={loading}
                                >
                                    <Search className="w-4 h-4 mr-1" />
                                    Semantic Search
                                </button>
                            </div>
                            
                            
                            {/* Backup Status */}
                            {backupInfo && (
                                <div className="text-xs text-gray-400 flex items-center">
                                    {backupInfo.backup_count > 0 ? (
                                        <>
                                            <Cloud className="w-3 h-3 mr-1 text-green-400" />
                                            <span>{backupInfo.backup_count} גיבויים זמינים</span>
                                        </>
                                    ) : (
                                        <>
                                            <CloudOff className="w-3 h-3 mr-1 text-yellow-400" />
                                            <span>אין גיבויים זמינים</span>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={() => onConnect(account.id)}
                            disabled={loading}
                            className="btn-primary flex items-center disabled:opacity-50"
                        >
                            {loading ? <Loader className="w-4 h-4 animate-spin mr-1" /> : null}
                            Connect
                        </button>
                    )}
                    
                    {/* Settings Menu */}
                    <div className="relative settings-menu-container">
                        <button
                            onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                            className="btn-secondary p-2 hover-scale"
                            disabled={loading}
                        >
                            <MoreVertical className="w-4 h-4" />
                        </button>
                        
                        {showSettingsMenu && (
                            <div className="absolute right-0 top-full mt-2 w-48 glass-elevated rounded-lg shadow-lg z-50 transform -translate-x-full">
                                <div className="py-2">
                                    <button
                                        onClick={() => {
                                            handleBackup();
                                            setShowSettingsMenu(false);
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm text-white hover:bg-white/10 flex items-center"
                                        disabled={backupLoading || loading}
                                    >
                                        {backupLoading ? (
                                            <Loader className="w-4 h-4 mr-2 animate-spin" />
                                        ) : (
                                            <Upload className="w-4 h-4 mr-2" />
                                        )}
                                        גיבוי לענן
                                    </button>
                                    
                                    <button
                                        onClick={() => {
                                            handleRestore();
                                            setShowSettingsMenu(false);
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm text-white hover:bg-white/10 flex items-center"
                                        disabled={backupLoading || loading}
                                    >
                                        {backupLoading ? (
                                            <Loader className="w-4 h-4 mr-2 animate-spin" />
                                        ) : (
                                            <Download className="w-4 h-4 mr-2" />
                                        )}
                                        שחזור מהענן
                                    </button>
                                    
                                    <div className="border-t border-white/10 my-1"></div>
                                    
                                    <button
                                        onClick={() => {
                                            onDelete(account.id);
                                            setShowSettingsMenu(false);
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center"
                                        disabled={loading}
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        מחק פרופיל
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
        </div>
    );
};

export default AccountCard;
