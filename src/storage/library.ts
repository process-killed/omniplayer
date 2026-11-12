import type { BookmarkEntry, HistoryEntry, PlaylistEntry, PlaylistItem, UrlRecord } from '../types';
import { dbClear, dbDelete, dbGetAll, dbPut } from './db';
import { uid } from '../utils/format';
import { Emitter } from '../utils/emitter';

interface LibraryEvents {
  history: { history: HistoryEntry[] };
  bookmarks: { bookmarks: BookmarkEntry[] };
  playlists: { playlists: PlaylistEntry[] };
  urls: { urls: UrlRecord[] };
}

/**
 * Local-only media library. Nothing here ever leaves the device: history,
 * bookmarks, playlists and recent URLs live in IndexedDB (or localStorage).
 */
export class Library extends Emitter<LibraryEvents> {
  private historyItems: HistoryEntry[] = [];
  private bookmarkItems: BookmarkEntry[] = [];
  private playlistItems: PlaylistEntry[] = [];
  private urlItems: UrlRecord[] = [];
  private ready = false;

  async init(): Promise<void> {
    if (this.ready) return;
    const [history, bookmarks, playlists, urls] = await Promise.all([
      dbGetAll<HistoryEntry>('history'),
      dbGetAll<BookmarkEntry>('bookmarks'),
      dbGetAll<PlaylistEntry>('playlists'),
      dbGetAll<UrlRecord>('urls'),
    ]);
    this.historyItems = history.sort((a, b) => b.updatedAt - a.updatedAt);
    this.bookmarkItems = bookmarks.sort((a, b) => b.createdAt - a.createdAt);
    this.playlistItems = playlists.sort((a, b) => b.updatedAt - a.updatedAt);
    this.urlItems = urls.sort((a, b) => b.lastUsed - a.lastUsed);
    this.ready = true;
  }

  get history(): HistoryEntry[] {
    return this.historyItems;
  }

  get bookmarks(): BookmarkEntry[] {
    return this.bookmarkItems;
  }

  get playlists(): PlaylistEntry[] {
    return this.playlistItems;
  }

  get urls(): UrlRecord[] {
    return this.urlItems;
  }

  /* ------------------------------------------------------------- history */

  async recordProgress(entry: Omit<HistoryEntry, 'updatedAt'>): Promise<void> {
    const existing = this.historyItems.find((item) => item.id === entry.id);
    const merged: HistoryEntry = {
      ...existing,
      ...entry,
      updatedAt: Date.now(),
      completed: entry.completed || (existing?.completed ?? false),
    };
    this.historyItems = [merged, ...this.historyItems.filter((item) => item.id !== entry.id)].slice(0, 200);
    this.emit('history', { history: this.historyItems });
    await dbPut('history', merged);
  }

  getResume(id: string): HistoryEntry | undefined {
    return this.historyItems.find((item) => item.id === id);
  }

  async removeHistory(id: string): Promise<void> {
    this.historyItems = this.historyItems.filter((item) => item.id !== id);
    this.emit('history', { history: this.historyItems });
    await dbDelete('history', id);
  }

  async clearHistory(): Promise<void> {
    this.historyItems = [];
    this.emit('history', { history: [] });
    await dbClear('history');
  }

  get continueWatching(): HistoryEntry[] {
    return this.historyItems
      .filter((item) => !item.completed && item.position > 10 && (!item.duration || item.position < item.duration - 20))
      .slice(0, 8);
  }

  /* ----------------------------------------------------------- bookmarks */

  async addBookmark(input: Omit<BookmarkEntry, 'id' | 'createdAt'>): Promise<BookmarkEntry> {
    const entry: BookmarkEntry = { ...input, id: uid('bm'), createdAt: Date.now() };
    this.bookmarkItems = [entry, ...this.bookmarkItems];
    this.emit('bookmarks', { bookmarks: this.bookmarkItems });
    await dbPut('bookmarks', entry);
    return entry;
  }

  async removeBookmark(id: string): Promise<void> {
    this.bookmarkItems = this.bookmarkItems.filter((item) => item.id !== id);
    this.emit('bookmarks', { bookmarks: this.bookmarkItems });
    await dbDelete('bookmarks', id);
  }

  async clearBookmarks(): Promise<void> {
    this.bookmarkItems = [];
    this.emit('bookmarks', { bookmarks: [] });
    await dbClear('bookmarks');
  }

  bookmarksFor(mediaId: string): BookmarkEntry[] {
    return this.bookmarkItems.filter((item) => item.mediaId === mediaId).sort((a, b) => a.time - b.time);
  }

  /* ----------------------------------------------------------- playlists */

  async createPlaylist(name: string): Promise<PlaylistEntry> {
    const entry: PlaylistEntry = {
      id: uid('pl'),
      name: name.trim() || 'New playlist',
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.playlistItems = [entry, ...this.playlistItems];
    this.emit('playlists', { playlists: this.playlistItems });
    await dbPut('playlists', entry);
    return entry;
  }

  async addToPlaylist(playlistId: string, item: Omit<PlaylistItem, 'id'>): Promise<void> {
    const playlist = this.playlistItems.find((entry) => entry.id === playlistId);
    if (!playlist) return;
    playlist.items.push({ ...item, id: uid('pli') });
    playlist.updatedAt = Date.now();
    this.emit('playlists', { playlists: this.playlistItems });
    await dbPut('playlists', playlist);
  }

  async removeFromPlaylist(playlistId: string, itemId: string): Promise<void> {
    const playlist = this.playlistItems.find((entry) => entry.id === playlistId);
    if (!playlist) return;
    playlist.items = playlist.items.filter((item) => item.id !== itemId);
    playlist.updatedAt = Date.now();
    this.emit('playlists', { playlists: this.playlistItems });
    await dbPut('playlists', playlist);
  }

  async renamePlaylist(playlistId: string, name: string): Promise<void> {
    const playlist = this.playlistItems.find((entry) => entry.id === playlistId);
    if (!playlist) return;
    playlist.name = name.trim() || playlist.name;
    playlist.updatedAt = Date.now();
    this.emit('playlists', { playlists: this.playlistItems });
    await dbPut('playlists', playlist);
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    this.playlistItems = this.playlistItems.filter((entry) => entry.id !== playlistId);
    this.emit('playlists', { playlists: this.playlistItems });
    await dbDelete('playlists', playlistId);
  }

  /* ---------------------------------------------------------------- urls */

  async rememberUrl(url: string, name: string): Promise<void> {
    const existing = this.urlItems.find((item) => item.url === url);
    const entry: UrlRecord = existing
      ? { ...existing, name, lastUsed: Date.now() }
      : { id: uid('url'), url, name, lastUsed: Date.now() };
    this.urlItems = [entry, ...this.urlItems.filter((item) => item.url !== url)].slice(0, 40);
    this.emit('urls', { urls: this.urlItems });
    await dbPut('urls', entry);
  }

  async removeUrl(id: string): Promise<void> {
    this.urlItems = this.urlItems.filter((item) => item.id !== id);
    this.emit('urls', { urls: this.urlItems });
    await dbDelete('urls', id);
  }

  async clearUrls(): Promise<void> {
    this.urlItems = [];
    this.emit('urls', { urls: [] });
    await dbClear('urls');
  }
}

export const library = new Library();
