import { afterEach, describe, expect, it, vi } from 'vitest';
import { installXhrProxy, xhrProxyActive } from '../src/core/xhrProxy';

class FakeXhr {
  static calls: string[] = [];
  open(_method: string, url: string): void {
    FakeXhr.calls.push(String(url));
  }
}

const g = globalThis as unknown as { XMLHttpRequest: unknown };

function setup(): void {
  FakeXhr.calls = [];
  g.XMLHttpRequest = FakeXhr;
}

describe('dash xhr proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrites only requests on the manifest origin', () => {
    setup();
    const release = installXhrProxy('https://cdn.example/manifest.mpd', (url) => `https://proxy/?url=${encodeURIComponent(url)}`);
    const xhr = new (g.XMLHttpRequest as typeof FakeXhr)();
    xhr.open('GET', 'https://cdn.example/seg/1.m4s');
    xhr.open('GET', 'https://other.example/tracker.gif');
    expect(FakeXhr.calls[0]).toContain('proxy/?url=');
    expect(FakeXhr.calls[0]).toContain(encodeURIComponent('https://cdn.example/seg/1.m4s'));
    expect(FakeXhr.calls[1]).toBe('https://other.example/tracker.gif');
    release();
  });

  it('restores the original open() after the last release', () => {
    setup();
    const before = (g.XMLHttpRequest as typeof FakeXhr).prototype.open;
    const a = installXhrProxy('https://cdn.example/a.mpd', (url) => url);
    const b = installXhrProxy('https://cdn.example/b.mpd', (url) => url);
    expect(xhrProxyActive()).toBe(true);
    a();
    expect(xhrProxyActive()).toBe(true); // still held by b
    b();
    expect(xhrProxyActive()).toBe(false);
    expect((g.XMLHttpRequest as typeof FakeXhr).prototype.open).toBe(before);
  });

  it('leaves requests on other origins alone', () => {
    setup();
    const release = installXhrProxy('https://cdn.example/a.mpd', (url) => `proxy:${url}`);
    const xhr = new (g.XMLHttpRequest as typeof FakeXhr)();
    xhr.open('GET', 'https://elsewhere.example/x.m4s');
    expect(FakeXhr.calls[0]).toBe('https://elsewhere.example/x.m4s');
    release();
    expect(xhrProxyActive()).toBe(false);
  });
});
