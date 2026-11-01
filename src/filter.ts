import { blocksToPlainText, docToBlocks } from './newspaper/doc';
import type { Post } from './store';

const TURKISH: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u', '’': "'", '‘': "'" };

/**
 * Aramada "gunes" de "güneş"i, "IŞIK" da "ışık"ı bulsun diye metni sadeleştirir.
 * Uzunluğu korur: bulunan yer orijinal metinde aynı konumda işaretlenebilir.
 */
export function foldText(text: string): string {
  const lower = text.toLocaleLowerCase('tr');
  const base = lower.length === text.length ? lower : [...text].map((c) => {
    const l = c.toLocaleLowerCase('tr');
    return l.length === c.length ? l : c;
  }).join('');
  return base.replace(/[À-ɏ’‘]/g, (c) => TURKISH[c] ?? (c.normalize('NFD')[0] || c));
}

export function searchTerms(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean);
}

// --- Etiketler ---

const MAX_TAG_LENGTH = 32;

export function cleanTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
}

export function tagKey(tag: string): string {
  return foldText(cleanTag(tag));
}

export interface TagInfo {
  name: string;
  key: string;
  count: number;
}

/** Etiket listesi yazılardan çıkar; hiçbir yazıda kalmayan etiket kendiliğinden kaybolur. */
export function collectTags(posts: Post[]): TagInfo[] {
  const byKey = new Map<string, { names: Map<string, number>; count: number }>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const key = tagKey(tag);
      if (!key) continue;
      const entry = byKey.get(key) ?? { names: new Map<string, number>(), count: 0 };
      entry.names.set(tag, (entry.names.get(tag) ?? 0) + 1);
      entry.count++;
      byKey.set(key, entry);
    }
  }
  return [...byKey.entries()]
    .map(([key, { names, count }]) => ({
      key,
      count,
      // Aynı etiketin farklı yazılışları varsa en çok kullanılanı görünür.
      name: [...names.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'));
}

/** Etiket rengi adından türer: iki cihazda da aynı etiket aynı renkte görünür. */
export function tagHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  // Altın açı: benzer adlar bile renk çemberinde birbirinden uzağa düşer.
  return Math.round((hash * 137.508) % 360) % 360;
}

// --- Filtre ---

export interface PostFilter {
  query: string;
  tags: Set<string>;
}

export function emptyFilter(): PostFilter {
  return { query: '', tags: new Set() };
}

export function isFiltering(filter: PostFilter): boolean {
  return filter.query.trim() !== '' || filter.tags.size > 0;
}

interface SearchEntry {
  haystack: string;
  body: string;
}

// Yazı nesnesi yalnızca içerik değişince yenilendiği için dizin bir kez kurulur.
const index = new WeakMap<Post, SearchEntry>();

function entryOf(post: Post): SearchEntry {
  let entry = index.get(post);
  if (!entry) {
    const body = blocksToPlainText(docToBlocks(post.doc));
    const captions = post.images.map((image) => image.caption).join(' ');
    entry = { body, haystack: foldText([post.title, body, captions, post.tags.join(' ')].join('\n')) };
    index.set(post, entry);
  }
  return entry;
}

export function postBody(post: Post): string {
  return entryOf(post).body;
}

/**
 * Seçili etiketlerden herhangi birini taşıyan ve aranan kelimelerin hepsini içeren yazılar.
 * Etiketler "veya" ile bağlanır: "Film" + "Tatil" ikisini birden gösterir.
 */
export function filterPosts(posts: Post[], filter: PostFilter): Post[] {
  const terms = searchTerms(filter.query);
  return posts.filter((post) => {
    if (filter.tags.size && !post.tags.some((tag) => filter.tags.has(tagKey(tag)))) return false;
    const { haystack } = entryOf(post);
    return terms.every((term) => haystack.includes(term));
  });
}

// --- Vurgulama ---

export interface TextPart {
  text: string;
  hit: boolean;
}

/** Metni aranan kelimelerin işaretlenebileceği parçalara böler. */
export function highlightParts(text: string, terms: string[]): TextPart[] {
  if (!terms.length) return [{ text, hit: false }];
  const folded = foldText(text);
  const hits = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      hits.fill(true, at, at + term.length);
    }
  }
  const parts: TextPart[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || hits[i] !== hits[start]) {
      parts.push({ text: text.slice(start, i), hit: hits[start] });
      start = i;
    }
  }
  return parts.filter((part) => part.text);
}

const EXCERPT_LENGTH = 220;

/** Karttaki özet: arama varsa kelimenin geçtiği yeri gösterir, yoksa yazının başını. */
export function excerptOf(post: Post, terms: string[]): string {
  const body = postBody(post);
  const folded = foldText(body);
  const at = terms.map((term) => folded.indexOf(term)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined || at < EXCERPT_LENGTH - 80) {
    return body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…` : body;
  }
  const from = body.indexOf(' ', Math.max(0, at - 70)) + 1 || at;
  const start = from > at ? at : from;
  const end = start + EXCERPT_LENGTH;
  return `…${body.slice(start, end).trim()}${end < body.length ? '…' : ''}`;
}
