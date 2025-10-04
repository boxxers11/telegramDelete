import React from 'react';
import MessageWizard from '../MessageWizard';
import { X } from 'lucide-react';
import { useAccounts } from '../../hooks/useAccounts';

interface MessageWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  accountLabel: string;
}

const MessageWizardModal: React.FC<MessageWizardModalProps> = ({
  isOpen,
  onClose,
  accountId,
  accountLabel,
}) => {
  const { accounts } = useAccounts();
  const currentAccount = accounts.find(acc => acc.id === accountId);
  // Default to false if account is not found yet
  const isAuthenticated = currentAccount ? currentAccount.is_authenticated : false;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      dir="rtl"
      onClick={onClose}
    >
      <div
        className="glass-elevated relative w-full max-w-6xl mx-4 rounded-2xl"
        style={{
          maxHeight: '90vh',
          height: '90vh',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-5 right-5 z-[60] bg-red-600 hover:bg-red-700 text-white rounded-full p-2 transition-colors"
          title="סגור חלון"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="h-full overflow-hidden">
          <MessageWizard
            accountId={accountId}
            accountLabel={accountLabel}
            isAuthenticated={isAuthenticated}
            onBack={onClose}
          />
        </div>
      </div>
    </div>
  );
};

export default MessageWizardModal;
