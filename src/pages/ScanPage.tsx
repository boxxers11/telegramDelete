import React, { useEffect, useMemo, useState } from 'react';
import { Loader } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import SimpleScanInterface from '../components/SimpleScanInterface';
import DiamondScanInterface from '../components/DiamondScanInterface';
import RecentDirectMessagesModal from '../components/ui/RecentDirectMessagesModal';
import { useAppContext } from '../App';

const ScanPage: React.FC = () => {
  const navigate = useNavigate();
  const { accountId = '' } = useParams<{ accountId: string }>();
  const { accountsState, scanController, uiMode } = useAppContext();
  const account = useMemo(
    () => accountsState.accounts.find((acc) => acc.id === accountId),
    [accountsState.accounts, accountId]
  );
  const accountLabel = account?.label ?? '';
  const isAuthenticated = Boolean(account?.is_authenticated);
  const [showRecentMessages, setShowRecentMessages] = useState(false);

  const {
    stopScan,
    startScan,
    setLastScanResults,
    getScanHistory,
    saveScanHistory,
    lastScanResults,
    isScanning,
    activeAccountId,
    scanProgress,
    guidance,
    updateGuidanceStage
  } = scanController;

  useEffect(() => {
    setShowRecentMessages(false);
  }, [accountId]);

  useEffect(() => {
    return () => {
      stopScan(accountId);
      setLastScanResults([]);
    };
  }, [accountId, stopScan, setLastScanResults]);

  useEffect(() => {
    if (accountsState.loading) {
      return;
    }
    if (!account) {
      navigate('/', { replace: true });
    }
  }, [accountsState.loading, account, navigate]);

  useEffect(() => {
    if (!accountId) {
      return;
    }

    if (isScanning && activeAccountId === accountId) {
      return;
    }

    let cancelled = false;

    const normalizeChats = (chats: any[] = []) =>
      chats.map(chat => ({
        ...chat,
        status: chat.status || (chat.error ? 'error' : 'completed'),
        messages: Array.isArray(chat.messages) ? chat.messages : [],
        messages_found: chat.messages_found ?? chat.candidates_found ?? 0,
        messages_deleted: chat.messages_deleted ?? chat.deleted ?? 0,
        selected: false,
        expanded: false
      }));

    const updateGuidanceForHistory = (count: number, hydrated: boolean) => {
      if (count > 0) {
        updateGuidanceStage('checking_previous', {
          message: hydrated
            ? `נטענו ${count} קבוצות מהסריקות האחרונות שנשמרו מקומית. ניתן לעיין בתוצאות ולבחור אם להפעיל סריקה חדשה.`
            : `נמצאו ${count} קבוצות עם תוצאות אחרונות. ניתן לעיין בהן או להפעיל סריקה נוספת.`,
          resumeAvailable: true,
          tips: [
            'לחיצה על "התחל סריקה" תריץ סריקה חדשה מהמסך הנוכחי.',
            'להתחלה נקייה ניתן לאפס את ההיסטוריה מתפריט הסריקה.'
          ]
        });
      } else {
        updateGuidanceStage('idle', {
          message: 'כדי להתחיל סריקה חדשה, לחץ על "התחל סריקה". רשימת הקבוצות תיטען ותוצג במפה.',
          resumeAvailable: false,
          tips: [
            'הסריקה סורקת רק קבוצות פעילות עם יותר מ-10 חברים.',
            'אם רשימת הקבוצות ארוכה, אפשר להשאיר את המפה פתוחה בזמן שהנתונים נטענים.'
          ]
        });
      }
    };

    const hydrateFromSources = async () => {
      const localHistory = getScanHistory(accountId) || [];
      if (localHistory.length > 0) {
        setLastScanResults(localHistory);
        updateGuidanceForHistory(localHistory.length, false);
        return;
      }

      // No local history – fall back to backend checkpoints
      updateGuidanceForHistory(0, false);

      try {
        const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/scan-status`);
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (cancelled || !data?.success) {
          return;
        }
        const scannedChats = Array.isArray(data?.result?.scanned_chats) ? data.result.scanned_chats : [];
        if (scannedChats.length === 0) {
          return;
        }

        const normalized = normalizeChats(scannedChats);
        setLastScanResults(normalized);
        saveScanHistory(accountId, normalized);
        updateGuidanceForHistory(normalized.length, true);
      } catch (error) {
        console.error('Failed to hydrate scan history from backend:', error);
      }
    };

    hydrateFromSources();

    return () => {
      cancelled = true;
      setLastScanResults([]);
    };
  // getScanHistory and setLastScanResults are stable (useCallback / state setter)
  }, [
    accountId,
    getScanHistory,
    isScanning,
    activeAccountId,
    saveScanHistory,
    setLastScanResults,
    updateGuidanceStage
  ]);

  const handleClose = () => {
    stopScan(accountId);
    setLastScanResults([]);
    navigate('/');
  };

  const handleStartScan = (isFullScan: boolean, batchSize?: number) => {
    // Prevent starting scan if already scanning
    if (isScanning && activeAccountId === accountId) {
      console.log('Scan already in progress, ignoring start request');
      return;
    }
    startScan(accountId, isFullScan, batchSize ?? 10);
  };

  const currentResults = useMemo(() => {
    if (lastScanResults && lastScanResults.length > 0) {
      return lastScanResults;
    }
    return getScanHistory(accountId) || [];
  }, [accountId, getScanHistory, lastScanResults]);

  if (!account) {
    if (accountsState.loading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950/95 text-white">
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      );
    }
    return null;
  }

  const sharedProps = {
    accountId,
    accountLabel,
    onClose: handleClose,
    onStartScan: handleStartScan,
    onStopScan: () => stopScan(accountId),
    isScanning: isScanning && activeAccountId === accountId,
    scanProgress,
    lastScanResults: currentResults,
    isAuthenticated,
    onShowRecentMessages: () => setShowRecentMessages(true),
    guidance,
    onUpdateGuidance: updateGuidanceStage
  };

  const content = uiMode === 'diamond'
    ? (
        <DiamondScanInterface
          {...sharedProps}
        />
      )
    : (
        <SimpleScanInterface
          {...sharedProps}
          uiMode={uiMode === 'simple' ? 'simple' : 'advanced'}
        />
      );

  return (
    <div className="relative z-10 flex min-h-screen flex-col bg-slate-950/95">
      <div className="flex-1 overflow-y-auto">
        {content}
      </div>
      {showRecentMessages && (
        <RecentDirectMessagesModal
          isOpen={showRecentMessages}
          onClose={() => setShowRecentMessages(false)}
          accountId={accountId}
        />
      )}
    </div>
  );
};

export default ScanPage;
