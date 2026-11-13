/**
 * =============================================================================
 * NEXUS · BOOT
 * =============================================================================
 * Entry point loaded by index.html. Imports every feature module, starts the
 * kernel, then hands the screen over to the app.
 * =============================================================================
 */

import { Nexus } from './core.js';
import './features/index.js';

function dismissBootScreen() {
  const boot = document.getElementById('nxBoot');
  if (!boot || boot.classList.contains('is-done')) return;
  boot.classList.add('is-done');
  setTimeout(() => boot.remove(), 620);
}

try {
  Nexus.start();
} catch (error) {
  console.warn('[Nexus] kernel failed to start — the base app still runs', error);
  dismissBootScreen();
}

Nexus.ready(() => {
  // Give the shell a beat to paint its first frame, then lift the curtain.
  setTimeout(dismissBootScreen, 500);
});

window.addEventListener('load', () => setTimeout(dismissBootScreen, 1200), {
  once: true
});

// Safety net: never leave a viewer staring at the boot screen.
setTimeout(dismissBootScreen, 6000);
