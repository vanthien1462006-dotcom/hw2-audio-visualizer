import type { AudioTask, AudioTaskQueueOptions } from './contract.ts';

interface Entry {
  readonly trackUrl: string;
  readonly controller: AbortController;
  readonly resolve: (buffer: AudioBuffer) => void;
  readonly reject: (error: unknown) => void;
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

export class AudioTaskQueue {
  private readonly maxConcurrent: number;
  private readonly work: AudioTask;
  // Queued and running entries, keyed by track URL.
  private readonly entries = new Map<string, Entry>();
  // Queued entries in FIFO order.
  private readonly waiting: Entry[] = [];
  private running = 0;
  private disposed = false;

  constructor(options: AudioTaskQueueOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new RangeError(`maxConcurrent must be an integer of at least 1, got ${options.maxConcurrent}`);
    }
    this.maxConcurrent = options.maxConcurrent;
    this.work = options.work;
  }

  enqueue(trackUrl: string): Promise<AudioBuffer> {
    if (this.disposed) {
      throw new Error('AudioTaskQueue is disposed');
    }
    if (this.entries.has(trackUrl)) {
      throw new Error(`Track is already queued or loading: ${trackUrl}`);
    }
    return new Promise<AudioBuffer>((resolve, reject) => {
      const entry: Entry = { trackUrl, controller: new AbortController(), resolve, reject };
      this.entries.set(trackUrl, entry);
      this.waiting.push(entry);
      this.processNext();
    });
  }

  cancel(trackUrl: string): boolean {
    const entry = this.entries.get(trackUrl);
    if (entry === undefined) {
      return false;
    }
    this.entries.delete(trackUrl);
    const queuedIndex = this.waiting.indexOf(entry);
    if (queuedIndex === -1) {
      entry.controller.abort();
    } else {
      this.waiting.splice(queuedIndex, 1);
    }
    entry.reject(abortError('Cancelled'));
    return true;
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      entry.reject(abortError('Queue disposed'));
    }
    this.entries.clear();
    this.waiting.splice(0);
  }

  private processNext(): void {
    while (!this.disposed && this.running < this.maxConcurrent) {
      const entry = this.waiting.shift();
      if (entry === undefined) {
        return;
      }
      this.running += 1;
      void this.run(entry);
    }
  }

  private async run(entry: Entry): Promise<void> {
    try {
      const buffer = await this.work(entry.trackUrl, entry.controller.signal);
      // decodeAudioData cannot be aborted, so a late result is dropped here.
      if (entry.controller.signal.aborted) {
        throw abortError('Cancelled');
      }
      entry.resolve(buffer);
    } catch (error: unknown) {
      entry.reject(error);
    } finally {
      // The slot is released only after work settles, so cancelled work still counts as running.
      this.running -= 1;
      if (this.entries.get(entry.trackUrl) === entry) {
        this.entries.delete(entry.trackUrl);
      }
      this.processNext();
    }
  }
}
