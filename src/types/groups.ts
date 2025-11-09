export type LifecycleStatus =
  | 'active'
  | 'pending'
  | 'waiting'
  | 'rejected'
  | 'failed'
  | 'left'
  | 'banned'
  | 'unknown';

export interface GroupRecord {
  id: string;
  platform: 'bot' | 'user';
  title?: string;
  username?: string;
  invite_link?: string;
  member_count?: number;
  my_status?: 'owner' | 'admin' | 'member' | 'restricted' | 'left' | 'banned';
  can_send?: boolean;
  slow_mode_delay?: number;
  is_forum?: boolean;
  linked_chat_id?: number;
  joined_at?: string;
  last_post_at?: string;
  sent_count_total: number;
  deleted_count_total: number;
  lifecycle_status: LifecycleStatus;
  metadata?: Record<string, unknown>;
  deleted_at?: string | null;
  last_status_change_at?: string | null;
  creates_join_request?: boolean;
  first_seen_at?: string | null;
  is_new?: boolean;
}

export interface JoinRequestResult {
  link: string;
  status: LifecycleStatus | 'joined' | 'requires_approval';
  info?: Record<string, unknown>;
}

export interface LeaveResult {
  chat_id: string;
  status: LifecycleStatus | 'processing';
  info?: Record<string, unknown>;
}
