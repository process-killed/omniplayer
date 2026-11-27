// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { closePopover, showPopover } from '../src/ui/dom';

/**
 * The ⋮ menu is a popover appended to <body>. Headless browsers always report
 * `hover: none`, so the sheet path is what usually gets tested; this covers the
 * desktop popover directly.
 */
describe('showPopover', () => {
  const anchor = () => {
    const button = document.createElement('button');
    button.textContent = '⋮';
    document.body.append(button);
    button.getBoundingClientRect = () =>
      ({ top: 700, bottom: 740, left: 1200, right: 1240, width: 40, height: 40, x: 1200, y: 700, toJSON: () => ({}) }) as DOMRect;
    return button;
  };

  it('mounts the menu and clamps it inside the viewport', () => {
    window.innerWidth = 1280;
    window.innerHeight = 800;
    const trigger = anchor();
    const menu = document.createElement('div');
    menu.innerHTML = '<button class="menu-item">Playback</button><button class="menu-item">Bookmark</button>';

    const popover = showPopover(trigger, menu, { align: 'end' });
    expect(document.querySelector('.popover')).toBeTruthy();
    expect(popover.querySelectorAll('.menu-item').length).toBe(2);

    const left = parseFloat(popover.style.left);
    const top = parseFloat(popover.style.top);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left).toBeLessThanOrEqual(1280 - 8);
    expect(top).toBeGreaterThanOrEqual(8);
    // It must not hang off the bottom edge.
    expect(top + popover.offsetHeight).toBeLessThanOrEqual(800);

    closePopover();
    expect(document.querySelector('.popover')).toBeFalsy();
    trigger.remove();
  });

  it('replaces the previous popover instead of stacking them', () => {
    const trigger = anchor();
    showPopover(trigger, document.createElement('div'));
    showPopover(trigger, document.createElement('div'));
    expect(document.querySelectorAll('.popover').length).toBe(1);
    closePopover();
    trigger.remove();
  });
});
