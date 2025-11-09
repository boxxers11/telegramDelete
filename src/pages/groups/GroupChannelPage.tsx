import React, { useEffect, useMemo, useState } from 'react';
import { Loader, Send, ExternalLink, Users, MessageSquare, Clock } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import HeaderFullScreen from '../../components/ui/HeaderFullScreen';
import { useAppContext } from '../../App';

interface GroupMessage {
  id: number;
  content: string;
  date: string;
  sender_id?: number;
  sender_username?: string;
  sender_display: string;
  media_type?: string;
  media_url?: string;
}

const GroupChannelPage: React.FC = () => {
  const navigate = useNavigate();
  const { accountId = '', chatId = '' } = useParams<{ accountId: string; chatId: string }>();
  const { accountsState } = useAppContext();
  
  const account = useMemo(
    () => accountsState.accounts.find((acc) => acc.id === accountId),
    [accountsState.accounts, accountId]
  );

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupInfo, setGroupInfo] = useState<any>(null);

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
    const loadGroupData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Load group messages
        const messagesResponse = await fetch(
          `http://127.0.0.1:8001/accounts/${accountId}/group-messages/${chatId}`
        );
        const messagesData = await messagesResponse.json();
        
        if (!messagesResponse.ok || !messagesData?.success) {
          throw new Error(messagesData?.error || 'שגיאה בטעינת הודעות הקבוצה');
        }

        if (!cancelled) {
          const messagesList = Array.isArray(messagesData.messages) ? messagesData.messages : [];
          setMessages(messagesList);
          setGroupInfo(messagesData.group_info || null);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || 'שגיאה בטעינת נתוני הקבוצה');
          setMessages([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadGroupData();

    return () => {
      cancelled = true;
    };
  }, [accountId, chatId]);

  const handleBack = () => {
    navigate(-1);
  };

  const handleOpenTelegram = () => {
    const target = groupInfo?.username 
      ? `https://t.me/${groupInfo.username}`
      : groupInfo?.invite_link || `tg://resolve?domain=${chatId}`;
    window.open(target, '_blank');
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString('he-IL');
    } catch {
      return dateString;
    }
  };

  if (!account) {
    return null;
  }

  return (
    <div className="relative z-10 flex min-h-screen flex-col bg-slate-950/95" dir="rtl">
      <HeaderFullScreen
        title={groupInfo?.title || `קבוצה ${chatId}`}
        onBack={handleBack}
        description={`חשבון: ${account.label}`}
        actions={
          <button
            type="button"
            onClick={handleOpenTelegram}
            className="btn-secondary flex items-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            פתיחה בטלגרם
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-8 w-8 animate-spin text-blue-400" />
            <span className="mr-3 text-white/80">טוען הודעות...</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-center">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
            <MessageSquare className="mx-auto h-12 w-12 text-white/40" />
            <p className="mt-4 text-white/60">לא נמצאו הודעות בקבוצה זו</p>
          </div>
        )}

        {!loading && !error && messages.length > 0 && (
          <div className="space-y-4">
            {/* Group Info */}
            {groupInfo && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-blue-400" />
                  <div>
                    <h3 className="font-semibold text-white">{groupInfo.title}</h3>
                    {groupInfo.username && (
                      <p className="text-sm text-white/60">@{groupInfo.username}</p>
                    )}
                    {groupInfo.member_count && (
                      <p className="text-sm text-white/60">
                        {groupInfo.member_count} חברים
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-white">
                          {message.sender_display}
                        </span>
                        {message.sender_username && (
                          <span className="text-sm text-white/60">
                            @{message.sender_username}
                          </span>
                        )}
                      </div>
                      <p className="text-white/80 mb-2">{message.content}</p>
                      {message.media_type && message.media_url && (
                        <div className="mt-2">
                          <span className="text-xs text-blue-400">
                            📎 {message.media_type}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/50">
                      <Clock className="h-3 w-3" />
                      {formatDate(message.date)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GroupChannelPage;
