import type { RouteName } from '../types';
import { Router } from './router';
import { store } from './store';
import { Session } from './session';
import { el, esc, openModal, toast, toastAction } from '../ui/dom';
import { icon } from '../ui/icons';
import { library } from '../storage/library';
import { log } from '../utils/log';
import { pwa } from './pwa';
import { parseEmbedParams } from './embed';
import type { PageContext, PageInstance } from '../ui/pages/types';
import { createHomePage } from '../ui/pages/home';
import { createOpenPage } from '../ui/pages/open';
import { createUrlPage } from '../ui/pages/url';
import { createSharePage } from '../ui/pages/share';
import { createTorrentsPage } from '../ui/pages/torrents';
import { createDownloadsPage } from '../ui/pages/downloads';
import { createDevelopersPage } from '../ui/pages/developers';
import { createPlaylistPage } from '../ui/pages/playlist';
import { createHistoryPage } from '../ui/pages/history';
import { createBookmarksPage } from '../ui/pages/bookmarks';
import { createSettingsPage } from '../ui/pages/settings';
import { createDiagnosticsPage } from '../ui/pages/diagnostics';
import { createAboutPage } from '../ui/pages/about';
import { createPlayerPage } from '../ui/player/player';

interface NavItem {
  route: RouteName;
  label: string;
  iconName: string;
  badge?: () => number;
  group: 'main' | 'system';
}

const NAV: NavItem[] = [
  { route: 'home', label: 'Home', iconName: 'home', group: 'main' },
  { route: 'open', label: 'Open media', iconName: 'folderOpen', group: 'main' },
  { route: 'url', label: 'Play a link', iconName: 'link', group: 'main' },
  { route: 'playlist', label: 'Playlist', iconName: 'listVideo', badge: () => store.queue.length, group: 'main' },
  { route: 'history', label: 'History', iconName: 'clock', badge: () => library.history.length, group: 'main' },
  { route: 'bookmarks', label: 'Bookmarks', iconName: 'bookmark', badge: () => library.bookmarks.length, group: 'main' },
  { route: 'torrents', label: 'Torrents', iconName: 'cloud', group: 'main' },
  { route: 'downloads', label: 'Downloads', iconName: 'download', group: 'main' },
  { route: 'share', label: 'Embed & share', iconName: 'share', group: 'main' },
  { route: 'developers', label: 'For developers', iconName: 'code', group: 'main' },
  { route: 'diagnostics', label: 'Diagnostics', iconName: 'activity', group: 'system' },
  { route: 'settings', label: 'Settings', iconName: 'settings', group: 'system' },
  { route: 'about', label: 'About', iconName: 'info', group: 'system' },
];

const TITLES: Record<RouteName, string> = {
  home: 'Home',
  open: 'Open media',
  url: 'Play a link',
  player: 'Player',
  embed: 'Embed player',
  share: 'Embed & share',
  torrents: 'Torrents',
  downloads: 'Downloads',
  developers: 'For developers',
  playlist: 'Playlist',
  history: 'History',
  bookmarks: 'Bookmarks',
  settings: 'Settings',
  diagnostics: 'Diagnostics',
  about: 'About',
};

const MOBILE_TABS: Array<[RouteName, string, string]> = [
  ['home', 'Home', 'home'],
  ['open', 'Open', 'folderOpen'],
  ['url', 'Link', 'link'],
  ['playlist', 'Queue', 'listVideo'],
  ['settings', 'Settings', 'settings'],
];

/** Application shell: navigation, page mounting and global shortcuts. */
export class App {
  private readonly router = new Router();
  private readonly session: Session;
  private readonly ctx: PageContext;
  private readonly shell: HTMLElement;
  private readonly pageHost: HTMLElement;
  private readonly navHost: HTMLElement;
  private readonly topbarTitle: HTMLElement;
  private readonly tabbar: HTMLElement;
  private page: PageInstance | null = null;
  private playerPage: PageInstance | null = null;
  private scrim: HTMLElement | null = null;
  private offlineBar!: HTMLElement;
  private embedErrorNode: HTMLElement | null = null;
  private installPill!: HTMLElement;
  private lastRoute: RouteName | null = null;

  constructor(private readonly mountPoint: HTMLElement) {
    this.session = new Session(store, this.router);
    this.ctx = { store, router: this.router, session: this.session };

    this.shell = el('div', { class: 'shell' });
    this.shell.innerHTML = `
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand__mark">${icon('play', 20)}</div>
          <div>
            <div class="brand__name">OmniPlay</div>
            <div class="brand__sub">Universal player</div>
          </div>
        </div>
        <nav class="nav" id="nav"></nav>
        <div class="sidebar__foot">
          <button class="install-card hidden" id="install-app" type="button">
            <span class="install-card__icon">${icon('download', 16)}</span>
            <span class="install-card__text">
              <b>Install OmniPlay</b>
              <span>Runs offline in its own window</span>
            </span>
            <span class="install-card__go">${icon('chevronRight', 15)}</span>
          </button>
          <div class="privacy-pill">${icon('shield', 14)}<span>Everything plays on this device. No uploads, no accounts, no tracking.</span></div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn" id="menu-toggle" aria-label="Menu">${icon('list', 20)}</button>
          <div class="topbar__title" id="topbar-title">Home</div>
          <div class="topbar__spacer"></div>
          <div class="topbar__actions">
            <button class="btn btn--ghost btn--sm" id="quick-theme" aria-label="Change theme">${icon('palette', 16)}</button>
            <button class="btn btn--sm" id="quick-url">${icon('link', 15)} <span class="quick-label">Play a link</span></button>
            <button class="btn btn--primary btn--sm" id="quick-open">${icon('folderOpen', 15)} <span class="quick-label">Open media</span></button>
          </div>
        </header>
        <main id="main" class="page-host"></main>
      </div>
    `;
    this.pageHost = this.shell.querySelector('#main') as HTMLElement;
    this.navHost = this.shell.querySelector('#nav') as HTMLElement;
    this.topbarTitle = this.shell.querySelector('#topbar-title') as HTMLElement;

    this.tabbar = el('nav', { class: 'mobile-tabbar', 'aria-label': 'Primary' });
    this.tabbar.innerHTML = MOBILE_TABS.map(
      ([route, label, iconName]) =>
        `<button class="tab-item" data-route="${route}">${icon(iconName, 21)}<span>${esc(label)}</span></button>`,
    ).join('');

    this.offlineBar = el('div', { class: 'offline-bar hidden', role: 'status' });
    this.offlineBar.innerHTML = `${icon('wifi', 14)}<span>You are offline — local files and cached pages still work.</span>`;

    this.installPill = el('div', { class: 'install-pill hidden' });
    const installGo = el('button', { class: 'install-pill__go', type: 'button' });
    installGo.innerHTML = `${icon('download', 15)}<span>Install app</span>`;
    installGo.addEventListener('click', () => void this.runInstall());
    const installDismiss = el('button', { class: 'install-pill__x', type: 'button', 'aria-label': 'Dismiss install prompt' });
    installDismiss.innerHTML = icon('x', 14);
    installDismiss.addEventListener('click', () => {
      localStorage.setItem('omniplay:install-dismissed', '1');
      this.syncInstallPill();
    });
    this.installPill.append(installGo, installDismiss);

    this.mountPoint.append(this.offlineBar, this.shell, this.installPill, this.tabbar);

    this.wireShell();
    this.wirePwa();
    this.renderNav();
    this.router.on('change', (state) => this.render(state.name));
    this.render(this.router.current.name);

    library.on('history', () => this.renderNav());
    library.on('bookmarks', () => this.renderNav());
    library.on('playlists', () => this.renderNav());
    store.on('queue', () => this.renderNav());
    store.on('notice', ({ message, level }) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    });
  }

  private wireShell(): void {
    this.shell.querySelector('#quick-open')?.addEventListener('click', () => this.router.navigate('open'));
    this.shell.querySelector('#quick-url')?.addEventListener('click', () => this.router.navigate('url'));
    this.shell.querySelector('#quick-theme')?.addEventListener('click', () => {
      const order: Array<'dark' | 'light' | 'amoled'> = ['dark', 'light', 'amoled'];
      const next = order[(order.indexOf(store.settings.theme) + 1) % order.length];
      store.updateSettings({ theme: next });
    });
    this.shell.querySelector('#menu-toggle')?.addEventListener('click', () => this.openSidebar());

    this.tabbar.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-route]');
      if (!button) return;
      this.router.navigate(button.dataset.route as RouteName);
    });

    document.addEventListener('keydown', (event) => {
      if (this.router.current.name === 'player') return;
      const target = event.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'o' && !event.ctrlKey && !event.metaKey) this.router.navigate('open');
      if (event.key === 'l' && !event.ctrlKey && !event.metaKey) this.router.navigate('url');
      if (event.key === '/') {
        event.preventDefault();
        this.router.navigate('history');
      }
    });
  }

  private wirePwa(): void {
    pwa.start();

    const installButton = this.shell.querySelector<HTMLElement>('#install-app');
    const syncInstall = () => {
      if (!installButton) return;
      const show = pwa.state === 'installable' || pwa.state === 'ios-manual';
      installButton.classList.toggle('hidden', !show);
      const label = installButton.querySelector('b');
      const sub = installButton.querySelector('.install-card__text span');
      if (label) label.textContent = pwa.state === 'ios-manual' ? 'Add to Home Screen' : 'Install OmniPlay';
      if (sub) sub.textContent = pwa.state === 'ios-manual' ? 'Safari: Share → Add to Home Screen' : 'Runs offline in its own window';
    };
    syncInstall();
    pwa.on('state', () => {
      syncInstall();
      this.syncInstallPill();
    });

    installButton?.addEventListener('click', () => void this.runInstall());
    this.syncInstallPill();

    pwa.on('update', ({ ready }) => {
      if (!ready) return;
      toastAction('A new version of OmniPlay is ready.', 'Reload', () => void pwa.applyUpdate());
    });

    const syncOffline = () => this.offlineBar.classList.toggle('hidden', navigator.onLine);
    pwa.on('offline', syncOffline);
    syncOffline();
    if (!navigator.onLine) this.offlineBar.classList.remove('hidden');
  }

  /** Phone-first install nudge: visible on the library screen only. */
  private syncInstallPill(): void {
    if (!this.installPill) return;
    const dismissed = localStorage.getItem('omniplay:install-dismissed') === '1';
    const compact = window.matchMedia('(max-width: 860px)').matches;
    const show = compact && pwa.state === 'installable' && !dismissed && this.router.current.name === 'home';
    this.installPill.classList.toggle('hidden', !show);
  }

  async runInstall(): Promise<void> {
    if (pwa.state === 'ios-manual') {
      openModal({
        title: 'Add OmniPlay to your Home Screen',
        description: 'Safari on iPhone and iPad installs web apps from the Share menu.',
        confirmLabel: 'Got it',
        cancelLabel: null,
        body: `
          <ol class="install-steps">
            <li><span class="install-steps__n">1</span><div><b>Tap the Share button</b><p>The square with an arrow, in Safari’s toolbar.</p></div></li>
            <li><span class="install-steps__n">2</span><div><b>Choose “Add to Home Screen”</b><p>Scroll the share sheet if you don’t see it.</p></div></li>
            <li><span class="install-steps__n">3</span><div><b>Tap “Add”</b><p>OmniPlay opens full-screen, without browser chrome.</p></div></li>
          </ol>
          <p class="text-xs muted" style="margin-top:14px">Note: iOS gives web apps a separate storage container, so history starts fresh inside the installed app.</p>
        `,
      });
      return;
    }
    const result = await pwa.install();
    if (result === 'accepted') toast('OmniPlay installed — open it from your home screen.', 'ok');
    else if (result === 'dismissed') toast('Install dismissed. You can install later from Settings → App.', 'info');
    else if (result === 'unavailable') {
      toast('Install is not available in this browser. Use Chrome, Edge or Safari.', 'warn');
    }
  }

  private openSidebar(): void {
    const sidebar = this.shell.querySelector('#sidebar');
    if (!sidebar) return;
    sidebar.classList.add('is-open');
    this.scrim = el('div', { class: 'sidebar-scrim' });
    this.scrim.addEventListener('click', () => this.closeSidebar());
    this.shell.append(this.scrim);
  }

  private closeSidebar(): void {
    this.shell.querySelector('#sidebar')?.classList.remove('is-open');
    this.scrim?.remove();
    this.scrim = null;
  }

  private renderNav(): void {
    this.navHost.innerHTML = '';
    const groups: Array<['main' | 'system', string]> = [
      ['main', 'Library'],
      ['system', 'System'],
    ];
    for (const [group, label] of groups) {
      this.navHost.append(el('div', { class: 'nav__label', text: label }));
      for (const item of NAV.filter((entry) => entry.group === group)) {
        const button = el('button', {
          class: `nav__item${this.router.current.name === item.route ? ' is-active' : ''}`,
          type: 'button',
        });
        const count = item.badge?.() ?? 0;
        button.innerHTML = `${icon(item.iconName, 18)}<span>${esc(item.label)}</span>${
          count > 0 ? `<span class="nav__badge">${count > 99 ? '99+' : count}</span>` : ''
        }`;
        button.addEventListener('click', () => {
          this.closeSidebar();
          this.router.navigate(item.route);
        });
        this.navHost.append(button);
      }
    }
    // Mobile tabs active state
    for (const button of Array.from(this.tabbar.querySelectorAll<HTMLElement>('[data-route]'))) {
      button.classList.toggle('is-active', button.dataset.route === this.router.current.name);
    }
  }

  /** Shown when an embed URL is opened without a usable ?src= link. */
  private mountEmbedError(): void {
    document.body.classList.add('is-embed-route');
    const box = el('div', { class: 'embed-error' });
    box.innerHTML = `
      <div class="embed-error__card">
        <h1>Nothing to play</h1>
        <p>This embed URL has no <code>src</code>. Add a direct media link:</p>
        <code class="embed-error__code">#/embed?src=ENCODED_LINK</code>
        <p class="text-xs muted">MP4/WebM play directly. MKV needs a CORS-enabled host or a proxy.</p>
      </div>`;
    this.mountPoint.append(box);
    this.embedErrorNode = box;
  }

  private render(route: RouteName): void {
    this.embedErrorNode?.remove();
    this.embedErrorNode = null;
    this.topbarTitle.textContent = TITLES[route];
    this.renderNav();
    this.closeSidebar();

    // Same page, different query (settings sections): keep the mounted instance.
    if (this.lastRoute === route && route !== 'player' && route !== 'embed' && this.page) {
      this.page.onParams?.(this.router.current.params);
      this.page.onShow?.();
      this.syncInstallPill();
      return;
    }
    this.lastRoute = route;

    // Tear down the previous page.
    this.page?.destroy?.();
    this.page = null;
    if (this.playerPage) {
      this.playerPage.destroy?.();
      this.playerPage = null;
    }
    this.pageHost.innerHTML = '';

    if (route === 'player' || route === 'embed') {
      const embed = route === 'embed' ? parseEmbedParams(this.router.current.params) : null;
      if (route === 'embed') {
        if (!embed) {
          this.mountEmbedError();
          return;
        }
        this.ctx.store.setCurrent(this.ctx.session.specFromLink(embed.src, embed.title || undefined));
      }
      const player = createPlayerPage(this.ctx, { mode: route === 'embed' ? 'embed' : 'app', embed: embed ?? undefined });
      document.body.append(player.el);
      this.playerPage = player;
      this.shell.classList.add('is-player');
      document.body.classList.add('is-player-route');
      if (route === 'embed') document.body.classList.add('is-embed-route');
      return;
    }
    this.shell.classList.remove('is-player');
    document.body.classList.remove('is-player-route', 'is-embed-route');

    const factory = this.factoryFor(route);
    const page = factory(this.ctx);
    this.pageHost.append(page.el);
    this.page = page;
    page.onShow?.();
    this.syncInstallPill();
  }

  private factoryFor(route: RouteName): (ctx: PageContext) => PageInstance {
    switch (route) {
      case 'open':
        return createOpenPage;
      case 'url':
        return createUrlPage;
      case 'share':
        return createSharePage;
      case 'torrents':
        return createTorrentsPage;
      case 'downloads':
        return createDownloadsPage;
      case 'developers':
        return createDevelopersPage;
      case 'playlist':
        return createPlaylistPage;
      case 'history':
        return createHistoryPage;
      case 'bookmarks':
        return createBookmarksPage;
      case 'settings':
        return createSettingsPage;
      case 'diagnostics':
        return createDiagnosticsPage;
      case 'about':
        return createAboutPage;
      case 'home':
      default:
        return createHomePage;
    }
  }
}
