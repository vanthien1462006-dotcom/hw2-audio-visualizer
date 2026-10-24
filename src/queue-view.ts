import type { QueueEntry } from './contract.ts';

export function trackName(trackUrl: string): string {
  return trackUrl.slice(trackUrl.lastIndexOf('/') + 1);
}

export function renderQueue(listEl: HTMLOListElement, entries: QueueEntry[]): void {
  const items = entries.map((entry) => {
    const item = document.createElement('li');
    item.textContent = `${trackName(entry.trackUrl)}: ${entry.status}`;
    return item;
  });
  listEl.replaceChildren(...items);
}
