/**
 * =============================================================================
 * NEXUS · SEARCH
 * =============================================================================
 * Ctrl/⌘ + K opens a search box over every action, setting, episode and panel.
 * Arrow keys move, Enter opens, Esc closes.
 * =============================================================================
 */

import { Nexus, icon, el, commands, listFeatures, isEnabled, toggleFeature, store, toast } from '../core.js';

function score(text, query) {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 1;

  let index = -1;
  let points = 0;
  let cursor = 0;

  for (const char of needle) {
    index = haystack.indexOf(char, cursor);
    if (index === -1) return 0;
    points += index === cursor ? 3 : 1;
    cursor = index + 1;
  }
  if (haystack.startsWith(needle)) points += 12;
  if (haystack.includes(` ${needle}`)) points += 6;
  return points;
}

class CommandPalette {
  constructor() {
    this.open = false;
    this.items = [];
    this.filtered = [];
    this.cursor = 0;
    this.root = null;
  }

  mount() {
    this.onKey = (event) => {
      if (!this.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.move(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.run();
      }
    };
    document.addEventListener('keydown', this.onKey, true);

    const off = Nexus.registerHotkey('mod+k', () => this.toggle(), {
      label: 'Command palette',
      group: 'Navigation'
    });

    return () => {
      document.removeEventListener('keydown', this.onKey, true);
      off();
      this.close();
    };
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.build();
    this.refresh('');
    requestAnimationFrame(() => this.input?.focus());
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root?.classList.remove('is-on');
    setTimeout(() => this.root?.remove(), 180);
    this.root = null;
  }

  build() {
    this.root?.remove();

    const root = el('div', {
      class: 'nx-palette',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Search'
    });

    root.innerHTML = `
      <div class="nx-palette__backdrop" data-close></div>
      <div class="nx-palette__panel">
        <div class="nx-palette__field">
          ${icon('search', 17)}
          <input type="text" placeholder="Search episodes, settings, actions…"
                 autocomplete="off" spellcheck="false" aria-label="Search" />
          <kbd>ESC</kbd>
        </div>
        <div class="nx-palette__list" role="listbox"></div>
        <div class="nx-palette__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>↵</kbd> to open</span>
        </div>
      </div>
    `;

    root.querySelector('[data-close]').addEventListener('click', () => this.close());
    document.body.appendChild(root);
    this.root = root;
    this.input = root.querySelector('input');
    this.list = root.querySelector('.nx-palette__list');

    this.input.addEventListener('input', () => this.refresh(this.input.value));
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.stopPropagation();
    });

    requestAnimationFrame(() => root.classList.add('is-on'));
    this.collect();
  }

  collect() {
    const items = [];
    const bridge = Nexus.bridge;

    for (const command of commands()) {
      items.push({
        id: `cmd:${command.id}`,
        title: command.title,
        subtitle: command.subtitle || '',
        group: command.group,
        glyph: command.icon || 'sparkles',
        keywords: command.keywords || '',
        run: () => Nexus.runCommand(command.id)
      });
    }

    for (const feature of listFeatures()) {
      const on = isEnabled(feature.id);
      items.push({
        id: `feat:${feature.id}`,
        title: `${on ? 'Turn off' : 'Turn on'} ${feature.name}`,
        subtitle: feature.description,
        group: 'Extras',
        glyph: feature.icon,
        keywords: `${feature.category} ${feature.tags.join(' ')} ${feature.id}`,
        run: () => {
          toggleFeature(feature.id);
          toast(`${feature.name} ${on ? 'disabled' : 'enabled'}`, on ? 'info' : 'success');
        }
      });
    }

    for (const accent of Nexus.ACCENTS) {
      items.push({
        id: `accent:${accent.id}`,
        title: `Colour: ${accent.name}`,
        subtitle: 'Change the app colour',
        group: 'Appearance',
        glyph: 'palette',
        keywords: 'theme colour accent',
        run: () => {
          Nexus.setAccent(accent.id);
          toast(`Theme: ${accent.name}`, 'success', 1400);
        }
      });
    }

    // Live app actions, surfaced through the shell bridge.
    if (bridge?.actions) {
      for (const action of bridge.actions()) items.push({ ...action, id: `app:${action.id}` });
    }

    // Episodes, when the grid is already rendered.
    const episodeCards = document.querySelectorAll('#episodesGridContainer .ep-card');
    if (episodeCards.length && bridge?.goToEpisode) {
      episodeCards.forEach((card) => {
        const ep = Number(card.dataset.ep);
        if (!Number.isFinite(ep)) return;
        items.push({
          id: `ep:${ep}`,
          title: `Episode ${ep}`,
          subtitle: 'Jump to episode',
          group: 'Episodes',
          glyph: 'film',
          keywords: `ep ${ep}`,
          run: () => bridge.goToEpisode(ep)
        });
      });
    }

    this.items = items;
  }

  refresh(query) {
    const trimmed = String(query || '').trim();
    const recent = store.get('ui.paletteRecent', []);

    const ranked = this.items
      .map((item) => {
        const base = score(`${item.title} ${item.keywords}`, trimmed);
        const recentBoost = trimmed ? 0 : recent.includes(item.id) ? 6 : 0;
        return { item, points: base + recentBoost };
      })
      .filter((entry) => entry.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 40)
      .map((entry) => entry.item);

    this.filtered = ranked;
    this.cursor = 0;
    this.paint(trimmed);
  }

  paint(query) {
    if (!this.list) return;
    this.list.replaceChildren();

    if (!this.filtered.length) {
      this.list.innerHTML = `<div class="nx-palette__empty">${icon('search', 20)}<span>Nothing matches “${query}”</span></div>`;
      return;
    }

    let lastGroup = null;
    this.filtered.forEach((item, index) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        this.list.appendChild(
          el('div', { class: 'nx-palette__group' }, item.group)
        );
      }

      const node = el('button', {
        type: 'button',
        class: `nx-palette__item${index === this.cursor ? ' is-active' : ''}`,
        role: 'option',
        'data-index': index
      });

      node.innerHTML =
        `<span class="nx-palette__icon">${icon(item.glyph || 'sparkles', 15)}</span>` +
        `<span class="nx-palette__copy"><strong></strong><em></em></span>` +
        `<span class="nx-palette__hint">↵</span>`;

      node.querySelector('strong').textContent = item.title;
      node.querySelector('em').textContent = item.subtitle || '';

      node.addEventListener('pointerenter', () => this.setCursor(index, false));
      node.addEventListener('click', () => this.run());
      this.list.appendChild(node);
    });
  }

  setCursor(index, scroll = true) {
    this.cursor = index;
    this.list.querySelectorAll('.nx-palette__item').forEach((node) => {
      const isActive = Number(node.dataset.index) === index;
      node.classList.toggle('is-active', isActive);
      if (isActive && scroll) node.scrollIntoView({ block: 'nearest' });
    });
  }

  move(delta) {
    if (!this.filtered.length) return;
    const next = (this.cursor + delta + this.filtered.length) % this.filtered.length;
    this.setCursor(next);
  }

  run() {
    const item = this.filtered[this.cursor];
    if (!item) return;

    const recent = store.get('ui.paletteRecent', []).filter((id) => id !== item.id);
    recent.unshift(item.id);
    store.set('ui.paletteRecent', recent.slice(0, 8));

    this.close();
    setTimeout(() => {
      try {
        item.run();
      } catch (error) {
        toast(`Action failed: ${error?.message || 'unknown'}`, 'error');
      }
    }, 60);
  }
}

const palette = new CommandPalette();

Nexus.defineFeature({
  id: 'command-palette',
  name: 'Search',
  icon: 'search',
  category: 'Basics',
  order: 5,
  description: 'Press Ctrl+K to search episodes, settings and actions.',
  tags: ['search', 'keyboard'],
  hotkeys: [{ combo: 'mod+k', label: 'Search' }],
  commands: [
    {
      id: 'open',
      title: 'Search',
      subtitle: 'Find anything',
      group: 'Basics',
      icon: 'search',
      run: () => palette.show()
    }
  ],
  mount() {
    const off = palette.mount();
    return () => {
      off();
      palette.close();
    };
  }
});

export default palette;
