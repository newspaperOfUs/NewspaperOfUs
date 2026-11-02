import { DATA_REPO } from './config';
import { bytesToBase64, GitHubRepo, type FileChange } from './github';
import { cacheGet, cachePut, type Session } from './session';

export interface PostImage {
  path: string;
  thumb: string;
  w: number;
  h: number;
  caption: string;
}

export interface Post {
  id: string;
  title: string;
  author: string;
  /** Anının tarihi (YYYY-MM-DD). */
  date: string;
  createdAt: string;
  updatedAt: string;
  /** Editörün ProseMirror JSON dokümanı. */
  doc: unknown;
  images: PostImage[];
  tags: string[];
}

/** Kaydedilmiş gazete: üretildiği hâliyle saklanır, yazılar sonradan değişse de değişmez. */
export interface SavedIssue {
  id: string;
  title: string;
  savedBy: string;
  savedAt: string;
  styleName: string;
  seed: number;
  thumb: string;
  pages: { full: string; preview: string }[];
  posts: { id: string; title: string }[];
}

export interface NewIssuePage {
  full: Blob;
  preview: Blob;
}

export interface NewImage {
  full: Blob;
  thumb: Blob;
  w: number;
  h: number;
  caption: string;
}

export class ConflictError extends Error {}

const isText = (value: unknown): value is string => typeof value === 'string';
const isIsoDate = (value: unknown): value is string => isText(value) && /^\d{4}-\d{2}-\d{2}/.test(value);
const isSize = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isId = (value: unknown): value is string => isText(value) && /^[\w-]+$/.test(value);

/** Şekli bozuk yazı null döner: tek dosya bütün arşivi kullanılmaz hâle getirmesin. */
function normalizePost(raw: unknown): Post | null {
  const post = raw as Partial<Post> | null;
  if (!post || !isId(post.id) || ![post.title, post.author].every(isText) || !isIsoDate(post.date) || !isIsoDate(post.createdAt)) return null;
  const images = (Array.isArray(post.images) ? post.images : [])
    .filter((image) => image && isText(image.path) && isText(image.thumb) && isSize(image.w) && isSize(image.h))
    .map((image) => ({ ...image, caption: isText(image.caption) ? image.caption : '' }));
  // Etiketlerden önce yazılmış yazılarda bu alan yok.
  const tags = (Array.isArray(post.tags) ? post.tags : []).filter(isText);
  return { ...(post as Post), images, tags };
}

function normalizeIssue(raw: unknown): SavedIssue | null {
  const issue = raw as Partial<SavedIssue> | null;
  if (!issue || !isId(issue.id) || ![issue.title, issue.savedBy, issue.styleName, issue.thumb].every(isText) || !isIsoDate(issue.savedAt)) return null;
  const pages = (Array.isArray(issue.pages) ? issue.pages : []).filter((page) => page && isText(page.full) && isText(page.preview));
  if (!pages.length) return null;
  const posts = (Array.isArray(issue.posts) ? issue.posts : []).filter((post) => post && isText(post.id) && isText(post.title));
  return { ...(issue as SavedIssue), pages, posts, seed: Number.isSafeInteger(issue.seed) ? issue.seed! : 0 };
}

const CONCURRENCY = 6;
/** Fotoğraflar telefonun belleğini doldurmasın: en son kullanılanlar kalır, gerisi gerekirse yeniden okunur. */
const MEMORY_BUDGET = 96 * 1024 * 1024;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

export function newPostId(date: string): string {
  const random = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${date.replaceAll('-', '')}-${hex}`;
}

export class Store {
  readonly github: GitHubRepo;
  posts: Post[] = [];
  issues: SavedIssue[] = [];
  /** Şekli bozuk olduğu için gösterilemeyen dosya sayısı. */
  unreadable = 0;
  /** path → blob sha; dosyaları okumak ve çakışma kontrolü için. */
  private files = new Map<string, string>();
  private memory = new Map<string, ArrayBuffer>();
  private memoryUsed = 0;
  private parsed = new Map<string, unknown>();

  constructor(private session: Session) {
    this.github = new GitHubRepo(session.token, DATA_REPO.owner, DATA_REPO.repo);
  }

  private async readFile(sha: string): Promise<ArrayBuffer> {
    const inMemory = this.memory.get(sha);
    if (inMemory) {
      // Map ekleme sırasını korur: en başta her zaman en uzun süredir kullanılmayan durur.
      this.memory.delete(sha);
      this.memory.set(sha, inMemory);
      return inMemory;
    }
    const cached = this.session.remember ? await cacheGet(sha) : null;
    if (cached) {
      this.remember(sha, cached);
      return cached;
    }
    const data = await this.github.readBlob(sha);
    this.remember(sha, data);
    if (this.session.remember) await cachePut(sha, data);
    return data;
  }

  private remember(sha: string, data: ArrayBuffer) {
    this.memory.set(sha, data);
    this.memoryUsed += data.byteLength;
    for (const [oldest, buffer] of this.memory) {
      if (this.memoryUsed <= MEMORY_BUDGET || oldest === sha) break;
      this.memory.delete(oldest);
      this.memoryUsed -= buffer.byteLength;
    }
  }

  async refresh(onProgress?: (done: number, total: number) => void): Promise<void> {
    const head = await this.github.headSha();
    const entries = await this.github.listFiles(head);
    this.files = new Map(entries.map((e) => [e.path, e.sha]));
    const postEntries = entries.filter((e) => /^posts\/[^/]+\.json$/.test(e.path));
    const issueEntries = entries.filter((e) => /^issues\/[^/]+\.json$/.test(e.path));
    const total = postEntries.length + issueEntries.length;
    let done = 0;
    const readJson = async <T>(sha: string, normalize: (raw: unknown) => T | null): Promise<T | null> => {
      if (!this.parsed.has(sha)) {
        // Ağ hatası yukarı çıkar; yalnızca dosyanın kendisi bozuksa atlanır.
        const buffer = await this.readFile(sha);
        let value: T | null = null;
        try {
          value = normalize(JSON.parse(new TextDecoder().decode(buffer)));
        } catch {
          value = null;
        }
        this.parsed.set(sha, value);
      }
      onProgress?.(++done, total);
      return this.parsed.get(sha) as T | null;
    };
    const posts = await mapLimit(postEntries, CONCURRENCY, (e) => readJson<Post>(e.sha, normalizePost));
    const issues = await mapLimit(issueEntries, CONCURRENCY, (e) => readJson<SavedIssue>(e.sha, normalizeIssue));
    // Dosya, içinde yazan kimliğin kendi yeri olmalı: sahte kimlik başka dosyaların silinmesine yol açmasın.
    const validPosts = posts.filter((post, i): post is Post => post !== null && postEntries[i].path === `posts/${post.id}.json`);
    const validIssues = issues.filter((issue, i): issue is SavedIssue => issue !== null && issueEntries[i].path === `issues/${issue.id}.json`);
    this.unreadable = total - validPosts.length - validIssues.length;
    this.posts = validPosts.sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
    this.issues = validIssues.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  getIssue(id: string): SavedIssue | undefined {
    return this.issues.find((issue) => issue.id === id);
  }

  getPost(id: string): Post | undefined {
    return this.posts.find((p) => p.id === id);
  }

  postSha(id: string): string | null {
    return this.files.get(`posts/${id}.json`) ?? null;
  }

  async imageBlob(path: string): Promise<Blob> {
    const sha = this.files.get(path);
    if (!sha) throw new Error(`Fotoğraf bulunamadı: ${path}`);
    return new Blob([await this.readFile(sha)], { type: 'image/jpeg' });
  }

  /**
   * Yazıyı ve fotoğraflarını tek commit'te kaydeder.
   * expectedSha, editör açıldığındaki hali: diğer kişi bu arada aynı yazıyı değiştirdiyse
   * üzerine yazmak yerine ConflictError atılır.
   */
  async savePost(
    post: Post,
    newImages: NewImage[],
    removed: PostImage[],
    expectedSha: string | null,
    /** Galerideki son sıra: kayıtlı fotoğrafın yolu veya newImages içindeki sırası. */
    order: (string | number)[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    await this.refreshFileIndex();
    if (this.postSha(post.id) !== expectedSha) {
      throw new ConflictError('Bu yazı sen düzenlerken değişmiş.');
    }

    const total = newImages.length * 2;
    let done = 0;
    const tick = () => onProgress?.(++done, total);
    const changes: FileChange[] = [];
    const uploaded: PostImage[] = [];

    // Sıralı yükleme: mobil bağlantıda onlarca paralel büyük istek zaman aşımına düşüyor.
    for (const image of newImages) {
      const name = crypto.randomUUID();
      const path = `images/${post.id}/${name}.jpg`;
      const thumb = `images/${post.id}/${name}.thumb.jpg`;
      changes.push({ path, sha: await this.uploadBlob(image.full) });
      tick();
      changes.push({ path: thumb, sha: await this.uploadBlob(image.thumb) });
      tick();
      uploaded.push({ path, thumb, w: image.w, h: image.h, caption: image.caption });
    }

    for (const image of removed) {
      for (const path of [image.path, image.thumb]) {
        if (this.files.has(path) && path.startsWith(`images/${post.id}/`)) changes.push({ path, sha: null });
      }
    }

    const images = order.map((key) =>
      typeof key === 'number' ? uploaded[key] : post.images.find((image) => image.path === key)!,
    );
    const saved: Post = { ...post, images, updatedAt: new Date().toISOString() };
    const json = new TextEncoder().encode(JSON.stringify(saved, null, 2));
    changes.push({ path: `posts/${post.id}.json`, sha: await this.github.createBlob(bytesToBase64(json)) });

    const verb = expectedSha ? 'Güncellendi' : 'Yeni yazı';
    await this.github.commit(`${verb}: ${post.title}`, changes);
    await this.refresh();
  }

  async deletePost(post: Post): Promise<void> {
    await this.refreshFileIndex();
    const own = post.images.flatMap((i) => [i.path, i.thumb]).filter((p) => p.startsWith(`images/${post.id}/`));
    const paths = [`posts/${post.id}.json`, ...own];
    const changes = paths.filter((p) => this.files.has(p)).map((path) => ({ path, sha: null }));
    if (changes.length) await this.github.commit(`Silindi: ${post.title}`, changes);
    await this.refresh();
  }

  /** Gazeteyi tek commit'te kaydeder; yarıda kalırsa depoda yarım gazete oluşmaz. */
  async saveIssue(
    meta: Pick<SavedIssue, 'title' | 'styleName' | 'seed' | 'posts'>,
    pages: NewIssuePage[],
    thumb: Blob,
    onProgress?: (done: number, total: number) => void,
  ): Promise<SavedIssue> {
    const now = new Date().toISOString();
    const id = newPostId(now.slice(0, 10));
    const base = `issues/${id}`;
    const total = pages.length * 2 + 1;
    let done = 0;
    const changes: FileChange[] = [];
    const upload = async (path: string, blob: Blob) => {
      changes.push({ path, sha: await this.uploadBlob(blob) });
      onProgress?.(++done, total);
      return path;
    };

    const saved: SavedIssue['pages'] = [];
    for (const [index, page] of pages.entries()) {
      saved.push({
        full: await upload(`${base}/sayfa-${index + 1}.jpg`, page.full),
        preview: await upload(`${base}/sayfa-${index + 1}.onizleme.jpg`, page.preview),
      });
    }
    const issue: SavedIssue = {
      ...meta,
      id,
      savedBy: this.session.name,
      savedAt: now,
      thumb: await upload(`${base}/kapak.jpg`, thumb),
      pages: saved,
    };
    const json = new TextEncoder().encode(JSON.stringify(issue, null, 2));
    changes.push({ path: `${base}.json`, sha: await this.github.createBlob(bytesToBase64(json)) });

    await this.github.commit(`Gazete kaydedildi: ${meta.title}`, changes);
    await this.refresh();
    return issue;
  }

  async deleteIssue(issue: SavedIssue): Promise<void> {
    await this.refreshFileIndex();
    // Yalnızca gazetenin kendi klasörü silinir; bozuk bir kayıt yazıları götüremez.
    const own = [issue.thumb, ...issue.pages.flatMap((page) => [page.full, page.preview])].filter((p) => p.startsWith(`issues/${issue.id}/`));
    const paths = [`issues/${issue.id}.json`, ...own];
    const changes = paths.filter((p) => this.files.has(p)).map((path) => ({ path, sha: null }));
    if (changes.length) await this.github.commit(`Gazete silindi: ${issue.title}`, changes);
    await this.refresh();
  }

  private async refreshFileIndex() {
    const entries = await this.github.listFiles(await this.github.headSha());
    this.files = new Map(entries.map((e) => [e.path, e.sha]));
  }

  private async uploadBlob(blob: Blob): Promise<string> {
    return this.github.createBlob(bytesToBase64(new Uint8Array(await blob.arrayBuffer())));
  }
}
