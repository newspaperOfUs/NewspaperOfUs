import type { Post } from '../store';
import { countChars, docToBlocks } from './doc';

/**
 * Tahmini sayfa sayısı. Gerçek dizgiyi çalıştırmak saniyeler sürer, bu ise her tıklamada anında çalışmalı;
 * bu yüzden motorun davranışını taklit eden kaba bir model kullanılır.
 * Sabitler ölçümden gelir: `npm run calibrate` motoru farklı senaryo ve tasarımlarda çalıştırıp
 * tahminle karşılaştırır. Motorun yerleşimi değişirse o komutla yeniden kontrol edilmeli.
 */

export interface StoryStats {
  chars: number;
  photos: number;
}

export interface PageRange {
  min: number;
  max: number;
}

/** Tek yazı küçük puntoyla sayfaya sığabilir; bölünürse okunur punto korunur ve sayfaya daha az girer. */
const CHARS_FIT_PAGE = 12000;
const CHARS_SPLIT_PAGE = 8500;
const MAX_STORIES_PER_PAGE = 7;

function photoCostAlone(stats: StoryStats): number {
  // Çok fotoğraf yan yana mozaik olur, az fotoğraf büyük basılır.
  if (stats.photos >= 5 || (stats.chars === 0 && stats.photos >= 2)) return stats.photos * 0.07;
  return stats.photos ? 0.2 + (stats.photos - 1) * 0.07 : 0;
}

function fitsOnePage(stats: StoryStats): boolean {
  return stats.chars / CHARS_FIT_PAGE + 0.04 + photoCostAlone(stats) <= 1;
}

/** Başka yazılarla paylaşılan sayfada kapladığı yer: sütunlar daraldıkça fotoğraflar da küçülür. */
function sharedUnits(stats: StoryStats): number {
  const photos = [0, 0.07, 0.11][stats.photos] ?? 0.11 + (stats.photos - 2) * 0.08;
  return stats.chars / CHARS_FIT_PAGE + 0.04 + photos;
}

/** Tek sayfaya sığmayan yazı: metin taşıyan sayfalar iki fotoğraf alır, artanlar mozaik sayfalara gider. */
function splitUnits(stats: StoryStats): number {
  const textPages = stats.chars / CHARS_SPLIT_PAGE;
  const carried = stats.chars ? Math.min(stats.photos, 2 * Math.ceil(textPages)) : 0;
  return textPages + carried * 0.29 + (stats.photos - carried) * 0.085;
}

/** Sıradaki yazı sığmıyorsa yeni sayfaya geçer; motor da yazıları sırayla yerleştirir. */
function rawPages(stories: StoryStats[]): number {
  let pages = 0;
  let fill = 0;
  let onPage = 0;
  const closePage = () => {
    pages += 1;
    fill = 0;
    onPage = 0;
  };

  for (const story of stories) {
    if (fitsOnePage(story)) {
      const units = sharedUnits(story);
      if (onPage > 0 && (fill + units > 1.07 || onPage >= MAX_STORIES_PER_PAGE)) closePage();
      fill += units;
      onPage += 1;
    } else {
      if (onPage > 0) closePage();
      const units = splitUnits(story);
      const whole = Math.floor(units - 0.1);
      pages += Math.max(0, whole);
      fill = Math.max(0.05, units - whole);
      onPage = 1;
    }
  }
  return pages + (onPage > 0 ? Math.min(1, fill) : 0);
}

export function estimatePages(stories: StoryStats[]): PageRange {
  if (!stories.length) return { min: 0, max: 0 };
  const raw = rawPages(stories);
  const middle = Math.ceil(raw);
  // Tasarıma göre sütun ve punto değişir; sayı büyüdükçe fark da büyür.
  const spread = Math.round(middle * 0.12);
  return { min: Math.max(1, middle - spread), max: middle + spread };
}

export function pagesLabel(range: PageRange): string {
  return range.min === range.max ? `${range.max} sayfa` : `${range.min}–${range.max} sayfa`;
}

export function estimateLabel(range: PageRange): string {
  return `tahmini ${pagesLabel(range)}`;
}

export function docStats(doc: unknown, photos: number): StoryStats {
  return { chars: countChars(docToBlocks(doc)), photos };
}

const postStats = new WeakMap<Post, StoryStats>();

export function estimatePosts(posts: Post[]): PageRange {
  return estimatePages(
    posts.map((post) => {
      let stats = postStats.get(post);
      if (!stats) {
        stats = docStats(post.doc, post.images.length);
        postStats.set(post, stats);
      }
      return stats;
    }),
  );
}
