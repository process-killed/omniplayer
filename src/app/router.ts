import type { RouteName } from '../types';
import { Emitter } from '../utils/emitter';

export interface RouteState {
  name: RouteName;
  params: Record<string, string>;
}

const VALID: RouteName[] = ['home', 'open', 'url', 'player', 'embed', 'share', 'torrents', 'downloads', 'developers', 'playlist', 'history', 'bookmarks', 'settings', 'diagnostics', 'about'];

/** Hash router — works from any static host, no server rewrites needed. */
export class Router extends Emitter<{ change: RouteState }> {
  private currentState: RouteState = { name: 'home', params: {} };

  constructor() {
    super();
    window.addEventListener('hashchange', () => this.sync());
    this.sync();
  }

  get current(): RouteState {
    return this.currentState;
  }

  private parse(hash: string): RouteState {
    const clean = hash.replace(/^#\/?/, '');
    const [path, query = ''] = clean.split('?');
    const name = (VALID as string[]).includes(path) ? (path as RouteName) : 'home';
    const params: Record<string, string> = {};
    new URLSearchParams(query).forEach((value, key) => {
      params[key] = value;
    });
    return { name, params };
  }

  private sync(): void {
    const next = this.parse(location.hash);
    if (next.name === this.currentState.name && JSON.stringify(next.params) === JSON.stringify(this.currentState.params)) {
      return;
    }
    this.currentState = next;
    this.emit('change', next);
  }

  navigate(name: RouteName, params: Record<string, string> = {}, replace = false): void {
    const query = new URLSearchParams(params).toString();
    const hash = `#/${name}${query ? `?${query}` : ''}`;
    if (location.hash === hash) {
      this.currentState = { name, params };
      this.emit('change', this.currentState);
      return;
    }
    if (replace) {
      history.replaceState(null, '', hash);
      this.currentState = { name, params };
      this.emit('change', this.currentState);
    } else {
      location.hash = hash;
    }
  }

  back(fallback: RouteName = 'home'): void {
    if (history.length > 1) history.back();
    else this.navigate(fallback);
  }
}
