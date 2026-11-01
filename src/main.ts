import './style.css';
import { DATA_REPO } from './config';
import { h } from './dom';
import { ApiError } from './github';
import { endSession, loadSession, saveSession, type Session } from './session';
import { Store } from './store';
import { editorView } from './views/editor';
import { feedView } from './views/feed';
import { generatorView } from './views/generator';
import { loginView } from './views/login';
import { postView } from './views/post';

export interface App {
  session: Session;
  store: Store;
  /** Gazete için işaretlenen yazılar. */
  selection: Set<string>;
  /** Düzenleme ekranı kaydedilmemiş değişiklik varsa çıkışı burada sorar. */
  leaveGuard: (() => boolean) | null;
  /** Görünüm değişince çağrılır: nesne URL'lerini ve editörü temizler. */
  cleanup: (() => void) | null;
  go: (hash: string) => void;
  logout: () => void;
  handleError: (error: unknown) => string;
}

const root = document.getElementById('app')!;
let app: App | null = null;
let isPrivate = true;
let currentHash = '';

function showLogin(message?: string) {
  root.replaceChildren(loginView({ onLogin: login, message }));
}

async function login(session: Session): Promise<void> {
  const store = new Store(session);
  const info = await store.github.connect();
  isPrivate = info.isPrivate;
  await store.refresh();
  saveSession(session);
  start(session, store);
}

function logout() {
  endSession();
  app = null;
  location.hash = '';
  showLogin();
}

function start(session: Session, store: Store) {
  app = {
    session,
    store,
    selection: new Set(),
    leaveGuard: null,
    cleanup: null,
    go: (hash) => {
      location.hash = hash;
    },
    logout,
    handleError(error) {
      if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 404) {
          logout();
          showLogin('Token artık geçerli değil. Süresi dolmuş veya silinmiş olabilir.');
          return '';
        }
        if (error.status === 403) {
          return 'GitHub bu işlemi reddetti: token’ın yazma yetkisi eksik olabilir veya istek limiti dolmuş olabilir.';
        }
      }
      return error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.';
    },
  };
  render();
}

function render() {
  if (!app) return;
  currentHash = location.hash;
  app.cleanup?.();
  app.cleanup = null;
  app.leaveGuard = null;

  const [, route, id] = location.hash.match(/^#\/?([^/]*)\/?(.*)$/) ?? [];
  let view: HTMLElement;
  switch (route) {
    case 'yeni':
      view = editorView(app, null);
      break;
    case 'duzenle':
      view = editorView(app, id);
      break;
    case 'yazi':
      view = postView(app, id);
      break;
    case 'gazete':
      view = generatorView(app);
      break;
    default:
      view = feedView(app);
  }

  const warning = isPrivate
    ? null
    : h(
        'div',
        { class: 'banner danger' },
        `Dikkat: ${DATA_REPO.repo} reposu public! İçerik token olmadan da okunabilir. GitHub’dan repoyu private yap.`,
      );
  root.replaceChildren(...[warning, view].filter((n): n is HTMLElement => !!n));
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  if (app?.leaveGuard && !app.leaveGuard()) {
    // Kullanıcı vazgeçti: adresi geri al, ekran aynı kalsın.
    history.replaceState(null, '', currentHash || '#/');
    return;
  }
  render();
});

async function boot() {
  const session = loadSession();
  if (!session) {
    showLogin();
    return;
  }
  root.replaceChildren(h('div', { class: 'center muted' }, 'Yükleniyor…'));
  try {
    await login(session);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
      endSession();
      showLogin('Kayıtlı token artık geçerli değil. Süresi dolmuş veya silinmiş olabilir.');
    } else {
      // Geçici ağ hatasında hatırlanan cihazı unutmayalım.
      const message = error instanceof Error ? error.message : 'Bağlanılamadı.';
      root.replaceChildren(
        h(
          'div',
          { class: 'center' },
          h('p', {}, message),
          h('button', { class: 'btn', onclick: () => void boot() }, 'Tekrar dene'),
        ),
      );
    }
  }
}

void boot();
