/**
 * Reference extension.
 *
 * Runs inside an opaque-origin sandboxed frame: there is no DOM access to the
 * app, no storage and no network. Everything goes through `window.omniplay`,
 * which the host validates against the permissions the user approved.
 */
const api = window.omniplay;

api.ui.registerNavigation({ id: 'hello', title: 'Hello', icon: 'package' });
api.logger.info('Hello OmniPlay activated');

let opens = 0;
api.storage.get('opens').then((value) => {
  opens = Number(value ?? 0) + 1;
  api.storage.set('opens', opens);
  api.ui.notify(`Hello extension activated ${opens} time(s)`);
});

api.on('player', (state) => {
  api.logger.debug(`player state: ${JSON.stringify(state)}`);
});
