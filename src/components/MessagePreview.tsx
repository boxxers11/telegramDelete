import React, { useState, useMemo } from 'react';
import { Search, Filter, Trash2, CheckSquare, Square, Calendar, MessageSquare, Users, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface Message {
  id: number;
  chat_id: number;
  chat_title: string;
  chat_type: string;
  date: string;
  content: string;
  media_type?: string;
  participants_count: number;
}

interface MessagePreviewProps {
  messages: Message[];
  onDeleteSelected: (messageIds: number[]) => void;
  onBack: () => void;
  isDeleting: boolean;
}

const MessagePreview: React.FC<MessagePreviewProps> = ({
  messages,
  onDeleteSelected,
  onBack,
  isDeleting
}) => {
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterChat, setFilterChat] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'chat' | 'content'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const messagesPerPage = 50;

  // Filter and sort messages
  const filteredAndSortedMessages = useMemo(() => {
    let filtered = messages.filter(msg => {
      const matchesSearch = !searchTerm || 
        msg.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        msg.chat_title.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesChat = !filterChat || 
        msg.chat_title.toLowerCase().includes(filterChat.toLowerCase());
      
      const matchesDate = !filterDate || 
        msg.date.startsWith(filterDate);
      
      return matchesSearch && matchesChat && matchesDate;
    });

    // Sort messages
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'chat':
          comparison = a.chat_title.localeCompare(b.chat_title);
          break;
        case 'content':
          comparison = a.content.localeCompare(b.content);
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [messages, searchTerm, filterChat, filterDate, sortBy, sortOrder]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedMessages.length / messagesPerPage);
  const startIndex = (currentPage - 1) * messagesPerPage;
  const paginatedMessages = filteredAndSortedMessages.slice(startIndex, startIndex + messagesPerPage);

  const handleSelectAll = () => {
    if (selectedMessages.size === paginatedMessages.length) {
      setSelectedMessages(new Set());
    } else {
      setSelectedMessages(new Set(paginatedMessages.map(msg => msg.id)));
    }
  };

  const handleSelectMessage = (messageId: number) => {
    const newSelected = new Set(selectedMessages);
    if (newSelected.has(messageId)) {
      newSelected.delete(messageId);
    } else {
      newSelected.add(messageId);
    }
    setSelectedMessages(newSelected);
  };

  const handleSort = (column: 'date' | 'chat' | 'content') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const truncateContent = (content: string, maxLength: number = 100) => {
    return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
  };

  const uniqueChats = Array.from(new Set(messages.map(msg => msg.chat_title))).sort();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <button
                onClick={onBack}
                className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 mr-4"
              >
                <ChevronLeft className="w-5 h-5 mr-1" />
                Back
              </button>
              <MessageSquare className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Message Preview</h1>
                <p className="text-gray-600">{filteredAndSortedMessages.length} messages found</p>
              </div>
            </div>
            
            <button
              onClick={() => onDeleteSelected(Array.from(selectedMessages))}
              disabled={selectedMessages.size === 0 || isDeleting}
              className="flex items-center px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {isDeleting ? 'Deleting...' : `Delete Selected (${selectedMessages.size})`}
            </button>
          </div>

          {/* Filters and Search */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search messages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <select
              value={filterChat}
              onChange={(e) => setFilterChat(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Chats</option>
              {uniqueChats.map(chat => (
                <option key={chat} value={chat}>{chat}</option>
              ))}
            </select>
            
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            
            <div className="flex items-center space-x-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                {selectedMessages.size} selected
              </span>
            </div>
          </div>
        </div>

        {/* Messages Table */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left">
                    <button
                      onClick={handleSelectAll}
                      className="flex items-center text-gray-600 hover:text-gray-800"
                    >
                      {selectedMessages.size === paginatedMessages.length && paginatedMessages.length > 0 ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  
                  <th className="px-6 py-4 text-left">
                    <button
                      onClick={() => handleSort('date')}
                      className="flex items-center text-sm font-medium text-gray-700 hover:text-gray-900"
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      Date
                      <ArrowUpDown className="w-3 h-3 ml-1" />
                    </button>
                  </th>
                  
                  <th className="px-6 py-4 text-left">
                    <button
                      onClick={() => handleSort('chat')}
                      className="flex items-center text-sm font-medium text-gray-700 hover:text-gray-900"
                    >
                      <Users className="w-4 h-4 mr-2" />
                      Chat
                      <ArrowUpDown className="w-3 h-3 ml-1" />
                    </button>
                  </th>
                  
                  <th className="px-6 py-4 text-left">
                    <button
                      onClick={() => handleSort('content')}
                      className="flex items-center text-sm font-medium text-gray-700 hover:text-gray-900"
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Content
                      <ArrowUpDown className="w-3 h-3 ml-1" />
                    </button>
                  </th>
                  
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-700">
                    Type
                  </th>
                </tr>
              </thead>
              
              <tbody className="divide-y divide-gray-200">
                {paginatedMessages.map((message) => (
                  <tr
                    key={message.id}
                    className={`hover:bg-gray-50 transition-colors ${
                      selectedMessages.has(message.id) ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleSelectMessage(message.id)}
                        className="text-gray-600 hover:text-gray-800"
                      >
                        {selectedMessages.has(message.id) ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {formatDate(message.date)}
                    </td>
                    
                    <td className="px-6 py-4">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {message.chat_title}
                        </div>
                        <div className="text-xs text-gray-500">
                          {message.chat_type} • {message.participants_count} members
                        </div>
                      </div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {truncateContent(message.content)}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        message.media_type 
                          ? 'bg-purple-100 text-purple-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {message.media_type || 'Text'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Showing {startIndex + 1} to {Math.min(startIndex + messagesPerPage, filteredAndSortedMessages.length)} of {filteredAndSortedMessages.length} messages
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="flex items-center px-3 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </button>
                  
                  <span className="px-3 py-2 text-sm text-gray-600">
                    Page {currentPage} of {totalPages}
                  </span>
                  
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="flex items-center px-3 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Empty State */}
        {filteredAndSortedMessages.length === 0 && (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No messages found</h3>
            <p className="text-gray-600">
              {messages.length === 0 
                ? "No messages to display. Run a scan first."
                : "Try adjusting your search or filter criteria."
              }
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessagePreview;