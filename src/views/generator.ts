import { PAPER_NAME } from '../config';
import { h, nextPaint } from '../dom';
import { blobToImage } from '../images';
import type { App } from '../main';
import { renderNewspaper, type NewspaperPost } from '../newspaper';
import type { Post } from '../store';
import { topBar, UrlPool } from './shared';

interface Rendered {
  seed: number;
  styleName: string;
  pages: { url: string; blob: Blob }[];
}

interface HistoryItem {
  seed: number;
  styleName: string;
  thumb: string;
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG oluşturulamadı.'))), 'image/png');
  });
}

function thumbnail(canvas: HTMLCanvasElement): string {
  const thumb = document.createElement('canvas');
  thumb.width = 180;
  thumb.height = Math.round((canvas.height / canvas.width) * 180);
  const ctx = thumb.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/jpeg', 0.75);
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

export function generatorView(app: App): HTMLElement {
  const pool = new UrlPool();
  const images = new Map<string, HTMLImageElement>();
  const history: HistoryItem[] = [];
  let current: Rendered | null = null;
  let busy = false;

  const chooser = h('div', { class: 'chooser' });
  const generateButton = h('button', { class: 'btn primary big', textContent: 'Gazete üret' });
  const downloadButton = h('button', { class: 'btn', textContent: 'PNG indir', disabled: true });
  const printButton = h('button', { class: 'btn', textContent: 'Yazdır', disabled: true });
  const status = h('p', { class: 'muted status', role: 'status' });
  const error = h('p', { class: 'error', role: 'alert' });
  const preview = h('div', { class: 'preview' });
  const historyStrip = h('div', { class: 'history' });

  const selectedPosts = () => app.store.posts.filter((p) => app.selection.has(p.id));

  const invalidate = () => {
    // Seçim değişince eski tasarımlar başka içeriğe ait olur.
    history.length = 0;
    historyStrip.replaceChildren();
    syncButtons();
  };

  const syncButtons = () => {
    const count = app.selection.size;
    generateButton.disabled = busy || count === 0;
    generateButton.textContent = current ? 'Yeniden üret' : 'Gazete üret';
    downloadButton.disabled = busy || !current;
    printButton.disabled = busy || !current;
    downloadButton.textContent = current && current.pages.length > 1 ? `PNG indir (${current.pages.length} sayfa)` : 'PNG indir';
  };

  const paintChooser = () => {
    chooser.replaceChildren(
      ...app.store.posts.map((post) => {
        const checkbox = h('input', { type: 'checkbox', checked: app.selection.has(post.id) });
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) app.selection.add(post.id);
          else app.selection.delete(post.id);
          invalidate();
        });
        return h(
          'label',
          { class: 'chooser-item' },
          checkbox,
          h('span', {}, post.title),
          h('span', { class: 'muted' }, ` · ${post.author}${post.images.length ? ` · ${post.images.length} foto` : ''}`),
        );
      }),
    );
  };

  const paintPreview = () => {
    if (!current) {
      preview.replaceChildren();
      return;
    }
    preview.replaceChildren(
      ...current.pages.map(({ url }, index) => {
        const image = h('img', { src: url, alt: `Gazete sayfa ${index + 1}`, class: 'preview-page' });
        image.addEventListener('click', () => image.classList.toggle('zoomed'));
        return image;
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

  async function loadPhotos(posts: Post[]): Promise<NewspaperPost[]> {
    const paths = posts.flatMap((p) => p.images.map((i) => i.path)).filter((path) => !images.has(path));
    let done = 0;
    for (const path of paths) {
      status.textContent = `Fotoğraflar indiriliyor ${++done}/${paths.length}…`;
      images.set(path, await blobToImage(await app.store.imageBlob(path)));
    }
    return posts.map((post) => ({
      id: post.id,
      title: post.title,
      author: post.author,
      date: post.date,
      doc: post.doc,
      photos: post.images.map((image) => {
        const element = images.get(image.path)!;
        return { source: element, w: element.naturalWidth, h: element.naturalHeight, caption: image.caption };
      }),
    }));
  }

  async function generate(seed: number) {
    if (busy) return;
    const posts = selectedPosts();
    if (!posts.length) return;
    busy = true;
    error.textContent = '';
    syncButtons();
    preview.classList.add('dim');

    try {
      const input = await loadPhotos(posts);
      status.textContent = 'Dizgi yapılıyor, mürekkep kuruyor…';
      await nextPaint();
      const result = await renderNewspaper({
        name: PAPER_NAME,
        posts: input,
        seed,
        ...issueNumbers(app.store.posts, posts),
      });

      const thumb = thumbnail(result.pages[0]);
      status.textContent = 'PNG hazırlanıyor…';
      await nextPaint();
      const pages: Rendered['pages'] = [];
      for (const canvas of result.pages) {
        const blob = await toBlob(canvas);
        pages.push({ blob, url: pool.make(blob) });
        canvas.width = 0;
      }

      current = { seed, styleName: result.styleName, pages };
      if (!history.some((item) => item.seed === seed)) {
        history.unshift({ seed, styleName: result.styleName, thumb });
      }
      status.textContent = `${result.styleName} · ${pages.length > 1 ? `${pages.length} sayfa · ` : ''}beğenmezsen yeniden üret`;
      paintPreview();
      paintHistory();
    } catch (e) {
      error.textContent = app.handleError(e);
      status.textContent = '';
    } finally {
      busy = false;
      preview.classList.remove('dim');
      syncButtons();
    }
  }

  generateButton.addEventListener('click', () => void generate(randomSeed()));

  downloadButton.addEventListener('click', async () => {
    if (!current) return;
    const { pages, seed } = current;
    for (const [index, page] of pages.entries()) {
      const suffix = pages.length > 1 ? `-sayfa${index + 1}` : '';
      const link = h('a', { href: page.url, download: `newspaper-of-us-${seed}${suffix}.png` });
      document.body.append(link);
      link.click();
      link.remove();
      // Tarayıcılar art arda indirmeleri birleştirip düşürebiliyor.
      if (index < pages.length - 1) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  });

  printButton.addEventListener('click', async () => {
    if (!current) return;
    const sheet = h(
      'div',
      { id: 'print-sheet' },
      current.pages.map(({ url }) => h('img', { src: url, alt: '' })),
    );
    document.body.append(sheet);
    await Promise.all([...sheet.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
    const clear = () => {
      sheet.remove();
      window.removeEventListener('afterprint', clear);
    };
    window.addEventListener('afterprint', clear);
    window.print();
  });

  app.cleanup = () => {
    pool.release();
    document.getElementById('print-sheet')?.remove();
  };

  paintChooser();
  syncButtons();
  if (app.selection.size) void generate(randomSeed());

  const empty = app.store.posts.length === 0;
  return h(
    'div',
    { class: 'page' },
    topBar(app, h('a', { class: 'btn', href: '#/' }, 'Geri')),
    h(
      'main',
      { class: 'content generator' },
      empty
        ? h('div', { class: 'empty' }, h('p', {}, 'Önce bir yazı eklemelisin.'), h('a', { class: 'btn primary', href: '#/yeni' }, 'Yazı ekle'))
        : h(
            'div',
            {},
            h('h2', {}, 'Hangi yazılar girsin?'),
            chooser,
            h('div', { class: 'row generator-actions' }, generateButton, downloadButton, printButton),
            status,
            error,
            historyStrip,
            preview,
          ),
    ),
  );
}
