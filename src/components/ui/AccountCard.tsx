import React, { useState, useEffect } from 'react';
import { User, Wifi, WifiOff, Eye, MessageSquare, Search, MoreVertical, Loader, Download, Upload, Database, Trash2, CheckCircle, Edit, X, Save } from 'lucide-react';
import { Account } from '../../hooks/useAccounts';
import { apiFetch } from '../../config/api';

// Import user avatar images
import userBlue from '../../assets/user-blue.png';
import userGreen from '../../assets/user-green.png';
import userJasper from '../../assets/user-jasper.png';
import userOrange from '../../assets/user-orange.png';
import userPink from '../../assets/user-pink.png';
import userPurple from '../../assets/user-purple.png';

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

// Generate user-specific color and avatar based on account ID
const getUserColor = (accountId: string) => {
    // Use hash of account ID to generate consistent color
    let hash = 0;
    for (let i = 0; i < accountId.length; i++) {
        hash = accountId.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Modern color palettes - vibrant, pleasant, glowing colors
    // Darker versions for better text contrast (WCAG compliant)
    const colorPalettes = [
        { 
            name: 'blue',
            avatar: userBlue,
            primary: 'rgba(58, 100, 255, 0.95)', 
            secondary: 'rgba(58, 100, 255, 0.75)', 
            dark: 'rgba(30, 50, 128, 0.9)', // Much darker for overlay
            border: 'rgba(92, 126, 255, 0.4)', 
            shadow: 'rgba(58, 100, 255, 0.35)', 
            glow: 'rgba(58, 100, 255, 0.4)',
            buttonBg: 'rgba(30, 50, 128, 0.85)', // Darker for button background
            buttonBorder: 'rgba(58, 100, 255, 0.3)',
            buttonShadow: 'rgba(58, 100, 255, 0.25)'
        }, // Blue
        { 
            name: 'purple',
            avatar: userPurple,
            primary: 'rgba(124, 77, 255, 0.95)', 
            secondary: 'rgba(185, 129, 255, 0.85)', 
            dark: 'rgba(62, 38, 128, 0.9)',
            border: 'rgba(168, 126, 255, 0.45)', 
            shadow: 'rgba(124, 77, 255, 0.35)', 
            glow: 'rgba(124, 77, 255, 0.4)',
            buttonBg: 'rgba(62, 38, 128, 0.85)',
            buttonBorder: 'rgba(124, 77, 255, 0.3)',
            buttonShadow: 'rgba(124, 77, 255, 0.25)'
        }, // Purple
        { 
            name: 'green',
            avatar: userGreen,
            primary: 'rgba(42, 200, 124, 0.95)', 
            secondary: 'rgba(20, 160, 95, 0.88)', 
            dark: 'rgba(21, 100, 62, 0.9)',
            border: 'rgba(94, 234, 177, 0.45)', 
            shadow: 'rgba(33, 181, 121, 0.35)', 
            glow: 'rgba(42, 200, 124, 0.4)',
            buttonBg: 'rgba(21, 100, 62, 0.85)',
            buttonBorder: 'rgba(42, 200, 124, 0.3)',
            buttonShadow: 'rgba(42, 200, 124, 0.25)'
        }, // Green
        { 
            name: 'orange',
            avatar: userOrange,
            primary: 'rgba(255, 159, 64, 0.95)', 
            secondary: 'rgba(255, 193, 7, 0.85)', 
            dark: 'rgba(128, 80, 32, 0.9)',
            border: 'rgba(255, 193, 7, 0.4)', 
            shadow: 'rgba(255, 159, 64, 0.35)', 
            glow: 'rgba(255, 159, 64, 0.4)',
            buttonBg: 'rgba(128, 80, 32, 0.85)',
            buttonBorder: 'rgba(255, 159, 64, 0.3)',
            buttonShadow: 'rgba(255, 159, 64, 0.25)'
        }, // Orange-Yellow
        { 
            name: 'pink',
            avatar: userPink,
            primary: 'rgba(236, 72, 153, 0.95)', 
            secondary: 'rgba(219, 39, 119, 0.85)', 
            dark: 'rgba(118, 36, 77, 0.9)',
            border: 'rgba(236, 72, 153, 0.4)', 
            shadow: 'rgba(236, 72, 153, 0.35)', 
            glow: 'rgba(236, 72, 153, 0.4)',
            buttonBg: 'rgba(118, 36, 77, 0.85)',
            buttonBorder: 'rgba(236, 72, 153, 0.3)',
            buttonShadow: 'rgba(236, 72, 153, 0.25)'
        }, // Pink
        { 
            name: 'jasper',
            avatar: userJasper,
            primary: 'rgba(255, 107, 107, 0.95)', 
            secondary: 'rgba(255, 159, 64, 0.85)', 
            dark: 'rgba(128, 54, 54, 0.9)',
            border: 'rgba(255, 159, 64, 0.4)', 
            shadow: 'rgba(255, 107, 107, 0.35)', 
            glow: 'rgba(255, 107, 107, 0.4)',
            buttonBg: 'rgba(128, 54, 54, 0.85)',
            buttonBorder: 'rgba(255, 107, 107, 0.3)',
            buttonShadow: 'rgba(255, 107, 107, 0.25)'
        }, // Red-Orange (Jasper)
    ];
    
    const index = Math.abs(hash) % colorPalettes.length;
    return colorPalettes[index];
};

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
    const userColor = getUserColor(account.id);
    const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
    const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
    const [backupLoading, setBackupLoading] = useState(false);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState({
        label: account.label,
        api_id: account.api_id?.toString() || '',
        api_hash: account.api_hash || '',
        phone: account.phone || ''
    });
    const [editLoading, setEditLoading] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);
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

    // Update edit form when account changes
    useEffect(() => {
        setEditForm({
            label: account.label,
            api_id: account.api_id?.toString() || '',
            api_hash: account.api_hash || '',
            phone: account.phone || ''
        });
    }, [account]);

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

    const handleUpdateAccount = async () => {
        setEditLoading(true);
        setEditError(null);
        try {
            const apiIdNum = parseInt(editForm.api_id);
            if (isNaN(apiIdNum)) {
                setEditError(isRTL ? 'API ID חייב להיות מספר' : 'API ID must be a number');
                setEditLoading(false);
                return;
            }

            const response = await apiFetch(`/accounts/${account.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    label: editForm.label,
                    api_id: apiIdNum,
                    api_hash: editForm.api_hash,
                    phone: editForm.phone
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
                throw new Error(errorData.detail || 'Failed to update account');
            }

            const data = await response.json();
            if (data.success) {
                setShowEditModal(false);
                setShowSettingsMenu(false);
                // Reload page to refresh account data
                window.location.reload();
            } else {
                setEditError(data.error || (isRTL ? 'שגיאה בעדכון החשבון' : 'Failed to update account'));
            }
        } catch (error) {
            console.error('Error updating account:', error);
            setEditError(error instanceof Error ? error.message : (isRTL ? 'שגיאת רשת' : 'Network error'));
        } finally {
            setEditLoading(false);
        }
    };
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
            className: 'account-action',
            onClick: () => onSemanticSearch(account.id),
            color: userColor
        },
        {
            key: 'messages',
            label: labels.send,
            Icon: MessageSquare,
            className: 'account-action',
            onClick: () => onSendMessage(account.id),
            color: userColor
        },
        {
            key: 'scan',
            label: labels.scan,
            Icon: Eye,
            className: 'account-action',
            onClick: () => onScan(account.id),
            color: userColor
        }
    ];
    
    // Calculate WCAG compliant text color (white) - buttons use darker backgrounds for contrast

    const lastScanHuman = dataStatus?.last_scan_date
        ? new Date(dataStatus.last_scan_date).toLocaleDateString(isRTL ? 'he-IL' : 'en-US')
        : null;
    const menuPositionClass = isRTL ? 'left-0' : 'right-0';

    return (
        <div 
            className="account-card-shell" 
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{
                '--user-glow-color': userColor.glow
            } as React.CSSProperties}
        >
            <div className="account-card-content text-white">
                <div className={`account-top-row ${isRTL ? 'flex-row-reverse' : ''}`}>
                    <div className={`account-identity ${isConnected ? '' : 'opacity-80'} ${isRTL ? 'flex-row-reverse' : ''}`}>
                        <div className={`${isRTL ? 'text-right' : 'text-left'} space-y-1 flex-1`}>
                            <div className="account-name">{account.label}</div>
                            <div className="account-phone">{account.phone}</div>
                            {isConnected && account.username && (
                                <div className={`text-sm text-green-300 flex items-center gap-1 ${isRTL ? 'flex-row-reverse' : ''}`}>
                                    <CheckCircle className="w-4 h-4" />
                                    {isRTL ? `מחובר כ-${account.username}` : `Connected as ${account.username}`}
                                </div>
                            )}
                        </div>
                        <div 
                            className="account-avatar"
                            style={{
                                background: `linear-gradient(135deg, ${userColor.primary}, ${userColor.secondary})`,
                                boxShadow: `0 16px 32px ${userColor.shadow}, 0 0 20px ${userColor.glow}`,
                                position: 'relative',
                                overflow: 'visible'
                            }}
                        >
                            <div 
                                className="account-avatar-glow-layer account-avatar-glow-1"
                                style={{
                                    position: 'absolute',
                                    inset: '-6px',
                                    borderRadius: '16px',
                                    background: userColor.glow,
                                    opacity: 0,
                                    transition: 'opacity 0.2s ease',
                                    zIndex: -1,
                                    pointerEvents: 'none',
                                    filter: 'blur(8px)'
                                }}
                            />
                            <div 
                                className="account-avatar-glow-layer account-avatar-glow-2"
                                style={{
                                    position: 'absolute',
                                    inset: '-10px',
                                    borderRadius: '16px',
                                    background: userColor.glow,
                                    opacity: 0,
                                    transition: 'opacity 0.2s ease',
                                    zIndex: -2,
                                    pointerEvents: 'none',
                                    filter: 'blur(12px)'
                                }}
                            />
                            <img 
                                src={userColor.avatar} 
                                alt={`${account.label} avatar`}
                                className="account-avatar-image"
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    position: 'relative',
                                    zIndex: 2,
                                    borderRadius: '16px'
                                }}
                            />
                            <div 
                                className="account-avatar-overlay"
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    background: userColor.dark,
                                    opacity: 0.1,
                                    transition: 'opacity 0.2s ease',
                                    zIndex: 3,
                                    pointerEvents: 'none',
                                    borderRadius: '16px'
                                }}
                            />
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
                                            setShowEditModal(true);
                                            setShowSettingsMenu(false);
                                        }}
                                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-white/80 transition-colors hover:bg-white/10 ${isRTL ? 'flex-row-reverse text-right' : ''}`}
                                        disabled={loading}
                                    >
                                        <Edit className="w-4 h-4" />
                                        {isRTL ? 'ערוך פרטי חשבון' : 'Edit Account'}
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
                        {actionButtons.map(({ key, label, Icon, className, onClick, color }) => (
                            <button
                                key={key}
                                onClick={onClick}
                                className={`${className} ${isRTL ? 'flex-row-reverse' : ''}`}
                                style={{
                                    background: `linear-gradient(135deg, ${color.buttonBg}, ${color.buttonBg}),
                                                 linear-gradient(135deg, ${color.primary}40, ${color.secondary}30)`,
                                    backdropFilter: 'blur(20px) saturate(180%)',
                                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                                    borderColor: color.buttonBorder,
                                    boxShadow: `0 8px 24px ${color.buttonShadow}, 
                                                inset 0 1px 0 rgba(255, 255, 255, 0.1),
                                                0 0 0 1px rgba(255, 255, 255, 0.05)`,
                                    color: '#ffffff' // White text for WCAG contrast
                                }}
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
                    {isConnected && dataStatus && 
                     dataStatus.scanned_chats_count === 0 && 
                     dataStatus.completed_scans === 0 && 
                     dataStatus.total_messages_found === 0 && 
                     dataStatus.checkpoints_count === 0 ? (
                        <div className="col-span-2 text-sm text-white/60 py-2">
                            {isRTL ? 'לא הושלמה סריקה ראשונית' : 'Initial scan not completed'}
                        </div>
                    ) : (
                        metrics.map((metric) => (
                            <div key={metric.label} className="account-metric">
                                <span>{metric.label}</span>
                                <strong className={metric.accent}>{metric.value}</strong>
                            </div>
                        ))
                    )}
                </div>

                <div className={`account-details-card ${isRTL ? 'text-right' : ''}`}>
                    <div className="account-details-title">
                        <span>{labels.lastScanTitle}</span>
                    </div>
                    {isConnected && dataStatus ? (
                        <>
                            {dataStatus.scanned_chats_count === 0 && 
                             dataStatus.completed_scans === 0 && 
                             dataStatus.total_messages_found === 0 && 
                             dataStatus.checkpoints_count === 0 ? (
                                <div className="text-sm text-white/60 py-2">
                                    {isRTL ? 'לא הושלמה סריקה ראשונית' : 'Initial scan not completed'}
                                </div>
                            ) : (
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
                            )}
                        </>
                    ) : (
                        <div className="text-sm text-white/70">{labels.noScanYet}</div>
                    )}
                    <div className={`flex gap-2 w-full ${isRTL ? 'flex-row-reverse' : ''}`}>
                        <button
                            onClick={handleBackup}
                            className="btn-secondary flex items-center justify-center gap-2 px-4 py-2 text-sm flex-1"
                            disabled={backupLoading || loading}
                        >
                            {backupLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            {labels.backupToCloud}
                        </button>
                        <button
                            onClick={handleRestore}
                            className="btn-secondary flex items-center justify-center gap-2 px-4 py-2 text-sm flex-1"
                            disabled={backupLoading || loading}
                        >
                            <Download className="w-4 h-4" />
                            {labels.restoreFromCloud}
                        </button>
                    </div>
                </div>
            </div>

            {/* Edit Account Modal */}
            {showEditModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowEditModal(false)}>
                    <div className={`glass-advanced max-w-md w-full mx-4 rounded-3xl p-6 ${isRTL ? 'text-right' : 'text-left'}`} onClick={(e) => e.stopPropagation()} dir={isRTL ? 'rtl' : 'ltr'}>
                        <div className={`flex items-center justify-between mb-6 ${isRTL ? 'flex-row-reverse' : ''}`}>
                            <h2 className="text-2xl font-bold text-white">
                                {isRTL ? 'ערוך פרטי חשבון' : 'Edit Account'}
                            </h2>
                            <button
                                onClick={() => {
                                    setShowEditModal(false);
                                    setEditError(null);
                                }}
                                className="rounded-full p-2 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-white/80 mb-2">
                                    {isRTL ? 'שם' : 'Label'}
                                </label>
                                <input
                                    type="text"
                                    value={editForm.label}
                                    onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder={isRTL ? 'שם החשבון' : 'Account name'}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-white/80 mb-2">
                                    {isRTL ? 'מספר טלפון' : 'Phone Number'}
                                </label>
                                <input
                                    type="text"
                                    value={editForm.phone}
                                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder={isRTL ? '+1234567890' : '+1234567890'}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-white/80 mb-2">
                                    API ID
                                </label>
                                <input
                                    type="text"
                                    value={editForm.api_id}
                                    onChange={(e) => setEditForm({ ...editForm, api_id: e.target.value })}
                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="12345678"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-white/80 mb-2">
                                    API Hash
                                </label>
                                <input
                                    type="text"
                                    value={editForm.api_hash}
                                    onChange={(e) => setEditForm({ ...editForm, api_hash: e.target.value })}
                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="abcdef1234567890abcdef1234567890"
                                />
                            </div>

                            {editError && (
                                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-300 text-sm">
                                    {editError}
                                </div>
                            )}

                            <div className={`flex gap-3 pt-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
                                <button
                                    onClick={handleUpdateAccount}
                                    disabled={editLoading}
                                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {editLoading ? (
                                        <>
                                            <Loader className="w-4 h-4 animate-spin" />
                                            {isRTL ? 'שומר...' : 'Saving...'}
                                        </>
                                    ) : (
                                        <>
                                            <Save className="w-4 h-4" />
                                            {isRTL ? 'שמור' : 'Save'}
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => {
                                        setShowEditModal(false);
                                        setEditError(null);
                                    }}
                                    disabled={editLoading}
                                    className="flex-1 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white font-medium hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isRTL ? 'ביטול' : 'Cancel'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AccountCard;
