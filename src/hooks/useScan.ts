import { useState, useCallback } from 'react';

export interface ScanProgress {
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
    completed?: number;
    skipped?: number;
    errors?: number;
    totalMessages?: number;
    totalDeleted?: number;
}

export const useScan = () => {
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState<ScanProgress | undefined>();
    const [lastScanResults, setLastScanResults] = useState<any[]>([]);
    const [scanHistory, setScanHistory] = useState<{[accountId: string]: any[]}>({});

    const loadScanHistory = useCallback(() => {
        try {
            const saved = localStorage.getItem('telegram-scan-history');
            if (saved) {
                setScanHistory(JSON.parse(saved));
            }
        } catch (error) {
            console.error('Failed to load scan history:', error);
        }
    }, []);

    const saveScanHistory = useCallback((accountId: string, results: any[]) => {
        try {
            const newHistory = { ...scanHistory, [accountId]: results };
            setScanHistory(newHistory);
            localStorage.setItem('telegram-scan-history', JSON.stringify(newHistory));
        } catch (error) {
            console.error('Failed to save scan history:', error);
        }
    }, [scanHistory]);

    const startScan = useCallback(async (accountId: string, isFullScan: boolean = false, batchSize: number = 1) => {
        setIsScanning(true);
        setScanProgress(undefined);
        
        try {
            console.log(`Starting scan for account: ${accountId}, full scan: ${isFullScan}, batch size: ${batchSize}`);
            
            const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/scan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    account_id: accountId,
                    include_private: false,
                    chat_name_filters: [],
                    dry_run: true,
                    test_mode: !isFullScan,
                    full_scan: isFullScan,
                    batch_size: batchSize
                }),
            });

            const data = await response.json();
            console.log('Backend response data:', data);

            if (data.success) {
                processScanResult(data.result, accountId);
                return { success: true, result: data.result };
            } else {
                setIsScanning(false);
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Scan network request failed:', error);
            setIsScanning(false);
            return { success: false, error: 'Network error occurred during scan' };
        }
    }, []);

    const processScanResult = useCallback((result: any, accountId: string) => {
        console.log('Processing scan result:', result);
        setIsScanning(false);
        
        // Process chats and add required fields
        const processedChats = result.chats.map((chat: any) => ({
            ...chat,
            status: chat.error ? 'error' : (chat.skipped_reason ? 'skipped' : 'completed'),
            expanded: false,
            selected: false,
            messages: chat.messages || [],
            messages_found: chat.candidates_found || 0,
            messages_deleted: chat.deleted || 0
        }));
        
        setLastScanResults(processedChats);
        
        // Save to scan history
        saveScanHistory(accountId, processedChats);

        // Update final stats
        const total = processedChats.length;
        const completed = processedChats.filter((c: any) => c.status === 'completed').length;
        const skipped = processedChats.filter((c: any) => c.status === 'skipped').length;
        const errors = processedChats.filter((c: any) => c.status === 'error').length;
        
        setScanProgress({
            type: 'final_summary',
            status: 'סריקה הושלמה',
            total: total,
            completed: completed,
            skipped: skipped,
            errors: errors,
            totalMessages: result.total_candidates,
            totalDeleted: result.total_deleted,
            chats: processedChats
        });

        return {
            success: true,
            totalCandidates: result.total_candidates,
            totalChatsProcessed: result.total_chats_processed,
            processedChats
        };
    }, [saveScanHistory]);

    const stopScan = useCallback(() => {
        setIsScanning(false);
        setScanProgress(undefined);
    }, []);

    const getScanHistory = useCallback((accountId: string) => {
        return scanHistory[accountId] || [];
    }, [scanHistory]);

    return {
        // State
        isScanning,
        scanProgress,
        lastScanResults,
        scanHistory,
        
        // Actions
        loadScanHistory,
        saveScanHistory,
        startScan,
        processScanResult,
        stopScan,
        getScanHistory
    };
};
