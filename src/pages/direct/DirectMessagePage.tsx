import React, { useEffect, useMemo, useState } from 'react';
import { Loader, Send } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import HeaderFullScreen from '../../components/ui/HeaderFullScreen';
import { useAppContext } from '../../App';

interface StoredMessage {
  id?: number;
  message_id?: number;
  sender_id?: number | string;
  sender_username?: string | null;
  sender_display?: string | null;
  message?: string;
  message_text?: string;
  timestamp?: string;
  date?: string;
}

const DirectMessagePage: React.FC = () => {
  const navigate = useNavigate();
  const { accountId = '', chatId = '' } = useParams<{ accountId: string; chatId: string }>();
  const { accountsState } = useAppContext();
  const account = useMemo(
    () => accountsState.accounts.find((candidate) => candidate.id === accountId),
    [accountsState.accounts, accountId]
  );

  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accountsState.loading) {
      return;
    }
    if (!account) {
      navigate('/', { replace: true });
    }
  }, [accountsState.loading, account, navigate]);

  useEffect(() => {
    if (!accountId || !chatId) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `http://127.0.0.1:8001/accounts/${accountId}/chat-messages/${chatId}`
        );
        const data = await response.json();
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'שגיאה בטעינת היסטוריית ההודעות');
        }
        if (!cancelled) {
          const list = Array.isArray(data.messages) ? data.messages : [];
          setMessages(list);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || 'שגיאה בטעינת היסטוריית ההודעות');
          setMessages([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [accountId, chatId]);

  const handleBack = () => {
    navigate(-1);
  };

  const handleOpenTelegram = () => {
    const username = messages.find((msg) => msg.sender_username)?.sender_username;
    const target = username
      ? `tg://resolve?domain=${username.replace('@', '')}`
      : `tg://user?id=${chatId}`;
    window.open(target, '_blank');
  };

  if (!account) {
    return null;
  }

  return (
    <div className="relative z-10 flex min-h-screen flex-col bg-slate-950/95" dir="rtl">
      <HeaderFullScreen
        title="הודעות פרטיות"
        onBack={handleBack}
        description={`חשבון: ${account.label}`}
        actions={
          <button
            type="button"
            onClick={handleOpenTelegram}
            className="btn-secondary flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            פתיחה בטלגרם
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <div className="flex min-h-[200px] items-center justify-center text-white/70">
            <Loader className="h-6 w-6 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/70">
            לא נמצאו הודעות קודמות בצ׳אט זה.
          </div>
        )}

        {!loading && !error && messages.length > 0 && (
          <div className="space-y-4">
            {messages.map((message) => {
              const text = message.message_text ?? message.message ?? '';
              const timestamp = message.timestamp ?? message.date ?? '';
              const formatted = timestamp
                ? new Date(timestamp).toLocaleString('he-IL')
                : '—';
              return (
                <article
                  key={message.message_id ?? message.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg"
                >
                  <header className="mb-2 flex items-center justify-between text-xs text-white/60">
                    <span>{message.sender_display ?? message.sender_username ?? 'לא ידוע'}</span>
                    <span>{formatted}</span>
                  </header>
                  <p className="text-sm text-white/90 whitespace-pre-line">{text || '—'}</p>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default DirectMessagePage;
