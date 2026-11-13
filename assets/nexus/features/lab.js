/**
 * =============================================================================
 * NEXUS · SETTINGS — one calm panel for everything
 * =============================================================================
 * A plain side panel with five tabs:
 *   Appearance → colour, motion, spacing
 *   Playback   → defaults applied to each new episode
 *   Features   → switch optional extras on or off
 *   Shortcuts  → every keyboard shortcut, grouped
 *   Developer  → how to add a feature + export settings
 *
 * Because it renders from the registry, anything you add in
 * assets/nexus/features/ shows up here with zero extra wiring.
 * =============================================================================
 */

import {
  Nexus,
  store,
  icon,
  el,
  toast,
  listFeatures,
  isEnabled,
  toggleFeature,
  hotkeys,
  ACCENTS
} from '../core.js';

const SNIPPET = `// assets/nexus/features/my-thing.js
import { Nexus, icon, toast } from '../core.js';

Nexus.defineFeature({
  id: 'my-thing',
  name: 'My Thing',
  icon: 'sparkles',        // any icon key from core.js
  category: 'Player',
  description: 'One line that shows up in the Lab and palette.',
  tags: ['demo'],
  hotkeys: [{ combo: 'shift+m', label: 'Do my thing' }],
  mount({ Nexus }) {
    const art = Nexus.player?.art;
    toast('My Thing is live', 'success');

    return () => {
      // undo everything you created here
    };
  }
});
`;

function prettyCombo(combo) {
  const mac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
  return combo
    .split('+')
    .map((part) => {
      if (part === 'mod') return mac ? '⌘' : 'Ctrl';
      if (part === 'shift') return mac ? '⇧' : 'Shift';
      if (part === 'alt') return mac ? '⌥' : 'Alt';
      if (part === 'escape') return 'Esc';
      if (part === 'arrowup') return '↑';
      if (part === 'arrowdown') return '↓';
      if (part === 'arrowleft') return '←';
      if (part === 'arrowright') return '→';
      return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
    })
    .join(mac ? ' ' : ' + ');
}

class Lab {
  constructor() {
    this.root = null;
    this.tab = store.get('ui.lastTab', 'appearance') || 'appearance';
  }

  mount() {
    const trigger = el('button', {
      id: 'nxLabTrigger',
      class: 'nx-lab-trigger',
      type: 'button',
      title: 'Settings',
      'aria-label': 'Open settings'
    });
    trigger.innerHTML = `${icon('sliders', 16)}<span class="nx-lab-trigger__label">Settings</span>`;

    const host = document.getElementById('playerTopBar')?.querySelector('.topbar-right');
    (host || document.body).appendChild(trigger);

    this.trigger = trigger;
    trigger.addEventListener('click', () => this.toggle());

    const off1 = Nexus.registerHotkey('mod+j', () => this.toggle(), {
      label: 'Open settings',
      group: 'Navigation'
    });
    const off2 = Nexus.registerHotkey('shift+?', () => this.show('shortcuts'), {
      label: 'Keyboard shortcuts',
      group: 'Navigation'
    });

    const onKey = (event) => {
      if (event.key === 'Escape' && this.root?.classList.contains('is-on')) {
        event.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      trigger.remove();
      this.close();
      off1();
      off2();
      document.removeEventListener('keydown', onKey);
    };
  }

  toggle() {
    if (this.root?.classList.contains('is-on')) this.close();
    else this.show(this.tab);
  }

  show(tab = 'appearance') {
    this.tab = tab;
    if (!this.root) this.build();
    this.root.classList.add('is-on');
    this.root.setAttribute('aria-hidden', 'false');
    this.render(tab);
  }

  close() {
    this.root?.classList.remove('is-on');
    this.root?.setAttribute('aria-hidden', 'true');
  }

  build() {
    const root = el('div', {
      id: 'nxLab',
      class: 'nx-lab',
      role: 'dialog',
      'aria-label': 'Settings',
      'aria-hidden': 'true'
    });

    root.innerHTML = `
      <div class="nx-lab__scrim" data-close></div>
      <aside class="nx-lab__panel">
        <header class="nx-lab__head">
          <div class="nx-lab__brand">
            <span class="nx-lab__logo">${icon('sparkles', 16)}</span>
            <div>
              <strong>Settings</strong>
              <em>AniFrame · v${Nexus.build}</em>
            </div>
          </div>
          <button class="nx-lab__close" type="button" aria-label="Close">${icon('x', 17)}</button>
        </header>
        <nav class="nx-lab__tabs" role="tablist">
          <button data-tab="appearance" role="tab">Appearance</button>
          <button data-tab="player" role="tab">Playback</button>
          <button data-tab="features" role="tab">Features</button>
          <button data-tab="shortcuts" role="tab">Shortcuts</button>
          <button data-tab="devkit" role="tab">Developer</button>
        </nav>
        <div class="nx-lab__body"></div>
      </aside>
    `;

    root.querySelector('[data-close]').addEventListener('click', () => this.close());
    root.querySelector('.nx-lab__close').addEventListener('click', () => this.close());
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        store.set('ui.lastTab', this.tab);
        this.render(this.tab);
      });
    });

    document.body.appendChild(root);
    this.root = root;
    this.body = root.querySelector('.nx-lab__body');
  }

  render(tab) {
    if (!this.root) return;

    this.root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.toggle('is-on', btn.dataset.tab === tab);
    });

    this.body.replaceChildren();
    const builders = {
      features: () => this.renderFeatures(),
      appearance: () => this.renderAppearance(),
      player: () => this.renderPlayer(),
      shortcuts: () => this.renderShortcuts(),
      devkit: () => this.renderDevkit()
    };
    (builders[tab] || builders.features)();
  }

  renderFeatures() {
    const features = listFeatures();
    const active = features.filter((feature) => isEnabled(feature.id)).length;

    const head = el('div', { class: 'nx-lab__summary' });
    head.innerHTML =
      `<span><strong>${active}</strong> of ${features.length} extras on</span>` +
      `<span class="nx-lab__pill">${Nexus.viewport.width} px</span>`;
    this.body.appendChild(head);

    const groups = new Map();
    for (const feature of features) {
      if (!groups.has(feature.category)) groups.set(feature.category, []);
      groups.get(feature.category).push(feature);
    }

    for (const [category, items] of groups) {
      this.body.appendChild(el('div', { class: 'nx-lab__group' }, category));

      for (const feature of items) {
        const enabled = isEnabled(feature.id);
        const card = el('div', {
          class: `nx-lab__feature${enabled ? ' is-on' : ''}${feature.status === 'failed' ? ' is-failed' : ''}`
        });

        card.innerHTML = `
          <span class="nx-lab__feature-icon">${icon(feature.icon, 16)}</span>
          <div class="nx-lab__feature-copy">
            <div class="nx-lab__feature-title">
              <strong></strong>
              ${feature.experimental ? '<span class="nx-lab__tag">beta</span>' : ''}
              ${feature.status === 'failed' ? '<span class="nx-lab__tag nx-lab__tag--err">error</span>' : ''}
            </div>
            <em></em>
          </div>
          <button class="nx-lab__switch${enabled ? ' is-on' : ''}" type="button"
                  role="switch" aria-checked="${enabled}" aria-label="Toggle ${feature.name}">
            <span></span>
          </button>
        `;

        card.querySelector('strong').textContent = feature.name;
        card.querySelector('em').textContent =
          feature.error ? `Failed: ${feature.error}` : feature.description;

        card.querySelector('.nx-lab__switch').addEventListener('click', () => {
          const next = toggleFeature(feature.id);
          this.render('features');
          toast(`${feature.name} ${next ? 'enabled' : 'disabled'}`, next ? 'success' : 'info', 1500);
        });

        this.body.appendChild(card);
      }
    }
  }

  renderAppearance() {
    const theme = store.get('theme', {});

    this.body.appendChild(el('div', { class: 'nx-lab__group' }, 'Colour'));
    const grid = el('div', { class: 'nx-accent-grid' });
    for (const accent of ACCENTS) {
      const btn = el('button', {
        type: 'button',
        class: `nx-accent${theme.accent === accent.id ? ' is-on' : ''}`,
        title: accent.name
      });
      btn.innerHTML = `<span class="nx-accent__dot" style="--swatch:${accent.hex}"></span><span>${accent.name}</span>`;
      btn.addEventListener('click', () => {
        Nexus.setAccent(accent.id);
        this.render('appearance');
      });
      grid.appendChild(btn);
    }
    this.body.appendChild(grid);

    const choice = (label, key, options) => {
      const wrap = el('div', { class: 'nx-lab__choice' });
      wrap.appendChild(el('span', { class: 'nx-lab__choice-label' }, label));
      const seg = el('div', { class: 'nx-seg' });
      for (const option of options) {
        const btn = el('button', {
          type: 'button',
          class: `nx-seg__btn${store.get(`theme.${key}`) === option.value ? ' is-on' : ''}`
        }, option.label);
        btn.addEventListener('click', () => {
          store.set(`theme.${key}`, option.value);
          Nexus.applyTheme();
          this.render('appearance');
        });
        seg.appendChild(btn);
      }
      wrap.appendChild(seg);
      return wrap;
    };

    this.body.appendChild(el('div', { class: 'nx-lab__group' }, 'Look and feel'));
    this.body.appendChild(
      choice('Motion', 'motion', [
        { label: 'Full', value: 'full' },
        { label: 'Reduced', value: 'reduced' },
        { label: 'Off', value: 'off' }
      ])
    );
    this.body.appendChild(
      choice('Glass', 'glass', [
        { label: 'High', value: 'high' },
        { label: 'Medium', value: 'medium' },
        { label: 'Solid', value: 'low' }
      ])
    );
    this.body.appendChild(
      choice('Density', 'density', [
        { label: 'Comfort', value: 'comfortable' },
        { label: 'Compact', value: 'compact' }
      ])
    );

    const reset = el('button', { class: 'nx-lab__btn', type: 'button' }, 'Reset appearance');
    reset.addEventListener('click', () => {
      store.reset('theme');
      Nexus.applyTheme();
      this.render('appearance');
      toast('Appearance reset', 'info');
    });
    this.body.appendChild(reset);
  }

  renderPlayer() {
    const toggle = (label, path, hint) => {
      const value = Boolean(store.get(path));
      const rowNode = el('div', { class: 'nx-lab__row' });
      rowNode.innerHTML = `
        <div class="nx-lab__row-copy"><strong></strong><em></em></div>
        <button class="nx-lab__switch${value ? ' is-on' : ''}" type="button"
                role="switch" aria-checked="${value}"><span></span></button>
      `;
      rowNode.querySelector('strong').textContent = label;
      rowNode.querySelector('em').textContent = hint || '';
      rowNode.querySelector('.nx-lab__switch').addEventListener('click', () => {
        const next = !store.get(path);
        store.set(path, next);
        this.render('player');
      });
      return rowNode;
    };

    this.body.appendChild(el('div', { class: 'nx-lab__group' }, 'Playback'));
    this.body.appendChild(
      toggle('Auto-play next episode', 'player.autoplayNext', 'Roll into the next episode automatically')
    );
    this.body.appendChild(
      toggle('Skip openings', 'player.skipIntro', 'Uses AniSkip timing data when available')
    );
    this.body.appendChild(
      toggle('Keep original pitch', 'player.keepPitch', 'Speed changes stay natural')
    );
    this.body.appendChild(
      toggle('Remember last speed', 'player.rememberSpeed', 'New episodes start at your last rate')
    );
    this.body.appendChild(
      toggle('Touch gestures', 'player.gestures', 'Swipe for seek, volume and brightness')
    );

    this.body.appendChild(el('div', { class: 'nx-lab__group' }, 'Starting speed'));
    const rateRow = el('div', { class: 'nx-lab__row' });
    rateRow.innerHTML = `
      <div class="nx-lab__row-copy"><strong>Default speed</strong><em>Applied when a stream starts</em></div>
      <select class="nx-lab__select">
        ${[0.75, 1, 1.25, 1.5, 2]
          .map(
            (rate) =>
              `<option value="${rate}"${Number(store.get('player.defaultRate', 1)) === rate ? ' selected' : ''}>${rate}×</option>`
          )
          .join('')}
      </select>
    `;
    rateRow.querySelector('select').addEventListener('change', (event) => {
      store.set('player.defaultRate', Number(event.target.value));
      toast(`Default speed ${event.target.value}×`, 'success', 1400);
    });
    this.body.appendChild(rateRow);

    const reset = el('button', { class: 'nx-lab__btn', type: 'button' }, 'Reset player defaults');
    reset.addEventListener('click', () => {
      store.reset('player');
      this.render('player');
      toast('Player defaults reset', 'info');
    });
    this.body.appendChild(reset);
  }

  renderShortcuts() {
    const list = hotkeys();
    const groups = new Map();
    for (const entry of list) {
      if (!groups.has(entry.group)) groups.set(entry.group, []);
      groups.get(entry.group).push(entry);
    }

    for (const [group, entries] of groups) {
      this.body.appendChild(el('div', { class: 'nx-lab__group' }, group));
      const table = el('div', { class: 'nx-keys' });
      for (const entry of entries) {
        const rowNode = el('div', { class: 'nx-keys__row' });
        rowNode.innerHTML = `<span></span><kbd>${prettyCombo(entry.combo)}</kbd>`;
        rowNode.querySelector('span').textContent = entry.label || entry.combo;
        table.appendChild(rowNode);
      }
      this.body.appendChild(table);
    }

    this.body.appendChild(
      el(
        'p',
        { class: 'nx-lab__note' },
        'Shortcuts are added automatically by each feature.'
      )
    );
  }

  renderDevkit() {
    this.body.appendChild(el('div', { class: 'nx-lab__group' }, 'Add a feature in a minute'));

    const steps = el('ol', { class: 'nx-lab__steps' });
    steps.innerHTML = `
      <li>Create <code>assets/nexus/features/my-thing.js</code>.</li>
      <li>Call <code>Nexus.defineFeature({...})</code> — copy the template below.</li>
      <li>Add one import line to <code>assets/nexus/features/index.js</code>.</li>
      <li>Reload. It starts itself and appears in Settings → Features.</li>
    `;
    this.body.appendChild(steps);

    const pre = el('pre', { class: 'nx-lab__code' });
    pre.textContent = SNIPPET;
    this.body.appendChild(pre);

    const actions = el('div', { class: 'nx-lab__actions' });

    const copy = el('button', { class: 'nx-lab__btn', type: 'button' }, `${icon('copy', 13)} Copy template`);
    copy.addEventListener('click', () => {
      navigator.clipboard
        ?.writeText(SNIPPET)
        .then(() => toast('Template copied', 'success'))
        .catch(() => toast('Copy blocked by the browser', 'error'));
    });

    const exportBtn = el('button', { class: 'nx-lab__btn nx-lab__btn--ghost', type: 'button' }, `${icon('download', 13)} Export config`);
    exportBtn.addEventListener('click', () => {
      const payload = JSON.stringify(store.all(), null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'aniframe-nexus-config.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      toast('Config exported', 'success');
    });

    actions.append(copy, exportBtn);
    this.body.appendChild(actions);

    this.body.appendChild(el('div', { class: 'nx-lab__group' }, 'App info'));
    const info = el('div', { class: 'nx-keys' });
    const rows = [
      ['Nexus version', Nexus.version],
      ['Build', Nexus.build],
      ['Viewport', `${Nexus.viewport.mode} · ${Nexus.viewport.width}×${Nexus.viewport.height}`],
      ['Touch', Nexus.viewport.touch ? 'yes' : 'no'],
      ['Player attached', Nexus.player?.art ? 'yes' : 'no'],
      ['Modules', `${listFeatures().length} registered`]
    ];
    for (const [key, value] of rows) {
      const rowNode = el('div', { class: 'nx-keys__row' });
      rowNode.innerHTML = `<span></span><kbd></kbd>`;
      rowNode.querySelector('span').textContent = key;
      rowNode.querySelector('kbd').textContent = String(value);
      info.appendChild(rowNode);
    }
    this.body.appendChild(info);
  }
}

const lab = new Lab();

Nexus.defineFeature({
  id: 'nexus-lab',
  name: 'Settings panel',
  icon: 'sliders',
  category: 'Basics',
  order: 6,
  description: 'Change the colour, playback defaults and which extras are on.',
  tags: ['settings', 'theme', 'features'],
  hotkeys: [
    { combo: 'mod+j', label: 'Open settings' },
    { combo: 'shift+?', label: 'Keyboard shortcuts' }
  ],
  commands: [
    {
      id: 'open',
      title: 'Open settings',
      subtitle: 'Colour, playback, shortcuts',
      group: 'Navigation',
      icon: 'sliders',
      run: () => lab.show('features')
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts',
      subtitle: 'Full hotkey map',
      group: 'Navigation',
      icon: 'keyboard',
      run: () => lab.show('shortcuts')
    }
  ],
  mount() {
    return lab.mount();
  }
});

export default lab;
