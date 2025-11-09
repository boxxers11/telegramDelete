import { useState, useCallback, useEffect, useRef } from 'react';
import { clearResumeSnapshot, saveResumeSnapshot } from '../state/resumeState';

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

export type GuidanceStage =
    | 'idle'
    | 'preparing_cache'
    | 'checking_previous'
    | 'contacting_api'
    | 'scanning'
    | 'processing'
    | 'completed'
    | 'error';

export interface ScanGuidance {
    stage: GuidanceStage;
    message: string;
    tips: string[];
    batches?: {
        total: number;
        completed: number;
        size: number;
    };
    resumeAvailable?: boolean;
    startedAt?: number;
    lastUpdatedAt?: number;
}

export const useScan = () => {
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState<ScanProgress | undefined>();
    const [lastScanResults, setLastScanResults] = useState<any[]>([]);
    const [scanHistory, setScanHistory] = useState<{[accountId: string]: any[]}>({});
    const pollIntervalRef = useRef<number | null>(null);
    const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
    const [guidance, setGuidance] = useState<ScanGuidance>({
        stage: 'idle',
        message: 'מוכן לסריקה. בחר קבוצות וטווח זמן כדי להתחיל.',
        tips: [
            'בחר רק את הקבוצות החשובות כדי לקצר את משך הסריקה.',
            'טווח קצר (1-2 ימים) מהיר יותר ומשאיר את הסריקות נקיות יותר.'
        ],
        resumeAvailable: false
    });

    const loadScanHistory = useCallback(() => {
        try {
            const saved = localStorage.getItem('telegram-scan-history');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object') {
                    setScanHistory(parsed);
                }
            }
        } catch (error) {
            console.error('Failed to load scan history:', error);
        }
    }, []);

    const saveScanHistory = useCallback((accountId: string, results: any[]) => {
        try {
            setScanHistory(prevHistory => {
                const newHistory = { ...prevHistory, [accountId]: results };
                localStorage.setItem('telegram-scan-history', JSON.stringify(newHistory));
                return newHistory;
            });
        } catch (error) {
            console.error('Failed to save scan history:', error);
        }
    }, []);

    useEffect(() => {
        loadScanHistory();
    }, [loadScanHistory]);
    
    // Cleanup polling interval on unmount
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
    }, []);

    const processScanResult = useCallback((result: any, accountId: string) => {
        console.log('Processing scan result:', result);
        setIsScanning(false);
        clearResumeSnapshot();
        
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

        setGuidance(prev => ({
            stage: 'processing',
            message: 'מעבד את תוצאות הסריקה ושומר אותן במטמון.',
            tips: [
                'התוצאות נשמרות כדי שנוכל להמשיך מאותה נקודה בסריקות הבאות.',
                'תוכל לעיין בכל רגע בתוצאות הביניים בחלון הסריקה.'
            ],
            batches: prev.batches,
            resumeAvailable: true,
            startedAt: prev.startedAt,
            lastUpdatedAt: Date.now()
        }));

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

        setGuidance(prev => ({
            stage: 'completed',
            message: 'הסריקה הסתיימה. ניתן לעיין בממצאים או להתחיל סריקה נוספת.',
            tips: [
                'שקול לסמן קבוצות שאינן פעילות כדי לדלג עליהן בסריקה הבאה.',
                'ניתן לשמור את התוצאות או לשלוח הודעות ישירות מהתוצאות המוצגות.'
            ],
            batches: prev.batches,
            resumeAvailable: true,
            startedAt: prev.startedAt,
            lastUpdatedAt: Date.now()
        }));

        return {
            success: true,
            totalCandidates: result.total_candidates,
            totalChatsProcessed: result.total_chats_processed,
            processedChats
        };
    }, [saveScanHistory]);

    const startScan = useCallback(async (accountId: string, isFullScan: boolean = false, batchSize: number = 1) => {
        // Prevent duplicate scan starts
        if (isScanning) {
            console.log('Scan already in progress, ignoring duplicate start request');
            return { success: false, error: 'Scan already in progress' };
        }
        
        setIsScanning(true);
        setScanProgress(undefined);
        setActiveAccountId(accountId);
        const hasHistory = Boolean(scanHistory[accountId]?.length);
        setGuidance({
            stage: 'preparing_cache',
            message: 'בודק אם קיימים נתונים קודמים כדי לחסוך זמן.',
            tips: hasHistory
                ? ['נמצאו תוצאות קודמות – אם תרצה ניתן לחזור רק על קבוצות שלא נבדקו.']
                : ['לא נמצאו סריקות קודמות. נבצע סריקה מלאה בהתאם להגדרותיך.'],
            resumeAvailable: hasHistory,
            startedAt: Date.now(),
            lastUpdatedAt: Date.now(),
            batches: {
                total: Math.max(1, Math.ceil((scanHistory[accountId]?.length || 20) / Math.max(1, batchSize))),
                completed: 0,
                size: Math.max(1, batchSize)
            }
        });
        
        try {
            console.log(`Starting scan for account: ${accountId}, full scan: ${isFullScan}, batch size: ${batchSize}`);
            setGuidance(prev => ({
                ...prev,
                stage: 'contacting_api',
                message: 'מתקשר לשרת כדי להפעיל את הסריקה. ייתכנו עיכובים קצרים מטעם טלגרם.',
                lastUpdatedAt: Date.now()
            }));

            saveResumeSnapshot({
                id: `scan-${accountId}-${Date.now()}`,
                type: 'scan',
                accountId,
                path: `/scan/${accountId}`,
                description: isFullScan ? 'סריקה מלאה של הקבוצות' : 'סריקה מהירה של הקבוצות',
                operations: [isFullScan ? 'Full scan' : 'Quick scan'],
                startedAt: Date.now(),
                status: 'pending',
                metadata: {
                    fullScan: isFullScan,
                    batchSize
                }
            });
            
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
                setGuidance(prev => ({
                    ...prev,
                    stage: 'scanning',
                    message: 'סריקה מתבצעת לפי האצוות שנבחרו. אין צורך בהתערבות – אנו נעדכן בתוצאות.',
                    lastUpdatedAt: Date.now()
                }));
                
                // If scan started in background, poll for results
                if (data.scanning && !data.result) {
                    // Clear any existing poll interval
                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                    }
                    
                    // Poll scan-status until completed
                    pollIntervalRef.current = window.setInterval(async () => {
                        try {
                            const statusResponse = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/scan-status`);
                            const statusData = await statusResponse.json();
                            
                            if (statusData.success && statusData.result) {
                                const progress = statusData.result.scan_progress || {};
                                const status = progress.status || 'scanning';
                                
                                if (status === 'completed') {
                                    if (pollIntervalRef.current) {
                                        clearInterval(pollIntervalRef.current);
                                        pollIntervalRef.current = null;
                                    }
                                    // Get final results - prefer last_scan_result if available
                                    let result = statusData.result.last_scan_result;
                                    if (!result) {
                                        // Fallback to building from scanned_chats
                                        const scannedChats = statusData.result.scanned_chats || [];
                                        if (scannedChats.length > 0) {
                                            result = {
                                                total_chats_processed: scannedChats.length,
                                                total_chats_skipped: 0,
                                                total_candidates: scannedChats.reduce((sum: number, chat: any) => sum + (chat.messages_found || 0), 0),
                                                total_deleted: scannedChats.reduce((sum: number, chat: any) => sum + (chat.messages_deleted || 0), 0),
                                                chats: scannedChats.map((chat: any) => ({
                                                    id: chat.id,
                                                    title: chat.title,
                                                    type: chat.type || 'group',
                                                    participants_count: chat.member_count || 0,
                                                    candidates_found: chat.messages_found || 0,
                                                    deleted: chat.messages_deleted || 0,
                                                    error: chat.error,
                                                    skipped_reason: chat.skipped_reason,
                                                    messages: chat.messages || [],
                                                    is_user_created: chat.is_user_created || false
                                                }))
                                            };
                                        }
                                    }
                                    if (result) {
                                        processScanResult(result, accountId);
                                    }
                                    setIsScanning(false);
                                } else if (status === 'error') {
                                    if (pollIntervalRef.current) {
                                        clearInterval(pollIntervalRef.current);
                                        pollIntervalRef.current = null;
                                    }
                                    setIsScanning(false);
                                    setGuidance({
                                        stage: 'error',
                                        message: progress.error || 'הסריקה נכשלה',
                                        tips: ['נסה שוב מאוחר יותר'],
                                        resumeAvailable: hasHistory,
                                        lastUpdatedAt: Date.now()
                                    });
                                }
                            }
                        } catch (pollError) {
                            console.error('Error polling scan status:', pollError);
                        }
                    }, 2000); // Poll every 2 seconds
                    
                    return { success: true, scanning: true };
                }
                
                // If result is available immediately (backward compatibility)
                if (data.result) {
                processScanResult(data.result, accountId);
                return { success: true, result: data.result };
                }
                
                return { success: true, scanning: true };
            } else {
                setIsScanning(false);
                setGuidance({
                    stage: 'error',
                    message: data.error || 'הסריקה נכשלה. כדאי לנסות שוב עם פחות קבוצות או טווח קצר יותר.',
                    tips: [
                        'בדוק את החיבור לשרת.',
                        'צמצם את מספר הקבוצות והסר את הלכורים שאינם חיוניים לסריקה מהירה יותר.'
                    ],
                    resumeAvailable: hasHistory,
                    lastUpdatedAt: Date.now()
                });
                clearResumeSnapshot();
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Scan network request failed:', error);
            setIsScanning(false);
            setGuidance({
                stage: 'error',
                message: 'שגיאת רשת בעת התחלת הסריקה. בדוק את החיבור שלך או נסה שוב מאוחר יותר.',
                tips: [
                    'אם הסריקה חוזרת על עצמה, שקול להקטין את מספר הקבוצות בכל ריצה.',
                    'וודא שהשרת (FastAPI) עדיין פעיל.'
                ],
                resumeAvailable: hasHistory,
                lastUpdatedAt: Date.now()
            });
            clearResumeSnapshot();
            return { success: false, error: 'Network error occurred during scan' };
        }
    }, [processScanResult, scanHistory, isScanning]);

    const stopScan = useCallback(async (accountId?: string) => {
        // Clear polling interval
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        
        const targetAccount = accountId || activeAccountId;
        if (targetAccount) {
            try {
                await fetch(`http://127.0.0.1:8001/accounts/${targetAccount}/stop-scan`, {
                    method: 'POST'
                });
            } catch (error) {
                console.error('Error stopping scan:', error);
            }
        }
        setIsScanning(false);
        setScanProgress(undefined);
        setActiveAccountId(null);
        setGuidance(prev => ({
            stage: 'idle',
            message: 'הסריקה הופסקה. ניתן להמשיך מאותה נקודה או להתחיל סריקה חדשה.',
            tips: [
                'בחר קבוצות ממוקדות כדי לקצר את הזמן.',
                'המערכת זוכרת את התוצאות האחרונות, כך שניתן להמשיך במהירות.'
            ],
            resumeAvailable: prev.resumeAvailable,
            lastUpdatedAt: Date.now()
        }));
        clearResumeSnapshot();
    }, [activeAccountId]);

    const getScanHistory = useCallback((accountId: string) => {
        return scanHistory[accountId] || [];
    }, [scanHistory]);

    const updateGuidanceStage = useCallback((stage: GuidanceStage, overrides?: Partial<ScanGuidance>) => {
        setGuidance(prev => ({
            ...prev,
            stage,
            message: overrides?.message ?? prev.message,
            tips: overrides?.tips ?? prev.tips,
            batches: overrides?.batches ?? prev.batches,
            resumeAvailable: overrides?.resumeAvailable ?? prev.resumeAvailable,
            lastUpdatedAt: Date.now(),
            startedAt: prev.startedAt ?? Date.now()
        }));
    }, []);

    return {
        // State
        isScanning,
        scanProgress,
        lastScanResults,
        scanHistory,
        activeAccountId,
        guidance,
        
        // Actions
        loadScanHistory,
        saveScanHistory,
        startScan,
        processScanResult,
        stopScan,
        getScanHistory,
        setLastScanResults,
        updateGuidanceStage
    };
};

export type UseScanController = ReturnType<typeof useScan>;
