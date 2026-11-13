/**
 * =============================================================================
 * NEXUS · SHELL
 * =============================================================================
 * Everything around the video:
 *   • panels that slide up as sheets on phones, with a drag handle
 *   • a "continue watching" row on the start screen
 *   • a quiet offline notice and a first-run tip
 *   • the action list used by the Ctrl+K search box
 * =============================================================================
 */

import { Nexus, icon, el, toast, store, onViewport, debounce, fmtTime } from '../core.js';
import { ProgressTracker } from '/script.js';

const DRAWERS = {
  servers: 'serversDrawer',
  sources: 'sourcesDrawer',
  episodes: 'episodesDrawer',
  info: 'infoDrawer',
  comments: 'commentsDrawer'
};

class ShellPro {
  constructor() {
    this.disposers = [];
    this.clockTimer = null;
  }

  mount() {
    this.watchTopBar();
    this.mountOfflineWatch();
    this.mountResumeCard();
    this.mountSheetHandles();
    this.registerCommands();
    this.firstRunTip();

    const offViewport = onViewport(() => this.syncDensity());
    this.disposers.push(offViewport);

    return () => this.destroy();
  }

  destroy() {
    clearInterval(this.clockTimer);
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* noop */
      }
    }
    document.getElementById('nxOfflineBar')?.remove();
    document.getElementById('nxResumeCard')?.remove();
    document.querySelectorAll('.nx-sheet-handle').forEach((node) => node.remove());
  }

  /* ------------------------------------------------------------- top bar */

  /** Track the app top bar so player overlays never sit underneath it. */
  watchTopBar() {
    const bar = document.getElementById('playerTopBar');
    if (!bar) return;

    const sync = () => {
      document.body.classList.toggle('nx-bar-visible', !bar.classList.contains('hidden'));
    };

    const observer = new MutationObserver(sync);
    observer.observe(bar, { attributes: true, attributeFilter: ['class'] });
    sync();
    this.disposers.push(() => observer.disconnect());
  }

  mountStatusCluster() {
    const bar = document.getElementById('playerTopBar');
    if (!bar || document.getElementById('nxStatusCluster')) return;

    const cluster = el('div', {
      id: 'nxStatusCluster',
      class: 'nx-status',
      'aria-label': 'Stream status'
    });

    cluster.innerHTML = `
      <span class="nx-status__item" data-net title="Network">
        ${icon('wifi', 12)}<span data-net-label>ONLINE</span>
      </span>
      <span class="nx-status__item nx-status__item--clock" title="Local time">
        ${icon('clock', 12)}<span data-clock>--:--</span>
      </span>
      <span class="nx-status__item nx-status__item--engine" data-engine title="Playback engine">
        ${icon('cpu', 12)}<span data-engine-label>IDLE</span>
      </span>
    `;

    const left = bar.querySelector('.topbar-left');
    (left || bar).appendChild(cluster);

    this.netLabel = cluster.querySelector('[data-net-label]');
    this.engineLabel = cluster.querySelector('[data-engine-label]');

    const refreshEngine = () => {
      const hud = Nexus.player?.hud;
      const engine = Nexus.player?.engine;
      if (!engine?.art) {
        this.engineLabel.textContent = 'IDLE';
        return;
      }
      const level = hud?.currentLevel?.();
      const label = level?.height ? `HLS ${level.height}p` : engine.hls ? 'HLS' : 'NATIVE';
      this.engineLabel.textContent = label;
    };

    // Track whether the app's own top bar is visible so the player HUD can
    // step out of its way instead of overlapping it.
    const syncBarState = () => {
      document.body.classList.toggle(
        'nx-bar-visible',
        !bar.classList.contains('hidden')
      );
    };
    const barObserver = new MutationObserver(syncBarState);
    barObserver.observe(bar, { attributes: true, attributeFilter: ['class'] });
    syncBarState();
    this.disposers.push(() => barObserver.disconnect());

    this.engineTimer = setInterval(refreshEngine, 4000);
    this.disposers.push(() => clearInterval(this.engineTimer));
    Nexus.on('player:attached', refreshEngine);
    Nexus.on('player:detached', () => {
      this.engineLabel.textContent = 'IDLE';
    });
  }

  tickClock() {
    const node = document.querySelector('#nxStatusCluster [data-clock]');
    if (!node) return;
    const now = new Date();
    node.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  syncDensity() {
    const { mode, touch } = Nexus.viewport;
    document.body.classList.toggle('nx-touch', touch);
    document.body.dataset.nxView = mode;
  }

  /* ------------------------------------------------------------ offline */

  mountOfflineWatch() {
    const apply = () => {
      const online = navigator.onLine;
      document.documentElement.dataset.nxOnline = online ? 'true' : 'false';

      const label = document.querySelector('#nxStatusCluster [data-net-label]');
      if (label) label.textContent = online ? 'ONLINE' : 'OFFLINE';

      const net = document.querySelector('#nxStatusCluster [data-net]');
      if (net) net.classList.toggle('is-offline', !online);

      let bar = document.getElementById('nxOfflineBar');
      if (!online && !bar) {
        bar = el('div', { id: 'nxOfflineBar', class: 'nx-offline' });
        bar.innerHTML = `${icon('wifi-off', 14)}<span>You are offline — playback will resume when the connection returns.</span>`;
        document.body.appendChild(bar);
        requestAnimationFrame(() => bar.classList.add('is-on'));
      } else if (online && bar) {
        bar.classList.remove('is-on');
        setTimeout(() => bar.remove(), 300);
        toast('Back online', 'success', 1600);
      }
    };

    window.addEventListener('online', apply);
    window.addEventListener('offline', apply);
    this.disposers.push(() => {
      window.removeEventListener('online', apply);
      window.removeEventListener('offline', apply);
    });
    apply();
  }

  /* ------------------------------------------------------- resume card */

  mountResumeCard() {
    const splash = document.getElementById('playerSplash');
    if (!splash) return;

    const render = debounce(() => {
      const bridge = Nexus.bridge;
      const anilistId = bridge?.currentAnilistId?.() || null;
      if (!anilistId) return;

      const saved = ProgressTracker.get(anilistId);
      document.getElementById('nxResumeCard')?.remove();
      if (!saved || !saved.time || saved.percent >= 95) return;

      const card = el('div', { id: 'nxResumeCard', class: 'nx-resume' });
      const percent = Math.min(100, Math.max(0, Number(saved.percent) || 0));

      card.innerHTML = `
        <div class="nx-resume__ring" style="--p:${percent}">
          <span>${percent}%</span>
        </div>
        <div class="nx-resume__copy">
          <strong>Continue watching</strong>
          <em>Episode ${saved.episode} · ${fmtTime(saved.time)}${saved.duration ? ` of ${fmtTime(saved.duration)}` : ''}</em>
        </div>
        <button class="nx-resume__go" type="button">Resume</button>
        <button class="nx-resume__reset" type="button" title="Clear progress">${icon('trash', 13)}</button>
      `;

      card.querySelector('.nx-resume__go').addEventListener('click', (event) => {
        event.stopPropagation();
        bridge?.goToEpisode?.(saved.episode);
      });

      card.querySelector('.nx-resume__reset').addEventListener('click', (event) => {
        event.stopPropagation();
        ProgressTracker.clear(anilistId);
        card.remove();
        toast('Progress cleared', 'info', 1400);
      });

      const cta = splash.querySelector('.splash-cta-row');
      if (cta) cta.parentElement.insertBefore(card, cta);
      else splash.querySelector('.splash-content-body')?.appendChild(card);
    }, 700);

    this.resumeTimer = setInterval(render, 4000);
    this.disposers.push(() => clearInterval(this.resumeTimer));
    Nexus.on('ready', render);
    setTimeout(render, 1500);
  }

  /* ------------------------------------------------------ bottom sheets */

  mountSheetHandles() {
    const inject = () => {
      for (const id of Object.values(DRAWERS)) {
        const drawer = document.getElementById(id);
        if (!drawer || drawer.querySelector(':scope > .nx-sheet-handle')) continue;

        const handle = el('div', {
          class: 'nx-sheet-handle',
          role: 'button',
          tabindex: '0',
          'aria-label': 'Drag to close'
        });
        handle.innerHTML = '<span></span>';
        drawer.prepend(handle);

        let startY = 0;
        let delta = 0;
        let dragging = false;

        handle.addEventListener('pointerdown', (event) => {
          dragging = true;
          startY = event.clientY;
          delta = 0;
          drawer.classList.add('is-dragging');
          handle.setPointerCapture?.(event.pointerId);
        });

        handle.addEventListener('pointermove', (event) => {
          if (!dragging) return;
          delta = Math.max(0, event.clientY - startY);
          drawer.style.setProperty('--nx-drag', `${delta}px`);
        });

        const end = () => {
          if (!dragging) return;
          dragging = false;
          drawer.classList.remove('is-dragging');
          drawer.style.removeProperty('--nx-drag');
          if (delta > 96) {
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
          }
        };

        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);

        handle.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
          }
        });
      }
    };

    inject();
    const observer = new MutationObserver(() => inject());
    observer.observe(document.body, { childList: true, subtree: true });
    this.disposers.push(() => observer.disconnect());
  }

  /* --------------------------------------------------------- commands */

  registerCommands() {
    const bridge = () => Nexus.bridge;

    // Ctrl/⌘ + 1…5 open the five panels.
    ['servers', 'sources', 'episodes', 'info', 'comments'].forEach((key, index) => {
      this.disposers.push(
        Nexus.registerHotkey(`mod+${index + 1}`, () => {
          bridge()?.openDrawer?.(key);
        }, { label: `Open ${key} panel`, group: 'Panels' })
      );
    });

    const drawerCommands = [
      ['servers', 'Servers and audio', 'layers'],
      ['sources', 'Streams', 'activity'],
      ['episodes', 'Episodes', 'film'],
      ['info', 'Details', 'info'],
      ['comments', 'Comments', 'message']
    ];

    for (const [key, title, glyph] of drawerCommands) {
      Nexus.addCommand({
        id: `shell:${key}`,
        title,
        subtitle: 'Open panel',
        group: 'Panels',
        icon: glyph,
        keywords: `drawer panel ${key}`,
        run: () => bridge()?.openDrawer?.(key)
      });
    }

    Nexus.addCommand({
      id: 'shell:next-ep',
      title: 'Next episode',
      subtitle: 'Skip forward',
      group: 'Playback',
      icon: 'skip-forward',
      keywords: 'next ep forward',
      run: () => bridge()?.nextEpisode?.()
    });

    Nexus.addCommand({
      id: 'shell:prev-ep',
      title: 'Previous episode',
      group: 'Playback',
      icon: 'skip-back',
      keywords: 'previous back ep',
      run: () => bridge()?.prevEpisode?.()
    });

    Nexus.addCommand({
      id: 'shell:rescan',
      title: 'Reload streams',
      subtitle: 'Search the servers again',
      group: 'Playback',
      icon: 'scan',
      keywords: 'reload retry refresh sources',
      run: () => bridge()?.rescan?.()
    });

    Nexus.addCommand({
      id: 'shell:download',
      title: 'Download episode',
      group: 'Playback',
      icon: 'download',
      keywords: 'save offline',
      run: () => bridge()?.download?.()
    });

    Nexus.addCommand({
      id: 'shell:zen',
      title: 'Focus mode',
      subtitle: 'Hide everything but the video',
      group: 'Appearance',
      icon: 'eye',
      keywords: 'cinema focus clean',
      run: () => {
        const on = document.body.classList.toggle('nx-zen');
        toast(on ? 'Focus mode on — press Esc to exit' : 'Focus mode off', 'info', 1500);
      }
    });

    Nexus.addCommand({
      id: 'shell:fullscreen',
      title: 'Toggle fullscreen',
      group: 'Appearance',
      icon: 'maximize',
      keywords: 'expand screen',
      run: () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.().catch(() => {});
      }
    });

    Nexus.addCommand({
      id: 'shell:reset-config',
      title: 'Reset all settings',
      subtitle: 'Colour, extras and defaults',
      group: 'System',
      icon: 'trash',
      keywords: 'clear wipe defaults',
      run: () => {
        store.reset();
        Nexus.applyTheme();
        toast('Settings reset. Reload for a clean start.', 'info', 3000);
      }
    });
  }

  firstRunTip() {
    if (store.get('ui.seenIntro', false)) return;
    store.set('ui.seenIntro', true);
    setTimeout(() => {
      toast('Press Ctrl+K to search episodes and settings', {
        type: 'info',
        duration: 6000,
        iconName: 'command',
        action: {
          label: 'Try it',
          run: () => Nexus.runCommand('command-palette:open')
        }
      });
    }, 2600);
  }
}

const shell = new ShellPro();

Nexus.defineFeature({
  id: 'shell-pro',
  name: 'Panels and resume',
  icon: 'monitor',
  category: 'Basics',
  order: 8,
  description: 'Phone-friendly sliding panels, continue watching, offline notice.',
  tags: ['shell', 'mobile', 'resume'],
  commands: [
    {
      id: 'next-episode',
      title: 'Next episode',
      group: 'Playback',
      icon: 'skip-forward',
      run: () => Nexus.bridge?.nextEpisode?.()
    }
  ],
  mount() {
    return shell.mount();
  }
});

export default shell;
