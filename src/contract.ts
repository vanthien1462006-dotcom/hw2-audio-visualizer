export type AudioTask = (trackUrl: string, signal: AbortSignal) => Promise<AudioBuffer>;

export interface AudioTaskQueueOptions {
  readonly maxConcurrent: number;
  readonly work: AudioTask;
}

export interface VisualizerOptions {
  readonly canvas: HTMLCanvasElement;
  readonly analyser: AnalyserNode;
}

export type TrackStatus = 'queued' | 'loading' | 'ready' | 'cancelled' | 'error';

export interface QueueEntry {
  readonly trackUrl: string;
  readonly status: TrackStatus;
}
