const TRACK_PATH_PREFIX = '/assets/tracks/';
const FFT_SIZE = 512;

export interface AudioEngine {
  readonly analyser: AnalyserNode;
  fetchAndDecode(url: string, signal: AbortSignal): Promise<AudioBuffer>;
  play(buffer: AudioBuffer): void;
  stop(): void;
  resume(): Promise<void>;
  dispose(): void;
}

// Track URLs come from the DOM, so they are untrusted: only same-origin track paths are allowed.
function resolveTrackUrl(url: string): URL {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin || !target.pathname.startsWith(TRACK_PATH_PREFIX)) {
    throw new Error(`Track URL is not allowed: ${url}`);
  }
  return target;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

export function createAudioEngine(): AudioEngine {
  // Created only when the app calls this function, never at module load.
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.connect(audioContext.destination);

  let currentSource: AudioBufferSourceNode | null = null;
  let disposed = false;

  async function fetchAndDecode(url: string, signal: AbortSignal): Promise<AudioBuffer> {
    if (disposed) {
      throw new Error('Audio engine is disposed');
    }
    const target = resolveTrackUrl(url);
    const response = await fetch(target.href, { signal });
    throwIfAborted(signal);
    if (!response.ok) {
      throw new Error(`Failed to load track: HTTP ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    throwIfAborted(signal);
    // decodeAudioData cannot be cancelled, so the signal is checked again after it resolves.
    const buffer = await audioContext.decodeAudioData(bytes);
    throwIfAborted(signal);
    return buffer;
  }

  function play(buffer: AudioBuffer): void {
    if (disposed) {
      return;
    }
    stop();
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.onended = () => {
      source.disconnect();
      if (currentSource === source) {
        currentSource = null;
      }
    };
    source.start();
    currentSource = source;
  }

  function stop(): void {
    if (currentSource === null) {
      return;
    }
    const source = currentSource;
    currentSource = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // stop() throws if the source has already stopped; the goal is met either way.
    }
    source.disconnect();
  }

  function resume(): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }
    return audioContext.resume();
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    stop();
    disposed = true;
    void audioContext.close();
  }

  return {
    get analyser() {
      return analyser;
    },
    fetchAndDecode,
    play,
    stop,
    resume,
    dispose,
  };
}
