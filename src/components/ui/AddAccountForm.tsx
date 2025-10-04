import React, { useState } from 'react';
import { Loader, X } from 'lucide-react';

interface AddAccountFormProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (accountData: {
        label: string;
        api_id: string;
        api_hash: string;
        phone: string;
    }) => Promise<{ success: boolean; error?: string }>;
    loading: boolean;
}

const AddAccountForm: React.FC<AddAccountFormProps> = ({
    isOpen,
    onClose,
    onAdd,
    loading
}) => {
    const [formData, setFormData] = useState({
        label: '',
        api_id: '',
        api_hash: '',
        phone: ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const result = await onAdd(formData);
        if (result.success) {
            setFormData({ label: '', api_id: '', api_hash: '', phone: '' });
            onClose();
        }
    };

    const handleClose = () => {
        setFormData({ label: '', api_id: '', api_hash: '', phone: '' });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="max-w-2xl mx-auto mb-8">
            <div className="glass-elevated p-8">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-title text-white">Add New Account</h2>
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-white"
                        disabled={loading}
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-caption font-medium text-white mb-2">
                            Account Label
                        </label>
                        <input
                            type="text"
                            value={formData.label}
                            onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
                            className="input-modern w-full"
                            placeholder="e.g., Personal, Work"
                            required
                            disabled={loading}
                        />
                    </div>
                    
                    <div>
                        <label className="block text-caption font-medium text-white mb-2">
                            API ID
                        </label>
                        <input
                            type="number"
                            value={formData.api_id}
                            onChange={(e) => setFormData(prev => ({ ...prev, api_id: e.target.value }))}
                            className="input-modern w-full"
                            placeholder="Your API ID from my.telegram.org"
                            required
                            disabled={loading}
                        />
                    </div>
                    
                    <div>
                        <label className="block text-caption font-medium text-white mb-2">
                            API Hash
                        </label>
                        <input
                            type="text"
                            value={formData.api_hash}
                            onChange={(e) => setFormData(prev => ({ ...prev, api_hash: e.target.value }))}
                            className="input-modern w-full"
                            placeholder="Your API Hash from my.telegram.org"
                            required
                            disabled={loading}
                        />
                    </div>
                    
                    <div>
                        <label className="block text-caption font-medium text-white mb-2">
                            Phone Number
                        </label>
                        <input
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                            className="input-modern w-full"
                            placeholder="+1234567890"
                            required
                            disabled={loading}
                        />
                    </div>
                    
                    <div className="flex space-x-4">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="btn-secondary flex-1"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary flex-1 flex items-center justify-center"
                        >
                            {loading ? <Loader className="w-4 h-4 animate-spin mr-2" /> : null}
                            Add Account
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddAccountForm;
