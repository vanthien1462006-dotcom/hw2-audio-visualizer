import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AudioTaskQueue } from './fifo-queue.ts';

interface Call {
  readonly trackUrl: string;
  readonly signal: AbortSignal;
  settled: boolean;
  resolve: (buffer: AudioBuffer) => void;
  reject: (error: unknown) => void;
}

function createControlledWork() {
  const calls: Call[] = [];
  const work = (trackUrl: string, signal: AbortSignal): Promise<AudioBuffer> =>
    new Promise<AudioBuffer>((resolve, reject) => {
      const call: Call = {
        trackUrl,
        signal,
        settled: false,
        resolve: (buffer) => {
          call.settled = true;
          resolve(buffer);
        },
        reject: (error) => {
          call.settled = true;
          reject(error);
        },
      };
      calls.push(call);
    });
  return { calls, work };
}

function unsettled(calls: Call[]): Call[] {
  return calls.filter((call) => !call.settled);
}

function fakeBuffer(id: string): AudioBuffer {
  return { id } as unknown as AudioBuffer;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('AudioTaskQueue', () => {
  it('never runs more than maxConcurrent tasks at once', { timeout: 2000 }, async () => {
    const { calls, work } = createControlledWork();
    const queue = new AudioTaskQueue({ maxConcurrent: 2, work });
    const urls = ['a', 'b', 'c', 'd', 'e'];
    const results = urls.map((url) => queue.enqueue(url));

    for (let finished = 0; finished < urls.length; finished++) {
      await tick();
      const active = unsettled(calls);
      assert.ok(active.length <= 2, `running tasks: ${active.length}`);
      assert.equal(active.length, Math.min(2, urls.length - finished));
      active[0].resolve(fakeBuffer(active[0].trackUrl));
    }

    assert.deepEqual(await Promise.all(results), urls.map((url) => fakeBuffer(url)));
  });

  it('starts tasks in FIFO order', { timeout: 2000 }, async () => {
    const { calls, work } = createControlledWork();
    const queue = new AudioTaskQueue({ maxConcurrent: 1, work });
    const urls = ['a', 'b', 'c', 'd'];
    const results = urls.map((url) => queue.enqueue(url));

    for (let i = 0; i < urls.length; i++) {
      await tick();
      assert.equal(calls.length, i + 1);
      assert.equal(calls[i].trackUrl, urls[i]);
      calls[i].resolve(fakeBuffer(urls[i]));
    }

    await Promise.all(results);
  });

  it('never calls work for a queued task that was cancelled', { timeout: 2000 }, async () => {
    const { calls, work } = createControlledWork();
    const queue = new AudioTaskQueue({ maxConcurrent: 1, work });
    const first = queue.enqueue('a');
    const second = queue.enqueue('b');
    const third = queue.enqueue('c');

    assert.equal(queue.cancel('b'), true);
    const secondRejected = assert.rejects(second, { name: 'AbortError' });

    await tick();
    calls[0].resolve(fakeBuffer('a'));
    await first;
    await tick();
    assert.deepEqual(calls.map((call) => call.trackUrl), ['a', 'c']);

    calls[1].resolve(fakeBuffer('c'));
    await third;
    await secondRejected;
  });

  it('aborts the signal of a running task when it is cancelled', { timeout: 2000 }, async () => {
    const { calls, work } = createControlledWork();
    const queue = new AudioTaskQueue({ maxConcurrent: 1, work });
    const pending = queue.enqueue('a');
    const rejected = assert.rejects(pending, { name: 'AbortError' });

    await tick();
    assert.equal(calls[0].signal.aborted, false);
    assert.equal(queue.cancel('a'), true);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(queue.cancel('a'), false);

    await rejected;
  });

  it('drops a late result of a cancelled task and keeps its slot until work settles', { timeout: 2000 }, async () => {
    const { calls, work } = createControlledWork();
    const queue = new AudioTaskQueue({ maxConcurrent: 1, work });
    const cancelled = queue.enqueue('a');
    const cancelledRejected = assert.rejects(cancelled, { name: 'AbortError' });
    const next = queue.enqueue('b');

    await tick();
    assert.equal(queue.cancel('a'), true);
    await cancelledRejected;

    await tick();
    assert.equal(calls.length, 1);

    calls[0].resolve(fakeBuffer('a'));
    await tick();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].trackUrl, 'b');

    calls[1].resolve(fakeBuffer('b'));
    assert.deepEqual(await next, fakeBuffer('b'));
  });

  it('dispose rejects every pending promise and starts no new work', { timeout: 2000 }, async () => {
    const { calls, work } = createControlledWork();
    const queue = new AudioTaskQueue({ maxConcurrent: 1, work });
    const outcomes = Promise.allSettled([queue.enqueue('a'), queue.enqueue('b'), queue.enqueue('c')]);

    await tick();
    queue.dispose();
    queue.dispose();

    const settled = await outcomes;
    for (const result of settled) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason.name, 'AbortError');
    }
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(queue.cancel('a'), false);
    assert.throws(() => queue.enqueue('d'), /disposed/);

    calls[0].resolve(fakeBuffer('a'));
    await tick();
    assert.equal(calls.length, 1);
  });

  it('keeps running the queue after a task fails', { timeout: 2000 }, async () => {
    const { calls, work } = createControlledWork();
    const queue = new AudioTaskQueue({ maxConcurrent: 1, work });
    const failing = queue.enqueue('a');
    const next = queue.enqueue('b');
    const failingRejected = assert.rejects(failing, { message: 'decode failed' });

    await tick();
    calls[0].reject(new Error('decode failed'));
    await failingRejected;

    await tick();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].trackUrl, 'b');

    calls[1].resolve(fakeBuffer('b'));
    assert.deepEqual(await next, fakeBuffer('b'));
  });

  it('rejects an invalid maxConcurrent', () => {
    const work = () => new Promise<AudioBuffer>(() => undefined);
    assert.throws(() => new AudioTaskQueue({ maxConcurrent: 0, work }), RangeError);
    assert.throws(() => new AudioTaskQueue({ maxConcurrent: 1.5, work }), RangeError);
  });

  it('throws when a track is already queued or loading', { timeout: 2000 }, async () => {
    const { work } = createControlledWork();
    const queue = new AudioTaskQueue({ maxConcurrent: 1, work });
    const pending = queue.enqueue('a');
    const pendingRejected = assert.rejects(pending, { name: 'AbortError' });

    assert.throws(() => queue.enqueue('a'), /already queued or loading/);

    queue.dispose();
    await pendingRejected;
  });
});
