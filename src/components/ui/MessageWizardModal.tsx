import React from 'react';
import { X, MessageSquare } from 'lucide-react';
import MessageWizard from '../MessageWizard';

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
  accountLabel 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="glass-elevated p-8 max-w-7xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <div className="glass-card p-3">
              <MessageSquare className="w-8 h-8 text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">שליחת הודעות</h2>
              <p className="text-gray-300">{accountLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Message Wizard Component */}
        <MessageWizard
          accountId={accountId}
          accountLabel={accountLabel}
          onBack={onClose}
        />
      </div>
    </div>
  );
};

export default MessageWizardModal;
