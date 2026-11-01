import { formatDate, h } from '../dom';
import type { App } from '../main';
import { blocksToPlainText, docToBlocks } from '../newspaper/doc';
import type { Post } from '../store';
import { loadInto, topBar, UrlPool } from './shared';

const STALE_AFTER_MS = 30_000;
let lastRefresh = Date.now();

function excerpt(post: Post): string {
  const text = blocksToPlainText(docToBlocks(post.doc));
  return text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text;
}

export function feedView(app: App): HTMLElement {
  const pool = new UrlPool();
  app.cleanup = () => pool.release();

  const generateButton = h('button', { class: 'btn primary', onclick: () => app.go('#/gazete') });
  const refreshButton = h('button', { class: 'btn', textContent: 'Yenile' });
  const list = h('div', { class: 'feed' });
  const status = h('p', { class: 'muted status', role: 'status' });

  const syncGenerate = () => {
    const count = app.selection.size;
    generateButton.textContent = count ? `Gazete üret (${count} yazı)` : 'Gazete üret';
    generateButton.disabled = count === 0;
    generateButton.title = count ? '' : 'Önce aşağıdan en az bir yazı işaretle';
  };

  const card = (post: Post) => {
    const checkbox = h('input', {
      type: 'checkbox',
      checked: app.selection.has(post.id),
      title: 'Gazeteye ekle',
    });
    checkbox.setAttribute('aria-label', `“${post.title}” yazısını gazeteye ekle`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) app.selection.add(post.id);
      else app.selection.delete(post.id);
      syncGenerate();
    });

    let thumb: HTMLElement | null = null;
    if (post.images.length) {
      const image = h('img', { alt: '', loading: 'lazy' });
      loadInto(app, pool, image, post.images[0].thumb);
      thumb = h(
        'a',
        { class: 'card-thumb', href: `#/yazi/${post.id}` },
        image,
        post.images.length > 1 ? h('span', { class: 'count' }, `${post.images.length} foto`) : null,
      );
    }

    return h(
      'article',
      { class: 'card' },
      h('label', { class: 'card-check' }, checkbox),
      h(
        'div',
        { class: 'card-body' },
        h('a', { class: 'card-title', href: `#/yazi/${post.id}` }, post.title),
        h('p', { class: 'muted meta' }, `${post.author} · ${formatDate(post.date)}`),
        h('p', { class: 'excerpt' }, excerpt(post)),
      ),
      thumb,
    );
  };

  const paint = () => {
    const known = new Set(app.store.posts.map((p) => p.id));
    for (const id of [...app.selection]) if (!known.has(id)) app.selection.delete(id);
    syncGenerate();
    pool.release();
    if (app.store.posts.length) {
      list.replaceChildren(...app.store.posts.map(card));
    } else {
      list.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('p', {}, 'Gazetenin ilk sayısı seni bekliyor.'),
          h('a', { class: 'btn primary', href: '#/yeni' }, 'İlk yazıyı yaz'),
        ),
      );
    }
  };

  const refresh = async () => {
    refreshButton.disabled = true;
    status.textContent = 'Güncelleniyor…';
    try {
      const before = JSON.stringify(app.store.posts.map((p) => [p.id, p.updatedAt]));
      await app.store.refresh();
      lastRefresh = Date.now();
      if (before !== JSON.stringify(app.store.posts.map((p) => [p.id, p.updatedAt]))) paint();
      status.textContent = '';
    } catch (error) {
      status.textContent = app.handleError(error);
    } finally {
      refreshButton.disabled = false;
    }
  };

  refreshButton.addEventListener('click', () => void refresh());
  paint();
  // Diğer kişinin yeni yazısı kendiliğinden gelsin.
  if (Date.now() - lastRefresh > STALE_AFTER_MS) void refresh();

  return h(
    'div',
    { class: 'page' },
    topBar(app, h('a', { class: 'btn', href: '#/yeni' }, 'Yeni yazı'), generateButton, refreshButton),
    h('main', { class: 'content' }, status, list),
  );
}
