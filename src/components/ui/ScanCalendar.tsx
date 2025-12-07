import React, { useState, useMemo, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X, Search, Filter, TrendingUp } from 'lucide-react';
import { apiFetch } from '../../config/api';

interface ScanCalendarProps {
  accountId: string;
  chatId?: number;
  onDateRangeSelect?: (startDate: string, endDate: string) => void;
  onClose?: () => void;
  currentScanDateRange?: { start: string; end: string } | null;
}

interface ScannedDateRange {
  start: string;
  end: string;
}

const ScanCalendar: React.FC<ScanCalendarProps> = ({
  accountId,
  chatId,
  onDateRangeSelect,
  onClose,
  currentScanDateRange
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedStartDate, setSelectedStartDate] = useState<Date | null>(null);
  const [selectedEndDate, setSelectedEndDate] = useState<Date | null>(null);
  const [scannedRanges, setScannedRanges] = useState<ScannedDateRange[]>([]);
  const [messagesPerDate, setMessagesPerDate] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<'all' | 'scanned' | 'with_messages' | 'not_scanned'>('all');
  const [searchDate, setSearchDate] = useState<string>('');
  const [showSearch, setShowSearch] = useState(false);

  // Load scanned date ranges - refresh periodically when scanning
  React.useEffect(() => {
    const loadScannedRanges = async () => {
      try {
        setLoading(true);
        const url = chatId 
          ? `/accounts/${accountId}/scan-date-ranges?chat_id=${chatId}`
          : `/accounts/${accountId}/scan-date-ranges`;
        const response = await apiFetch(url);
        const data = await response.json();
        
        if (data.success) {
          if (chatId && data.scanned_date_ranges) {
            setScannedRanges(data.scanned_date_ranges.map((range: string[]) => ({
              start: range[0],
              end: range[1]
            })));
            // Load messages_per_date for specific chat
            if (data.messages_per_date) {
              setMessagesPerDate(data.messages_per_date);
            }
          } else if (data.scanned_date_ranges) {
            // Aggregate all ranges from all chats
            const allRanges: ScannedDateRange[] = [];
            const allMessagesPerDate: Record<string, number> = {};
            Object.values(data.scanned_date_ranges).forEach((chatData: any) => {
              if (chatData.scanned_date_ranges) {
                chatData.scanned_date_ranges.forEach((range: string[]) => {
                  allRanges.push({ start: range[0], end: range[1] });
                });
              }
              // Aggregate messages_per_date from all chats
              if (chatData.messages_per_date) {
                Object.entries(chatData.messages_per_date).forEach(([date, count]) => {
                  allMessagesPerDate[date] = (allMessagesPerDate[date] || 0) + (count as number);
                });
              }
            });
            setScannedRanges(allRanges);
            setMessagesPerDate(allMessagesPerDate);
          }
        }
      } catch (error) {
        console.error('Error loading scanned ranges:', error);
      } finally {
        setLoading(false);
      }
    };

    loadScannedRanges();
    
    // Refresh every 5 seconds to update calendar with new scan results
    const intervalId = setInterval(loadScannedRanges, 5000);
    
    return () => {
      clearInterval(intervalId);
    };
  }, [accountId, chatId]);

  // Check if a date is scanned
  const isDateScanned = useCallback((date: Date): boolean => {
    const dateStr = date.toISOString().split('T')[0];
    return scannedRanges.some(range => {
      return dateStr >= range.start && dateStr <= range.end;
    });
  }, [scannedRanges]);

  // Get message count for a specific date
  const getMessageCountForDate = useCallback((date: Date): number => {
    const dateStr = date.toISOString().split('T')[0];
    return messagesPerDate[dateStr] || 0;
  }, [messagesPerDate]);

  // Check if a date is in selected range
  const isDateInSelectedRange = useCallback((date: Date): boolean => {
    if (!selectedStartDate || !selectedEndDate) return false;
    const dateStr = date.toISOString().split('T')[0];
    const startStr = selectedStartDate.toISOString().split('T')[0];
    const endStr = selectedEndDate.toISOString().split('T')[0];
    return dateStr >= startStr && dateStr <= endStr;
  }, [selectedStartDate, selectedEndDate]);

  // Check if a date is in current scan range
  const isDateInCurrentScanRange = useCallback((date: Date): boolean => {
    if (!currentScanDateRange) return false;
    const dateStr = date.toISOString().split('T')[0];
    return dateStr >= currentScanDateRange.start && dateStr <= currentScanDateRange.end;
  }, [currentScanDateRange]);

  // Navigate to specific date
  const navigateToDate = useCallback((dateStr: string) => {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        setCurrentDate(date);
        setSearchDate('');
        setShowSearch(false);
      }
    } catch (e) {
      console.error('Invalid date:', dateStr);
    }
  }, []);

  // Get calendar days for current month with filtering
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: (Date | null)[] = [];
    
    // Add empty cells for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    // Apply filters
    if (filterMode === 'all') {
      return days;
    }
    
    return days.map(date => {
      if (!date) return null;
      const isScanned = isDateScanned(date);
      const messageCount = getMessageCountForDate(date);
      
      if (filterMode === 'scanned' && !isScanned) return null;
      if (filterMode === 'with_messages' && messageCount === 0) return null;
      if (filterMode === 'not_scanned' && isScanned) return null;
      
      return date;
    });
  }, [currentDate, filterMode, isDateScanned, getMessageCountForDate]);

  const handleDateClick = (date: Date) => {
    if (!selectedStartDate || (selectedStartDate && selectedEndDate)) {
      // Start new selection
      setSelectedStartDate(date);
      setSelectedEndDate(null);
    } else {
      // Complete selection
      if (date < selectedStartDate) {
        setSelectedEndDate(selectedStartDate);
        setSelectedStartDate(date);
      } else {
        setSelectedEndDate(date);
      }
    }
  };

  const handleConfirmSelection = () => {
    if (selectedStartDate && selectedEndDate) {
      const startStr = selectedStartDate.toISOString().split('T')[0];
      const endStr = selectedEndDate.toISOString().split('T')[0];
      onDateRangeSelect?.(startStr, endStr);
      onClose?.();
    }
  };

  const handleClearSelection = () => {
    setSelectedStartDate(null);
    setSelectedEndDate(null);
  };

  const goToPreviousMonth = useCallback(() => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }, []);

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Handle wheel scroll for month navigation - use ref to attach non-passive listener
  const calendarRef = React.useRef<HTMLDivElement>(null);
  
  React.useEffect(() => {
    const element = calendarRef.current;
    if (!element) return;
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0) {
        // Scroll down - go to next month
        goToNextMonth();
      } else {
        // Scroll up - go to previous month
        goToPreviousMonth();
      }
    };
    
    // Add event listener with passive: false to allow preventDefault
    element.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, [goToNextMonth, goToPreviousMonth]);

  const monthNames = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
  ];

  const weekDays = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

  return (
    <div 
      ref={calendarRef}
      className="bg-slate-900/95 text-white rounded-xl border border-slate-700 p-8 max-w-6xl mx-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Calendar className="h-8 w-8 text-blue-400" />
          <h2 className="text-2xl font-bold">
            יומן סריקה
            {chatId && <span className="text-sm text-slate-400 ml-2">(קבוצה ספציפית)</span>}
          </h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <button
          onClick={goToPreviousMonth}
          className="p-3 hover:bg-slate-800 rounded-lg transition-colors"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
        <div className="flex items-center gap-4 flex-wrap">
          <h3 className="text-2xl font-bold">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </h3>
          <button
            onClick={goToToday}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            היום
          </button>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors flex items-center gap-2"
          >
            <Search className="h-4 w-4" />
            חיפוש תאריך
          </button>
        </div>
        <button
          onClick={goToNextMonth}
          className="p-3 hover:bg-slate-800 rounded-lg transition-colors"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      </div>
      
      {/* Date Search */}
      {showSearch && (
        <div className="mb-4 p-4 bg-slate-800/50 rounded-lg">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={searchDate}
              onChange={(e) => setSearchDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchDate) {
                  navigateToDate(searchDate);
                }
              }}
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => searchDate && navigateToDate(searchDate)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              עבור
            </button>
            <button
              onClick={() => {
                setShowSearch(false);
                setSearchDate('');
              }}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              ביטול
            </button>
          </div>
        </div>
      )}
      
      <div className="text-center text-sm text-slate-400 mb-4">
        💡 גלול למעלה/למטה למעבר בין חודשים
      </div>
      
      {/* Filter Buttons */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Filter className="h-4 w-4 text-slate-400" />
        <span className="text-sm text-slate-400">סינון:</span>
        {(['all', 'scanned', 'with_messages', 'not_scanned'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setFilterMode(mode)}
            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
              filterMode === mode
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
            }`}
          >
            {mode === 'all' && 'הכל'}
            {mode === 'scanned' && 'נסרק בלבד'}
            {mode === 'with_messages' && 'עם הודעות'}
            {mode === 'not_scanned' && 'לא נסרק'}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="bg-slate-800/30 p-3 rounded-lg mb-4 border border-slate-700">
        <p className="text-xs text-slate-400 mb-2 font-semibold">מקרא:</p>
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500/30 border border-green-500 rounded transition-all hover:scale-110"></div>
            <span className="text-slate-300">נסרק</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-500/30 border border-blue-500 rounded transition-all hover:scale-110"></div>
            <span className="text-slate-300">נבחר</span>
          </div>
          {currentScanDateRange && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-yellow-400 rounded animate-pulse"></div>
              <span className="text-yellow-300 font-semibold">סורק כעת</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-slate-700 border border-slate-600 rounded"></div>
            <span className="text-slate-300">לא נסרק</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-green-300 font-semibold bg-green-500/40 px-1.5 py-0.5 rounded border border-green-400/60">
              5
            </span>
            <span className="text-slate-300">מספר הודעות</span>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2 mb-6">
          {/* Week day headers */}
          {weekDays.map((day, index) => (
            <div
              key={index}
              className="p-2 text-center text-sm font-medium text-slate-400"
            >
              {day}
            </div>
          ))}

          {/* Calendar days */}
          {calendarDays.map((date, index) => {
            if (!date) {
              return <div key={index} className="p-2"></div>;
            }

            const isScanned = isDateScanned(date);
            const isSelected = isDateInSelectedRange(date);
            const isCurrentlyScanning = isDateInCurrentScanRange(date);
            const isStart = selectedStartDate && date.toDateString() === selectedStartDate.toDateString();
            const isEnd = selectedEndDate && date.toDateString() === selectedEndDate.toDateString();
            const isToday = date.toDateString() === new Date().toDateString();
            const messageCount = getMessageCountForDate(date);

            return (
              <button
                key={index}
                onClick={() => handleDateClick(date)}
                className={`
                  p-3 text-base rounded-lg transition-all relative min-h-[70px] flex flex-col items-center justify-center
                  ${isScanned 
                    ? 'bg-green-500/30 border-2 border-green-500 hover:bg-green-500/50' 
                    : 'bg-slate-800 border-2 border-slate-700 hover:bg-slate-700'
                  }
                  ${isCurrentlyScanning ? 'ring-2 ring-yellow-400 ring-offset-1 ring-offset-slate-900 animate-pulse' : ''}
                  ${isSelected ? 'bg-blue-500/30 border-blue-500' : ''}
                  ${isStart || isEnd ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900' : ''}
                  ${isToday ? 'font-bold border-blue-400' : ''}
                  ${messageCount > 0 ? 'cursor-pointer' : ''}
                `}
                title={
                  messageCount > 0 
                    ? `${messageCount} הודעות נמצאו ביום זה (${date.toLocaleDateString('he-IL')})` 
                    : isScanned 
                      ? `נסרק - ${date.toLocaleDateString('he-IL')}` 
                      : `לא נסרק - ${date.toLocaleDateString('he-IL')}`
                }
              >
                <div className="flex flex-col items-center justify-center w-full gap-1 relative">
                  <span className={`${isToday ? 'text-blue-400 text-lg font-bold' : 'text-white'} ${messageCount > 0 ? 'mb-0.5' : ''}`}>
                    {date.getDate()}
                  </span>
                  {messageCount > 0 && (
                    <span className="text-[10px] text-green-300 font-bold bg-green-500/40 px-1.5 py-0.5 rounded border border-green-400/60 shadow-sm">
                      {messageCount}
                    </span>
                  )}
                  {isScanned && messageCount === 0 && (
                    <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected Range Display */}
      {selectedStartDate && selectedEndDate && (
        <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400 mb-1">טווח נבחר:</p>
              <p className="font-medium">
                {selectedStartDate.toLocaleDateString('he-IL')} - {selectedEndDate.toLocaleDateString('he-IL')}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleClearSelection}
                className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                נקה
              </button>
              <button
                onClick={handleConfirmSelection}
                className="px-4 py-1 text-sm bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                בחר טווח
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Statistics Summary */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Scanned Days Count */}
        <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 hover:border-green-500/50 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 mb-1">ימים נסרקים</p>
              <p className="text-2xl font-bold text-green-400">
                {Object.keys(messagesPerDate).length}
              </p>
            </div>
            <Calendar className="h-8 w-8 text-green-400/50" />
          </div>
        </div>
        
        {/* Total Messages Found */}
        <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 hover:border-blue-500/50 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 mb-1">סה"כ הודעות נמצאו</p>
              <p className="text-2xl font-bold text-blue-400">
                {Object.values(messagesPerDate).reduce((sum, count) => sum + count, 0).toLocaleString('he-IL')}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-blue-400/50" />
          </div>
        </div>
        
        {/* Date Ranges Count */}
        <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 hover:border-purple-500/50 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 mb-1">טווחי סריקה</p>
              <p className="text-2xl font-bold text-purple-400">
                {scannedRanges.length}
              </p>
            </div>
            <div className="h-8 w-8 flex items-center justify-center bg-purple-500/20 rounded-full">
              <span className="text-purple-400 text-xs font-bold">{scannedRanges.length}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Average Messages Per Day */}
      {Object.keys(messagesPerDate).length > 0 && (
        <div className="mt-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 mb-2">סטטיסטיקות נוספות</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-slate-400">ממוצע הודעות ליום</p>
              <p className="text-lg font-bold text-green-400">
                {(Object.values(messagesPerDate).reduce((sum, count) => sum + count, 0) / Object.keys(messagesPerDate).length).toFixed(1)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">יום עם הכי הרבה הודעות</p>
              <p className="text-lg font-bold text-blue-400">
                {(() => {
                  const maxEntry = Object.entries(messagesPerDate).reduce((max, [date, count]) => 
                    count > max[1] ? [date, count] : max, ['', 0] as [string, number]
                  );
                  return maxEntry[1] > 0 ? maxEntry[1] : 0;
                })()}
              </p>
            </div>
            <div>
              <p className="text-slate-400">ימים עם הודעות</p>
              <p className="text-lg font-bold text-purple-400">
                {Object.values(messagesPerDate).filter(count => count > 0).length}
              </p>
            </div>
            <div>
              <p className="text-slate-400">ימים ללא הודעות</p>
              <p className="text-lg font-bold text-slate-400">
                {scannedRanges.reduce((sum, range) => {
                  const start = new Date(range.start);
                  const end = new Date(range.end);
                  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                  return sum + days;
                }, 0) - Object.keys(messagesPerDate).length}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Scanned Ranges Summary */}
      {scannedRanges.length > 0 && (
        <div className="mt-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-300">טווחי סריקה ({scannedRanges.length})</p>
            <button
              onClick={() => {
                // Sort ranges by date (newest first)
                const sorted = [...scannedRanges].sort((a, b) => 
                  new Date(b.start).getTime() - new Date(a.start).getTime()
                );
                setScannedRanges(sorted);
              }}
              className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
            >
              מיון לפי תאריך
            </button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {scannedRanges.slice(0, 10).map((range, index) => {
              const rangeStart = new Date(range.start);
              const rangeEnd = new Date(range.end);
              const daysInRange = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
              const messagesInRange = Object.entries(messagesPerDate)
                .filter(([date]) => date >= range.start && date <= range.end)
                .reduce((sum, [, count]) => sum + count, 0);
              const avgMessagesPerDay = daysInRange > 0 ? (messagesInRange / daysInRange).toFixed(1) : '0';
              
              return (
                <div 
                  key={index} 
                  className="text-xs bg-slate-700/50 p-2 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
                  onClick={() => {
                    setCurrentDate(rangeStart);
                    setSelectedStartDate(rangeStart);
                    setSelectedEndDate(rangeEnd);
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-200">
                      {rangeStart.toLocaleDateString('he-IL')} - {rangeEnd.toLocaleDateString('he-IL')}
                    </span>
                    {messagesInRange > 0 && (
                      <span className="text-green-300 font-bold bg-green-500/20 px-2 py-0.5 rounded">
                        {messagesInRange} הודעות
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-slate-400 mt-1">
                    <span>{daysInRange} ימים</span>
                    {messagesInRange > 0 && (
                      <>
                        <span>•</span>
                        <span>ממוצע: {avgMessagesPerDay} הודעות/יום</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {scannedRanges.length > 10 && (
              <div className="text-xs text-slate-500 text-center pt-2">
                +{scannedRanges.length - 10} טווחים נוספים...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ScanCalendar;

