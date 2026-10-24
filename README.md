# Audio Queue Visualizer

A concurrent FIFO audio queue with an FFT 512 visualizer. Tracks are loaded and decoded through a queue with a concurrency limit. The playing track is drawn on a canvas from an `AnalyserNode` (`fftSize` 512, 256 frequency bins). The project uses Vite and vanilla TypeScript in strict mode, with no runtime dependencies.

## Requirements

- Node.js 22.18 or later. The test runner and `tools/generate-tracks.ts` run TypeScript files directly through Node's type stripping. The project was tested with Node.js v24.14.1.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Do not open `index.html` directly from disk. The page loads its script as an ES module and fetches the track files over HTTP. Browsers block both from a `file://` page, so the app must be served. Vite serves it for you.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the dev server at http://localhost:5173 |
| `npm run build` | Type-checks with `tsc`, then bundles into `dist/` |
| `npm run preview` | Serves `dist/` at http://localhost:4173. Run `npm run build` first. |
| `npm test` | Runs `node --test "src/**/*.test.ts"` |

## Sample tracks

The app ships four sample tracks in `public/assets/tracks/` (`track-1.wav` to `track-4.wav`). No download is needed.

To regenerate them:

```bash
node tools/generate-tracks.ts
```

Each file is mono, 16-bit PCM, 44.1 kHz and 8 seconds long. It contains a sine tone at 220, 330, 440 or 523 Hz, with a 0.05 s fade-in and a 0.2 s fade-out so that playback has no click. The script writes only to `public/assets/tracks/` and uses no randomness.

## Design

### Queue (`src/fifo-queue.ts`)

- `AudioTaskQueue` starts tasks in FIFO order. At most `maxConcurrent` tasks run at the same time.
- The limit comes from `data-max-concurrent="2"` on `#queue-list`. If the value is missing or invalid, the app uses 2.
- `enqueue(trackUrl)` returns a promise for the decoded `AudioBuffer`. Enqueuing a track that is already queued or loading throws an error.
- Each task has its own `AbortController`. Cancellation works as follows:
  - `cancel(trackUrl)` on a queued track removes it from the queue. The task's work never runs, and its promise rejects with `AbortError`.
  - `cancel(trackUrl)` on a running track aborts its signal and rejects its promise with `AbortError` at once. Its concurrency slot is released only when its work settles. A decode that cannot be cancelled still uses CPU and memory, so this keeps the number of running tasks within `maxConcurrent`.
- If a task fails, only that task's promise rejects. The queue keeps running the next tasks.
- `dispose()` aborts all tasks, rejects every pending promise and blocks new work.

### Why the signal is checked after each `await`

`decodeAudioData` cannot be cancelled. Once it starts, it runs to completion. The engine therefore checks `signal.aborted` after `fetch`, after `arrayBuffer()` and after `decodeAudioData`. If the task was cancelled, the engine throws `AbortError` and drops the buffer. Before reading the body, it also checks `response.ok`.

### Track URLs

Track URLs come from `data-track-url` attributes, so the engine treats them as untrusted. It resolves each URL against the page and accepts it only when the origin matches the page and the path starts with `/assets/tracks/`. Anything else is rejected before any fetch, including other origins, `javascript:` and `data:` URLs, and paths outside that prefix.

### Visualizer (`src/visualizer.ts`)

- The frame loop uses `requestAnimationFrame`. It reuses one `Uint8Array` allocated at startup, reads no layout and draws one bar per frequency bin with `fillRect`.
- Bar color comes from the `--bar-color` token in `src/css/tokens.css`. The color is read once in `start()`.
- With `prefers-reduced-motion: reduce`, no animation loop runs. The visualizer draws one static frame when it starts.

### Cleanup

Every resource has a stop path:

- **Source nodes:** `stop()` stops the current `AudioBufferSourceNode`, disconnects it and clears its `onended` handler. A source that ends on its own disconnects itself.
- **Animation frames:** `stop()` cancels the pending `requestAnimationFrame` id.
- **Listeners:** the canvas `resize` listener is removed in `stop()`. The `pagehide` listener on `window` disposes the queue, the visualizer and the engine.
- **AudioContext:** `dispose()` closes it.
- **Queue:** `dispose()` aborts running and queued tasks.

## Dependencies

The project has exactly two dev dependencies, `vite` and `typescript`, and no runtime dependencies. It loads nothing from a CDN, and it uses no external fonts, images or scripts.

## Known limits

- `decodeAudioData` cannot be cancelled. A cancelled decode finishes in the background, its result is discarded, and its concurrency slot stays in use until it finishes.
- The visualizer draws simple bars: one bar per frequency bin, with no smoothing and no logarithmic scale.
- Pause stops playback. The engine keeps no pause position, so Play starts the latest ready track again from the beginning.
- Track URL validation checks the origin and the path prefix. It does not reject query strings or fragments.
- `tsconfig.json` excludes `src/**/*.test.ts`, so `npm run build` does not type-check the test files. The tests run through Node's type stripping.

## Measurements

These values are not recorded yet. The person who runs the checks fills in the results. Leave a cell empty until a measurement exists.

| Check | How to measure | Result |
| --- | --- | --- |
| Frame rate during playback | DevTools Performance panel, recording while a track plays | |
| `Layout` events repeated inside the frame loop | DevTools Performance panel, while a track plays | |
| Frame loop stops after Stop | DevTools Performance panel, after pressing Stop | |
| Heap after repeated play and stop cycles | DevTools Memory panel, heap snapshots before and after | |
| Console errors during normal use | DevTools Console | |
| Lighthouse | Lighthouse in DevTools | |
