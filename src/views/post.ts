import { formatDate, h } from '../dom';
import type { App } from '../main';
import { estimateLabel, estimatePosts } from '../newspaper/estimate';
import { docToHtml } from '../richtext';
import type { Post } from '../store';
import { tagChip } from './filters';
import { askDialog, iconButton, iconLink, lightbox, loadInto, toast, topBar, UrlPool } from './shared';

/** Bir anı üç soruda silinir; düğmeler her soruda yer değiştirir, yani art arda tıklayarak geçilemez. */
async function confirmDelete(app: App, post: Post): Promise<boolean> {
  const photos = post.images.length ? `${post.images.length} fotoğrafıyla birlikte ` : '';
  const mine = post.author === app.session.name;

  const first = await askDialog({
    title: 'Bu anıyı silecek misin?',
    body: `“${post.title}” ${photos}arşivden kalkacak.`,
    keep: 'Yok, kalsın',
    proceed: 'Evet, sil',
    danger: true,
  });
  if (!first) return false;

  const second = await askDialog({
    title: 'Emin misin? Gerçekten mi?',
    body: mine
      ? `${formatDate(post.date)} gününü anlatmak için oturup bunu yazmıştın. O gün o kadar mı kötüydü?`
      : `Bu yazıyı ${post.author} yazmış. ${post.author} olan bitenden haberdar mı? Bence önce bir sor.`,
    keep: 'Haklısın, kıyamadım',
    proceed: 'Eminim, sil',
    proceedFirst: true,
    pressure: 1,
    danger: true,
  });
  if (!second) return false;

  return askDialog({
    title: 'Son kararın mı?',
    body: 'Matbaa durdu, herkes sana bakıyor. Bu sayfa bir daha basılmayacak ve yazı işleri bunu asla unutmayacak. Son sözün?',
    keep: 'Tamam, vazgeçtim',
    proceed: 'Son kararım, sil',
    pressure: 2,
    danger: true,
  });
}

export function postView(app: App, id: string): HTMLElement {
  const post = app.store.getPost(id);
  if (!post) {
    return h(
      'div',
      { class: 'page' },
      topBar(),
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
  const deleteButton = iconButton(
    'trash',
    'Sil',
    async () => {
      if (!(await confirmDelete(app, post))) return;
      deleteButton.disabled = true;
      deleteButton.lastElementChild!.textContent = 'Siliniyor…';
      try {
        await app.store.deletePost(post);
        app.selection.delete(post.id);
        toast(`“${post.title}” arşivden kaldırıldı. Yazı işleri yas tutuyor.`);
        app.go('#/');
      } catch (error) {
        status.textContent = app.handleError(error);
        deleteButton.disabled = false;
        deleteButton.lastElementChild!.textContent = 'Sil';
      }
    },
    'danger',
  );

  const gallery = post.images.length
    ? h(
        'div',
        { class: 'gallery' },
        post.images.map((image, index) => {
          const element = h('img', { alt: image.caption, loading: 'lazy' });
          void loadInto(app, pool, element, image.thumb);
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

  const generate = iconButton(
    'paper',
    `Bu yazıdan gazete üret · ${estimateLabel(estimatePosts([post]))}`,
    () => {
      app.selection = new Set([post.id]);
      app.go('#/gazete');
    },
    'primary',
  );

  return h(
    'div',
    { class: 'page' },
    topBar(),
    h(
      'main',
      { class: 'content article' },
      h('a', { class: 'back', href: '#/' }, 'Tüm yazılar'),
      post.tags.length ? h('div', { class: 'card-tags article-tags' }, post.tags.map(tagChip)) : null,
      h('h1', {}, post.title),
      h('p', { class: 'meta byline' }, `${post.author} · ${formatDate(post.date)}`),
      h('div', { class: 'article-actions' }, generate, iconLink('edit', 'Düzenle', `#/duzenle/${post.id}`), deleteButton),
      status,
      body,
      gallery,
    ),
  );
}
