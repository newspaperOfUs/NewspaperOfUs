import { h } from './dom';
import { icon } from './icons';

/** public/theme-init.js ile aynı anahtar: o dosya temayı sayfa çizilmeden önce uygular. */
const KEY = 'newspaper-of-us.theme';

type Theme = 'light' | 'dark';

const META_COLORS: Record<Theme, string> = { light: '#f5efe2', dark: '#14120f' };

function current(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function syncButton(button: HTMLButtonElement) {
  const dark = current() === 'dark';
  const label = dark ? 'Aydınlık moda geç' : 'Karanlık moda geç';
  button.replaceChildren(icon(dark ? 'sun' : 'moon'));
  button.title = label;
  button.setAttribute('aria-label', label);
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLORS[theme]);
  document.querySelectorAll<HTMLButtonElement>('.theme-toggle').forEach(syncButton);
}

/** Elle seçim yapılmadıysa cihazın ayarını izler. */
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
  if (!localStorage.getItem(KEY)) apply(event.matches ? 'dark' : 'light');
});

export function themeButton(): HTMLButtonElement {
  const button = h('button', { class: 'icon-only theme-toggle', type: 'button' });
  button.addEventListener('click', () => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
  });
  syncButton(button);
  return button;
}
