import React from 'react';
import { X } from 'lucide-react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    language: 'he' | 'en';
    onLanguageChange: (language: 'he' | 'en') => void;
    uiMode: 'simple' | 'advanced' | 'diamond';
    onUiModeChange: (mode: 'simple' | 'advanced' | 'diamond') => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    language,
    onLanguageChange,
    uiMode,
    onUiModeChange
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-elevated p-8 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-title text-white">
                        {language === 'he' ? 'הגדרות' : 'Settings'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="btn-secondary"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
                
                <div className="space-y-6">
                    {/* Language Selection */}
                    <div className="glass-card p-6">
                        <h3 className="text-subtitle text-white mb-4">
                            {language === 'he' ? 'שפה' : 'Language'}
                        </h3>
                        <div className="flex space-x-4">
                            <button
                                onClick={() => onLanguageChange('he')}
                                className={`btn-modern flex-1 ${language === 'he' ? 'btn-primary' : 'btn-secondary'}`}
                            >
                                עברית
                            </button>
                            <button
                                onClick={() => onLanguageChange('en')}
                                className={`btn-modern flex-1 ${language === 'en' ? 'btn-primary' : 'btn-secondary'}`}
                            >
                                English
                            </button>
                        </div>
                    </div>

                    {/* UI Mode Selection */}
                    <div className="glass-card p-6">
                        <h3 className="text-subtitle text-white mb-4">
                            {language === 'he' ? 'מצב ממשק' : 'UI Mode'}
                        </h3>
                        <div className="flex space-x-4">
                            <button
                                onClick={() => onUiModeChange('simple')}
                                className={`btn-modern flex-1 ${uiMode === 'simple' ? 'btn-primary' : 'btn-secondary'}`}
                            >
                                {language === 'he' ? 'ממשק פשוט' : 'Simple UI'}
                            </button>
                            <button
                                onClick={() => onUiModeChange('advanced')}
                                className={`btn-modern flex-1 ${uiMode === 'advanced' ? 'btn-primary' : 'btn-secondary'}`}
                            >
                                {language === 'he' ? 'ממשק מתקדם' : 'Advanced UI'}
                            </button>
                            <button
                                onClick={() => onUiModeChange('diamond')}
                                className={`btn-modern flex-1 ${uiMode === 'diamond' ? 'btn-primary' : 'btn-secondary'}`}
                            >
                                {language === 'he' ? 'ממשק יהלומים' : 'Diamond UI'}
                            </button>
                        </div>
                    </div>

                    {/* Additional Settings */}
                    <div className="glass-card p-6">
                        <h3 className="text-subtitle text-white mb-4">
                            {language === 'he' ? 'הגדרות נוספות' : 'Additional Settings'}
                        </h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-body text-white">
                                    {language === 'he' ? 'הצג הודעות שגיאה מפורטות' : 'Show detailed error messages'}
                                </span>
                                <input type="checkbox" className="toggle" defaultChecked />
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-body text-white">
                                    {language === 'he' ? 'הצג התראות' : 'Show notifications'}
                                </span>
                                <input type="checkbox" className="toggle" defaultChecked />
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-body text-white">
                                    {language === 'he' ? 'שמור היסטוריית סריקה' : 'Save scan history'}
                                </span>
                                <input type="checkbox" className="toggle" defaultChecked />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
