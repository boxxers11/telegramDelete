import React, { useState, useEffect } from 'react';
import { User, Wifi, WifiOff, Eye, MessageSquare, Search, MoreVertical, Loader, Download, Upload, Database, Trash2, CheckCircle } from 'lucide-react';
import { Account } from '../../hooks/useAccounts';
import { apiFetch } from '../../config/api';

interface AccountCardProps {
    account: Account;
    onConnect: (accountId: string) => void;
    onDelete: (accountId: string) => void;
    onScan: (accountId: string) => void;
    onSendMessage: (accountId: string) => void;
    onSemanticSearch: (accountId: string) => void;
    loading?: boolean;
    language: 'he' | 'en';
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
    latest_backup: unknown;
    all_backups: unknown[];
}

const AccountCard: React.FC<AccountCardProps> = ({
    account,
    onConnect,
    onDelete,
    onScan,
    onSendMessage,
    onSemanticSearch,
    loading = false,
    language,
    isBulkConnecting = false,
    bulkConnectState
}) => {
    const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
    const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
    const [backupLoading, setBackupLoading] = useState(false);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [temporaryMessages, setTemporaryMessages] = useState<Array<{
        key: string;
        chat_id: number;
        chat_title: string;
        message_id: number;
        sent_at: string;
        deletes_at: string;
        minutes_remaining: number;
    }>>([]);

    const loadTemporaryMessages = async () => {
        try {
            const response = await apiFetch(`/accounts/${account.id}/temporary-messages`);
            if (!response.ok) {
                return;
            }
            const data = await response.json();
            if (data.success && Array.isArray(data.temporary_messages)) {
                setTemporaryMessages(data.temporary_messages);
            }
        } catch (error) {
            if (error instanceof Error && error.name !== 'AbortError') {
                console.error('Error loading temporary messages:', error);
            }
        }
    };

    // Load data status and backup info when component mounts
    useEffect(() => {
        if (account.is_authenticated) {
            loadDataStatus();
            loadBackupInfo();
            loadTemporaryMessages();
            // Refresh temporary messages every minute
            const interval = setInterval(loadTemporaryMessages, 60000);
            return () => clearInterval(interval);
        } else {
            setTemporaryMessages([]);
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
            const response = await apiFetch(`/accounts/${account.id}/data-status`);
            if (!response.ok) {
                return; // Silently fail if endpoint not available
            }
            const data = await response.json();
            if (data.success) {
                setDataStatus(data.data_status);
            }
        } catch (error) {
            // Silently ignore timeout/abort errors - these are non-critical
            if (error instanceof Error && error.name !== 'AbortError') {
            console.error('Error loading data status:', error);
            }
        }
    };

    const loadBackupInfo = async () => {
        try {
            const response = await apiFetch(`/accounts/${account.id}/backup-info`);
            if (!response.ok) {
                return; // Silently fail if endpoint not available
            }
            const data = await response.json();
            if (data.success) {
                setBackupInfo(data.backup_info);
            }
        } catch (error) {
            // Silently ignore timeout/abort errors - these are non-critical
            if (error instanceof Error && error.name !== 'AbortError') {
            console.error('Error loading backup info:', error);
            }
        }
    };

    const handleBackup = async () => {
        setBackupLoading(true);
        try {
            const response = await apiFetch(`/accounts/${account.id}/backup`, {
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
            const response = await apiFetch(`/accounts/${account.id}/restore`, {
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
    const isConnected = account.is_authenticated;
    const isRTL = language === 'he';
    const labels = {
        semantic: isRTL ? 'חיפוש סמנטי' : 'Semantic Search',
        send: isRTL ? 'שליחת הודעות' : 'Send Messages',
        scan: isRTL ? 'סריקת הודעות' : 'Scan Messages',
        connect: isRTL ? 'התחברות לחשבון' : 'Connect to account',
        connected: isRTL ? 'מחובר' : 'Connected',
        notConnected: isRTL ? 'מנותק' : 'Not connected',
        noBackups: isRTL ? 'אין גיבויים זמינים' : 'No backups available',
        backupsAvailable: (count: number) =>
            isRTL ? `${count} גיבויים זמינים` : `${count} backups available`,
        lastScanTitle: isRTL ? 'פרטי סריקה אחרונה' : 'Last Scan Details',
        lastScanDate: isRTL ? 'תאריך סריקה אחרון' : 'Last scan date',
        checkpoints: isRTL ? 'נקודות בדיקה' : 'Checkpoints',
        chatsScanned: isRTL ? "צ'אטים נסרקו" : 'Chats scanned',
        messagesFound: isRTL ? 'הודעות נמצאו' : 'Messages found',
        scansCompleted: isRTL ? 'סריקות הושלמו' : 'Scans completed',
        noScanYet: isRTL ? 'טרם בוצעה סריקה לחשבון זה.' : 'No scans have been run for this account yet.',
        backupToCloud: isRTL ? 'גיבוי לענן' : 'Backup to cloud',
        restoreFromCloud: isRTL ? 'שחזור' : 'Restore',
        menuRestore: isRTL ? 'שחזור מהענן' : 'Restore from cloud',
        deleteProfile: isRTL ? 'מחק פרופיל' : 'Delete profile',
        accountOptions: isRTL ? 'אפשרויות חשבון' : 'Account options'
    };
    const metrics = [
        {
            label: labels.chatsScanned,
            value: isConnected && dataStatus ? dataStatus.scanned_chats_count : '—',
            accent: 'text-purple-300'
        },
        {
            label: labels.scansCompleted,
            value: isConnected && dataStatus ? dataStatus.completed_scans : '—',
            accent: 'text-green-300'
        },
        {
            label: labels.messagesFound,
            value: isConnected && dataStatus ? dataStatus.total_messages_found : '—',
            accent: 'text-yellow-300'
        },
        {
            label: labels.checkpoints,
            value: isConnected && dataStatus ? dataStatus.checkpoints_count : '—',
            accent: 'text-blue-300'
        }
    ];

    const connectionIcon = isConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />;
    const connectionLabel = isConnected ? labels.connected : labels.notConnected;
    const connectionColor = isConnected ? 'text-green-300' : 'text-red-300';
    const isCurrentBulkTarget = Boolean(bulkConnectState?.active && bulkConnectState.currentAccountId === account.id);
    const connectDisabled = loading || isBulkConnecting || isConnected;
    const connectButtonLabel = isCurrentBulkTarget
        ? (isRTL ? 'מתחבר...' : 'Connecting...')
        : labels.connect;

    const backupStatus = backupInfo && backupInfo.backup_count > 0
        ? labels.backupsAvailable(backupInfo.backup_count)
        : labels.noBackups;

    const actionButtons = [
        {
            key: 'semantic',
            label: labels.semantic,
            Icon: Search,
            className: 'account-action account-action--semantic',
            onClick: () => onSemanticSearch(account.id)
        },
        {
            key: 'messages',
            label: labels.send,
            Icon: MessageSquare,
            className: 'account-action account-action--send',
            onClick: () => onSendMessage(account.id)
        },
        {
            key: 'scan',
            label: labels.scan,
            Icon: Eye,
            className: 'account-action account-action--scan',
            onClick: () => onScan(account.id)
        }
    ];

    const lastScanHuman = dataStatus?.last_scan_date
        ? new Date(dataStatus.last_scan_date).toLocaleDateString(isRTL ? 'he-IL' : 'en-US')
        : null;
    const menuPositionClass = isRTL ? 'left-0' : 'right-0';

    return (
        <div className="account-card-shell mb-6" dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="account-card-content text-white">
                <div className={`account-top-row ${isRTL ? 'flex-row-reverse' : ''}`}>
                    <div className={`account-identity ${isConnected ? '' : 'opacity-80'} ${isRTL ? 'flex-row-reverse' : ''}`}>
                        <div className="account-avatar">
                            <User className="w-8 h-8 text-white" />
                        </div>
                        <div className={`${isRTL ? 'text-right' : 'text-left'} space-y-1`}>
                            <div className="account-name">{account.label}</div>
                            <div className="account-phone">{account.phone}</div>
                            {isConnected && account.username && (
                                <div className={`text-sm text-green-300 flex items-center gap-1 ${isRTL ? 'flex-row-reverse' : ''}`}>
                                    <CheckCircle className="w-4 h-4" />
                                    {isRTL ? `מחובר כ-${account.username}` : `Connected as ${account.username}`}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className={`relative settings-menu-container ${isRTL ? 'order-first' : ''}`}>
                        <button
                            onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                            className="rounded-3xl border border-white/15 bg-white/10 p-3 text-white/80 transition-all hover:bg-white/15 hover:text-white"
                            disabled={loading}
                            aria-label={labels.accountOptions}
                        >
                            <MoreVertical className="w-5 h-5" />
                        </button>

                        {showSettingsMenu && (
                            <div
                                className={`absolute top-full ${menuPositionClass} mt-3 w-56 rounded-2xl border border-white/10 bg-[#0F172A]/95 p-3 shadow-2xl`}
                            >
                                <div className="flex flex-col gap-1 text-sm">
                                    <button
                                        onClick={() => {
                                            handleBackup();
                                            setShowSettingsMenu(false);
                                        }}
                                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-white/80 transition-colors hover:bg-white/10 ${isRTL ? 'flex-row-reverse text-right' : ''}`}
                                        disabled={backupLoading || loading}
                                    >
                                        {backupLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                        {labels.backupToCloud}
                                    </button>
                                    <button
                                        onClick={() => {
                                            handleRestore();
                                            setShowSettingsMenu(false);
                                        }}
                                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-white/80 transition-colors hover:bg-white/10 ${isRTL ? 'flex-row-reverse text-right' : ''}`}
                                        disabled={backupLoading || loading}
                                    >
                                        {backupLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                        {labels.menuRestore}
                                    </button>
                                    <div className="my-1 h-px bg-white/10" />
                                    <button
                                        onClick={() => {
                                            onDelete(account.id);
                                            setShowSettingsMenu(false);
                                        }}
                                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-red-300 transition-colors hover:bg-red-500/10 ${isRTL ? 'flex-row-reverse text-right' : ''}`}
                                        disabled={loading}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        {labels.deleteProfile}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className={`account-state-row ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                    <span className={`account-badge ${connectionColor}`}>
                        {connectionIcon}
                        <span>{connectionLabel}</span>
                    </span>
                    <span className="account-badge">
                        <Database className="w-4 h-4" />
                        {backupStatus}
                    </span>
                    {lastScanHuman && (
                        <span className="account-badge">
                            <Eye className="w-4 h-4 opacity-80" />
                            {lastScanHuman}
                        </span>
                    )}
                </div>

                {isConnected ? (
                    <div className={`account-actions ${isRTL ? 'flex-row-reverse' : ''}`}>
                        {actionButtons.map(({ key, label, Icon, className, onClick }) => (
                            <button
                                key={key}
                                onClick={onClick}
                                className={`${className} ${isRTL ? 'flex-row-reverse' : ''}`}
                            >
                                <Icon />
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className={`${isRTL ? 'text-right' : 'text-left'}`}>
                        <button
                            onClick={() => {
                                if (!connectDisabled) {
                                    onConnect(account.id);
                                }
                            }}
                            className={`btn-secondary inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold ${connectDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                            disabled={connectDisabled}
                        >
                            {isCurrentBulkTarget || loading
                                ? <Loader className="w-4 h-4 animate-spin" />
                                : <Wifi className="w-4 h-4" />}
                            {connectButtonLabel}
                        </button>
                    </div>
                )}

                <div className={`account-metrics ${isRTL ? 'text-right' : ''}`}>
                    {metrics.map((metric) => (
                        <div key={metric.label} className="account-metric">
                            <span>{metric.label}</span>
                            <strong className={metric.accent}>{metric.value}</strong>
                        </div>
                    ))}
                </div>

                <div className={`account-details-card ${isRTL ? 'text-right' : ''}`}>
                    <div className="account-details-title">
                        <span>{labels.lastScanTitle}</span>
                        <span className="account-badge">
                            <Database className="w-4 h-4" />
                            {connectionLabel}
                        </span>
                    </div>
                    {isConnected && dataStatus ? (
                        <>
                            <div className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2 text-sm">
                                <span className="text-xs text-white/50">{labels.lastScanDate}</span>
                                <span>{lastScanHuman}</span>
                            </div>
                            <div className="account-details-grid">
                                <div className="account-metric">
                                    <span>{labels.checkpoints}</span>
                                    <strong className="text-blue-300">{dataStatus.checkpoints_count}</strong>
                                </div>
                                <div className="account-metric">
                                    <span>{labels.chatsScanned}</span>
                                    <strong className="text-purple-300">{dataStatus.scanned_chats_count}</strong>
                                </div>
                                <div className="account-metric">
                                    <span>{labels.messagesFound}</span>
                                    <strong className="text-yellow-300">{dataStatus.total_messages_found}</strong>
                                </div>
                                <div className="account-metric">
                                    <span>{labels.scansCompleted}</span>
                                    <strong className="text-green-300">{dataStatus.completed_scans}</strong>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="text-sm text-white/70">{labels.noScanYet}</div>
                    )}
                    <div className={`flex flex-wrap gap-2 ${isRTL ? 'justify-start' : 'justify-end'}`}>
                        <button
                            onClick={handleBackup}
                            className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm"
                            disabled={backupLoading || loading}
                        >
                            {backupLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            {labels.backupToCloud}
                        </button>
                        <button
                            onClick={handleRestore}
                            className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm"
                            disabled={backupLoading || loading}
                        >
                            <Download className="w-4 h-4" />
                            {labels.restoreFromCloud}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AccountCard;
