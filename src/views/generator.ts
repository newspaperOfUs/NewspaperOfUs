import { PAPER_NAME } from '../config';
import { h, nextPaint } from '../dom';
import { filterPosts, isFiltering } from '../filter';
import { icon } from '../icons';
import type { App } from '../main';
import { CancelledError, renderNewspaper, type NewspaperPost } from '../newspaper';
import { estimateLabel, estimatePosts } from '../newspaper/estimate';
import type { Post } from '../store';
import { storeZip } from '../zip';
import { clearFilterButton, filterBar } from './filters';
import { iconButton, topBar, UrlPool } from './shared';

interface RenderedPage {
  png: Blob;
  pngUrl: string;
  previewUrl: string;
}

interface Rendered {
  seed: number;
  styleName: string;
  pages: RenderedPage[];
  pool: UrlPool;
}

interface HistoryItem {
  seed: number;
  styleName: string;
  thumb: string;
}

/** Ekrandaki önizleme küçük tutulur; telefonda 20 tam boy sayfa belleğe sığmaz. */
const PREVIEW_WIDTH = 1240;

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Sayfa dosyaya çevrilemedi.'))), type, quality);
  });
}

function scaled(canvas: HTMLCanvasElement, width: number): HTMLCanvasElement {
  const small = document.createElement('canvas');
  small.width = width;
  small.height = Math.round((canvas.height / canvas.width) * width);
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return small;
}

/** Cilt numarası ilk yazının yılından, sayı numarası o tarihe kadarki yazı sayısından gelir. */
function issueNumbers(all: Post[], selected: Post[]) {
  const latest = selected.map((p) => p.date).sort().at(-1)!;
  const firstYear = Math.min(...all.map((p) => Number(p.date.slice(0, 4))));
  return {
    volume: Number(latest.slice(0, 4)) - firstYear + 1,
    issueNumber: all.filter((p) => p.date <= latest).length,
  };
}

function saveFile(href: string, name: string) {
  const link = h('a', { href, download: name });
  document.body.append(link);
  link.click();
  link.remove();
}

function zoom(url: string, alt: string) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const overlay = h('div', { class: 'zoom', onclick: close }, h('img', { src: url, alt }));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
}

export function generatorView(app: App): HTMLElement {
  const history: HistoryItem[] = [];
  let current: Rendered | null = null;
  let running: AbortController | null = null;

  const narrow = window.matchMedia('(max-width: 60rem)').matches;
  const chooser = h('div', { class: 'chooser' });
  const generateLabel = h('span', {});
  const generateInfo = h('small', {});
  const generateButton = h('button', { class: 'btn primary dock-main' }, icon('paper'), generateLabel, generateInfo);
  const downloadLabel = h('span', {}, 'PNG indir');
  const downloadButton = h('button', { class: 'btn', disabled: true }, icon('download'), downloadLabel);
  const printButton = iconButton('print', 'Yazdır', () => void print());
  printButton.disabled = true;
  const cancelButton = h('button', { class: 'link', type: 'button', textContent: 'İptal', hidden: true, onclick: () => running?.abort() });
  const status = h('p', { class: 'muted status', role: 'status' });
  const progressBar = h('div', { class: 'progress-bar' });
  const progress = h('div', { class: 'progress', hidden: true }, progressBar);
  const error = h('p', { class: 'error', role: 'alert' });
  const preview = h('div', { class: 'preview' });
  const historyStrip = h('div', { class: 'history' });
  const summaryText = h('span', {});
  const selectAll = h('button', { class: 'link', type: 'button' });
  const resultCount = h('span', { class: 'result-count' });
  const panel = h('details', { class: 'chooser-panel', open: !narrow || app.selection.size === 0 });

  let visible: Post[] = [];

  const selectedPosts = () => app.store.posts.filter((p) => app.selection.has(p.id));

  const syncButtons = () => {
    const selected = selectedPosts();
    const busy = running !== null;
    generateButton.disabled = busy || selected.length === 0;
    generateLabel.textContent = current ? 'Yeniden üret' : 'Gazete üret';
    generateInfo.textContent = selected.length ? `${selected.length} yazı · ${estimateLabel(estimatePosts(selected))}` : 'Önce yazı seç';
    downloadButton.disabled = busy || !current;
    printButton.disabled = busy || !current;
    downloadLabel.textContent = current && current.pages.length > 1 ? `ZIP indir (${current.pages.length} sayfa)` : 'PNG indir';
    summaryText.textContent = selected.length ? `Hangi yazılar girsin? (${selected.length} seçili)` : 'Hangi yazılar girsin?';
    const allOn = visible.length > 0 && visible.every((p) => app.selection.has(p.id));
    selectAll.textContent = allOn ? 'Seçimi kaldır' : 'Hepsini seç';
    selectAll.hidden = visible.length === 0;
  };

  const invalidate = () => {
    // Seçim değişince eski tasarımlar başka içeriğe ait olur.
    history.length = 0;
    historyStrip.replaceChildren();
    if (current && !running) {
      status.textContent = 'Seçim değişti: görünen gazete eski seçime ait. Yeniden üretebilirsin.';
    }
    syncButtons();
  };

  const paintChooser = () => {
    visible = filterPosts(app.store.posts, app.filter);
    resultCount.textContent = isFiltering(app.filter) ? `${visible.length} / ${app.store.posts.length} yazı` : `${visible.length} yazı`;
    clearFilter.hidden = !isFiltering(app.filter);
    chooser.replaceChildren(
      ...(visible.length
        ? visible.map((post) => {
            const checkbox = h('input', { type: 'checkbox', class: 'check', checked: app.selection.has(post.id) });
            checkbox.addEventListener('change', () => {
              if (checkbox.checked) app.selection.add(post.id);
              else app.selection.delete(post.id);
              invalidate();
            });
            const details = [post.author, post.date.split('-').reverse().join('.')];
            if (post.images.length) details.push(`${post.images.length} foto`);
            return h(
              'label',
              { class: 'chooser-item' },
              checkbox,
              h('span', { class: 'chooser-text' }, h('span', { class: 'chooser-title' }, post.title), h('span', { class: 'meta' }, details.join(' · '))),
            );
          })
        : [h('p', { class: 'muted chooser-empty' }, 'Bu aramayla eşleşen yazı yok.')]),
    );
    syncButtons();
  };

  const filters = filterBar(app, paintChooser);
  const clearFilter = clearFilterButton(app, paintChooser, filters.reset);

  selectAll.addEventListener('click', () => {
    const allOn = visible.every((p) => app.selection.has(p.id));
    for (const post of visible) {
      if (allOn) app.selection.delete(post.id);
      else app.selection.add(post.id);
    }
    paintChooser();
    invalidate();
  });

  const paintPreview = () => {
    if (!current) {
      preview.replaceChildren();
      return;
    }
    const { pages, seed } = current;
    preview.replaceChildren(
      ...pages.map(({ previewUrl, pngUrl }, index) => {
        const image = h('img', { src: previewUrl, alt: `Gazete sayfa ${index + 1}`, class: 'preview-page', loading: 'lazy' });
        image.addEventListener('click', () => zoom(pngUrl, `Gazete sayfa ${index + 1}`));
        return h(
          'figure',
          { class: 'preview-sheet' },
          image,
          pages.length > 1
            ? h(
                'figcaption',
                {},
                `Sayfa ${index + 1} / ${pages.length}`,
                h('a', { class: 'link', href: pngUrl, download: `newspaper-of-us-${seed}-sayfa${index + 1}.png` }, 'Bu sayfayı indir'),
              )
            : null,
        );
      }),
    );
  };

  const paintHistory = () => {
    historyStrip.replaceChildren(
      ...history.map((item) => {
        const button = h(
          'button',
          {
            class: `history-item${current?.seed === item.seed ? ' on' : ''}`,
            title: item.styleName,
            onclick: () => void generate(item.seed),
          },
          h('img', { src: item.thumb, alt: item.styleName }),
        );
        button.setAttribute('aria-label', `Bu tasarıma dön: ${item.styleName}`);
        return button;
      }),
    );
  };

  function toInput(posts: Post[]): NewspaperPost[] {
    return posts.map((post) => ({
      id: post.id,
      title: post.title,
      author: post.author,
      date: post.date,
      doc: post.doc,
      photos: post.images.map((image) => ({
        w: image.w,
        h: image.h,
        caption: image.caption,
        load: async () => createImageBitmap(await app.store.imageBlob(image.path)),
      })),
    }));
  }

  async function generate(seed: number) {
    if (running) return;
    const posts = selectedPosts();
    if (!posts.length) return;
    const controller = new AbortController();
    running = controller;
    error.textContent = '';
    cancelButton.hidden = false;
    progress.hidden = false;
    progressBar.style.width = '4%';
    syncButtons();
    preview.classList.add('dim');
    if (narrow) panel.open = false;

    const pool = new UrlPool();
    const pages: RenderedPage[] = [];
    let thumb = '';

    try {
      const result = await renderNewspaper(
        { name: PAPER_NAME, posts: toInput(posts), seed, ...issueNumbers(app.store.posts, posts) },
        {
          signal: controller.signal,
          onProgress: ({ stage, page, total }) => {
            if (stage === 'layout') {
              status.textContent = `Dizgi yapılıyor, sayfa ${page}…`;
            } else {
              status.textContent = `Baskıda, sayfa ${page} / ${total}…`;
              progressBar.style.width = `${Math.round(((page - 0.5) / total!) * 100)}%`;
            }
          },
          onPage: async (canvas, index) => {
            if (index === 0) {
              const small = scaled(canvas, 180);
              thumb = small.toDataURL('image/jpeg', 0.75);
              small.width = 0;
            }
            const png = await toBlob(canvas, 'image/png');
            const small = scaled(canvas, PREVIEW_WIDTH);
            const jpeg = await toBlob(small, 'image/jpeg', 0.86);
            small.width = 0;
            pages.push({ png, pngUrl: pool.make(png), previewUrl: pool.make(jpeg) });
            await nextPaint();
          },
        },
      );

      current?.pool.release();
      current = { seed, styleName: result.styleName, pages, pool };
      if (!history.some((item) => item.seed === seed)) {
        history.unshift({ seed, styleName: result.styleName, thumb });
      }
      status.textContent = `${result.styleName} · ${pages.length} sayfa · beğenmezsen yeniden üret`;
      paintPreview();
      paintHistory();
    } catch (e) {
      pool.release();
      if (e instanceof CancelledError) {
        status.textContent = 'Baskı iptal edildi.';
      } else {
        error.textContent = app.handleError(e);
        status.textContent = '';
      }
    } finally {
      running = null;
      cancelButton.hidden = true;
      progress.hidden = true;
      preview.classList.remove('dim');
      syncButtons();
    }
  }

  async function print() {
    if (!current) return;
    const sheet = h(
      'div',
      { id: 'print-sheet' },
      current.pages.map(({ pngUrl }) => h('img', { src: pngUrl, alt: '' })),
    );
    document.body.append(sheet);
    await Promise.all([...sheet.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
    const clear = () => {
      sheet.remove();
      window.removeEventListener('afterprint', clear);
    };
    window.addEventListener('afterprint', clear);
    window.print();
  }

  generateButton.addEventListener('click', () => void generate(randomSeed()));

  downloadButton.addEventListener('click', async () => {
    if (!current) return;
    const { pages, seed } = current;
    if (pages.length === 1) {
      saveFile(pages[0].pngUrl, `newspaper-of-us-${seed}.png`);
      return;
    }
    downloadButton.disabled = true;
    downloadLabel.textContent = 'ZIP hazırlanıyor…';
    try {
      const zip = await storeZip(pages.map((page, i) => ({ name: `newspaper-of-us-${seed}-sayfa${i + 1}.png`, blob: page.png })));
      const url = URL.createObjectURL(zip);
      saveFile(url, `newspaper-of-us-${seed}.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      error.textContent = app.handleError(e);
    } finally {
      syncButtons();
    }
  });

  app.cleanup = () => {
    running?.abort();
    current?.pool.release();
    document.getElementById('print-sheet')?.remove();
    document.querySelector('.zoom')?.remove();
  };

  panel.append(
    h('summary', {}, summaryText),
    h(
      'div',
      { class: 'chooser-body' },
      filters.element,
      h('div', { class: 'result-line' }, resultCount, clearFilter, h('span', { class: 'spacer' }), selectAll),
      chooser,
    ),
  );

  paintChooser();
  if (app.selection.size) void generate(randomSeed());

  const empty = app.store.posts.length === 0;
  return h(
    'div',
    { class: 'page page-generator' },
    topBar(h('a', { class: 'btn', href: '#/' }, 'Geri')),
    empty
      ? h('main', { class: 'content empty' }, h('p', {}, 'Önce bir yazı eklemelisin.'), h('a', { class: 'btn primary', href: '#/yeni' }, 'Yazı ekle'))
      : h(
          'main',
          { class: 'generator' },
          panel,
          h(
            'section',
            { class: 'press' },
            h('div', { class: 'press-actions' }, downloadButton, printButton),
            h('div', { class: 'press-status' }, status, cancelButton),
            progress,
            error,
            historyStrip,
            preview,
          ),
        ),
    empty ? null : h('div', { class: 'dock' }, h('div', { class: 'dock-inner' }, generateButton)),
  );
}
