import { useState, useEffect, useCallback } from 'react';

export interface UpdateItem {
  id: string;
  timestamp: Date;
  type: 'scan' | 'delete' | 'connect' | 'error' | 'info' | 'backup' | 'restore';
  message: string;
  accountId?: string;
  chatId?: string;
  details?: any;
}

const STORAGE_KEY = 'telegram_delete_updates_history';
const MAX_HISTORY_HOURS = 36; // 36 שעות אחרונות

export const useUpdatesHistory = () => {
  const [updates, setUpdates] = useState<UpdateItem[]>([]);

  // Load updates from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsedUpdates = JSON.parse(stored).map((update: any) => ({
          ...update,
          timestamp: new Date(update.timestamp)
        }));
        setUpdates(parsedUpdates);
      }
    } catch (error) {
      console.error('Failed to load updates history:', error);
    }
  }, []);

  // Save updates to localStorage whenever updates change
  useEffect(() => {
    try {
      const updatesToStore = updates.map(update => ({
        ...update,
        timestamp: update.timestamp.toISOString()
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatesToStore));
    } catch (error) {
      console.error('Failed to save updates history:', error);
    }
  }, [updates]);

  // Add new update
  const addUpdate = useCallback((update: Omit<UpdateItem, 'id' | 'timestamp'>) => {
    const newUpdate: UpdateItem = {
      ...update,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };

    setUpdates(prev => {
      const newUpdates = [newUpdate, ...prev];
      
      // Keep only last 36 hours of updates for display
      const thirtySixHoursAgo = new Date();
      thirtySixHoursAgo.setHours(thirtySixHoursAgo.getHours() - MAX_HISTORY_HOURS);
      
      return newUpdates.filter(update => update.timestamp >= thirtySixHoursAgo);
    });
  }, []);

  // Add multiple updates at once
  const addUpdates = useCallback((newUpdates: Omit<UpdateItem, 'id' | 'timestamp'>[]) => {
    const updatesWithIds = newUpdates.map(update => ({
      ...update,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    }));

    setUpdates(prev => {
      const allUpdates = [...updatesWithIds, ...prev];
      
      // Keep only last 36 hours of updates for display
      const thirtySixHoursAgo = new Date();
      thirtySixHoursAgo.setHours(thirtySixHoursAgo.getHours() - MAX_HISTORY_HOURS);
      
      return allUpdates.filter(update => update.timestamp >= thirtySixHoursAgo);
    });
  }, []);

  // Clear all updates
  const clearUpdates = useCallback(() => {
    setUpdates([]);
  }, []);

  // Get updates by type
  const getUpdatesByType = useCallback((type: UpdateItem['type']) => {
    return updates.filter(update => update.type === type);
  }, [updates]);

  // Get updates by date range
  const getUpdatesByDateRange = useCallback((startDate: Date, endDate: Date) => {
    return updates.filter(update => 
      update.timestamp >= startDate && update.timestamp <= endDate
    );
  }, [updates]);

  // Search updates by message content
  const searchUpdates = useCallback((query: string) => {
    const lowercaseQuery = query.toLowerCase();
    return updates.filter(update => 
      update.message.toLowerCase().includes(lowercaseQuery)
    );
  }, [updates]);

  // Get recent updates (last N updates)
  const getRecentUpdates = useCallback((count: number = 10) => {
    return updates.slice(0, count);
  }, [updates]);

  // Get updates from last 36 hours
  const getLast36HoursUpdates = useCallback(() => {
    const thirtySixHoursAgo = new Date();
    thirtySixHoursAgo.setHours(thirtySixHoursAgo.getHours() - MAX_HISTORY_HOURS);
    
    return updates.filter(update => update.timestamp >= thirtySixHoursAgo);
  }, [updates]);

  // Get updates statistics
  const getUpdatesStats = useCallback(() => {
    const stats = {
      total: updates.length,
      byType: {} as Record<UpdateItem['type'], number>,
      byDay: {} as Record<string, number>,
      lastUpdate: updates[0]?.timestamp || null
    };

    updates.forEach(update => {
      // Count by type
      stats.byType[update.type] = (stats.byType[update.type] || 0) + 1;
      
      // Count by day
      const day = update.timestamp.toISOString().split('T')[0];
      stats.byDay[day] = (stats.byDay[day] || 0) + 1;
    });

    return stats;
  }, [updates]);

  return {
    updates,
    addUpdate,
    addUpdates,
    clearUpdates,
    getUpdatesByType,
    getUpdatesByDateRange,
    searchUpdates,
    getRecentUpdates,
    getLast36HoursUpdates,
    getUpdatesStats
  };
};
