import { useState, useCallback } from 'react';

export interface Account {
    id: string;
    label: string;
    phone: string;
    api_id: number;
    api_hash: string;
    is_authenticated: boolean;
    username?: string;
}

export interface LoginData {
    accountId: string;
    phone_code_hash?: string;
    needsCode: boolean;
    needs2FA: boolean;
}

export const useAccounts = () => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showLoginModal, setShowLoginModal] = useState<LoginData | null>(null);

    const loadAccounts = useCallback(async () => {
        setLoading(true);
        try {
            console.log('Loading accounts from http://127.0.0.1:8001/accounts');
            const response = await fetch('http://127.0.0.1:8001/accounts');
            console.log('Response status:', response.status);
            
            if (response.ok) {
                const data = await response.json();
                console.log('Raw data from API:', data);
                const updatedAccounts = data.map((acc: any) => ({
                    ...acc,
                    is_authenticated: acc.is_authenticated || false
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
            const response = await fetch('http://127.0.0.1:8001/accounts', {
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

    const connectAccount = useCallback(async (accountId: string) => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/connect`, {
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
                    setSuccess(`Connected successfully as @${data.username}!`);
                    setAccounts(prev => {
                        const updated = prev.map(acc => 
                            acc.id === accountId 
                                ? { ...acc, is_authenticated: true, username: data.username }
                                : acc
                        );
                        // Save updated accounts to localStorage
                        localStorage.setItem('telegram_accounts', JSON.stringify(updated));
                        return updated;
                    });
                    return { success: true, needsVerification: false };
                }
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

    const verifyCode = useCallback(async (code: string, password?: string) => {
        if (!showLoginModal || !code) return { success: false, error: 'No login data or code' };

        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`http://127.0.0.1:8001/accounts/${showLoginModal.accountId}/connect`, {
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
                        acc.id === showLoginModal.accountId 
                            ? { ...acc, is_authenticated: true, username: data.username }
                            : acc
                    );
                    // Save updated accounts to localStorage
                    localStorage.setItem('telegram_accounts', JSON.stringify(updated));
                    return updated;
                });
                setShowLoginModal(null);
                return { success: true };
            } else {
                if (data.error === '2FA_REQUIRED') {
                    setShowLoginModal(prev => prev ? { ...prev, needs2FA: true } : null);
                    setError('Two-factor authentication required. Please enter your password.');
                    return { success: false, error: '2FA_REQUIRED' };
                } else {
                    setError(data.error || 'Verification failed');
                    return { success: false, error: data.error };
                }
            }
        } catch (error) {
            setError('Network error occurred');
            return { success: false, error: 'Network error occurred' };
        } finally {
            setLoading(false);
        }
    }, [showLoginModal]);

    const deleteAccount = useCallback(async (accountId: string) => {
        setLoading(true);
        try {
            const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}`, {
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
        setShowLoginModal(null);
    }, []);

    return {
        // State
        accounts,
        loading,
        error,
        success,
        showLoginModal,
        
        // Actions
        loadAccounts,
        addAccount,
        connectAccount,
        verifyCode,
        deleteAccount,
        clearMessages,
        closeLoginModal
    };
};
