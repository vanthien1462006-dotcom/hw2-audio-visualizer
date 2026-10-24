import type { AudioTask, QueueEntry, TrackStatus } from './contract.ts';
import { createAudioEngine } from './audio-engine.ts';
import { AudioTaskQueue } from './fifo-queue.ts';
import { renderQueue, trackName } from './queue-view.ts';
import { createVisualizer } from './visualizer.ts';

const DEFAULT_MAX_CONCURRENT = 2;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Required element is missing: ${selector}`);
  }
  return element;
}

const trackList = requireElement<HTMLUListElement>('section[aria-labelledby="tracks-heading"] ul');
const queueList = requireElement<HTMLOListElement>('#queue-list');
const playButton = requireElement<HTMLButtonElement>('#play-btn');
const pauseButton = requireElement<HTMLButtonElement>('#pause-btn');
const stopButton = requireElement<HTMLButtonElement>('#stop-btn');
const playerStatus = requireElement<HTMLParagraphElement>('#player-status');
const canvas = requireElement<HTMLCanvasElement>('#visualizer');

// data-max-concurrent is read from the DOM. Missing or invalid values fall back to 2.
const rawMaxConcurrent = Number(queueList.dataset.maxConcurrent);
const maxConcurrent =
  Number.isInteger(rawMaxConcurrent) && rawMaxConcurrent >= 1 ? rawMaxConcurrent : DEFAULT_MAX_CONCURRENT;

const engine = createAudioEngine();
const visualizer = createVisualizer({ canvas, analyser: engine.analyser });

// Status of every track clicked so far, in click order.
let entries: QueueEntry[] = [];
// Most recently decoded track; Play plays this buffer.
let latestReady: { name: string; buffer: AudioBuffer } | null = null;

const work: AudioTask = async (trackUrl, signal) => {
  setStatus(trackUrl, 'loading');
  return engine.fetchAndDecode(trackUrl, signal);
};
const queue = new AudioTaskQueue({ maxConcurrent, work });

function setStatus(trackUrl: string, status: TrackStatus): void {
  const next: QueueEntry = { trackUrl, status };
  const index = entries.findIndex((entry) => entry.trackUrl === trackUrl);
  entries = index === -1 ? [...entries, next] : entries.map((entry, i) => (i === index ? next : entry));
  renderQueue(queueList, entries);
}

function setPlayerStatus(message: string): void {
  playerStatus.textContent = message;
}

function isInFlight(trackUrl: string): boolean {
  const entry = entries.find((item) => item.trackUrl === trackUrl);
  return entry !== undefined && (entry.status === 'queued' || entry.status === 'loading');
}

// One listener on the track list handles every track button (event delegation).
trackList.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  const button = event.target.closest('button');
  const trackUrl = button?.dataset.trackUrl;
  if (trackUrl === undefined || isInFlight(trackUrl)) {
    return;
  }
  setStatus(trackUrl, 'queued');
  queue.enqueue(trackUrl).then(
    (buffer) => {
      latestReady = { name: trackName(trackUrl), buffer };
      setStatus(trackUrl, 'ready');
      setPlayerStatus(`${trackName(trackUrl)} is ready. Press Play.`);
    },
    (error: unknown) => {
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      setStatus(trackUrl, cancelled ? 'cancelled' : 'error');
      setPlayerStatus(`Could not load ${trackName(trackUrl)}.`);
    },
  );
});

playButton.addEventListener('click', () => {
  // resume() is called synchronously inside the click, so the browser treats it as a user gesture.
  engine.resume().then(
    () => {
      if (latestReady === null) {
        setPlayerStatus('No track is ready yet.');
        return;
      }
      engine.play(latestReady.buffer);
      visualizer.start();
      setPlayerStatus(`Playing ${latestReady.name}.`);
    },
    () => {
      setPlayerStatus('The browser did not allow audio to start.');
    },
  );
});

// The engine has no pause position, so Pause stops playback the same way Stop does.
pauseButton.addEventListener('click', () => {
  engine.stop();
  visualizer.stop();
  setPlayerStatus('Paused. Press Play to start the latest track again.');
});

stopButton.addEventListener('click', () => {
  engine.stop();
  visualizer.stop();
  setPlayerStatus('Stopped.');
});

window.addEventListener('pagehide', () => {
  queue.dispose();
  visualizer.stop();
  engine.dispose();
});
