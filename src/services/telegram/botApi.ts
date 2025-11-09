import type { GroupRecord } from '../../types/groups';

const notImplemented = () => {
  throw new Error('Bot API integration is not available in this build');
};

export const getChat = async (_chatId: string): Promise<GroupRecord> => {
  notImplemented();
};

export const getChatMemberCount = async (_chatId: string): Promise<number> => {
  notImplemented();
};

export const leaveChat = async (_chatId: string): Promise<void> => {
  notImplemented();
};

export const getChatAdministrators = async (_chatId: string) => {
  notImplemented();
};
