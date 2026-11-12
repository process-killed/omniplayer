import type { Router } from '../../app/router';
import type { Session } from '../../app/session';
import type { Store } from '../../app/store';

export interface PageContext {
  store: Store;
  router: Router;
  session: Session;
}

export interface PageInstance {
  el: HTMLElement;
  destroy?: () => void;
  onShow?: () => void;
  /** Called when only the query string changed (e.g. settings sections). */
  onParams?: (params: Record<string, string>) => void;
}

export type PageFactory = (ctx: PageContext) => PageInstance;
