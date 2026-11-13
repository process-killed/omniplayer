/**
 * =============================================================================
 * NEXUS · FEATURE INDEX
 * =============================================================================
 * This is the only file you touch when adding a module.
 *
 *   import './my-thing.js';   ← one line, that's it
 *
 * Each module registers itself with Nexus.defineFeature() on import, so order
 * here only decides registration order, not behaviour.
 * =============================================================================
 */

import './player-pro.js';
import './command-palette.js';
import './lab.js';
import './shell-pro.js';
import './ambient.js';
import './guardian.js';

export {};
