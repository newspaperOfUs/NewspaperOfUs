import { DATA_REPO, PAPER_NAME } from '../config';
import { h } from '../dom';
import { ApiError } from '../github';
import type { Session } from '../session';

interface LoginProps {
  onLogin: (session: Session) => Promise<void>;
  message?: string;
}

export function loginView({ onLogin, message }: LoginProps): HTMLElement {
  const token = h('input', {
    type: 'password',
    id: 'token',
    required: true,
    autocomplete: 'off',
    placeholder: 'github_pat_…',
  });
  token.spellcheck = false;
  const name = h('input', {
    type: 'text',
    id: 'name',
    required: true,
    autocomplete: 'given-name',
    maxLength: 40,
    placeholder: 'Yazılarında görünecek isim',
  });
  const remember = h('input', { type: 'checkbox', id: 'remember', checked: true });
  const error = h('p', { class: 'error', role: 'alert', textContent: message ?? '' });
  const submit = h('button', { type: 'submit', class: 'btn primary', textContent: 'Gir' });

  const form = h(
    'form',
    { class: 'login-form' },
    h('label', { htmlFor: 'token' }, 'Erişim anahtarı'),
    token,
    h('label', { htmlFor: 'name' }, 'Adın'),
    name,
    h('label', { class: 'check' }, remember, ' Bu cihazı hatırla'),
    error,
    submit,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Kontrol ediliyor…';
    try {
      await onLogin({
        token: token.value.trim(),
        name: name.value.trim(),
        remember: remember.checked,
      });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) {
        error.textContent = 'Anahtar yanlış veya bu gazeteye erişim yetkisi yok.';
      } else {
        error.textContent = e instanceof Error ? e.message : 'Bağlanılamadı.';
      }
      submit.disabled = false;
      submit.textContent = 'Gir';
    }
  });

  return h(
    'main',
    { class: 'login' },
    h('h1', { class: 'masthead' }, PAPER_NAME),
    h('p', { class: 'muted' }, 'Yalnızca iki okuru olan gazete.'),
    form,
    h('p', { class: 'hint' }, `Anahtar, ${DATA_REPO.repo} reposuna erişim veren GitHub token’ıdır.`),
  );
}
