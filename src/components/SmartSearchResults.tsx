import React, { useState } from 'react';
import { Search, ExternalLink, Calendar, MessageSquare, Users, ArrowLeft, Filter, ChevronDown, ChevronUp } from 'lucide-react';

interface SearchMessage {
  id: number;
  chat_id: number;
  chat_title: string;
  chat_type: string;
  date: string;
  content: string;
  link: string;
  matched_keywords: string[];
}

interface SmartSearchResultsProps {
  messages: SearchMessage[];
  prompt: string;
  keywords: string[];
  totalFound: number;
  onBack: () => void;
}

const SmartSearchResults: React.FC<SmartSearchResultsProps> = ({
  messages,
  prompt,
  keywords,
  totalFound,
  onBack
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterChat, setFilterChat] = useState('');
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());

  const filteredMessages = messages.filter(msg => {
    const matchesSearch = !searchTerm || 
      msg.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.chat_title.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesChat = !filterChat || 
      msg.chat_title.toLowerCase().includes(filterChat.toLowerCase());
    
    return matchesSearch && matchesChat;
  });

  const uniqueChats = Array.from(new Set(messages.map(msg => msg.chat_title))).sort();

  const toggleExpanded = (messageId: number) => {
    const newExpanded = new Set(expandedMessages);
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId);
    } else {
      newExpanded.add(messageId);
    }
    setExpandedMessages(newExpanded);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const truncateContent = (content: string, maxLength: number = 150) => {
    return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
  };

  const highlightKeywords = (text: string, keywords: string[]) => {
    let highlightedText = text;
    keywords.forEach(keyword => {
      const regex = new RegExp(`(${keyword})`, 'gi');
      highlightedText = highlightedText.replace(regex, '<mark class="bg-yellow-200 px-1 rounded">$1</mark>');
    });
    return highlightedText;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <button
                onClick={onBack}
                className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 mr-4"
              >
                <ArrowLeft className="w-5 h-5 mr-1" />
                Back
              </button>
              <Search className="w-8 h-8 text-purple-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Smart Search Results</h1>
                <p className="text-gray-600">{totalFound} messages found</p>
              </div>
            </div>
          </div>

          {/* Search Info */}
          <div className="bg-purple-50 rounded-lg p-4 mb-4">
            <h3 className="font-semibold text-purple-900 mb-2">Search Query:</h3>
            <p className="text-purple-800 mb-3">"{prompt}"</p>
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-purple-700">Keywords:</span>
              {keywords.map(keyword => (
                <span key={keyword} className="px-2 py-1 bg-purple-200 text-purple-800 rounded-full text-xs">
                  {keyword}
                </span>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Filter messages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            
            <select
              value={filterChat}
              onChange={(e) => setFilterChat(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">All Chats</option>
              {uniqueChats.map(chat => (
                <option key={chat} value={chat}>{chat}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4">
          {filteredMessages.length === 0 ? (
            <div className="bg-white rounded-xl shadow-lg p-12 text-center">
              <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No messages found</h3>
              <p className="text-gray-600">
                {messages.length === 0 
                  ? "No messages match your search criteria."
                  : "Try adjusting your filters."
                }
              </p>
            </div>
          ) : (
            filteredMessages.map((message) => (
              <div key={message.id} className="bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow">
                <div className="p-6">
                  {/* Message Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                      <div className="flex items-center mr-4">
                        <Users className="w-4 h-4 text-gray-500 mr-2" />
                        <span className="font-medium text-gray-900">{message.chat_title}</span>
                        <span className={`ml-2 px-2 py-1 text-xs font-medium rounded-full ${
                          message.chat_type === 'User' 
                            ? 'bg-blue-100 text-blue-800' 
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {message.chat_type}
                        </span>
                      </div>
                      
                      <div className="flex items-center text-gray-500">
                        <Calendar className="w-4 h-4 mr-1" />
                        <span className="text-sm">{formatDate(message.date)}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <a
                        href={message.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center px-3 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Open
                      </a>
                      
                      <button
                        onClick={() => toggleExpanded(message.id)}
                        className="flex items-center px-3 py-1 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                      >
                        {expandedMessages.has(message.id) ? (
                          <>
                            <ChevronUp className="w-3 h-3 mr-1" />
                            Less
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3 h-3 mr-1" />
                            More
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Message Content */}
                  <div className="mb-4">
                    <div 
                      className="text-gray-800 leading-relaxed"
                      dangerouslySetInnerHTML={{
                        __html: highlightKeywords(
                          expandedMessages.has(message.id) 
                            ? message.content 
                            : truncateContent(message.content),
                          message.matched_keywords
                        )
                      }}
                    />
                  </div>

                  {/* Matched Keywords */}
                  <div className="flex flex-wrap gap-2">
                    <span className="text-sm text-gray-600">Matched:</span>
                    {message.matched_keywords.map(keyword => (
                      <span key={keyword} className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Summary */}
        {filteredMessages.length > 0 && (
          <div className="mt-6 bg-white rounded-xl shadow-lg p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <div>
                <div className="text-2xl font-bold text-purple-600">{totalFound}</div>
                <div className="text-sm text-gray-600">Total Messages</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-600">{uniqueChats.length}</div>
                <div className="text-sm text-gray-600">Chats Searched</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">{keywords.length}</div>
                <div className="text-sm text-gray-600">Keywords Used</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SmartSearchResults;