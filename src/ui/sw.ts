/**
 * Service Worker anmelden und eine wartende neue Version melden. Die App lädt nie von
 * selbst neu (mitten in einer Sitzung wäre das störend); der Hinweis bietet es an.
 */

type Listener = (waiting: boolean) => void;
let waitingWorker: ServiceWorker | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l(!!waitingWorker);
}

export function onUpdateAvailable(l: Listener): () => void {
  listeners.add(l);
  l(!!waitingWorker);
  return () => listeners.delete(l);
}

export function applyUpdate(): void {
  if (!waitingWorker) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waitingWorker.postMessage('SKIP_WAITING');
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = w;
            notify();
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingWorker = reg.waiting;
        notify();
      }
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      // Beim Zurückkehren in die App nach Updates schauen.
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void reg.update().catch(() => undefined));
    } catch {
      // Ohne Service Worker läuft die App trotzdem, nur nicht offline.
    }
  });
}

/** Bittet den Browser, die Daten nicht bei Platzmangel zu löschen. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
