import React, { useState } from 'react';
import { Loader, X } from 'lucide-react';
import { LoginData } from '../../hooks/useAccounts';

interface LoginModalProps {
    data: LoginData | null;
    onClose: () => void;
    onVerify: (code: string, password?: string) => Promise<{ success: boolean; error?: string }>;
    loading: boolean;
}

const LoginModal: React.FC<LoginModalProps> = ({
    data,
    onClose,
    onVerify,
    loading
}) => {
    const [verificationCode, setVerificationCode] = useState('');
    const [twoFactorPassword, setTwoFactorPassword] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const result = await onVerify(verificationCode, twoFactorPassword);
        if (result.success) {
            setVerificationCode('');
            setTwoFactorPassword('');
            onClose();
        }
    };

    const handleClose = () => {
        setVerificationCode('');
        setTwoFactorPassword('');
        onClose();
    };

    if (!data) return null;

    return (
        <div className="max-w-md mx-auto mb-8">
            <div className="glass-elevated p-8">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-title text-white">Verify Your Account</h3>
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-white"
                        disabled={loading}
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-caption font-medium text-white mb-2">
                            Verification Code
                        </label>
                        <input
                            type="text"
                            value={verificationCode}
                            onChange={(e) => setVerificationCode(e.target.value)}
                            className="input-modern w-full"
                            placeholder="Enter 5-digit code"
                            maxLength={5}
                            required
                            disabled={loading}
                        />
                    </div>
                    
                    {data.needs2FA && (
                        <div>
                            <label className="block text-caption font-medium text-white mb-2">
                                2FA Password
                            </label>
                            <input
                                type="password"
                                value={twoFactorPassword}
                                onChange={(e) => setTwoFactorPassword(e.target.value)}
                                className="input-modern w-full"
                                placeholder="Enter your 2FA password"
                                required
                                disabled={loading}
                            />
                        </div>
                    )}
                    
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
                            disabled={loading || !verificationCode}
                            className="btn-primary flex-1 flex items-center justify-center disabled:opacity-50"
                        >
                            {loading ? <Loader className="w-4 h-4 animate-spin mr-2" /> : null}
                            Verify
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default LoginModal;
