import React from 'react';
import { Account } from '../../hooks/useAccounts';
import AccountCard from './AccountCard';

interface AccountsListProps {
    accounts: Account[];
    loading: boolean;
    onConnect: (accountId: string) => void;
    onDelete: (accountId: string) => void;
    onScan: (accountId: string) => void;
    onSendMessage: (accountId: string) => void;
    onSemanticSearch: (accountId: string) => void;
    language: 'he' | 'en';
    isBulkConnecting?: boolean;
    bulkConnectState?: {
        active: boolean;
        total: number;
        completed: number;
        currentAccountId: string | null;
    };
}

const AccountsList: React.FC<AccountsListProps> = ({
    accounts,
    loading,
    onConnect,
    onDelete,
    onScan,
    onSendMessage,
    onSemanticSearch,
    language,
    isBulkConnecting = false,
    bulkConnectState
}) => {
    const sortedAccounts = [...accounts].sort((a, b) => {
        const aDate = a.last_connected_at ? new Date(a.last_connected_at).getTime() : 0;
        const bDate = b.last_connected_at ? new Date(b.last_connected_at).getTime() : 0;
        if (aDate === bDate) {
            return a.label.localeCompare(b.label, language === 'he' ? 'he' : 'en');
        }
        return bDate - aDate;
    });

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto space-y-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="glass-elevated p-8 animate-pulse">
                        <div className="flex items-start justify-between">
                            <div className="flex items-start space-x-6">
                                <div className="glass-card p-4 rounded-2xl w-16 h-16 bg-gray-600"></div>
                                <div className="flex-1 min-w-0">
                                    <div className="h-6 bg-gray-600 rounded mb-2 w-32"></div>
                                    <div className="h-4 bg-gray-600 rounded w-24"></div>
                                </div>
                            </div>
                            <div className="flex items-center space-x-3">
                                <div className="h-8 bg-gray-600 rounded w-20"></div>
                                <div className="h-8 bg-gray-600 rounded w-8"></div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (accounts.length === 0) {
        const emptyTitle = language === 'he' ? 'לא נוספו חשבונות' : 'No accounts added yet';
        const emptyDescription = language === 'he'
            ? 'הוסף את חשבון הטלגרם הראשון שלך כדי להתחיל לנהל הודעות'
            : 'Add your first Telegram account to start managing your messages';

        return (
            <div className="max-w-2xl mx-auto text-center">
                <div className="glass-elevated p-12">
                    <div className="glass-card p-6 w-fit mx-auto mb-4">
                        <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                    </div>
                    <h3 className="text-title text-white mb-2">{emptyTitle}</h3>
                    <p className="text-body text-gray-300 mb-6">{emptyDescription}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-4">
            {sortedAccounts.map((account) => (
                <AccountCard
                    key={account.id}
                    account={account}
                    onConnect={onConnect}
                    onDelete={onDelete}
                    onScan={onScan}
                    onSendMessage={onSendMessage}
                    onSemanticSearch={onSemanticSearch}
                    language={language}
                    loading={loading}
                    isBulkConnecting={isBulkConnecting}
                    bulkConnectState={bulkConnectState}
                />
            ))}
        </div>
    );
};

export default AccountsList;
