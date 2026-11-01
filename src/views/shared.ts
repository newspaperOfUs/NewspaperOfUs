import { PAPER_NAME } from '../config';
import { h } from '../dom';
import type { App } from '../main';

export function topBar(app: App, ...actions: (HTMLElement | null | false)[]): HTMLElement {
  return h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, PAPER_NAME),
    h('div', { class: 'actions' }, ...actions),
    h(
      'div',
      { class: 'who' },
      h('span', { class: 'muted' }, app.session.name),
      h(
        'button',
        {
          class: 'link',
          onclick: () => {
            if (confirm('Çıkış yapılsın mı? Token ve önbellek bu cihazdan silinir.')) app.logout();
          },
        },
        'Çıkış',
      ),
    ),
  );
}

/** Görünüm kapanınca serbest bırakılan fotoğraf URL'leri. */
export class UrlPool {
  private urls: string[] = [];

  make(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    return url;
  }

  release() {
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls = [];
  }
}

export function loadInto(app: App, pool: UrlPool, image: HTMLImageElement, path: string) {
  app.store
    .imageBlob(path)
    .then((blob) => {
      image.src = pool.make(blob);
    })
    .catch(() => {
      image.alt = 'Fotoğraf yüklenemedi';
    });
}

export function lightbox(app: App, pool: UrlPool, paths: { path: string; caption: string }[], start: number) {
  let index = start;
  const image = h('img', { class: 'lightbox-img', alt: '' });
  const caption = h('p', { class: 'lightbox-caption' });

  const show = () => {
    const item = paths[index];
    caption.textContent = item.caption;
    image.removeAttribute('src');
    loadInto(app, pool, image, item.path);
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
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
