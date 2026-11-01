import { formatDate, h } from '../dom';
import type { App } from '../main';
import { docToHtml } from '../richtext';
import { lightbox, loadInto, topBar, UrlPool } from './shared';

export function postView(app: App, id: string): HTMLElement {
  const post = app.store.getPost(id);
  if (!post) {
    return h(
      'div',
      { class: 'page' },
      topBar(app),
      h('main', { class: 'content empty' }, h('p', {}, 'Bu yazı bulunamadı; silinmiş olabilir.'), h('a', { class: 'btn', href: '#/' }, 'Ana sayfa')),
    );
  }

  const pool = new UrlPool();
  app.cleanup = () => {
    pool.release();
    document.querySelector('.lightbox')?.remove();
  };

  const body = h('div', { class: 'prose' });
  // docToHtml şemaya bağlıdır; serbest HTML üretmez.
  body.innerHTML = docToHtml(post.doc);

  const status = h('p', { class: 'error', role: 'alert' });
  const deleteButton = h('button', { class: 'btn danger', textContent: 'Sil' });
  deleteButton.addEventListener('click', async () => {
    if (!confirm(`“${post.title}” ve fotoğrafları silinsin mi?`)) return;
    deleteButton.disabled = true;
    deleteButton.textContent = 'Siliniyor…';
    try {
      await app.store.deletePost(post);
      app.selection.delete(post.id);
      app.go('#/');
    } catch (error) {
      status.textContent = app.handleError(error);
      deleteButton.disabled = false;
      deleteButton.textContent = 'Sil';
    }
  });

  const gallery = post.images.length
    ? h(
        'div',
        { class: 'gallery' },
        post.images.map((image, index) => {
          const element = h('img', { alt: image.caption, loading: 'lazy' });
          loadInto(app, pool, element, image.thumb);
          return h(
            'button',
            {
              class: 'gallery-item',
              onclick: () => lightbox(app, pool, post.images.map(({ path, caption }) => ({ path, caption })), index),
            },
            element,
            image.caption ? h('span', { class: 'gallery-caption' }, image.caption) : null,
          );
        }),
      )
    : null;

  return h(
    'div',
    { class: 'page' },
    topBar(
      app,
      h('a', { class: 'btn', href: `#/duzenle/${post.id}` }, 'Düzenle'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            app.selection = new Set([post.id]);
            app.go('#/gazete');
          },
        },
        'Bu yazıdan gazete üret',
      ),
      deleteButton,
    ),
    h(
      'main',
      { class: 'content article' },
      status,
      h('h1', {}, post.title),
      h('p', { class: 'muted meta' }, `${post.author} · ${formatDate(post.date)}`),
      body,
      gallery,
    ),
  );
}
