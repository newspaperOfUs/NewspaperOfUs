import { PAPER_NAME } from '../config';
import { h } from '../dom';
import type { App } from '../main';
import { PRICES, SLOGANS } from '../newspaper/copy';
import { themeButton } from '../theme';
import { logoutButton } from './shared';

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

/** Ana sayfa ve kaydedilenler aynı gazetenin iki bölümüdür. */
export function frontPage(app: App, active: 'posts' | 'saved'): HTMLElement {
  const today = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const tab = (label: string, href: string, on: boolean) => {
    const link = h('a', { class: `front-tab${on ? ' on' : ''}`, href }, label);
    if (on) link.setAttribute('aria-current', 'page');
    return link;
  };
  const savedCount = app.store.issues.length;
  return h(
    'header',
    { class: 'front' },
    h(
      'div',
      { class: 'front-strip' },
      h('span', {}, today),
      h('span', { class: 'front-price' }, pick(PRICES)),
      h('span', { class: 'front-tools' }, h('span', { class: 'front-who' }, app.session.name), themeButton(), logoutButton(app)),
    ),
    h('h1', { class: 'nameplate' }, PAPER_NAME),
    h('p', { class: 'front-sub' }, pick(SLOGANS)),
    h(
      'nav',
      { class: 'front-nav' },
      tab('Yazılar', '#/', active === 'posts'),
      tab(savedCount ? `Kaydedilenler (${savedCount})` : 'Kaydedilenler', '#/kaydedilenler', active === 'saved'),
    ),
  );
}
