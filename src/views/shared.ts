import { PAPER_NAME } from '../config';
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import type { App } from '../main';
import { themeButton } from '../theme';

export function iconLink(name: IconName, label: string, href: string, extraClass = ''): HTMLAnchorElement {
  return h('a', { class: `btn ${extraClass}`, href }, icon(name), h('span', {}, label));
}

export function iconButton(name: IconName, label: string, onclick: () => void, extraClass = ''): HTMLButtonElement {
  return h('button', { class: `btn ${extraClass}`, type: 'button', onclick }, icon(name), h('span', {}, label));
}

export function topBar(...actions: (HTMLElement | null | false)[]): HTMLElement {
  return h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, PAPER_NAME),
    h('div', { class: 'actions' }, ...actions, themeButton()),
  );
}

export function logoutButton(app: App): HTMLButtonElement {
  const button = h('button', { class: 'icon-only', type: 'button', title: 'Çıkış' }, icon('logout'));
  button.setAttribute('aria-label', 'Çıkış');
  button.addEventListener('click', async () => {
    const answer = await askDialog({
      title: 'Çıkış yapılsın mı?',
      body: 'Token ve önbellek bu cihazdan silinir. Tekrar girmek için token gerekir.',
      keep: 'Kalayım',
      proceed: 'Çıkış yap',
    });
    if (answer) app.logout();
  });
  return button;
}

/** Görünüm kapanınca serbest bırakılan fotoğraf URL'leri. */
export class UrlPool {
  private urls: string[] = [];
  private closed = false;

  make(blob: Blob): string {
    // Yolda kalan bir indirme kapanmış görünüme (veya çıkış sonrasına) özel içerik bırakamasın.
    if (this.closed) throw new Error('Görünüm kapandı.');
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    return url;
  }

  release() {
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls = [];
  }

  close() {
    this.closed = true;
    this.release();
  }
}

// Görünümün dışında, body'ye eklenen katmanlar: diyalog, ışık kutusu, büyütme, yazdırma sayfası.
const overlays = new Set<() => void>();

/** Dönen işlev katman kendiliğinden kapanınca çağrılır. */
export function trackOverlay(close: () => void): () => void {
  overlays.add(close);
  return () => overlays.delete(close);
}

export function closeOverlays() {
  for (const close of [...overlays]) close();
  overlays.clear();
}

export function loadInto(app: App, pool: UrlPool, image: HTMLImageElement, path: string): Promise<void> {
  return app.store
    .imageBlob(path)
    .then((blob) => {
      image.src = pool.make(blob);
    })
    .catch(() => {
      image.alt = 'Fotoğraf yüklenemedi';
    });
}

const MAX_PARALLEL_THUMBS = 6;

/**
 * Küçük resimler ekrana yaklaşınca indirilir: 150 yazıda 150 istek atılmasın.
 * Son görünen önce yüklenir; hızlı kaydırınca geride kalanlar sırayı tutmaz.
 */
export class LazyImages {
  private paths = new WeakMap<Element, string>();
  private queue: HTMLImageElement[] = [];
  private active = 0;
  private observer: IntersectionObserver;

  constructor(
    private app: App,
    private pool: UrlPool,
  ) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer.unobserve(entry.target);
          this.queue.push(entry.target as HTMLImageElement);
        }
        this.pump();
      },
      { rootMargin: '500px 0px' },
    );
  }

  watch(image: HTMLImageElement, path: string) {
    this.paths.set(image, path);
    this.observer.observe(image);
  }

  private pump() {
    while (this.active < MAX_PARALLEL_THUMBS && this.queue.length) {
      const image = this.queue.pop()!;
      this.active++;
      void loadInto(this.app, this.pool, image, this.paths.get(image)!).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  stop() {
    this.observer.disconnect();
    this.queue = [];
  }
}

// --- Diyalog ---

export interface DialogOptions {
  title: string;
  body: string;
  keep: string;
  proceed: string;
  /** Sil düğmesi solda mı? Üç soruda yer değiştirir ki art arda tıklayarak geçilemesin. */
  proceedFirst?: boolean;
  /** Vazgeç büyür, devam küçülür: 0 normal, 2 en belirgin fark. */
  pressure?: number;
  danger?: boolean;
}

/** Evet derse true döner. Esc, arka plan veya vazgeç düğmesi hayır demektir. */
export function askDialog(options: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: `dialog pressure-${options.pressure ?? 0}${options.danger ? ' danger' : ''}` });
    const finish = (answer: boolean) => {
      untrack();
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    const untrack = trackOverlay(() => finish(false));

    const keep = h('button', { class: 'btn primary dialog-keep', type: 'button', onclick: () => finish(false) }, options.keep);
    const proceed = h('button', { class: 'btn dialog-proceed', type: 'button', onclick: () => finish(true) }, options.proceed);
    const buttons = options.proceedFirst ? [proceed, keep] : [keep, proceed];

    dialog.append(
      h('h2', { class: 'dialog-title' }, options.title),
      h('p', { class: 'dialog-body' }, options.body),
      h('div', { class: 'dialog-actions' }, ...buttons),
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    // Enter'a yanlışlıkla basan silmesin.
    keep.focus();
  });
}

export function toast(message: string) {
  document.querySelector('.toast')?.remove();
  const element = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(element);
  setTimeout(() => element.remove(), 5000);
}

// --- Fotoğraf görüntüleyici ---

export function lightbox(app: App, pool: UrlPool, paths: { path: string; caption: string }[], start: number) {
  let index = start;
  const image = h('img', { class: 'lightbox-img', alt: '' });
  const caption = h('p', { class: 'lightbox-caption' });

  const show = () => {
    const item = paths[index];
    caption.textContent = item.caption;
    image.removeAttribute('src');
    void loadInto(app, pool, image, item.path);
  };
  const close = () => {
    untrack();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const untrack = trackOverlay(close);
  const step = (delta: number) => {
    index = (index + delta + paths.length) % paths.length;
    show();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  };

  const navButton = (label: string, title: string, delta: number) => {
    const button = h('button', { class: 'lightbox-nav', title, textContent: label });
    button.setAttribute('aria-label', title);
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      step(delta);
    });
    return button;
  };

  const overlay = h(
    'div',
    { class: 'lightbox', onclick: close },
    paths.length > 1 ? navButton('‹', 'Önceki fotoğraf', -1) : null,
    h('figure', { onclick: (e: Event) => e.stopPropagation() }, image, caption),
    paths.length > 1 ? navButton('›', 'Sonraki fotoğraf', 1) : null,
  );
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  show();
}
