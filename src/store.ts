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

export interface NewImage {
  full: Blob;
  thumb: Blob;
  w: number;
  h: number;
  caption: string;
}

export class ConflictError extends Error {}

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
  /** path → blob sha; dosyaları okumak ve çakışma kontrolü için. */
  private files = new Map<string, string>();
  private memory = new Map<string, ArrayBuffer>();
  private memoryUsed = 0;
  private parsed = new Map<string, Post>();

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
    let done = 0;
    const posts = await mapLimit(postEntries, CONCURRENCY, async (e) => {
      let post = this.parsed.get(e.sha);
      if (!post) {
        const text = new TextDecoder().decode(await this.readFile(e.sha));
        const raw = JSON.parse(text) as Post;
        // Etiketlerden önce yazılmış yazılarda bu alan yok.
        post = { ...raw, tags: raw.tags ?? [] };
        this.parsed.set(e.sha, post);
      }
      onProgress?.(++done, postEntries.length);
      return post;
    });
    this.posts = posts.sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
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
        if (this.files.has(path)) changes.push({ path, sha: null });
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
    const paths = [`posts/${post.id}.json`, ...post.images.flatMap((i) => [i.path, i.thumb])];
    const changes = paths.filter((p) => this.files.has(p)).map((path) => ({ path, sha: null }));
    if (changes.length) await this.github.commit(`Silindi: ${post.title}`, changes);
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
