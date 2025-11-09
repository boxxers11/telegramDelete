import React, { useEffect } from 'react';
import { Loader } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import MessageWizard from '../components/MessageWizard';
import { useAppContext } from '../App';

const SendMessagesPage: React.FC = () => {
  const navigate = useNavigate();
  const { accountId = '' } = useParams<{ accountId: string }>();
  const { accountsState } = useAppContext();

  const account = accountsState.accounts.find((acc) => acc.id === accountId);

  useEffect(() => {
    if (accountsState.loading) {
      return;
    }
    if (!account) {
      navigate('/', { replace: true });
    }
  }, [account, accountsState.loading, navigate]);

  const handleBack = () => {
    navigate('/');
  };

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

  return (
    <div className="relative z-10 flex min-h-screen flex-col bg-slate-950/95">
      <div className="flex-1 overflow-y-auto">
        <MessageWizard
          accountId={account.id}
          accountLabel={account.label}
          isAuthenticated={Boolean(account.is_authenticated)}
          onBack={handleBack}
        />
      </div>
    </div>
  );
};

export default SendMessagesPage;
