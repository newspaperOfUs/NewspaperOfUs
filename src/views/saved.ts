import { formatDate, h } from '../dom';
import { icon } from '../icons';
import type { App } from '../main';
import type { SavedIssue } from '../store';
import { storeZip } from '../zip';
import { frontPage } from './front';
import { printImages, saveFile, zoom } from './press';
import { askDialog, iconButton, LazyImages, toast, topBar, UrlPool } from './shared';

function savedDate(issue: SavedIssue): string {
  return formatDate(issue.savedAt.slice(0, 10));
}

function pageCount(issue: SavedIssue): string {
  return `${issue.pages.length} sayfa`;
}

function listView(app: App): HTMLElement {
  const pool = new UrlPool();
  const thumbs = new LazyImages(app, pool);
  app.cleanup = () => {
    thumbs.stop();
    pool.close();
  };

  const grid = h('div', { class: 'saved-grid' });

  const paint = () => {
    pool.release();
    if (!app.store.issues.length) {
      grid.className = 'empty';
      grid.replaceChildren(
        h('p', {}, 'Henüz kaydedilmiş gazete yok. Beğendiğin bir baskıyı üretim ekranından kaydedebilirsin.'),
        h('a', { class: 'btn primary', href: '#/gazete' }, 'Gazete üret'),
      );
      return;
    }
    grid.className = 'saved-grid';
    grid.replaceChildren(
      ...app.store.issues.map((issue) => {
        const cover = h('img', { alt: '', class: 'saved-cover' });
        thumbs.watch(cover, issue.thumb);
        return h(
          'a',
          { class: 'saved-card', href: `#/kaydedilenler/${issue.id}` },
          cover,
          h('span', { class: 'saved-title' }, issue.title),
          h('span', { class: 'meta' }, `${pageCount(issue)} · ${savedDate(issue)}`),
          h('span', { class: 'meta' }, issue.savedBy),
        );
      }),
    );
  };
  paint();

  // Diğer kişinin yeni kaydı da görünsün.
  const before = app.store.issues;
  void app.store
    .refresh()
    .then(() => {
      const after = app.store.issues;
      if (before.length !== after.length || before.some((issue, i) => issue !== after[i])) paint();
    })
    .catch(() => undefined);

  return h(
    'div',
    { class: 'page' },
    frontPage(app, 'saved'),
    h('main', { class: 'content' }, grid),
  );
}

function detailView(app: App, issue: SavedIssue): HTMLElement {
  const pool = new UrlPool();
  const pageImages = new LazyImages(app, pool);
  /** Tam boy sayfalar yalnızca gerektiğinde iner: indirme, yazdırma veya büyütme. */
  const fullUrls = new Map<number, string>();
  app.cleanup = () => {
    pageImages.stop();
    pool.close();
  };

  const status = h('p', { class: 'muted status', role: 'status' });
  const error = h('p', { class: 'error', role: 'alert' });
  const baseName = `newspaper-of-us-${issue.seed}`;

  const fullUrl = async (index: number): Promise<string> => {
    let url = fullUrls.get(index);
    if (!url) {
      url = pool.make(await app.store.imageBlob(issue.pages[index].full));
      fullUrls.set(index, url);
    }
    return url;
  };

  const busy = async (buttons: HTMLButtonElement[], work: () => Promise<void>) => {
    buttons.forEach((button) => (button.disabled = true));
    error.textContent = '';
    try {
      await work();
    } catch (e) {
      error.textContent = app.handleError(e);
    } finally {
      status.textContent = '';
      buttons.forEach((button) => (button.disabled = false));
    }
  };

  const fetchAll = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (let index = 0; index < issue.pages.length; index++) {
      status.textContent = `Sayfalar indiriliyor ${index + 1}/${issue.pages.length}…`;
      urls.push(await fullUrl(index));
    }
    return urls;
  };

  const multi = issue.pages.length > 1;
  const downloadButton = iconButton(
    'download',
    multi ? `ZIP indir (${issue.pages.length} sayfa)` : 'JPEG indir',
    () =>
      void busy(actions, async () => {
        if (!multi) {
          saveFile(await fullUrl(0), `${baseName}.jpg`);
          return;
        }
        const files = [];
        for (let index = 0; index < issue.pages.length; index++) {
          status.textContent = `Sayfalar indiriliyor ${index + 1}/${issue.pages.length}…`;
          files.push({ name: `${baseName}-sayfa${index + 1}.jpg`, blob: await app.store.imageBlob(issue.pages[index].full) });
        }
        saveFile(pool.make(await storeZip(files)), `${baseName}.zip`);
      }),
  );
  const printButton = iconButton('print', 'Yazdır', () =>
    void busy(actions, async () => {
      await printImages(await fetchAll());
    }),
  );
  const deleteButton = iconButton(
    'trash',
    'Sil',
    () =>
      void busy(actions, async () => {
        const answer = await askDialog({
          title: 'Bu gazeteyi silecek misin?',
          body: `“${issue.title}” baskısı kaydedilenlerden kalkacak. Yazılar yerinde kalır.`,
          keep: 'Kalsın',
          proceed: 'Evet, sil',
          danger: true,
        });
        if (!answer) return;
        status.textContent = 'Siliniyor…';
        await app.store.deleteIssue(issue);
        toast('Gazete kaydedilenlerden kaldırıldı.');
        app.go('#/kaydedilenler');
      }),
    'danger',
  );
  const actions = [downloadButton, printButton, deleteButton];

  const sheets = issue.pages.map((page, index) => {
    const image = h('img', { alt: `Gazete sayfa ${index + 1}`, class: 'preview-page' });
    pageImages.watch(image, page.preview);
    image.addEventListener('click', () => {
      void fullUrl(index)
        .then((url) => zoom(url, `Gazete sayfa ${index + 1}`))
        .catch((e) => {
          error.textContent = app.handleError(e);
        });
    });
    const pageLink = h('button', {
      class: 'link',
      type: 'button',
      textContent: 'Bu sayfayı indir',
      onclick: () =>
        void busy([pageLink], async () => {
          saveFile(await fullUrl(index), `${baseName}-sayfa${index + 1}.jpg`);
        }),
    });
    return h(
      'figure',
      { class: 'preview-sheet' },
      image,
      multi ? h('figcaption', {}, `Sayfa ${index + 1} / ${issue.pages.length}`, pageLink) : null,
    );
  });

  // Silinmiş yazılar başlığıyla kalır, bağlantı yalnızca hâlâ duranlara verilir.
  const included = issue.posts.map((post) =>
    h('li', {}, app.store.getPost(post.id) ? h('a', { href: `#/yazi/${post.id}` }, post.title) : post.title),
  );

  return h(
    'div',
    { class: 'page' },
    topBar(h('a', { class: 'btn', href: '#/kaydedilenler' }, 'Geri')),
    h(
      'main',
      { class: 'content saved-detail' },
      h('h1', {}, issue.title),
      h('p', { class: 'meta byline' }, `${issue.styleName} · ${pageCount(issue)} · ${issue.savedBy} · ${savedDate(issue)}`),
      h('div', { class: 'article-actions' }, downloadButton, printButton, deleteButton),
      status,
      error,
      h('details', { class: 'saved-posts' }, h('summary', {}, `İçindeki yazılar (${issue.posts.length})`), h('ul', {}, included)),
      h('div', { class: 'preview' }, sheets),
    ),
  );
}

export function savedView(app: App, id: string): HTMLElement {
  if (!id) return listView(app);
  const issue = app.store.getIssue(id);
  if (issue) return detailView(app, issue);
  return h(
    'div',
    { class: 'page' },
    topBar(),
    h(
      'main',
      { class: 'content empty' },
      h('p', {}, 'Bu gazete bulunamadı; silinmiş olabilir.'),
      h('a', { class: 'btn', href: '#/kaydedilenler' }, icon('back'), 'Kaydedilenler'),
    ),
  );
}
