import React, { useState, useEffect } from 'react';
import { 
  X, 
  Play, 
  Square, 
  Pause, 
  RotateCcw,
  Eye, 
  Trash2, 
  MessageSquare, 
  RefreshCw,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import SharedGroupsList from '../SharedGroupsList';
import { useUpdatesHistory } from '../../hooks/useUpdatesHistory';

interface Message {
  id: number;
  content: string;
  date: string;
  selected: boolean;
}

interface ChatInfo {
  id: number;
  title: string;
  status: 'pending' | 'scanning' | 'completed' | 'skipped' | 'error' | 'deleting';
  messages_found: number;
  messages_deleted: number;
  member_count: number;
  progress_percent: number;
  has_unscanned_dates: boolean;
  user_joined_at?: string;
  error?: string;
  reason?: string;
  messages?: Message[];
  selected: boolean;
}

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  accountLabel: string;
}

const ScanModal: React.FC<ScanModalProps> = ({ isOpen, onClose, accountId, accountLabel }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [hasPreviousScan, setHasPreviousScan] = useState(false);
  const [allChats, setAllChats] = useState<ChatInfo[]>([]);
  const [selectedChats, setSelectedChats] = useState<number[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    totalMessages: 0,
    deletedMessages: 0,
    phase1Complete: false,
    phase2Started: false
  });
  const [realtimeUpdates, setRealtimeUpdates] = useState<string[]>([]);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [selectedChatForDetails, setSelectedChatForDetails] = useState<ChatInfo | null>(null);
  const [showExpandedUpdates, setShowExpandedUpdates] = useState(false);
  const [animatingMessages, setAnimatingMessages] = useState<Set<number>>(new Set());
  const [deletedMessages, setDeletedMessages] = useState<Set<number>>(new Set());
  const [reorderingMessages, setReorderingMessages] = useState<Set<number>>(new Set());
  
  // Use updates history hook
  const { addUpdate } = useUpdatesHistory();

  // Load previous scan data when modal opens
  useEffect(() => {
    if (isOpen && accountId) {
      loadPreviousScan();
    }
  }, [isOpen, accountId]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    
    // Cleanup on unmount
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const loadPreviousScan = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/scan-status`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.result.has_previous_scan) {
          setHasPreviousScan(true);
          
          // Load scanned chats from previous scan
          const scannedChats = data.result.scanned_chats || [];
          if (scannedChats.length > 0) {
            const chatInfos: ChatInfo[] = scannedChats.map((chat: any) => ({
              id: chat.id,
              title: chat.title,
              status: chat.status || 'completed',
              messages_found: chat.messages_found || 0,
              messages_deleted: chat.messages_deleted || 0,
              member_count: chat.member_count || 0,
              progress_percent: 100,
              has_unscanned_dates: false,
              messages: chat.messages || [],
              selected: false
            }));
            
            setAllChats(chatInfos);
            
            // Update stats
            const totalMessages = scannedChats.reduce((sum: number, chat: any) => sum + (chat.messages_found || 0), 0);
            const totalDeleted = scannedChats.reduce((sum: number, chat: any) => sum + (chat.messages_deleted || 0), 0);
            
            setStats(prev => ({
              ...prev,
              total: scannedChats.length,
              completed: scannedChats.length,
              totalMessages: totalMessages,
              deletedMessages: totalDeleted
            }));
            
            setRealtimeUpdates([`📊 טעינת סריקה קודמת: ${scannedChats.length} קבוצות, ${totalMessages} הודעות נמצאו`]);
          }
        }
      }
    } catch (error) {
      console.error('Error loading previous scan:', error);
    }
  };

  const loadChatMessages = async (chatId: number) => {
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/chat-messages/${chatId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.messages) {
          // Update the chat with messages
          setAllChats(prev => prev.map(chat => 
            chat.id === chatId 
              ? { ...chat, messages: data.messages }
              : chat
          ));
          
          // Update selectedChatForDetails if it's the same chat
          setSelectedChatForDetails(prev => 
            prev && prev.id === chatId 
              ? { ...prev, messages: data.messages }
              : prev
          );
        }
      }
    } catch (error) {
      console.error('Error loading chat messages:', error);
    }
  };

  // SSE connection for real-time updates
  useEffect(() => {
    if (isScanning && accountId) {
      // Close existing connection if any
      if (eventSource) {
        eventSource.close();
        setEventSource(null);
      }
      
      const newEventSource = new EventSource(`http://127.0.0.1:8001/accounts/${accountId}/scan-events`);
      setEventSource(newEventSource);
      
      // Add connection state tracking
      newEventSource.onopen = () => {
        console.log('SSE connection opened');
            setRealtimeUpdates(prev => ['🔗 חיבור לשרת הוקם', ...prev.slice(0, 9)]);
            addUpdate({
              type: 'connect',
              message: 'חיבור לשרת הוקם',
              accountId: accountId
            });
      };

      newEventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('SSE Event received:', data);
          
          if (data.type === 'group_discovered') {
            // Only show groups with more than 20 members
            const memberCount = data.member_count || 0;
            const isGroup = !data.is_user && memberCount > 20;
            
            if (isGroup) {
              const updateMessage = `🔍 מצא קבוצה: ${data.chat_name} (${memberCount} חברים)`;
              setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]);
              
              // Add to allChats array only if not exists and is a group
              setAllChats(prev => {
                const exists = prev.find(chat => chat.id === data.chat_id);
                if (!exists) {
                  return [...prev, {
                    id: data.chat_id,
                    title: data.chat_name,
                    status: 'pending',
                    messages_found: 0,
                    messages_deleted: 0,
                    member_count: memberCount,
                    progress_percent: 0,
                    has_unscanned_dates: false,
                    selected: false
                  }];
                }
                return prev;
              });
            }
            
            // Update total count only from phase 1 - count only actual groups
            if (!stats.phase1Complete) {
              setStats(prev => ({
                ...prev,
                total: data.total_discovered || 0
              }));
            }
          } else if (data.type === 'phase1_complete') {
            const updateMessage = `✅ שלב 1 הושלם: ${data.total_groups} קבוצות תקפות נמצאו (רק קבוצות עם מעל 20 חברים)`;
            setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]);
            setStats(prev => ({
              ...prev,
              total: data.total_groups || 0,
              phase1Complete: true
            }));
          } else if (data.type === 'phase2_start') {
            const updateMessage = `🔍 שלב 2: מתחיל סריקה מעמיקה...`;
            setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]);
            setStats(prev => ({
              ...prev,
              phase2Started: true
            }));
          } else if (data.type === 'chat_scanning') {
            const updateMessage = `🔍 סורק: ${data.chat_name} (${data.current_index}/${data.total})`;
            setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]);
            
            // Update chat status - only update the specific chat being scanned
            setAllChats(prev => prev.map(chat => 
              chat.id === data.chat_id || chat.id === data.current_chat_id
                ? { 
                    ...chat, 
                    status: 'scanning', 
                    progress_percent: data.progress_percent || 0, 
                    messages_found: data.messages_found || 0 
                  }
                : chat
            ));
            
            // Update completed count only in phase 2
            if (stats.phase2Started) {
              setStats(prev => ({
                ...prev,
                completed: Math.max(prev.completed, (data.current_index || 0) - 1) // Don't count current as completed yet
              }));
            }
          } else if (data.type === 'message_found') {
            const messageContent = data.message_text || '[Media]';
            const preview = messageContent.length > 60 ? messageContent.substring(0, 60) + '...' : messageContent;
            const updateMessage = `📝 [${data.chat_name}] ${preview}`;
            setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]);
          } else if (data.type === 'chat_completed') {
            const updateMessage = `✅ הושלם: ${data.chat_name} - ${data.messages_found || 0} הודעות`;
            setRealtimeUpdates(prev => [updateMessage, ...prev.slice(0, 9)]);
            
            // Update chat status
            setAllChats(prev => prev.map(chat => 
              chat.id === data.chat_id
                ? { 
                    ...chat, 
                    status: data.status || 'completed', 
                    progress_percent: 100,
                    messages_found: data.messages_found || 0,
                    messages: data.messages || []
                  }
                : chat
            ));
            
            // Update stats - only increment completed if it's actually completed
            if (data.status === 'completed') {
              setStats(prev => ({
                ...prev,
                completed: prev.completed + 1,
                totalMessages: prev.totalMessages + (data.messages_found || 0)
              }));
            }
          } else if (data.type === 'scan_complete') {
            setRealtimeUpdates(prev => ['✅ סריקה הושלמה!', ...prev.slice(0, 9)]);
            addUpdate({
              type: 'scan',
              message: 'סריקה הושלמה!',
              accountId: accountId,
              details: { totalChats: stats.total, messagesFound: stats.totalMessages }
            });
            setIsScanning(false);
            
            // Update all chats with scanned data
            if (data.scanned_chats && Array.isArray(data.scanned_chats)) {
              setAllChats(prev => prev.map(chat => {
                const scannedChat = data.scanned_chats.find((sc: any) => sc.id === chat.id);
                return scannedChat ? { ...chat, ...scannedChat, status: 'completed' } : chat;
              }));
            }
            
            // Auto backup after scan completion
            setRealtimeUpdates(prev => ['💾 מבצע גיבוי אוטומטי...', ...prev.slice(0, 9)]);
            addUpdate({
              type: 'backup',
              message: 'מבצע גיבוי אוטומטי...',
              accountId: accountId
            });
            (async () => {
              try {
                const backupResponse = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/backup`, {
                  method: 'POST'
                });
                if (backupResponse.ok) {
                  setRealtimeUpdates(prev => ['✅ גיבוי הושלם!', ...prev.slice(0, 9)]);
            addUpdate({
              type: 'backup',
              message: 'גיבוי הושלם!',
              accountId: accountId
            });
                } else {
                  setRealtimeUpdates(prev => ['⚠️ גיבוי נכשל', ...prev.slice(0, 9)]);
                }
              } catch (backupError) {
                console.error('Auto backup after scan failed:', backupError);
                setRealtimeUpdates(prev => ['⚠️ גיבוי נכשל', ...prev.slice(0, 9)]);
              }
            })();
            
            newEventSource.close();
            setEventSource(null);
          } else if (data.type === 'scan_idle') {
            setRealtimeUpdates(prev => ['⏸️ סריקה לא פעילה', ...prev.slice(0, 9)]);
            setIsScanning(false);
            newEventSource.close();
            setEventSource(null);
          } else if (data.type === 'error') {
            setRealtimeUpdates(prev => [`❌ שגיאה: ${data.message}`, ...prev.slice(0, 9)]);
            setIsScanning(false);
            newEventSource.close();
            setEventSource(null);
          }
        } catch (error) {
          console.error('Error parsing SSE data:', error);
        }
      };

      newEventSource.onerror = (error) => {
        console.error('SSE error:', error);
        setRealtimeUpdates(prev => ['❌ חיבור נקטע - מנסה להתחבר מחדש...', ...prev.slice(0, 9)]);
        
        // Try to reconnect after 3 seconds
        setTimeout(() => {
          if (isScanning) {
            newEventSource.close();
            setEventSource(null);
            // The useEffect will recreate the connection
          }
        }, 3000);
      };

      return () => {
        newEventSource.close();
        setEventSource(null);
      };
    }
  }, [isScanning, accountId]);

  const loadAllChats = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/chats`);
      if (response.ok) {
        const chats = await response.json();
        const chatInfos: ChatInfo[] = chats.map((chat: any) => ({
          id: chat.id,
          title: chat.title,
          status: 'pending',
          messages_found: 0,
          messages_deleted: 0,
          member_count: chat.member_count || 0,
          progress_percent: 0,
          has_unscanned_dates: false,
          selected: false
        }));
        setAllChats(chatInfos);
      }
    } catch (error) {
      console.error('Error loading chats:', error);
    }
  };

  const handleStartScan = async () => {
    try {
      // Auto backup before starting scan
      setRealtimeUpdates(['💾 מבצע גיבוי אוטומטי...']);
      try {
        const backupResponse = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/backup`, {
          method: 'POST'
        });
        if (backupResponse.ok) {
          setRealtimeUpdates(['✅ גיבוי הושלם, מתחיל סריקה...']);
        } else {
          setRealtimeUpdates(['⚠️ גיבוי נכשל, ממשיך עם הסריקה...']);
        }
      } catch (backupError) {
        console.error('Auto backup failed:', backupError);
        setRealtimeUpdates(['⚠️ גיבוי נכשל, ממשיך עם הסריקה...']);
      }

      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_size: 0, // Continuous scan
          groups_to_scan: selectedChats.length > 0 ? selectedChats : undefined
        })
      });
      
      if (response.ok) {
        setIsScanning(true);
        setIsPaused(false);
        setHasPreviousScan(false);
        setRealtimeUpdates(prev => ['🚀 מתחיל סריקה...', ...prev]);
      }
    } catch (error) {
      console.error('Error starting scan:', error);
    }
  };

  const handlePauseScan = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/pause-scan`, {
        method: 'POST'
      });
      
      if (response.ok) {
        setIsPaused(true);
        setRealtimeUpdates(prev => ['⏸️ סריקה הושהתה', ...prev.slice(0, 9)]);
      }
    } catch (error) {
      console.error('Error pausing scan:', error);
    }
  };

  const handleResumeScan = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/resume-scan`, {
        method: 'POST'
      });
      
      if (response.ok) {
        setIsPaused(false);
        setRealtimeUpdates(prev => ['▶️ ממשיך סריקה...', ...prev.slice(0, 9)]);
      }
    } catch (error) {
      console.error('Error resuming scan:', error);
    }
  };

  const handleStopScan = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/stop-scan`, {
        method: 'POST'
      });
      
      if (response.ok) {
        setIsScanning(false);
        setIsPaused(false);
        setRealtimeUpdates(prev => ['⏹️ סריקה הופסקה', ...prev.slice(0, 9)]);
        if (eventSource) {
          eventSource.close();
          setEventSource(null);
        }
      }
    } catch (error) {
      console.error('Error stopping scan:', error);
    }
  };

  const handleContinuePreviousScan = async () => {
    setHasPreviousScan(false);
    setIsPaused(false);
    setIsScanning(true);
    setRealtimeUpdates(['🔄 ממשיך סריקה קודמת...']);
    addUpdate({
      type: 'scan',
      message: 'ממשיך סריקה קודמת...',
      accountId: accountId
    });
  };

  const handleDeleteMessagesWithAnimation = async (chatId: number, messageIds: number[]) => {
    // Add notification about immediate operation
    setRealtimeUpdates(prev => [
      '⚡ פעולה מיידית: מחיקת הודעות - סריקה הופסקה זמנית',
      ...prev.slice(0, 9)
    ]);
    
    // Start animation for all messages
    setAnimatingMessages(new Set(messageIds));
    
    // Wait for animation to complete
    setTimeout(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/delete-messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_ids: messageIds,
            revoke: true
          })
        });
        
        const result = await response.json();
        
        if (result.success) {
          // Mark messages as deleted
          setDeletedMessages(prev => new Set([...prev, ...messageIds]));
          
          // Verify deletion
          const verifyResponse = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/verify-deletion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              deleted_message_ids: messageIds,
              time_range_minutes: 1
            })
          });
          
          const verifyResult = await verifyResponse.json();
          
          if (verifyResult.success) {
            const actuallyDeleted = verifyResult.verification_result.actually_deleted;
            const stillExist = verifyResult.verification_result.still_exist;
            
            setRealtimeUpdates(prev => [
              `✅ נמחקו ${actuallyDeleted} הודעות, ${stillExist} עדיין קיימות`,
              '▶️ סריקה חודשה מהמקום שעצרנו',
              ...prev.slice(0, 8)
            ]);
            
            // Update chat data
            setAllChats(prev => prev.map(chat => 
              chat.id === chatId 
                ? { 
                    ...chat, 
                    messages: chat.messages?.filter(m => !messageIds.includes(m.id)) || [],
                    messages_found: Math.max(0, (chat.messages_found || 0) - actuallyDeleted),
                    messages_deleted: (chat.messages_deleted || 0) + actuallyDeleted
                  }
                : chat
            ));
            
            // Trigger reorder animation for remaining messages
            if (selectedChatForDetails && selectedChatForDetails.messages) {
              const remainingMessages = selectedChatForDetails.messages.filter(m => !messageIds.includes(m.id));
              if (remainingMessages.length > 0) {
                setReorderingMessages(new Set(remainingMessages.map(m => m.id)));
                setTimeout(() => {
                  setReorderingMessages(new Set());
                }, 300);
              } else {
                // Close modal if no messages left
                setTimeout(() => {
                  setSelectedChatForDetails(null);
                }, 100);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error deleting messages:', error);
        setRealtimeUpdates(prev => [`❌ שגיאה במחיקת הודעות: ${error}`, ...prev.slice(0, 9)]);
      } finally {
        // Remove from animating set
        setAnimatingMessages(prev => {
          const newSet = new Set(prev);
          messageIds.forEach(id => newSet.delete(id));
          return newSet;
        });
      }
    }, 80); // Wait for animation to complete
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0, message: '' });
  const [isDeleting, setIsDeleting] = useState(false);

  const performDeleteAll = async () => {
    try {
      setIsDeleting(true);
      setRealtimeUpdates(prev => ['🗑️ מתחיל מחיקת הודעות...', ...prev.slice(0, 9)]);
      
      let totalDeleted = 0;
      let totalFailed = 0;
      let totalMessages = 0;
      
      // Count total messages first
      for (const chat of allChats) {
        if (chat.messages_found > 0) {
          totalMessages += chat.messages_found;
        }
      }
      
      // Check if there are any messages to delete
      if (totalMessages === 0) {
        setRealtimeUpdates(prev => ['ℹ️ אין הודעות למחוק. הסריקה עדיין לא הסתיימה או לא נמצאו הודעות.', ...prev.slice(0, 9)]);
        setIsDeleting(false);
        return;
      }
      
      setDeleteProgress({ current: 0, total: totalMessages, message: 'מתחיל מחיקת הודעות...' });
      
      let processedMessages = 0;
      
      // Delete messages from each chat
      for (const chat of allChats) {
        if (chat.messages_found > 0) {
          try {
            setDeleteProgress({ 
              current: processedMessages, 
              total: totalMessages, 
              message: `מוחק הודעות מ-${chat.title}...` 
            });
            
            // Get messages for this chat first
            let messageIds = [];
            if (chat.messages && chat.messages.length > 0) {
              messageIds = chat.messages.map(m => m.id);
            } else {
              // Try to load messages from the endpoint
              try {
                const messagesResponse = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/chat-messages/${chat.id}`);
                if (messagesResponse.ok) {
                  const messagesData = await messagesResponse.json();
                  if (messagesData.success && messagesData.messages) {
                    messageIds = messagesData.messages.map((m: any) => m.id);
                  }
                }
              } catch (error) {
                console.error('Error loading messages:', error);
              }
            }
            
            if (messageIds.length === 0) {
              setRealtimeUpdates(prev => [`⚠️ ${chat.title}: אין הודעות זמינות למחיקה`, ...prev.slice(0, 9)]);
              processedMessages += chat.messages_found;
              continue;
            }
            
            const response = await fetch(`http://127.0.0.1:8001/accounts/${accountId}/delete-messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: parseInt(chat.id.toString()),
                message_ids: messageIds,
                revoke: true
              })
            });
            
            if (response.ok) {
              const result = await response.json();
              const deletedCount = result.deleted_count || 0;
              const failedCount = result.failed_count || 0;
              
              totalDeleted += deletedCount;
              totalFailed += failedCount;
              processedMessages += chat.messages?.length || chat.messages_found;
              
              // Update chat status
              setAllChats(prev => prev.map(c => 
                c.id === chat.id 
                  ? { 
                      ...c, 
                      messages_found: 0, 
                      messages: [], 
                      messages_deleted: (c.messages_deleted || 0) + deletedCount,
                      status: 'completed'
                    }
                  : c
              ));
              
              setRealtimeUpdates(prev => [
                `✅ ${chat.title}: ${deletedCount} הודעות נמחקו${failedCount > 0 ? `, ${failedCount} נכשלו` : ''}`,
                ...prev.slice(0, 9)
              ]);
            } else {
              const errorText = await response.text();
              console.error(`Failed to delete messages from ${chat.title}:`, errorText);
              totalFailed += chat.messages_found;
              processedMessages += chat.messages?.length || chat.messages_found;
              
              setRealtimeUpdates(prev => [
                `❌ ${chat.title}: שגיאה במחיקה - ${errorText}`,
                ...prev.slice(0, 9)
              ]);
            }
            
            // Small delay between chats
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`Error deleting messages from ${chat.title}:`, error);
            totalFailed += chat.messages_found;
            processedMessages += chat.messages?.length || chat.messages_found;
            
            setRealtimeUpdates(prev => [
              `❌ ${chat.title}: שגיאה - ${error}`,
              ...prev.slice(0, 9)
            ]);
          }
        }
      }
      
      setDeleteProgress({ current: totalMessages, total: totalMessages, message: 'מחיקה הושלמה!' });
      
      setRealtimeUpdates(prev => [
        `✅ מחיקה הושלמה: ${totalDeleted} הודעות נמחקו, ${totalFailed} נכשלו`,
        ...prev.slice(0, 9)
      ]);
      
      setStats(prev => ({
        ...prev,
        totalMessages: 0,
        deletedMessages: prev.deletedMessages + totalDeleted
      }));
      
      // Clear progress after 3 seconds
      setTimeout(() => {
        setDeleteProgress({ current: 0, total: 0, message: '' });
        setIsDeleting(false);
      }, 3000);
      
    } catch (error) {
      console.error('Error deleting all messages:', error);
      setRealtimeUpdates(prev => [`❌ שגיאה במחיקת הודעות: ${error}`, ...prev.slice(0, 9)]);
      setDeleteProgress({ current: 0, total: 0, message: '' });
      setIsDeleting(false);
    }
  };


  const handleGroupsLoaded = (groups: any[]) => {
    const chatInfos: ChatInfo[] = groups.map((group: any) => ({
      id: group.id,
      title: group.title,
      status: 'pending',
      messages_found: 0,
      messages_deleted: 0,
      member_count: group.member_count || 0,
      progress_percent: 0,
      has_unscanned_dates: false,
      selected: false
    }));
    setAllChats(chatInfos);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" 
      style={{ 
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999
      }}
    >
      <div 
        className="glass-elevated p-8 max-w-6xl w-full mx-4" 
        style={{ 
          maxHeight: '90vh',
          height: '90vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollbarWidth: 'thin',
          scrollbarColor: '#4B5563 #1F2937'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <div className="glass-card p-3">
              <Eye className="w-8 h-8 text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">סריקת הודעות</h2>
              <p className="text-gray-300">{accountLabel}</p>
              {isScanning && (
                <p className="text-sm text-yellow-400 mt-1">
                  ⚠️ הסריקה תמשיך גם אם תסגור את החלון
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2"
            disabled={isScanning}
            title={isScanning ? "הסריקה תמשיך ברקע - השתמש בכפתור עצור" : "סגור חלון"}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Real-time Updates */}
        {realtimeUpdates.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">עדכונים בזמן אמת</h3>
              <button
                onClick={() => setShowExpandedUpdates(!showExpandedUpdates)}
                className="text-white/60 hover:text-white transition-colors duration-200"
                title={showExpandedUpdates ? "סגור חלון מורחב" : "פתח חלון מורחב"}
              >
                {showExpandedUpdates ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
              </button>
            </div>
            <div className={`glass-card p-4 rounded-xl overflow-y-auto transition-all duration-300 ${
              showExpandedUpdates ? 'max-h-96' : 'max-h-32'
            }`}>
              {realtimeUpdates.map((update, index) => (
                <div key={index} className="text-sm text-gray-300 mb-1 animate-fadeInUp">
                  {update}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{stats.total}</div>
            <div className="text-sm text-gray-300">סה"כ קבוצות</div>
            {stats.phase1Complete && (
              <div className="text-xs text-green-400 mt-1">✅ שלב 1 הושלם</div>
            )}
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{stats.completed}</div>
            <div className="text-sm text-gray-300">הושלמו</div>
            {stats.phase2Started && (
              <div className="text-xs text-blue-400 mt-1">🔍 שלב 2 פעיל</div>
            )}
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">{stats.totalMessages}</div>
            <div className="text-sm text-gray-300">הודעות נמצאו</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold text-red-400">{stats.deletedMessages}</div>
            <div className="text-sm text-gray-300">הודעות נמחקו</div>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex flex-wrap gap-3 mb-6">
          {!isScanning && !hasPreviousScan && (
            <button
              onClick={handleStartScan}
              className="btn-primary flex items-center"
            >
              <Play className="w-5 h-5 mr-2" />
              התחל סריקה
            </button>
          )}
          
          {isScanning && !isPaused && (
            <button
              onClick={handlePauseScan}
              className="btn-secondary flex items-center"
            >
              <Pause className="w-5 h-5 mr-2" />
              השהה סריקה
            </button>
          )}
          
          {isScanning && isPaused && (
            <button
              onClick={handleResumeScan}
              className="btn-primary flex items-center"
            >
              <Play className="w-5 h-5 mr-2" />
              המשך סריקה
            </button>
          )}
          
          {isScanning && (
            <button
              onClick={handleStopScan}
              className="btn-destructive flex items-center"
            >
              <Square className="w-5 h-5 mr-2" />
              עצור סריקה
            </button>
          )}
          
          {hasPreviousScan && !isScanning && (
            <button
              onClick={handleContinuePreviousScan}
              className="btn-secondary flex items-center"
            >
              <RotateCcw className="w-5 h-5 mr-2" />
              המשך סריקה קודמת
            </button>
          )}
          
          <button
            onClick={loadAllChats}
            className="btn-secondary flex items-center"
          >
            <RefreshCw className="w-5 h-5 mr-2" />
            רענן קבוצות
          </button>
        </div>

        {/* Groups List */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3">קבוצות לסריקה</h3>
          <SharedGroupsList
            accountId={accountId}
            onGroupsLoaded={handleGroupsLoaded}
            showSelection={true}
            selectedChats={new Set(selectedChats)}
            onSelectionChange={(selected) => setSelectedChats(Array.from(selected))}
            showLastMessageTime={true}
          />
        </div>

        {/* Results Actions */}
        {stats.totalMessages > 0 && (
          <div className="flex gap-3 mb-6">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="btn-destructive flex items-center"
              disabled={isDeleting}
            >
              <Trash2 className="w-5 h-5 mr-2" />
              {isDeleting ? 'מוחק הודעות...' : 'מחק את כל ההודעות'}
            </button>
          </div>
        )}

        {/* Delete Progress */}
        {isDeleting && (
          <div className="mb-6">
            <div className="glass-card p-4 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-white">מחיקת הודעות</h3>
                <span className="text-sm text-gray-300">
                  {deleteProgress.current} / {deleteProgress.total}
                </span>
              </div>
              <div className="text-sm text-gray-300 mb-3">{deleteProgress.message}</div>
              <div className="w-full bg-gray-700 rounded-full h-3">
                <div 
                  className="bg-red-500 h-3 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${deleteProgress.total > 0 ? (deleteProgress.current / deleteProgress.total) * 100 : 0}%` }}
                ></div>
              </div>
              <div className="text-xs text-gray-400 mt-2">
                {deleteProgress.total > 0 ? Math.round((deleteProgress.current / deleteProgress.total) * 100) : 0}% הושלם
              </div>
            </div>
          </div>
        )}

        {/* Groups Status */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3">סטטוס קבוצות ({allChats.length})</h3>
          <div className="glass-card p-4 rounded-xl max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
            {allChats.length === 0 ? (
              <div className="text-center text-gray-400 py-4">
                לא נמצאו קבוצות. התחל סריקה כדי למצוא קבוצות.
              </div>
            ) : (
              allChats.map((chat) => (
                <div
                  key={chat.id}
                  className="flex items-center justify-between p-3 mb-2 glass-card rounded-lg hover-lift cursor-pointer"
                  onClick={() => {
                    // Load messages for this chat
                    loadChatMessages(chat.id);
                    setSelectedChatForDetails(chat);
                  }}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      chat.status === 'completed' ? 'bg-green-500' :
                      chat.status === 'scanning' ? 'bg-blue-500 animate-pulse' :
                      chat.status === 'error' ? 'bg-red-500' :
                      'bg-gray-500'
                    }`} />
                    <span className="text-white font-medium">{chat.title}</span>
                  </div>
                  <div className="flex items-center space-x-4 text-sm text-gray-300">
                    <span className="flex items-center">
                      <MessageSquare className="w-4 h-4 mr-1" />
                      {chat.messages_found}
                    </span>
                    {chat.messages_deleted > 0 && (
                      <span className="flex items-center text-red-400">
                        <Trash2 className="w-4 h-4 mr-1" />
                        {chat.messages_deleted}
                      </span>
                    )}
                    <span>{chat.progress_percent}%</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chat Details Modal */}
        {selectedChatForDetails && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 overflow-hidden" onClick={() => setSelectedChatForDetails(null)}>
            <div className="glass-elevated p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">{selectedChatForDetails.title}</h3>
                <button
                  onClick={() => setSelectedChatForDetails(null)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="glass-card p-3 text-center">
                  <div className="text-2xl font-bold text-blue-400">{selectedChatForDetails.messages_found}</div>
                  <div className="text-sm text-gray-300">הודעות נמצאו</div>
                </div>
                <div className="glass-card p-3 text-center">
                  <div className="text-2xl font-bold text-red-400">{selectedChatForDetails.messages_deleted}</div>
                  <div className="text-sm text-gray-300">הודעות נמחקו</div>
                </div>
              </div>

              {selectedChatForDetails.messages_found && selectedChatForDetails.messages_found > 0 ? (
                <>
                  <div className="mb-4">
                    <h4 className="text-lg font-semibold text-white mb-2">הודעות</h4>
                    <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
                      {selectedChatForDetails.messages && selectedChatForDetails.messages.length > 0 ? (
                        selectedChatForDetails.messages
                          .filter(message => !deletedMessages.has(message.id))
                          .map((message) => (
                        <div 
                          key={message.id} 
                          className={`glass-card p-3 rounded-lg transition-all duration-200 ${
                            animatingMessages.has(message.id) ? 'message-collapse' : ''
                          } ${
                            reorderingMessages.has(message.id) ? 'message-reorder' : ''
                          }`}
                        >
                          <div className="text-sm text-gray-400 mb-1">
                            {new Date(message.date).toLocaleString('he-IL')}
                          </div>
                          <div className="text-white">{message.content}</div>
                        </div>
                        ))
                      ) : (
                        <div className="text-center text-gray-400 py-4">
                          טוען הודעות...
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {selectedChatForDetails.messages && selectedChatForDetails.messages.length > 0 && (
                    <button
                      onClick={async () => {
                        if (!confirm(`האם אתה בטוח שברצונך למחוק ${selectedChatForDetails.messages?.length} הודעות מ-${selectedChatForDetails.title}?`)) return;
                        
                        const messageIds = selectedChatForDetails.messages?.map(m => m.id) || [];
                        await handleDeleteMessagesWithAnimation(parseInt(selectedChatForDetails.id.toString()), messageIds);
                      }}
                      className="btn-destructive w-full flex items-center justify-center"
                    >
                      <Trash2 className="w-5 h-5 mr-2" />
                      מחק את כל ההודעות מקבוצה זו
                    </button>
                  )}
                </>
              ) : (
                <div className="text-center text-gray-400 py-8">
                  אין הודעות להצגה
                </div>
              )}
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-elevated p-6 max-w-md w-full mx-4 rounded-2xl">
              <div className="text-center">
                <div className="glass-card p-4 w-16 h-16 mx-auto mb-4 rounded-full">
                  <Trash2 className="w-8 h-8 text-red-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">מחיקת הודעות</h3>
                <p className="text-gray-300 mb-6">
                  האם אתה בטוח שברצונך למחוק את כל ההודעות שנמצאו?
                  <br />
                  <span className="text-yellow-400 font-medium">{stats.totalMessages} הודעות</span> יימחקו מ-<span className="text-blue-400 font-medium">{allChats.filter(c => c.messages_found > 0).length} קבוצות</span>
                </p>
                
                {deleteProgress.total > 0 && (
                  <div className="mb-4">
                    <div className="text-sm text-gray-300 mb-2">{deleteProgress.message}</div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-red-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(deleteProgress.current / deleteProgress.total) * 100}%` }}
                      ></div>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {deleteProgress.current} / {deleteProgress.total} הודעות
                    </div>
                  </div>
                )}
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 px-4 py-2 rounded-lg bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                  >
                    ביטול
                  </button>
                  <button
                    onClick={async () => {
                      setShowDeleteConfirm(false);
                      await performDeleteAll();
                    }}
                    className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    מחק הודעות
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScanModal;
