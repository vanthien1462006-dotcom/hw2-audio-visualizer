import type { VisualizerOptions } from './contract.ts';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function requireContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Visualizer canvas has no 2D rendering context');
  }
  return context;
}

export function createVisualizer(options: VisualizerOptions): { start(): void; stop(): void } {
  const { canvas, analyser } = options;
  const context = requireContext2d(canvas);

  // Allocated once here; the frame loop reuses it and allocates nothing.
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  let width = 0;
  let height = 0;
  let frameId = 0;
  let running = false;

  // Reads canvas size and bar color. Called from start() and on resize, never per frame.
  function readCanvasStyle(): void {
    width = canvas.width;
    height = canvas.height;
    context.fillStyle = getComputedStyle(canvas).getPropertyValue('--bar-color').trim();
  }

  function draw(): void {
    analyser.getByteFrequencyData(buffer);
    context.clearRect(0, 0, width, height);
    const barWidth = width / buffer.length;
    for (let i = 0; i < buffer.length; i++) {
      const barHeight = (buffer[i] / 255) * height;
      context.fillRect(i * barWidth, height - barHeight, barWidth, barHeight);
    }
  }

  function frame(): void {
    draw();
    frameId = requestAnimationFrame(frame);
  }

  function start(): void {
    if (running) {
      return;
    }
    running = true;
    readCanvasStyle();
    window.addEventListener('resize', readCanvasStyle);
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      draw();
      return;
    }
    frameId = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (frameId !== 0) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    window.removeEventListener('resize', readCanvasStyle);
    running = false;
  }

  return { start, stop };
}
