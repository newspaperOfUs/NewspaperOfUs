import { API_BASE } from './config';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TreeEntry {
  path: string;
  sha: string;
}

/** Tek bir commit'te uygulanacak değişiklik: sha=null dosyayı siler. */
export interface FileChange {
  path: string;
  sha: string | null;
}

const MAX_COMMIT_RETRIES = 5;
const MAX_RATE_LIMIT_RETRIES = 4;

export class GitHubRepo {
  private branch = 'main';

  constructor(
    private token: string,
    private owner: string,
    private repo: string,
  ) {}

  private url(path: string) {
    return `${API_BASE}/repos/${this.owner}/${this.repo}${path}`;
  }

  /** Çıkıştan sonra bekleyen hiçbir iş token'ı kullanamaz. */
  forget() {
    this.token = '';
  }

  private async request(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json') {
    for (let attempt = 0; ; attempt++) {
      if (!this.token) throw new ApiError(0, 'Oturum kapatıldı.');
      let res: Response;
      try {
        res = await fetch(this.url(path), {
          // Özel içerik tarayıcının disk önbelleğine düşmesin; kalıcı önbellek "hatırla" ile açılır, çıkışta silinir.
          // Dalın son hâli de hep güncel gelsin: API yanıtları normalde 60 sn önbelleğe alınır.
          cache: 'no-store',
          ...init,
          headers: {
            Accept: accept,
            Authorization: `Bearer ${this.token}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
        });
      } catch {
        throw new ApiError(0, 'GitHub’a ulaşılamadı. İnternet bağlantını kontrol et.');
      }
      if (res.ok) return res;

      const body = await res.json().catch(() => ({}) as { message?: string });
      const message: string = body.message || `GitHub hatası (${res.status})`;
      // GitHub dakikada ~80 yazma isteğine izin verir; çok fotoğraflı yüklemede bekleyip devam ederiz.
      const limited = (res.status === 403 || res.status === 429) && /rate limit/i.test(message);
      if (limited && attempt < MAX_RATE_LIMIT_RETRIES) {
        const seconds = Number(res.headers.get('Retry-After')) || 30 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, Math.min(seconds, 90) * 1000));
        continue;
      }
      throw new ApiError(res.status, message);
    }
  }

  /** Token bu repoya erişebiliyor mu? Erişemiyorsa GitHub 401/404 döner. */
  async connect(): Promise<{ isPrivate: boolean }> {
    const res = await this.request('');
    const info = await res.json();
    this.branch = info.default_branch || 'main';
    return { isPrivate: !!info.private };
  }

  /** Dalın son commit'i. */
  async headSha(): Promise<string> {
    try {
      const res = await this.request(`/git/ref/heads/${this.branch}`);
      return (await res.json()).object.sha;
    } catch (e) {
      // Tamamen boş repoda Git Data API çalışmaz; ilk commit'i Contents API ile açıyoruz.
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) return this.bootstrap();
      throw e;
    }
  }

  private async bootstrap(): Promise<string> {
    const res = await this.request('/contents/README.md', {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Newspaper of Us veri deposu',
        content: btoa('Newspaper of Us verileri. Bu repo private kalmalidir.\n'),
      }),
    });
    return (await res.json()).commit.sha;
  }

  async listFiles(commitSha: string): Promise<TreeEntry[]> {
    const res = await this.request(`/git/trees/${commitSha}?recursive=1`);
    const data = await res.json();
    return (data.tree as { path: string; sha: string; type: string }[])
      .filter((e) => e.type === 'blob')
      .map(({ path, sha }) => ({ path, sha }));
  }

  async readBlob(sha: string): Promise<ArrayBuffer> {
    const res = await this.request(`/git/blobs/${sha}`, {}, 'application/vnd.github.raw+json');
    return res.arrayBuffer();
  }

  async createBlob(base64: string): Promise<string> {
    const res = await this.request('/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: base64, encoding: 'base64' }),
    });
    return (await res.json()).sha;
  }

  /**
   * Değişiklikleri tek commit olarak uygular. İki kişi aynı anda kaydederse ref güncellemesi
   * 422 döner; o zaman en güncel commit'in üstüne yeniden kurup tekrar deneriz.
   */
  async commit(message: string, changes: FileChange[]): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const head = await this.headSha();
      const treeRes = await this.request('/git/trees', {
        method: 'POST',
        body: JSON.stringify({
          base_tree: head,
          tree: changes.map((c) => ({ path: c.path, mode: '100644', type: 'blob', sha: c.sha })),
        }),
      });
      const commitRes = await this.request('/git/commits', {
        method: 'POST',
        body: JSON.stringify({ message, tree: (await treeRes.json()).sha, parents: [head] }),
      });
      const sha: string = (await commitRes.json()).sha;
      try {
        await this.request(`/git/refs/heads/${this.branch}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha, force: false }),
        });
        return sha;
      } catch (e) {
        const conflict = e instanceof ApiError && e.status === 422;
        if (!conflict || attempt >= MAX_COMMIT_RETRIES) throw e;
      }
    }
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
