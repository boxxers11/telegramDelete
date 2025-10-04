import React, { useState, useEffect } from 'react';
import { Loader, CheckCircle, XCircle, AlertTriangle, MessageSquare, ChevronUp, ChevronDown, Square } from 'lucide-react';
import AdvancedUpdatesWindow from './AdvancedUpdatesWindow';

interface ScanningItem {
  id: number;
  name: string;
  status: 'scanning' | 'completed' | 'error' | 'skipped';
  messagesFound?: number;
  error?: string;
  reason?: string;
}

interface ScanningWindowProps {
  isVisible: boolean;
  scanningItems: ScanningItem[];
  isPaused?: boolean;
  scanProgress?: any;
  onClose: () => void;
}

const ScanningWindow: React.FC<ScanningWindowProps> = ({
  isVisible,
  scanningItems,
  isPaused = false,
  scanProgress,
  onClose
}) => {
  const [displayedItems, setDisplayedItems] = useState<ScanningItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (scanningItems.length > 0) {
      // Show last 5 items with animation
      const lastItems = scanningItems.slice(-5);
      setDisplayedItems(lastItems);
    }
  }, [scanningItems]);

  if (!isVisible) return null;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scanning':
        return <Loader className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'skipped':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default:
        return <MessageSquare className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusText = (item: ScanningItem) => {
    switch (item.status) {
      case 'scanning':
        return 'סורק...';
      case 'completed':
        return `נמצאו ${item.messagesFound || 0} הודעות`;
      case 'error':
        return item.error || 'שגיאה';
      case 'skipped':
        return item.reason || 'דולג';
      default:
        return 'ממתין';
    }
  };

  return (
    <>
      <div className="floating-window">
        <div className="p-6">
          {/* Revolutionary Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              {isPaused ? (
                <Square className="w-6 h-6 text-yellow-400 mr-3" />
              ) : (
                <Loader className="w-6 h-6 animate-spin text-accent mr-3" />
              )}
              <h3 className="text-lg font-semibold text-white">
                {isPaused ? 'סריקה מושהית' : 'סריקה פעילה'}
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-white/60 hover:text-white transition-colors duration-200"
                title={isExpanded ? "סגור חלון מורחב" : "פתח חלון מורחב"}
              >
                {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
              </button>
              <button
                onClick={onClose}
                className="text-white/60 hover:text-white transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Revolutionary Current Item */}
          {scanProgress && (
            <div className="mb-6 glass-card p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center flex-1">
                  {isPaused ? (
                    <Square className="w-6 h-6 text-yellow-400 mr-3" />
                  ) : (
                    <Loader className="w-6 h-6 animate-spin text-accent mr-3" />
                  )}
                  <span className="text-body font-medium text-white">
                    {scanProgress.current_chat || scanProgress.chat_name || 'מתכונן לסריקה...'}
                  </span>
                </div>
                <div className="text-white/60 text-sm">
                  {scanProgress.progress_percent || 0}%
                </div>
              </div>
              
              {/* Revolutionary Progress Bar */}
              <div className="w-full bg-white/10 rounded-full h-2 mb-4">
                <div 
                  className="bg-accent h-2 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${scanProgress.progress_percent || 0}%` }}
                />
              </div>
              
              {/* Revolutionary Stats */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="text-white/60">
                  <span className="block">הודעות שנמצאו:</span>
                  <span className="text-white font-medium">
                    {scanProgress.messages_found || 0}
                  </span>
                </div>
                <div className="text-white/60">
                  <span className="block">הודעות שנמחקו:</span>
                  <span className="text-white font-medium">
                    {scanProgress.messages_deleted || 0}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Revolutionary Items List */}
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {displayedItems.map((item, index) => (
              <div 
                key={item.id} 
                className={`glass-card p-4 transition-all duration-300 ${
                  index === displayedItems.length - 1 ? 'animate-pulse' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center flex-1">
                    {getStatusIcon(item.status)}
                    <div className="mr-3 flex-1">
                      <div className="text-white font-medium truncate">
                        {item.name}
                      </div>
                      <div className="text-white/60 text-sm">
                        {getStatusText(item)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Revolutionary Progress Indicator */}
          <div className="mt-4 flex items-center justify-center">
            <div className="flex space-x-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="w-3 h-3 bg-accent rounded-full animate-pulse"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Advanced Updates Window */}
      <AdvancedUpdatesWindow
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
      />
    </>
  );
};

export default ScanningWindow;