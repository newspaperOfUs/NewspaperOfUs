import { h, todayIso } from '../dom';
import { prepareImage } from '../images';
import type { App } from '../main';
import { createRichEditor } from '../richtext';
import { clearDraft, loadDraft, saveDraft } from '../session';
import { ConflictError, newPostId, type NewImage, type Post, type PostImage } from '../store';
import { loadInto, topBar, UrlPool } from './shared';

interface Draft {
  title: string;
  date: string;
  doc: unknown;
  /** Taslağın başladığı sürüm: geri yüklenince de çakışma kontrolü buna göre yapılır. */
  baseSha: string | null;
}

type GalleryItem =
  | { kind: 'saved'; image: PostImage; caption: string }
  | { kind: 'new'; image: NewImage; caption: string; url: string };

export function editorView(app: App, id: string | null): HTMLElement {
  const existing = id ? app.store.getPost(id) : undefined;
  if (id && !existing) {
    return h(
      'div',
      { class: 'page' },
      topBar(app),
      h('main', { class: 'content empty' }, h('p', {}, 'Bu yazı bulunamadı; silinmiş olabilir.'), h('a', { class: 'btn', href: '#/' }, 'Ana sayfa')),
    );
  }

  const session = app.session;
  const draftKey = id ?? 'new';
  const draft = loadDraft<Draft>(session, draftKey);
  const baseSha = draft ? draft.baseSha : id ? app.store.postSha(id) : null;
  const pool = new UrlPool();
  let dirty = false;
  let saving = false;
  let draftTimer = 0;

  const markDirty = () => {
    dirty = true;
    clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      saveDraft(session, draftKey, { title: title.value, date: date.value, doc: rich.getDoc(), baseSha } satisfies Draft);
    }, 700);
  };

  const title = h('input', {
    type: 'text',
    class: 'title-input',
    placeholder: 'Başlık',
    maxLength: 160,
    value: draft?.title ?? existing?.title ?? '',
    oninput: markDirty,
  });
  title.setAttribute('aria-label', 'Başlık');

  const date = h('input', {
    type: 'date',
    value: draft?.date ?? existing?.date ?? todayIso(),
    oninput: markDirty,
  });
  date.setAttribute('aria-label', 'Anının tarihi');

  const rich = createRichEditor(draft?.doc ?? existing?.doc, markDirty);

  // --- Galeri ---
  const items: GalleryItem[] = (existing?.images ?? []).map((image) => ({
    kind: 'saved',
    image,
    caption: image.caption,
  }));
  const removed: PostImage[] = [];
  const galleryGrid = h('div', { class: 'gallery-edit' });
  const errorLine = h('p', { class: 'error', role: 'alert' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const addButton = h('button', {
    type: 'button',
    class: 'btn',
    textContent: 'Fotoğraf ekle',
    onclick: () => fileInput.click(),
  });

  const paintGallery = () => {
    galleryGrid.replaceChildren(
      ...items.map((item, index) => {
        const image = h('img', { alt: '' });
        if (item.kind === 'saved') loadInto(app, pool, image, item.image.thumb);
        else image.src = item.url;

        const caption = h('input', {
          type: 'text',
          class: 'caption-input',
          placeholder: 'Altyazı (isteğe bağlı)',
          maxLength: 160,
          value: item.caption,
          oninput: () => {
            item.caption = caption.value;
            markDirty();
          },
        });
        caption.setAttribute('aria-label', 'Fotoğraf altyazısı');

        const move = (delta: number) => {
          const target = index + delta;
          if (target < 0 || target >= items.length) return;
          [items[index], items[target]] = [items[target], items[index]];
          markDirty();
          paintGallery();
        };

        const iconButton = (label: string, name: string, onclick: () => void, disabled = false) => {
          const button = h('button', { type: 'button', class: 'icon-btn', title: name, textContent: label, onclick, disabled });
          button.setAttribute('aria-label', name);
          return button;
        };

        return h(
          'div',
          { class: 'gallery-edit-item' },
          image,
          h(
            'div',
            { class: 'gallery-edit-actions' },
            iconButton('←', 'Öne al', () => move(-1), index === 0),
            iconButton('→', 'Arkaya al', () => move(1), index === items.length - 1),
            iconButton('✕', 'Fotoğrafı kaldır', () => {
              items.splice(index, 1);
              if (item.kind === 'saved') removed.push(item.image);
              markDirty();
              paintGallery();
            }),
          ),
          caption,
        );
      }),
    );
  };

  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (!files.length) return;
    addButton.disabled = true;
    errorLine.textContent = '';
    for (const [index, file] of files.entries()) {
      addButton.textContent = `İşleniyor ${index + 1}/${files.length}…`;
      try {
        const image = await prepareImage(file);
        items.push({ kind: 'new', image, caption: '', url: pool.make(image.thumb) });
        paintGallery();
        markDirty();
      } catch (error) {
        errorLine.textContent = error instanceof Error ? error.message : 'Fotoğraf eklenemedi.';
      }
    }
    addButton.disabled = false;
    addButton.textContent = 'Fotoğraf ekle';
  });

  // --- Kaydet ---
  const saveButton = h('button', { class: 'btn primary', textContent: existing ? 'Kaydet' : 'Yayınla' });
  const idleLabel = saveButton.textContent;

  saveButton.addEventListener('click', async () => {
    errorLine.textContent = '';
    if (!title.value.trim()) {
      errorLine.textContent = 'Bir başlık yazmalısın.';
      title.focus();
      return;
    }
    if (rich.isEmpty() && items.length === 0) {
      errorLine.textContent = 'Yazı veya en az bir fotoğraf eklemelisin.';
      return;
    }

    saving = true;
    saveButton.disabled = true;
    const now = new Date().toISOString();
    const dateValue = date.value || todayIso();

    // Yeni fotoğraflar savePost içinde sona eklenir; sırayı ve altyazıları sonra birleştiriyoruz.
    const newOnes = items.filter((i): i is Extract<GalleryItem, { kind: 'new' }> => i.kind === 'new');
    const post: Post = {
      id: existing?.id ?? newPostId(dateValue),
      title: title.value.trim(),
      author: existing?.author ?? session.name,
      date: dateValue,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      doc: rich.getDoc(),
      images: items
        .filter((i): i is Extract<GalleryItem, { kind: 'saved' }> => i.kind === 'saved')
        .map((i) => ({ ...i.image, caption: i.caption.trim() })),
    };
    const order = items.map((i) => (i.kind === 'saved' ? i.image.path : newOnes.indexOf(i)));

    try {
      await app.store.savePost(
        post,
        newOnes.map((i) => ({ ...i.image, caption: i.caption.trim() })),
        removed,
        baseSha,
        order,
        (done, total) => {
          saveButton.textContent = `Yükleniyor ${Math.round((done / total) * 100)}%`;
        },
      );
      clearTimeout(draftTimer);
      clearDraft(session, draftKey);
      dirty = false;
      app.go(`#/yazi/${post.id}`);
    } catch (error) {
      errorLine.textContent =
        error instanceof ConflictError
          ? 'Bu yazı sen düzenlerken diğer cihazdan değiştirilmiş. Üzerine yazmamak için kaydedilmedi: metnini kopyala, sayfayı yenile, “Taslağı at” de ve güncel hâline ekle.'
          : app.handleError(error);
      saveButton.disabled = false;
      saveButton.textContent = idleLabel;
    } finally {
      saving = false;
    }
  });

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty || saving) event.preventDefault();
  };
  window.addEventListener('beforeunload', beforeUnload);

  app.leaveGuard = () => !dirty || confirm('Kaydedilmemiş değişiklikler var. Çıkılsın mı? (Metin taslak olarak saklanır.)');
  app.cleanup = () => {
    clearTimeout(draftTimer);
    window.removeEventListener('beforeunload', beforeUnload);
    rich.destroy();
    pool.release();
  };

  paintGallery();

  const draftNotice = draft
    ? h(
        'p',
        { class: 'banner' },
        'Kaydedilmemiş taslağın geri yüklendi. ',
        h(
          'button',
          {
            class: 'link',
            onclick: () => {
              clearDraft(session, draftKey);
              dirty = false;
              location.reload();
            },
          },
          'Taslağı at',
        ),
      )
    : null;

  return h(
    'div',
    { class: 'page' },
    topBar(app, h('a', { class: 'btn', href: existing ? `#/yazi/${existing.id}` : '#/' }, 'Vazgeç'), saveButton),
    h(
      'main',
      { class: 'content editor-page' },
      draftNotice,
      title,
      h('label', { class: 'date-row' }, 'Tarih ', date),
      rich.element,
      h('h2', {}, 'Galeri'),
      galleryGrid,
      h('div', { class: 'row' }, addButton, fileInput),
      errorLine,
    ),
  );
}
