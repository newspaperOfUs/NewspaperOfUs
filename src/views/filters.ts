import { h } from '../dom';
import { collectTags, highlightParts, isFiltering, tagHue, tagKey } from '../filter';
import { icon } from '../icons';
import type { App } from '../main';

const SEARCH_DELAY_MS = 120;

export function tagChip(name: string): HTMLElement {
  const chip = h('span', { class: 'tag' }, name);
  chip.style.setProperty('--hue', String(tagHue(tagKey(name))));
  return chip;
}

export function highlighted(text: string, terms: string[]): (string | HTMLElement)[] {
  return highlightParts(text, terms).map((part) => (part.hit ? h('mark', {}, part.text) : part.text));
}

/** Ana sayfa ve gazete seçimi aynı filtreyi paylaşır: orada süzdüğün burada da süzülü kalır. */
export function filterBar(app: App, onChange: () => void): { element: HTMLElement; repaint: () => void; reset: () => void } {
  const filter = app.filter;
  let timer = 0;

  const input = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'Başlıkta ve yazılarda ara…',
    value: filter.query,
    enterKeyHint: 'search',
  });
  input.setAttribute('aria-label', 'Yazılarda ara');
  const clear = h('button', { class: 'search-clear', type: 'button', title: 'Aramayı temizle', hidden: !filter.query }, icon('close'));
  clear.setAttribute('aria-label', 'Aramayı temizle');

  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      filter.query = input.value;
      onChange();
    }, SEARCH_DELAY_MS);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  clear.addEventListener('click', () => {
    clearTimeout(timer);
    input.value = '';
    clear.hidden = true;
    filter.query = '';
    onChange();
    input.focus();
  });

  const chips = h('div', { class: 'chips', role: 'group' });
  chips.setAttribute('aria-label', 'Etikete göre süz');

  const repaint = () => {
    // Yazarken gelen otomatik yenileme yazılanı geri almasın.
    if (document.activeElement !== input) {
      input.value = filter.query;
      clear.hidden = !filter.query;
    }
    const tags = collectTags(app.store.posts);
    // Artık hiçbir yazıda olmayan etiket filtreyi boşa düşürmesin.
    const known = new Set(tags.map((t) => t.key));
    for (const key of [...filter.tags]) if (!known.has(key)) filter.tags.delete(key);

    chips.hidden = tags.length === 0;
    chips.replaceChildren(
      ...tags.map((tag) => {
        const on = filter.tags.has(tag.key);
        const chip = h(
          'button',
          {
            class: `chip${on ? ' on' : ''}`,
            type: 'button',
            onclick: () => {
              if (filter.tags.has(tag.key)) filter.tags.delete(tag.key);
              else filter.tags.add(tag.key);
              repaint();
              onChange();
            },
          },
          tag.name,
          h('span', { class: 'chip-count' }, String(tag.count)),
        );
        chip.setAttribute('aria-pressed', String(on));
        chip.style.setProperty('--hue', String(tagHue(tag.key)));
        return chip;
      }),
    );
  };
  repaint();

  return {
    element: h('div', { class: 'filters' }, h('label', { class: 'search' }, icon('search'), input, clear), chips),
    repaint,
    reset: () => {
      clearTimeout(timer);
      input.value = '';
      clear.hidden = true;
      filter.query = '';
      filter.tags.clear();
      repaint();
    },
  };
}

export function clearFilterButton(app: App, onChange: () => void, reset: () => void): HTMLButtonElement {
  return h('button', {
    class: 'link',
    type: 'button',
    textContent: 'Temizle',
    hidden: !isFiltering(app.filter),
    onclick: () => {
      reset();
      onChange();
    },
  });
}
