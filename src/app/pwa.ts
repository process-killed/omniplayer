import { Emitter } from '../utils/emitter';
import { log } from '../utils/log';

export type PwaState = 'unsupported' | 'installable' | 'installed' | 'ios-manual';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaEvents {
  state: { state: PwaState };
  update: { ready: boolean };
  offline: { offline: boolean };
}

/**
 * Installability and updates.
 *
 * Chrome/Edge fire `beforeinstallprompt`; Safari has no API, so iOS users get
 * exact Share → Add to Home Screen steps instead of a button that cannot work.
 */
class PwaManager extends Emitter<PwaEvents> {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private stateValue: PwaState = 'unsupported';
  private registration: ServiceWorkerRegistration | null = null;
  private updateReady = false;
  private reloading = false;
  private started = false;

  get state(): PwaState {
    return this.stateValue;
  }

  get canInstall(): boolean {
    return this.stateValue === 'installable';
  }

  get hasUpdate(): boolean {
    return this.updateReady;
  }

  get isStandalone(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }

  get isIOS(): boolean {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    if (this.isStandalone) {
      this.setState('installed');
    } else if (this.isIOS) {
      this.setState('ios-manual');
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.setState('installable');
      log.info('PWA install prompt available');
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.setState('installed');
    });

    window.addEventListener('online', () => this.emit('offline', { offline: false }));
    window.addEventListener('offline', () => this.emit('offline', { offline: true }));

    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      // The app may boot after the load event (IndexedDB is awaited first), so
      // register immediately when the document is already complete.
      if (document.readyState === 'complete') {
        void this.registerServiceWorker();
      } else {
        window.addEventListener('load', () => void this.registerServiceWorker(), { once: true });
      }
    }
  }

  private setState(state: PwaState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.emit('state', { state });
  }

  private async registerServiceWorker(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      this.registration = registration;

      const track = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            this.updateReady = true;
            this.emit('update', { ready: true });
          }
        });
      };

      if (registration.waiting && navigator.serviceWorker.controller) {
        this.updateReady = true;
        this.emit('update', { ready: true });
      }
      track(registration.installing);
      registration.addEventListener('updatefound', () => track(registration.installing));

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!this.reloading) return;
        window.location.reload();
      });

      // Check for a new build when the tab regains focus.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
      });
    } catch (error) {
      log.warn('service worker registration failed', error);
    }
  }

  async checkForUpdate(): Promise<boolean> {
    if (!this.registration) return false;
    try {
      await this.registration.update();
      return this.updateReady || !!this.registration.waiting;
    } catch {
      return false;
    }
  }

  async applyUpdate(): Promise<void> {
    const waiting = this.registration?.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    this.reloading = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // Fallback in case controllerchange never fires.
    window.setTimeout(() => window.location.reload(), 1500);
  }

  /**
   * @returns what happened, so the UI can show the right follow-up.
   */
  async install(): Promise<'accepted' | 'dismissed' | 'ios' | 'installed' | 'unavailable'> {
    if (this.stateValue === 'installed') return 'installed';
    if (this.stateValue === 'ios-manual') return 'ios';
    const prompt = this.deferredPrompt;
    if (!prompt) return 'unavailable';
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      this.deferredPrompt = null;
      if (choice.outcome === 'accepted') {
        this.setState('installed');
        return 'accepted';
      }
      this.setState('installable');
      return 'dismissed';
    } catch (error) {
      log.warn('install prompt failed', error);
      return 'unavailable';
    }
  }

  async requestPersistentStorage(): Promise<boolean> {
    try {
      if (!navigator.storage?.persist) return false;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
}

export const pwa = new PwaManager();
