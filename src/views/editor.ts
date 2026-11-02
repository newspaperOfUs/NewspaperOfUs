import { h, todayIso } from '../dom';
import { cleanTag, collectTags, tagHue, tagKey } from '../filter';
import { icon } from '../icons';
import { prepareImage } from '../images';
import type { App } from '../main';
import { docStats, estimatePages, pagesLabel } from '../newspaper/estimate';
import { createRichEditor } from '../richtext';
import { clearDraft, loadDraft, saveDraft } from '../session';
import { ConflictError, newPostId, type NewImage, type Post, type PostImage } from '../store';
import { loadInto, topBar, UrlPool } from './shared';

interface Draft {
  title: string;
  date: string;
  doc: unknown;
  tags?: string[];
  /** Taslağın başladığı sürüm: geri yüklenince de çakışma kontrolü buna göre yapılır. */
  baseSha: string | null;
}

type GalleryItem =
  | { kind: 'saved'; image: PostImage; caption: string }
  | { kind: 'new'; image: NewImage; caption: string; url: string };

const ESTIMATE_DELAY_MS = 300;

export function editorView(app: App, id: string | null): HTMLElement {
  const existing = id ? app.store.getPost(id) : undefined;
  if (id && !existing) {
    return h(
      'div',
      { class: 'page' },
      topBar(),
      h('main', { class: 'content empty' }, h('p', {}, 'Bu yazı bulunamadı; silinmiş olabilir.'), h('a', { class: 'btn', href: '#/' }, 'Ana sayfa')),
    );
  }

  const session = app.session;
  const draftKey = id ?? 'new';
  const draft = loadDraft<Draft>(session, draftKey);
  const baseSha = draft ? draft.baseSha : id ? app.store.postSha(id) : null;
  const pool = new UrlPool();
  let tags: string[] = draft?.tags ?? existing?.tags ?? [];
  let dirty = false;
  let saving = false;
  let draftTimer = 0;
  let estimateTimer = 0;

  const scheduleEstimate = () => {
    clearTimeout(estimateTimer);
    estimateTimer = window.setTimeout(syncEstimate, ESTIMATE_DELAY_MS);
  };

  const markDirty = () => {
    dirty = true;
    clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      saveDraft(session, draftKey, { title: title.value, date: date.value, doc: rich.getDoc(), tags, baseSha } satisfies Draft);
    }, 700);
    scheduleEstimate();
  };

  // Uzun başlık tek satırda kesilmesin diye yazdıkça uzayan alan.
  const growTitle = () => {
    title.style.height = 'auto';
    title.style.height = `${title.scrollHeight}px`;
  };
  const title = h('textarea', {
    class: 'title-input',
    placeholder: 'Başlık',
    maxLength: 160,
    rows: 1,
    value: draft?.title ?? existing?.title ?? '',
    oninput: () => {
      growTitle();
      markDirty();
    },
  });
  title.setAttribute('aria-label', 'Başlık');
  title.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  requestAnimationFrame(growTitle);
  // Başlık yazı tipi sonradan yüklenince satır sayısı değişebilir.
  void document.fonts.ready.then(growTitle);

  const date = h('input', {
    type: 'date',
    value: draft?.date ?? existing?.date ?? todayIso(),
    oninput: markDirty,
  });
  date.setAttribute('aria-label', 'Anının tarihi');

  const rich = createRichEditor(draft?.doc ?? existing?.doc, markDirty);

  // --- Etiketler ---
  const knownTags = collectTags(app.store.posts);
  const tagPicker = h('div', { class: 'tag-picker' });
  const tagInput = h('input', {
    type: 'text',
    class: 'tag-input',
    placeholder: 'Yeni etiket',
    maxLength: 32,
    enterKeyHint: 'done',
  });
  tagInput.setAttribute('aria-label', 'Yeni etiket');

  const paintTags = () => {
    const names = knownTags.map((tag) => tag.name);
    for (const tag of tags) {
      if (!names.some((name) => tagKey(name) === tagKey(tag))) names.push(tag);
    }
    tagPicker.replaceChildren(
      ...names.map((name) => {
        const key = tagKey(name);
        const on = tags.some((tag) => tagKey(tag) === key);
        const chip = h(
          'button',
          {
            type: 'button',
            class: `chip${on ? ' on' : ''}`,
            onclick: () => {
              tags = on ? tags.filter((tag) => tagKey(tag) !== key) : [...tags, name];
              markDirty();
              paintTags();
            },
          },
          name,
        );
        chip.setAttribute('aria-pressed', String(on));
        chip.style.setProperty('--hue', String(tagHue(key)));
        return chip;
      }),
    );
  };

  /** Aynı etiket farklı yazılışla ("film", "FİLM") ikinci kez oluşmaz. */
  const commitTagInput = () => {
    const clean = cleanTag(tagInput.value.replace(/,/g, ' '));
    tagInput.value = '';
    if (!clean) return;
    const key = tagKey(clean);
    if (!tags.some((tag) => tagKey(tag) === key)) {
      tags = [...tags, knownTags.find((tag) => tag.key === key)?.name ?? clean];
      markDirty();
    }
    paintTags();
  };

  tagInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitTagInput();
    }
  });
  tagInput.addEventListener('blur', commitTagInput);

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
  const addLabel = h('span', {}, 'Fotoğraf ekle');
  const addButton = h('button', { type: 'button', class: 'gallery-add', onclick: () => fileInput.click() }, icon('image'), addLabel);

  const paintGallery = () => {
    galleryGrid.replaceChildren(
      ...items.map((item, index) => {
        const image = h('img', { alt: '' });
        if (item.kind === 'saved') void loadInto(app, pool, image, item.image.thumb);
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

        const action = (label: string, name: string, onclick: () => void, disabled = false) => {
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
            action('←', 'Öne al', () => move(-1), index === 0),
            action('→', 'Arkaya al', () => move(1), index === items.length - 1),
            action('✕', 'Fotoğrafı kaldır', () => {
              items.splice(index, 1);
              if (item.kind === 'saved') removed.push(item.image);
              markDirty();
              paintGallery();
            }),
          ),
          caption,
        );
      }),
      addButton,
    );
  };

  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (!files.length) return;
    addButton.disabled = true;
    errorLine.textContent = '';
    for (const [index, file] of files.entries()) {
      addLabel.textContent = `İşleniyor ${index + 1}/${files.length}…`;
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
    addLabel.textContent = 'Fotoğraf ekle';
  });

  // --- Tahmini sayfa ---
  const estimateValue = h('strong', {});
  const estimateDetail = h('span', { class: 'muted' });
  const estimateBox = h('div', { class: 'estimate', role: 'status' }, icon('paper'), h('span', {}, 'Tahmini baskı: ', estimateValue), estimateDetail);

  const syncEstimate = () => {
    const stats = docStats(rich.getDoc(), items.length);
    estimateValue.textContent = pagesLabel(estimatePages([stats]));
    const parts = [`${stats.chars.toLocaleString('tr-TR')} karakter`];
    if (items.length) parts.push(`${items.length} fotoğraf`);
    estimateDetail.textContent = parts.join(' · ');
  };

  // --- Kaydet ---
  const saveButton = h('button', { class: 'btn primary', textContent: existing ? 'Kaydet' : 'Yayınla' });
  const idleLabel = saveButton.textContent;

  saveButton.addEventListener('click', async () => {
    errorLine.textContent = '';
    commitTagInput();
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
      tags,
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
    clearTimeout(estimateTimer);
    window.removeEventListener('beforeunload', beforeUnload);
    rich.destroy();
    pool.close();
  };

  paintTags();
  paintGallery();
  syncEstimate();

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

  rich.element.append(estimateBox);

  return h(
    'div',
    { class: 'page' },
    topBar(h('a', { class: 'btn', href: existing ? `#/yazi/${existing.id}` : '#/' }, 'Vazgeç'), saveButton),
    h(
      'main',
      { class: 'content editor-page' },
      draftNotice,
      title,
      h('div', { class: 'meta-row' }, h('label', { class: 'date-row' }, 'Tarih ', date)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Etiketler'), h('div', { class: 'tag-editor' }, tagPicker, tagInput)),
      rich.element,
      h('h2', { class: 'section-title' }, 'Galeri'),
      galleryGrid,
      fileInput,
      errorLine,
    ),
  );
}
