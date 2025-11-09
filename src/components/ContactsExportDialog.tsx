import React, { useState, useRef } from 'react';
import { Calendar, Download, X, Loader, Square } from 'lucide-react';

interface ContactsExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
}

interface DateRange {
  start: string;
  end: string;
}

const ContactsExportDialog: React.FC<ContactsExportDialogProps> = ({
  isOpen,
  onClose,
  accountId
}) => {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    return {
      start: oneYearAgo.toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
    };
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCancelExport = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setExportProgress('מבטל ייצוא...');
      setTimeout(() => {
        setIsExporting(false);
        setExportProgress('');
        abortControllerRef.current = null;
      }, 1000);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress('מתחיל ייצוא אנשי קשר...');

    // Create new AbortController for this export
    abortControllerRef.current = new AbortController();

    try {
      // Validate date range
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      const maxRange = 2 * 365 * 24 * 60 * 60 * 1000; // 2 years in milliseconds
      
      if (endDate.getTime() - startDate.getTime() > maxRange) {
        throw new Error('טווח התאריכים לא יכול להיות יותר מ-2 שנים');
      }

      setExportProgress('מביא אנשי קשר...');
      
      // Call backend API to get contacts
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/contacts-export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start_date: dateRange.start,
          end_date: dateRange.end
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('שגיאה בייצוא אנשי הקשר');
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'שגיאה בייצוא אנשי הקשר');
      }

      setExportProgress('יוצר קובץ...');

      // Create export payload with required fields
      const exportPayload = {
        metadata: {
          timestamp: new Date().toISOString(),
          appVersion: '0.0.0',
          accountId,
          dateRange: {
            start: dateRange.start,
            end: dateRange.end
          },
          totalContacts: data.contacts?.length || 0
        },
        contacts: data.contacts?.map((contact: any) => ({
          ...contact,
          openInTelegram: contact.username 
            ? `https://t.me/${contact.username}` 
            : contact.user_id 
              ? `tg://user?id=${contact.user_id}`
              : null,
          openInAppLink: contact.user_id 
            ? `app://open/dm/${accountId}/${contact.user_id}`
            : null
        })) || []
      };

      // Create and download the file
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { 
        type: 'application/json' 
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `telegram_contacts_export_${accountId}_${dateRange.start}_to_${dateRange.end}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportProgress('הייצוא הושלם בהצלחה!');
      setTimeout(() => {
        onClose();
        setIsExporting(false);
        setExportProgress('');
      }, 1500);

    } catch (error) {
      console.error('Error exporting contacts:', error);
      
      if (error instanceof Error && error.name === 'AbortError') {
        setExportProgress('הייצוא בוטל');
        setTimeout(() => {
          setIsExporting(false);
          setExportProgress('');
          abortControllerRef.current = null;
        }, 1000);
      } else {
        setExportProgress(`שגיאה: ${error instanceof Error ? error.message : 'שגיאה לא ידועה'}`);
        setTimeout(() => {
          setIsExporting(false);
          setExportProgress('');
          abortControllerRef.current = null;
        }, 3000);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900/95 border border-white/20 rounded-2xl p-6 w-full max-w-md mx-4" dir="rtl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">ייצוא אנשי קשר</h2>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="text-white/60 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              תאריך התחלה
            </label>
            <div className="relative">
              <Calendar className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                disabled={isExporting}
                className="w-full bg-black/40 border border-white/20 rounded-xl px-4 py-3 pr-10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              תאריך סיום
            </label>
            <div className="relative">
              <Calendar className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                disabled={isExporting}
                className="w-full bg-black/40 border border-white/20 rounded-xl px-4 py-3 pr-10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
            <p className="text-sm text-blue-200">
              <strong>הערה:</strong> טווח התאריכים המקסימלי הוא 2 שנים. 
              היסטוריית השיחות תיטען רק כאשר תלחץ על הקישורים הפנימיים.
            </p>
          </div>

          {exportProgress && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-3">
                {isExporting && <Loader className="h-4 w-4 animate-spin text-blue-400" />}
                <span className="text-sm text-white/80">{exportProgress}</span>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            {isExporting ? (
              <button
                onClick={handleCancelExport}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Square className="h-4 w-4" />
                בטל ייצוא
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="flex-1 bg-white/10 hover:bg-white/20 text-white py-3 px-4 rounded-xl transition-colors"
                >
                  ביטול
                </button>
                <button
                  onClick={handleExport}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  ייצא אנשי קשר
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactsExportDialog;
