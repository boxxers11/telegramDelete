import { extractTelegramLinks, uniqueLinks } from './linkExtractor';
import { globalJoinQueue } from './joinQueue';
import { fetchGroups, refreshGroups, joinByLinks, leaveChats } from './telegram/mtproto';
import type { GroupRecord, JoinRequestResult, LeaveResult } from '../types/groups';

export interface JoinLinksResponse {
  queued: number;
  results: JoinRequestResult[];
}

export interface LeaveGroupsResponse {
  results: LeaveResult[];
}

export interface GroupsSnapshot {
  groups: GroupRecord[];
  synced_at?: string | null;
}

export const groupsRepo = {
  async list(accountId: string): Promise<GroupsSnapshot> {
    return fetchGroups(accountId);
  },

  async refresh(accountId: string): Promise<GroupsSnapshot> {
    await refreshGroups(accountId);
    return fetchGroups(accountId);
  },

  async joinFromText(accountId: string, text: string): Promise<JoinLinksResponse> {
    const extracted = uniqueLinks(extractTelegramLinks(text));
    if (extracted.length === 0) {
      return { queued: 0, results: [] };
    }

    // Send all links together in one request (background task with SSE)
    const allLinks = extracted.map((item) => item.raw);

    // The endpoint now returns immediately and processes in background
    // Results will come via SSE, so we return empty results here
    const result = await globalJoinQueue.enqueue('batch', async () =>
      joinByLinks(accountId, allLinks)
      );

    return {
      queued: extracted.length,
      results: result || []
    };
  },

  async joinLinks(accountId: string, links: string[]): Promise<JoinRequestResult[]> {
    return joinByLinks(accountId, links);
  },

  async leave(accountId: string, chatIds: string[]): Promise<LeaveGroupsResponse> {
    const results = await leaveChats(accountId, chatIds);
    return { results };
  }
};
