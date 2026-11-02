import { formatDate, h } from '../dom';
import { excerptOf, filterPosts, isFiltering, searchTerms } from '../filter';
import { icon } from '../icons';
import type { App } from '../main';
import { estimateLabel, estimatePosts } from '../newspaper/estimate';
import type { Post } from '../store';
import { clearFilterButton, filterBar, highlighted, tagChip } from './filters';
import { frontPage } from './front';
import { iconLink, LazyImages, UrlPool } from './shared';

const STALE_AFTER_MS = 30_000;
let lastRefresh = Date.now();

function monthOf(post: Post): string {
  const [y, m] = post.date.split('-').map(Number);
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(y, (m || 1) - 1, 1));
}

export function feedView(app: App): HTMLElement {
  const pool = new UrlPool();
  const thumbs = new LazyImages(app, pool);
  app.cleanup = () => {
    thumbs.stop();
    pool.close();
  };

  const list = h('div', { class: 'feed' });
  const status = h('p', { class: 'muted status', role: 'status' });
  const count = h('span', { class: 'result-count' });
  const selectAll = h('button', { class: 'link', type: 'button' });
  const refreshButton = h('button', { class: 'link', type: 'button', textContent: 'Yenile' });

  const generateButton = h('button', { class: 'btn primary dock-main', type: 'button', onclick: () => app.go('#/gazete') });
  const clearSelection = h('button', { class: 'icon-only', type: 'button', title: 'Seçimi temizle' }, icon('close'));
  clearSelection.setAttribute('aria-label', 'Seçimi temizle');

  // Kartlar bir kez kurulur: aramada her tuşta küçük resimler yeniden yüklenmesin.
  const cards = new Map<string, { element: HTMLElement; checkbox: HTMLInputElement; title: HTMLElement; excerpt: HTMLElement; post: Post }>();
  let visible: Post[] = [];

  const selectedPosts = () => app.store.posts.filter((p) => app.selection.has(p.id));

  const syncDock = () => {
    const selected = selectedPosts();
    const label = selected.length
      ? [`${selected.length} yazı`, estimateLabel(estimatePosts(selected))].join(' · ')
      : '';
    generateButton.replaceChildren(
      icon('paper'),
      h('span', {}, 'Gazete üret'),
      label ? h('small', {}, label) : '',
    );
    clearSelection.hidden = selected.length === 0;
    for (const { element, checkbox, post } of cards.values()) {
      const on = app.selection.has(post.id);
      checkbox.checked = on;
      element.classList.toggle('selected', on);
    }
    const allOn = visible.length > 0 && visible.every((p) => app.selection.has(p.id));
    selectAll.textContent = allOn ? 'Seçimi kaldır' : 'Hepsini seç';
    selectAll.hidden = visible.length === 0;
  };

  const buildCard = (post: Post) => {
    const checkbox = h('input', { type: 'checkbox', class: 'check', title: 'Gazeteye ekle' });
    checkbox.setAttribute('aria-label', `“${post.title}” yazısını gazeteye ekle`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) app.selection.add(post.id);
      else app.selection.delete(post.id);
      syncDock();
    });

    let thumb: HTMLElement | null = null;
    if (post.images.length) {
      const image = h('img', { alt: '' });
      thumbs.watch(image, post.images[0].thumb);
      thumb = h(
        'div',
        { class: 'card-thumb' },
        image,
        post.images.length > 1 ? h('span', { class: 'count' }, String(post.images.length)) : null,
      );
    }

    const title = h('a', { class: 'card-title', href: `#/yazi/${post.id}` }, post.title);
    const excerpt = h('p', { class: 'excerpt' });
    const element = h(
      'article',
      { class: 'card' },
      h('label', { class: 'card-check' }, checkbox),
      h(
        'div',
        { class: 'card-body' },
        title,
        h('p', { class: 'meta' }, `${post.author} · ${formatDate(post.date)}`),
        excerpt,
        post.tags.length ? h('div', { class: 'card-tags' }, post.tags.map(tagChip)) : null,
      ),
      thumb,
    );
    cards.set(post.id, { element, checkbox, title, excerpt, post });
  };

  const paintList = () => {
    visible = filterPosts(app.store.posts, app.filter);
    const terms = searchTerms(app.filter.query);
    const filtering = isFiltering(app.filter);

    count.textContent = filtering ? `${visible.length} / ${app.store.posts.length} yazı` : `${visible.length} yazı`;
    clearFilter.hidden = !filtering;

    if (!visible.length) {
      list.replaceChildren(
        app.store.posts.length
          ? h('div', { class: 'empty' }, h('p', {}, 'Bu aramayla eşleşen yazı yok.'))
          : h(
              'div',
              { class: 'empty' },
              h('p', {}, 'Gazetenin ilk sayısı seni bekliyor.'),
              h('a', { class: 'btn primary', href: '#/yeni' }, 'İlk yazıyı yaz'),
            ),
      );
      syncDock();
      return;
    }

    // 150 yazı tek uzun listede kaybolmasın: aylara ayrılır.
    const months: { name: string; cards: HTMLElement[] }[] = [];
    for (const post of visible) {
      const card = cards.get(post.id)!;
      card.title.replaceChildren(...highlighted(post.title, terms));
      card.excerpt.replaceChildren(...highlighted(excerptOf(post, terms), terms));
      const name = monthOf(post);
      const last = months.at(-1);
      if (last?.name === name) last.cards.push(card.element);
      else months.push({ name, cards: [card.element] });
    }
    list.replaceChildren(
      ...months.map((month) =>
        h(
          'section',
          { class: 'month' },
          h('h2', { class: 'month-title' }, month.name, h('span', { class: 'month-count' }, String(month.cards.length))),
          h('div', { class: 'cards' }, month.cards),
        ),
      ),
    );
    syncDock();
  };

  // Listenin ortasındayken filtre değişirse sonuçların başına dön.
  const onFilter = () => {
    paintList();
    const top = list.getBoundingClientRect().top + window.scrollY - filters.element.offsetHeight - 8;
    if (window.scrollY > top) window.scrollTo(0, top);
  };
  const filters = filterBar(app, onFilter);
  const clearFilter = clearFilterButton(app, onFilter, filters.reset);

  const paint = () => {
    const known = new Set(app.store.posts.map((p) => p.id));
    for (const id of [...app.selection]) if (!known.has(id)) app.selection.delete(id);
    pool.release();
    cards.clear();
    app.store.posts.forEach(buildCard);
    filters.repaint();
    paintList();
  };

  selectAll.addEventListener('click', () => {
    const allOn = visible.every((p) => app.selection.has(p.id));
    for (const post of visible) {
      if (allOn) app.selection.delete(post.id);
      else app.selection.add(post.id);
    }
    syncDock();
  });
  clearSelection.addEventListener('click', () => {
    app.selection.clear();
    syncDock();
  });

  const refresh = async () => {
    refreshButton.disabled = true;
    status.textContent = 'Güncelleniyor…';
    try {
      const before = app.store.posts;
      await app.store.refresh();
      lastRefresh = Date.now();
      const after = app.store.posts;
      // Yazı nesneleri yalnızca içerik değişince yenilenir.
      if (before.length !== after.length || before.some((post, i) => post !== after[i])) paint();
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
    { class: 'page page-home' },
    frontPage(app, 'posts'),
    filters.element,
    h(
      'main',
      { class: 'content' },
      h('div', { class: 'result-line' }, count, clearFilter, h('span', { class: 'spacer' }), selectAll, refreshButton),
      app.store.unreadable
        ? h('p', { class: 'banner', role: 'status' }, `${app.store.unreadable} dosya bozuk olduğu için gösterilmiyor. Veri reposunu kontrol et.`)
        : null,
      status,
      list,
    ),
    h(
      'div',
      { class: 'dock' },
      h('div', { class: 'dock-inner' }, iconLink('plus', 'Yeni yazı', '#/yeni', 'dock-new'), generateButton, clearSelection),
    ),
  );
}
