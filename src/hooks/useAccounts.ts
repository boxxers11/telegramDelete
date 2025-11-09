import { useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch, apiUrl } from '../config/api';

export interface Account {
    id: string;
    label: string;
    phone: string;
    api_id: number;
    api_hash: string;
    is_authenticated: boolean;
    username?: string;
    last_connected_at?: string | null;
}

export interface LoginData {
    accountId: string;
    phone_code_hash?: string;
    needsCode: boolean;
    needs2FA: boolean;
}

interface BulkConnectState {
    active: boolean;
    total: number;
    completed: number;
    currentAccountId: string | null;
}

interface ConnectAccountOptions {
    suppressSuccess?: boolean;
}

export const useAccounts = () => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showLoginModal, setShowLoginModal] = useState<LoginData | null>(null);
    const [bulkState, setBulkState] = useState<BulkConnectState>({
        active: false,
        total: 0,
        completed: 0,
        currentAccountId: null
    });
    const [isBulkConnecting, setIsBulkConnecting] = useState(false);
    const bulkResolvers = useRef<Record<string, (result: boolean) => void>>({});

    useEffect(() => {
        return () => {
            Object.values(bulkResolvers.current).forEach((resolve) => {
                try {
                    resolve(false);
                } catch (error) {
                    console.error('Bulk resolver cleanup error:', error);
                }
            });
            bulkResolvers.current = {};
        };
    }, []);

    const loadAccounts = useCallback(async () => {
        setLoading(true);
        try {
            const endpoint = apiUrl('/accounts');
            console.log('Loading accounts from', endpoint);
            const response = await apiFetch('/accounts');
            console.log('Response status:', response.status);
            
            if (response.ok) {
                const data = await response.json();
                console.log('Raw data from API:', data);
                const updatedAccounts = data.map((acc: any) => ({
                    ...acc,
                    is_authenticated: acc.is_authenticated || false,
                    last_connected_at: acc.last_connected_at ?? acc.connected_at ?? null
                }));
                setAccounts(updatedAccounts);
                console.log('Loaded accounts:', updatedAccounts);
                
                // Save accounts to localStorage for persistence
                localStorage.setItem('telegram_accounts', JSON.stringify(updatedAccounts));
            } else {
                console.error('Response not ok:', response.status, response.statusText);
                setError(`Failed to load accounts: ${response.status} ${response.statusText}`);
                
                // Try to load from localStorage as fallback
                const savedAccounts = localStorage.getItem('telegram_accounts');
                if (savedAccounts) {
                    const accounts = JSON.parse(savedAccounts);
                    setAccounts(accounts);
                    console.log('Loaded accounts from localStorage as fallback:', accounts);
                }
            }
        } catch (error) {
            console.error('Failed to load accounts:', error);
            setError('Failed to load accounts: ' + (error as Error).message);
            
            // Try to load from localStorage as fallback
            const savedAccounts = localStorage.getItem('telegram_accounts');
            if (savedAccounts) {
                const accounts = JSON.parse(savedAccounts);
                setAccounts(accounts);
                console.log('Loaded accounts from localStorage as fallback:', accounts);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    const addAccount = useCallback(async (newAccountData: {
        label: string;
        api_id: string;
        api_hash: string;
        phone: string;
    }) => {
        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await apiFetch('/accounts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    label: newAccountData.label,
                    api_id: parseInt(newAccountData.api_id),
                    api_hash: newAccountData.api_hash,
                    phone: newAccountData.phone
                }),
            });

            const data = await response.json();

            if (data.success) {
                setSuccess('Account added successfully!');
                await loadAccounts();
                return { success: true };
            } else {
                setError(data.error || 'Failed to add account');
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Add account error:', error);
            setError('Network error occurred');
            return { success: false, error: 'Network error occurred' };
        } finally {
            setLoading(false);
        }
    }, [loadAccounts]);

    const connectAccount = useCallback(async (accountId: string, options: ConnectAccountOptions = {}) => {
        setLoading(true);
        setError(null);

        try {
            const response = await apiFetch(`/accounts/${accountId}/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            const data = await response.json();

            if (data.success) {
                if (data.status === 'CODE_SENT') {
                    setShowLoginModal({
                        accountId,
                        phone_code_hash: data.phone_code_hash,
                        needsCode: true,
                        needs2FA: false
                    });
                    setSuccess('Verification code sent! Check your Telegram app.');
                    return { success: true, needsVerification: true };
                } else if (data.status === 'AUTHENTICATED') {
                    if (!options.suppressSuccess) {
                        setSuccess(`Connected successfully as @${data.username}!`);
                    }
                    setAccounts(prev => {
                        const updated = prev.map(acc => 
                            acc.id === accountId 
                                ? { 
                                    ...acc, 
                                    is_authenticated: true, 
                                    username: data.username,
                                    last_connected_at: data.last_connected_at ?? new Date().toISOString()
                                }
                                : acc
                        );
                        // Save updated accounts to localStorage
                        localStorage.setItem('telegram_accounts', JSON.stringify(updated));
                        return updated;
                    });
                    return { success: true, needsVerification: false };
                }
                return { success: true, needsVerification: false };
            } else {
                if (data.error === '2FA_REQUIRED') {
                    setShowLoginModal(prev => prev ? { ...prev, needs2FA: true } : null);
                    setError('Two-factor authentication required. Please enter your password.');
                    return { success: false, error: '2FA_REQUIRED' };
                } else {
                    setError(data.error || 'Connection failed');
                    return { success: false, error: data.error };
                }
            }
        } catch (error) {
            setError('Network error occurred');
            return { success: false, error: 'Network error occurred' };
        } finally {
            setLoading(false);
        }
    }, []);

    const connectAllAccounts = useCallback(async () => {
        if (accounts.length === 0) {
            setError('לא נמצאו חשבונות לחיבור');
            return { success: false, processed: 0 };
        }

        setError(null);
        setSuccess(null);

        const targetAccounts = [...accounts];
        const total = targetAccounts.length;
        const suppressIndividualSuccess = total > 1;
        const failures: string[] = [];
        let completed = 0;

        setIsBulkConnecting(true);
        setBulkState({
            active: true,
            total,
            completed: 0,
            currentAccountId: targetAccounts[0]?.id ?? null
        });

        for (const account of targetAccounts) {
            setBulkState(prev => ({
                active: true,
                total,
                completed,
                currentAccountId: account.id
            }));

            const result = await connectAccount(account.id, { suppressSuccess: suppressIndividualSuccess });
            if (!result.success) {
                failures.push(account.label);
                continue;
            }

            if (result.needsVerification) {
                const verified = await new Promise<boolean>((resolve) => {
                    bulkResolvers.current[account.id] = resolve;
                });
                if (!verified) {
                    failures.push(account.label);
                    break;
                }
            }

            completed += 1;
            setBulkState(prev => ({
                ...prev,
                completed,
                currentAccountId: null
            }));
        }

        setBulkState(prev => ({
            ...prev,
            active: false,
            total,
            completed,
            currentAccountId: null
        }));

        setIsBulkConnecting(false);

        Object.keys(bulkResolvers.current).forEach((key) => {
            const resolver = bulkResolvers.current[key];
            if (resolver) {
                resolver(false);
            }
            delete bulkResolvers.current[key];
        });

        if (failures.length > 0) {
            setError(`החיבור נעצר עבור: ${failures.join(', ')}`);
        } else if (completed === total) {
            setSuccess(total === 1 ? 'החשבון חובר בהצלחה' : 'כל החשבונות חוברו בהצלחה!');
        }

        return { success: failures.length === 0, processed: completed };
    }, [accounts, connectAccount]);

    const verifyCode = useCallback(async (code: string, password?: string) => {
        if (!showLoginModal || !code) return { success: false, error: 'No login data or code' };

        const accountId = showLoginModal.accountId;

        setLoading(true);
        setError(null);

        try {
            const response = await apiFetch(`/accounts/${accountId}/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    code: code,
                    phone_code_hash: showLoginModal.phone_code_hash,
                    password: showLoginModal.needs2FA ? password : undefined
                }),
            });

            const data = await response.json();

            if (data.success) {
                setSuccess(`Connected successfully as @${data.username}!`);
                setAccounts(prev => {
                    const updated = prev.map(acc => 
                        acc.id === accountId 
                            ? { 
                                ...acc, 
                                is_authenticated: true, 
                                username: data.username,
                                last_connected_at: data.last_connected_at ?? new Date().toISOString()
                            }
                            : acc
                    );
                    // Save updated accounts to localStorage
                    localStorage.setItem('telegram_accounts', JSON.stringify(updated));
                    return updated;
                });
                setShowLoginModal(null);
                const resolver = bulkResolvers.current[accountId];
                if (resolver) {
                    resolver(true);
                    delete bulkResolvers.current[accountId];
                }
                return { success: true };
            } else {
                if (data.error === '2FA_REQUIRED') {
                    setShowLoginModal(prev => prev ? { ...prev, needs2FA: true } : null);
                    setError('Two-factor authentication required. Please enter your password.');
                    return { success: false, error: '2FA_REQUIRED' };
                } else {
                    setError(data.error || 'Verification failed');
                    const resolver = bulkResolvers.current[accountId];
                    if (resolver) {
                        resolver(false);
                        delete bulkResolvers.current[accountId];
                    }
                    return { success: false, error: data.error };
                }
            }
        } catch (error) {
            setError('Network error occurred');
            const resolver = bulkResolvers.current[accountId];
            if (resolver) {
                resolver(false);
                delete bulkResolvers.current[accountId];
            }
            return { success: false, error: 'Network error occurred' };
        } finally {
            setLoading(false);
        }
    }, [showLoginModal]);

    const deleteAccount = useCallback(async (accountId: string) => {
        setLoading(true);
        try {
            const response = await apiFetch(`/accounts/${accountId}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                setSuccess('Account deleted successfully!');
                // Update localStorage immediately
                setAccounts(prev => {
                    const updated = prev.filter(acc => acc.id !== accountId);
                    localStorage.setItem('telegram_accounts', JSON.stringify(updated));
                    return updated;
                });
                return { success: true };
            } else {
                setError('Failed to delete account');
                return { success: false, error: 'Failed to delete account' };
            }
        } catch (error) {
            setError('Network error occurred');
            return { success: false, error: 'Network error occurred' };
        } finally {
            setLoading(false);
        }
    }, [loadAccounts]);

    const clearMessages = useCallback(() => {
        setError(null);
        setSuccess(null);
    }, []);

    const closeLoginModal = useCallback(() => {
        if (showLoginModal?.accountId) {
            const resolver = bulkResolvers.current[showLoginModal.accountId];
            if (resolver) {
                resolver(false);
                delete bulkResolvers.current[showLoginModal.accountId];
            }
        }
        setShowLoginModal(null);
    }, [showLoginModal]);

    return {
        // State
        accounts,
        loading,
        error,
        success,
        showLoginModal,
        bulkConnectState: bulkState,
        isBulkConnecting,
        
        // Actions
        loadAccounts,
        addAccount,
        connectAccount,
        connectAllAccounts,
        verifyCode,
        deleteAccount,
        clearMessages,
        closeLoginModal
    };
};
