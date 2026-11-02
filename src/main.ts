import './style.css';
import { DATA_REPO, PAPER_NAME } from './config';
import { h } from './dom';
import { emptyFilter, type PostFilter } from './filter';
import { ApiError } from './github';
import { endSession, loadSession, saveSession, type Session } from './session';
import { Store } from './store';
import { editorView } from './views/editor';
import { feedView } from './views/feed';
import { generatorView } from './views/generator';
import { loginView } from './views/login';
import { postView } from './views/post';
import { savedView } from './views/saved';
import { closeOverlays } from './views/shared';

export interface App {
  session: Session;
  store: Store;
  /** Gazete için işaretlenen yazılar. */
  selection: Set<string>;
  /** Ana sayfa ve gazete seçimindeki arama ve etiketler. */
  filter: PostFilter;
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
let onFeed = false;
/** Bir yazıya girip dönünce uzun listenin başına atılmayalım. */
let feedScroll = 0;
let bootStore: Store | null = null;
let logoutWhileBooting = false;

function showLogin(message?: string) {
  root.replaceChildren(loginView({ onLogin: login, message }));
}

async function login(session: Session): Promise<void> {
  const store = new Store(session);
  try {
    const info = await store.github.connect();
    isPrivate = info.isPrivate;
    await store.refresh();
  } catch (error) {
    // Giriş olmadıysa indirilen dosyalar cihazda sahipsiz kalmasın.
    store.github.forget();
    endSession();
    throw error;
  }
  saveSession(session);
  start(session, store);
}

/** Kayıtlı oturumla açılış: hata olursa cihazı unutmaz, açılırken başka sekme çıkış yaptıysa çıkışı geri almaz. */
async function resume(session: Session, onProgress: (done: number, total: number) => void): Promise<void> {
  const store = new Store(session);
  bootStore = store;
  logoutWhileBooting = false;
  try {
    const info = await store.github.connect();
    isPrivate = info.isPrivate;
    await store.refresh(onProgress);
  } finally {
    bootStore = null;
  }
  if (logoutWhileBooting || !loadSession()) {
    store.github.forget();
    closeSession('Başka bir sekmeden çıkış yapıldı.');
    return;
  }
  saveSession(session);
  start(session, store);
}

/** Görünümün bekleyen işlerini durdurur, token'ı unutur ve cihazdaki her şeyi siler. */
function closeSession(message?: string) {
  app?.cleanup?.();
  app?.store.github.forget();
  closeOverlays();
  document.querySelector('.toast')?.remove();
  endSession();
  app = null;
  onFeed = false;
  feedScroll = 0;
  location.hash = '';
  showLogin(message);
}

/** Bir sekmede çıkış yapınca diğer sekmeler de kapanır. */
const sessionChannel = new BroadcastChannel('newspaper-of-us');
sessionChannel.onmessage = (event) => {
  if (event.data !== 'logout') return;
  if (app) closeSession('Başka bir sekmeden çıkış yapıldı.');
  else if (bootStore) logoutWhileBooting = true;
};

function logout() {
  closeSession();
  sessionChannel.postMessage('logout');
}

function start(session: Session, store: Store) {
  app = {
    session,
    store,
    selection: new Set(),
    filter: emptyFilter(),
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
  if (onFeed) feedScroll = window.scrollY;
  app.cleanup?.();
  app.cleanup = null;
  app.leaveGuard = null;
  closeOverlays();

  const [, route, id] = location.hash.match(/^#\/?([^/]*)\/?(.*)$/) ?? [];
  let view: HTMLElement;
  try {
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
      case 'kaydedilenler':
        view = savedView(app, id);
        break;
      default:
        view = feedView(app);
    }
  } catch {
    // Bozuk bir içerik kullanıcıyı çıkışsız bir ekranda bırakmasın.
    view = failureScreen('Bu sayfa açılamadı. İçerik bozuk olabilir.', h('a', { class: 'btn', href: '#/' }, 'Ana sayfa'));
  }

  const warning = isPrivate
    ? null
    : h(
        'div',
        { class: 'banner danger' },
        `Dikkat: ${DATA_REPO.repo} reposu public! İçerik token olmadan da okunabilir. GitHub’dan repoyu private yap.`,
      );
  root.replaceChildren(...[warning, view].filter((n): n is HTMLElement => !!n));
  onFeed = !['yeni', 'duzenle', 'yazi', 'gazete', 'kaydedilenler'].includes(route);
  window.scrollTo(0, onFeed ? feedScroll : 0);
}

function failureScreen(message: string, action: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'center' },
    h('p', {}, message),
    h('div', { class: 'failure-actions' }, action, h('button', { class: 'btn', onclick: logout }, 'Çıkış yap')),
  );
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
  // Başka bir sitenin içinde çerçeveyle açılınca çalışmaz: kandırılmış tıklamaya kapalı.
  if (window.top !== window.self) return;
  const session = loadSession();
  if (!session) {
    showLogin();
    return;
  }
  const progress = h('p', { class: 'muted', role: 'status' }, 'Arşiv açılıyor…');
  root.replaceChildren(h('div', { class: 'center' }, h('h1', { class: 'nameplate' }, PAPER_NAME), progress));
  try {
    await resume(session, (done, total) => {
      progress.textContent = `Arşiv açılıyor… ${done}/${total}`;
    });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
      closeSession('Kayıtlı token artık geçerli değil. Süresi dolmuş veya silinmiş olabilir.');
      sessionChannel.postMessage('logout');
    } else {
      // Geçici ağ hatasında hatırlanan cihazı unutmayalım; ama çıkış yolu hep açık kalsın.
      const message = error instanceof Error ? error.message : 'Bağlanılamadı.';
      root.replaceChildren(failureScreen(message, h('button', { class: 'btn', onclick: () => void boot() }, 'Tekrar dene')));
    }
  }
}

void boot();
