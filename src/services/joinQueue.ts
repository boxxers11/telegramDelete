type TaskRunner<T> = () => Promise<T>;

interface QueueItem<T> {
  run: TaskRunner<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  category: 'invite' | 'username';
}

interface JoinQueueOptions {
  inviteDelayMs?: number;
  usernameDelayMs?: number;
  floodWaitBackoffMs?: number;
}

const DEFAULT_OPTIONS: Required<JoinQueueOptions> = {
  inviteDelayMs: 5_000,
  usernameDelayMs: 2_000,
  floodWaitBackoffMs: 30_000
};

export class JoinQueue {
  private inviteQueue: QueueItem<unknown>[] = [];
  private usernameQueue: QueueItem<unknown>[] = [];
  private running = false;
  private options: Required<JoinQueueOptions>;

  constructor(options: JoinQueueOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  enqueue<T>(category: 'invite' | 'username', runner: TaskRunner<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = { run: runner, resolve, reject, category };
      if (category === 'invite') {
        this.inviteQueue.push(item);
      } else {
        this.usernameQueue.push(item);
      }
      this.processNext();
    });
  }

  clear() {
    this.inviteQueue = [];
    this.usernameQueue = [];
  }

  private async processNext() {
    if (this.running) {
      return;
    }

    const nextItem = this.inviteQueue.shift() ?? this.usernameQueue.shift();
    if (!nextItem) {
      return;
    }

    this.running = true;
    const delay =
      nextItem.category === 'invite'
        ? this.options.inviteDelayMs
        : this.options.usernameDelayMs;

    try {
      const result = await nextItem.run();
      nextItem.resolve(result);
      setTimeout(() => {
        this.running = false;
        this.processNext();
      }, delay);
    } catch (error: any) {
      if (error && error.code === 'FLOOD_WAIT' && error.waitSeconds) {
        const waitMs = Math.min(
          Math.max(Number(error.waitSeconds) * 1000, delay),
          this.options.floodWaitBackoffMs
        );
        setTimeout(() => {
          this.running = false;
          this.processNext();
        }, waitMs);
      } else {
        nextItem.reject(error);
        this.running = false;
        this.processNext();
      }
    }
  }
}

export const globalJoinQueue = new JoinQueue();
