import React, { useState } from 'react';
import { Search, Filter, Calendar, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { useUpdatesHistory } from '../hooks/useUpdatesHistory';

// UpdateItem interface is now imported from useUpdatesHistory hook

interface AdvancedUpdatesWindowProps {
  isExpanded: boolean;
  onToggle: () => void;
}

const AdvancedUpdatesWindow: React.FC<AdvancedUpdatesWindowProps> = ({
  isExpanded,
  onToggle
}) => {
  // Use updates history hook
  const { updates, searchUpdates, getLast36HoursUpdates } = useUpdatesHistory();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{start: string, end: string}>({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'scan': return 'text-blue-400';
      case 'delete': return 'text-red-400';
      case 'connect': return 'text-green-400';
      case 'error': return 'text-red-500';
      case 'info': return 'text-gray-400';
      default: return 'text-gray-400';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'scan': return 'סריקה';
      case 'delete': return 'מחיקה';
      case 'connect': return 'חיבור';
      case 'error': return 'שגיאה';
      case 'info': return 'מידע';
      default: return 'אחר';
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dayBeforeYesterday = new Date(today);
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
    
    const updateDate = new Date(timestamp);
    const updateDay = new Date(updateDate.getFullYear(), updateDate.getMonth(), updateDate.getDate());
    
    const timeStr = updateDate.toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    if (updateDay.getTime() === today.getTime()) {
      // היום - רק שעה
      const [hours, minutes, seconds] = timeStr.split(':');
      return (
        <span className="text-white/80">
          {hours}:{minutes}
          <span className="text-white/50 text-xs ml-1">{seconds}</span>
        </span>
      );
    } else if (updateDay.getTime() === yesterday.getTime()) {
      // אתמול
      return (
        <span className="text-white/80">
          אתמול, {timeStr}
        </span>
      );
    } else if (updateDay.getTime() === dayBeforeYesterday.getTime()) {
      // שלשום
      return (
        <span className="text-white/80">
          שלשום, {timeStr}
        </span>
      );
    } else {
      // תאריך אחר
      const dayStr = updateDate.toLocaleDateString('he-IL', {
        day: '2-digit',
        month: '2-digit'
      });
      return (
        <span className="text-white/80">
          {dayStr}, {timeStr}
        </span>
      );
    }
  };

  const filteredUpdates = React.useMemo(() => {
    // Start with last 36 hours updates
    let filtered = getLast36HoursUpdates();
    
    // Apply search filter
    if (searchTerm) {
      filtered = searchUpdates(searchTerm).filter(update => 
        filtered.some(f => f.id === update.id)
      );
    }
    
    // Apply type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(update => update.type === filterType);
    }
    
    // Apply date range filter
    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);
    filtered = filtered.filter(update => {
      const updateDate = new Date(update.timestamp);
      return updateDate >= startDate && updateDate <= endDate;
    });
    
    return filtered;
  }, [updates, searchTerm, filterType, dateRange, searchUpdates, getLast36HoursUpdates]);

  const resetFilters = () => {
    setSearchTerm('');
    setFilterType('all');
    setDateRange({
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
    });
  };

  return (
    <div className={`fixed bottom-4 right-4 transition-all duration-300 ease-in-out ${
      isExpanded 
        ? 'w-96 h-96 bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg shadow-2xl' 
        : 'w-80 h-20 bg-black/50 backdrop-blur-sm border border-white/10 rounded-lg'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        <h3 className="text-white font-medium">עדכונים</h3>
        <button
          onClick={onToggle}
          className="text-white/60 hover:text-white transition-colors duration-200"
        >
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Filters */}
          <div className="p-3 space-y-3 border-b border-white/10">
            {/* Search */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/40 w-4 h-4" />
              <input
                type="text"
                placeholder="חיפוש עדכונים..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white/5 border border-white/20 rounded px-3 py-2 pr-10 text-white text-sm placeholder-white/40 focus:outline-none focus:border-white/40 transition-colors"
              />
            </div>

            {/* Type Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="w-4 h-4 text-white/40" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="bg-white/5 border border-white/20 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-white/40 transition-colors"
              >
                <option value="all">כל הסוגים</option>
                <option value="scan">סריקה</option>
                <option value="delete">מחיקה</option>
                <option value="connect">חיבור</option>
                <option value="error">שגיאה</option>
                <option value="info">מידע</option>
              </select>
            </div>

            {/* Date Range */}
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-white/40" />
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({...prev, start: e.target.value}))}
                className="bg-white/5 border border-white/20 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-white/40 transition-colors"
              />
              <span className="text-white/40">-</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({...prev, end: e.target.value}))}
                className="bg-white/5 border border-white/20 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-white/40 transition-colors"
              />
            </div>

            {/* Reset Button */}
            <button
              onClick={resetFilters}
              className="flex items-center space-x-1 text-white/60 hover:text-white/80 transition-colors duration-200 text-sm"
            >
              <RotateCcw className="w-3 h-3" />
              <span>איפוס פילטרים</span>
            </button>
          </div>

          {/* Updates List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredUpdates.length === 0 ? (
              <div className="text-white/40 text-sm text-center py-4">
                אין עדכונים לתצוגה
              </div>
            ) : (
              filteredUpdates.map((update) => (
                <div key={update.id} className="bg-white/5 rounded p-2 border border-white/10">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className={`text-xs font-medium ${getTypeColor(update.type)}`}>
                          {getTypeLabel(update.type)}
                        </span>
                        {formatTimestamp(update.timestamp)}
                      </div>
                      <p className="text-white/80 text-sm">{update.message}</p>
                      {update.accountId && (
                        <p className="text-white/40 text-xs mt-1">
                          חשבון: {update.accountId}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {!isExpanded && (
        <div className="p-3">
          <div className="text-white/80 text-sm">
            {getLast36HoursUpdates().length} עדכונים (36 שעות אחרונות)
          </div>
          {getLast36HoursUpdates().length > 0 && (
            <div className="text-white/40 text-xs mt-1 truncate">
              {getLast36HoursUpdates()[getLast36HoursUpdates().length - 1]?.message}
            </div>
          )}
          {getLast36HoursUpdates().length > 0 && (
            <div className="text-white/50 text-xs mt-1">
              {formatTimestamp(getLast36HoursUpdates()[getLast36HoursUpdates().length - 1]?.timestamp)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdvancedUpdatesWindow;
