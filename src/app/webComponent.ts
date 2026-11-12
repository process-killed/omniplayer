/**
 * `<omni-play>` — a custom element so frameworks can drop the player in with
 * plain HTML:
 *
 *   <omni-play src="https://host/video.mp4" autoplay muted title="Episode 1"></omni-play>
 *
 * It is a thin wrapper around `OmniPlay.mount`, so every attribute maps to an
 * embed parameter and every method/property is forwarded to the controller.
 */
import { mount, type MountOptions, type MountedPlayer, type PlayerEvent } from './embedApi';

const ATTRS: Array<[string, keyof MountOptions]> = [
  ['src', 'src'],
  ['title', 'title'],
  ['poster', 'poster'],
  ['subtitle', 'subtitle'],
  ['accent', 'accent'],
  ['start', 'start'],
  ['autoplay', 'autoplay'],
  ['muted', 'muted'],
  ['loop', 'loop'],
  ['controls', 'controls'],
];

export class OmniPlayElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ATTRS.map(([attr]) => attr);
  }

  private player: MountedPlayer | null = null;
  private handlers = new Set<(event: PlayerEvent) => void>();

  connectedCallback(): void {
    this.style.display = this.style.display || 'block';
    this.render();
  }

  disconnectedCallback(): void {
    this.player?.destroy();
    this.player = null;
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.render();
  }

  private options(): MountOptions {
    const options: MountOptions = { src: this.getAttribute('src') ?? '' };
    for (const [attr, key] of ATTRS) {
      if (attr === 'src') continue;
      const raw = this.getAttribute(attr);
      if (raw === null) continue;
      const target = options as unknown as Record<string, unknown>;
      if (key === 'autoplay' || key === 'muted' || key === 'loop') {
        target[key] = raw !== 'false' && raw !== '0';
      } else if (key === 'controls') {
        options.controls = raw !== 'false' && raw !== '0';
      } else if (key === 'start') {
        options.start = Number(raw) || 0;
      } else {
        target[key] = raw;
      }
    }
    return options;
  }

  private render(): void {
    if (!this.getAttribute('src')) return;
    this.player?.destroy();
    this.player = mount(this, this.options());
    this.player.on((event) => this.handlers.forEach((handler) => handler(event)));
  }

  play(): void {
    this.player?.play();
  }

  pause(): void {
    this.player?.pause();
  }

  seek(seconds: number): void {
    this.player?.seek(seconds);
  }

  setVolume(value: number): void {
    this.player?.setVolume(value);
  }

  setMuted(value: boolean): void {
    this.player?.setMuted(value);
  }

  setRate(value: number): void {
    this.player?.setRate(value);
  }

  load(src: string, start?: number): void {
    this.setAttribute('src', src);
    if (start !== undefined) this.setAttribute('start', String(start));
    this.player?.load(src, start);
  }

  on(handler: (event: PlayerEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  destroy(): void {
    this.player?.destroy();
    this.player = null;
    this.remove();
  }
}

export function defineOmniPlay(): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get('omni-play')) customElements.define('omni-play', OmniPlayElement);
}
