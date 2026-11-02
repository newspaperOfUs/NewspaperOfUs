import { Editor, generateHTML, isValidCSSStyleValue, type Extensions } from '@tiptap/core';
import TextAlign from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import { liftForDark } from './color';
import { h } from './dom';

/** Her renkli metin karanlık mod karşılığını da taşır; kayıtlı doküman değişmez. */
const ThemedColor = Color.extend({
  addGlobalAttributes() {
    return (this.parent?.() ?? []).map((entry) => ({
      ...entry,
      attributes: {
        ...entry.attributes,
        color: {
          ...entry.attributes.color,
          // Doğrulama şart: değer style niteliğine yazılıyor, ";" ile başka stil eklenemesin.
          renderHTML: (attributes: Record<string, unknown>) =>
            isValidCSSStyleValue(attributes.color)
              ? { style: `color: ${attributes.color}; --dark: ${liftForDark(attributes.color)}` }
              : {},
        },
      },
    }));
  },
});

const extensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    code: false,
    codeBlock: false,
    link: false,
  }),
  TextStyle,
  ThemedColor,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Çıktı şemayla sınırlıdır (script, on* olamaz), bu yüzden innerHTML'e güvenle konur. */
export function docToHtml(doc: unknown): string {
  return generateHTML((doc ?? EMPTY_DOC) as Parameters<typeof generateHTML>[0], extensions);
}

const SWATCHES: [string, string][] = [
  ['#a3201a', 'Kırmızı'],
  ['#c2601a', 'Turuncu'],
  ['#1d3a8a', 'Lacivert'],
  ['#1f6b3a', 'Yeşil'],
  ['#6b2a84', 'Mor'],
  ['#7a5a2a', 'Sepya'],
];

interface ToolDef {
  label: string;
  title: string;
  run: (e: Editor) => void;
  active?: (e: Editor) => boolean;
  class?: string;
}

const TOOLS: (ToolDef | '|')[] = [
  { label: 'B', title: 'Kalın (Ctrl+B)', class: 'tool-b', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { label: 'I', title: 'İtalik (Ctrl+I)', class: 'tool-i', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { label: 'U', title: 'Altı çizili (Ctrl+U)', class: 'tool-u', run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
  { label: 'S', title: 'Üstü çizili', class: 'tool-s', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
  '|',
  { label: 'Ara başlık', title: 'Büyük ara başlık', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  { label: 'Alt başlık', title: 'Küçük ara başlık', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  { label: '❝', title: 'Alıntı', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
  { label: '•', title: 'Madde listesi', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { label: '1.', title: 'Numaralı liste', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { label: '―', title: 'Ayraç', run: (e) => e.chain().focus().setHorizontalRule().run() },
  '|',
  { label: '⇤', title: 'Sola yasla', run: (e) => e.chain().focus().setTextAlign('left').run(), active: (e) => e.isActive({ textAlign: 'left' }) },
  { label: '↔', title: 'Ortala', run: (e) => e.chain().focus().setTextAlign('center').run(), active: (e) => e.isActive({ textAlign: 'center' }) },
  { label: '⇥', title: 'Sağa yasla', run: (e) => e.chain().focus().setTextAlign('right').run(), active: (e) => e.isActive({ textAlign: 'right' }) },
  '|',
  { label: '↶', title: 'Geri al', run: (e) => e.chain().focus().undo().run() },
  { label: '↷', title: 'Yinele', run: (e) => e.chain().focus().redo().run() },
];

export interface RichEditor {
  element: HTMLElement;
  getDoc: () => unknown;
  isEmpty: () => boolean;
  destroy: () => void;
}

export function createRichEditor(initial: unknown, onChange: () => void): RichEditor {
  const mount = h('div', { class: 'editor-surface' });
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar' });
  const buttons: { el: HTMLButtonElement; def: ToolDef }[] = [];

  const editor = new Editor({
    element: mount,
    extensions,
    content: (initial ?? EMPTY_DOC) as object,
    onUpdate: onChange,
    onSelectionUpdate: () => syncToolbar(),
    onTransaction: () => syncToolbar(),
    editorProps: { attributes: { 'aria-label': 'Yazı içeriği', spellcheck: 'true' } },
  });

  const appendColors = () => {
    for (const [color, name] of SWATCHES) {
      const swatch = h('button', { type: 'button', class: 'swatch', title: `Yazı rengi: ${name}` });
      swatch.style.setProperty('--swatch', color);
      swatch.style.setProperty('--swatch-dark', liftForDark(color));
      swatch.setAttribute('aria-label', `Yazı rengi: ${name}`);
      swatch.addEventListener('mousedown', (e) => e.preventDefault());
      swatch.addEventListener('click', () => editor.chain().focus().setColor(color).run());
      toolbar.append(swatch);
    }

    const picker = h('input', { type: 'color', class: 'color-picker', title: 'Başka bir renk seç', value: '#a3201a' });
    picker.setAttribute('aria-label', 'Başka bir renk seç');
    picker.addEventListener('input', () => editor.chain().setColor(picker.value).run());
    picker.addEventListener('change', () => editor.commands.focus());
    toolbar.append(picker);

    const clearColor = h('button', { type: 'button', class: 'tool', title: 'Rengi kaldır', textContent: 'A̸' });
    clearColor.setAttribute('aria-label', 'Rengi kaldır');
    clearColor.addEventListener('mousedown', (e) => e.preventDefault());
    clearColor.addEventListener('click', () => editor.chain().focus().unsetColor().run());
    toolbar.append(clearColor);
  };

  let separators = 0;
  for (const tool of TOOLS) {
    if (tool === '|') {
      toolbar.append(h('span', { class: 'tool-sep' }));
      // Renkler ilk gruptan hemen sonra: telefonda yana kaydırmadan görünsün.
      if (++separators === 1) {
        appendColors();
        toolbar.append(h('span', { class: 'tool-sep' }));
      }
      continue;
    }
    const button = h('button', {
      type: 'button',
      class: `tool ${tool.class ?? ''}`,
      title: tool.title,
      textContent: tool.label,
    });
    button.setAttribute('aria-label', tool.title);
    // mousedown'u engellemek seçili metni korur: renk ve kalın seçimi kaybolmadan uygulanır.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => tool.run(editor));
    toolbar.append(button);
    buttons.push({ el: button, def: tool });
  }

  function syncToolbar() {
    for (const { el, def } of buttons) el.classList.toggle('on', def.active?.(editor) ?? false);
  }

  return {
    element: h('div', { class: 'editor' }, toolbar, mount),
    getDoc: () => editor.getJSON(),
    isEmpty: () => editor.isEmpty,
    destroy: () => editor.destroy(),
  };
}
