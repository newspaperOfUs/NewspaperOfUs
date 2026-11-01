import { BYLINES, CAPTIONS, KICKERS } from './copy';
import { blocksToPlainText, countChars, splitBlocks, type Block } from './doc';
import { lazyFiller, type FillerDeck } from './filler';
import { colOrnament, hrule, ruleHeight } from './ornaments';
import { renderPhoto, type SourcePhoto } from './photo';
import type { Rng } from './rng';
import type { DisplayFont, Style } from './styles';
import {
  drawLine,
  fontCss,
  itemsHeight,
  typesetBlocks,
  wrapPlain,
  type Face,
  type Item,
  type Line,
  type WidthFn,
} from './typeset';

export const PAGE_W = 2480;
export const PAGE_H = 3508;

export type DrawOp = (ctx: CanvasRenderingContext2D) => void;

export interface NewsPhoto extends SourcePhoto {
  caption: string;
}

export interface Story {
  key: string;
  title: string;
  author: string;
  dateText: string;
  blocks: Block[];
  photos: NewsPhoto[];
  /** Bir önceki sayfadan devam ediyorsa: "(Baştarafı 1. sayfada)". */
  headNote?: string;
  /** Sonraki sayfaya taşıyorsa: "(Devamı 2. sayfada)". */
  tailNote?: string;
}

export interface Env {
  style: Style;
  rng: Rng;
  measure: WidthFn;
  ctx: CanvasRenderingContext2D;
  deck: FillerDeck;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Placement = 'above' | 'top' | 'inset' | 'mid' | 'bottom' | 'side' | 'mosaic';

interface LeafPlan {
  id: number;
  story: Story;
  lead: boolean;
  placement: Placement;
  spanRatio: number;
  colStart: 'left' | 'right' | 'center';
  sideRatio: number;
  sideLeft: boolean;
  midAt: number;
  charsTarget: number;
  headFont: DisplayFont;
  caps: boolean;
  headBoost: number;
  deck: boolean;
  kicker: string | null;
  dropCap: boolean;
  bylinePrefix: string;
  bylineRules: boolean;
  stack: boolean;
  align: 'center' | 'left';
  fallbackCaption: string | null;
  bodyFactor: number;
  /** Çok kısa yazı: küçük harflerle sütunlara bölmek yerine büyük ve ortalı dizilir. */
  short: boolean;
  rowFactor: number;
  phiMax: number;
}

type TreeNode =
  | { t: 'leaf'; k: number; plan: LeafPlan }
  | { t: 'row'; k: number; children: TreeNode[] }
  | { t: 'col'; k: number; children: TreeNode[] };

// --- Yardımcılar ---

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function asFace(font: DisplayFont): Face {
  return { family: font.family, regular: font.weight, bold: font.weight, sizeAdj: 1 };
}

const capCache = new Map<string, number>();

export function capRatio(env: Env, face: Pick<Face, 'family' | 'regular' | 'bold'>): number {
  const key = `${face.family}|${face.regular}`;
  let ratio = capCache.get(key);
  if (ratio === undefined) {
    env.ctx.font = fontCss(face, {}, 200);
    ratio = env.ctx.measureText('H').actualBoundingBoxAscent / 200 || 0.7;
    capCache.set(key, ratio);
  }
  return ratio;
}

export function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  track: number,
  align: 'left' | 'center' | 'right' = 'left',
) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
  let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  chars.forEach((c, i) => {
    ctx.fillText(c, cursor, baseline);
    cursor += widths[i] + track;
  });
}

function firstSentence(blocks: Block[]): string | null {
  const text = blocksToPlainText(blocks.filter((b) => b.kind === 'p').slice(0, 2));
  const match = text.match(/^.{20,130}?[.!?…](?=\s|$)/);
  return match ? match[0] : null;
}

// --- Başlık ---

function balanceLines(words: string[], widthOf: (s: string) => number, count: number): string[] {
  const n = words.length;
  const total = widthOf(words.join(' '));
  const ideal = total / count;
  const memo = new Map<string, { cost: number; breaks: number[] }>();

  const solve = (start: number, left: number): { cost: number; breaks: number[] } => {
    const key = `${start}|${left}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let best = { cost: Infinity, breaks: [] as number[] };
    if (left === 1) {
      const w = widthOf(words.slice(start).join(' '));
      best = { cost: (w - ideal) ** 2, breaks: [] };
    } else {
      for (let end = start + 1; end <= n - left + 1; end++) {
        const w = widthOf(words.slice(start, end).join(' '));
        const rest = solve(end, left - 1);
        const cost = (w - ideal) ** 2 + rest.cost;
        if (cost < best.cost) best = { cost, breaks: [end, ...rest.breaks] };
      }
    }
    memo.set(key, best);
    return best;
  };

  const { breaks } = solve(0, count);
  const lines: string[] = [];
  let at = 0;
  for (const end of [...breaks, n]) {
    lines.push(words.slice(at, end).join(' '));
    at = end;
  }
  return lines;
}

interface HeadLine {
  text: string;
  size: number;
  w: number;
}

function fitHeadline(env: Env, plan: LeafPlan, W: number, maxH: number): HeadLine[] {
  const font = plan.headFont;
  const face = asFace(font);
  const text = (plan.caps ? plan.story.title.toLocaleUpperCase('tr') : plan.story.title).trim() || '—';
  const words = text.split(/\s+/);
  const widthAt100 = (s: string) => env.measure(face, {}, s, 100);

  const narrow = font.condensed ? 1.25 : 1;
  const target = clamp(
    W * env.style.headScale * plan.headBoost * (plan.lead ? 1 : 0.84) * narrow,
    54,
    plan.lead ? 400 : 260,
  );
  const minSize = 44;

  let best: HeadLine[] | null = null;
  let bestScore = Infinity;
  const maxLines = Math.min(words.length, 9);
  for (let count = 1; count <= maxLines; count++) {
    const lines = balanceLines(words, widthAt100, count);
    const widest = Math.max(...lines.map(widthAt100));
    const fitSize = (W / widest) * 100;
    const size = Math.min(fitSize, target * 1.12);
    const fill = (widest * size) / 100 / W;
    const tall = size * font.lead * count > maxH ? 4 : 0;
    const score =
      Math.abs(Math.log(size / target)) + (1 - fill) * 0.7 + (fitSize < minSize ? 5 : 0) + tall + count * 0.015;
    if (score < bestScore) {
      bestScore = score;
      if (plan.stack && count <= 4) {
        best = lines.map((line) => {
          const s = Math.min((W / widthAt100(line)) * 100, target * 1.5);
          return { text: line, size: s, w: (widthAt100(line) * s) / 100 };
        });
      } else {
        best = lines.map((line) => ({ text: line, size, w: (widthAt100(line) * size) / 100 }));
      }
    }
  }
  return best!;
}

interface Header {
  h: number;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number) => void;
}

function layoutHeader(env: Env, plan: LeafPlan, W: number, f: number, availH: number): Header {
  const { style, measure } = env;
  const story = plan.story;
  const parts: { h: number; draw: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number) => void }[] = [];
  const size = f * style.body.sizeAdj;
  const align = plan.align;
  const anchorX = (x: number, w: number) => (align === 'center' ? x + w / 2 : x);
  const label = style.label;

  if (plan.kicker) {
    const kSize = clamp(size * 0.92, 24, 40);
    const color = style.spot ?? style.ink;
    const text = plan.kicker;
    parts.push({
      h: kSize * 1.55,
      draw: (ctx, x, y, w) => {
        ctx.font = fontCss(label, { b: true }, kSize);
        ctx.fillStyle = color;
        drawTracked(ctx, text, anchorX(x, w), y + kSize * 0.95, kSize * 0.14, align);
      },
    });
  }

  if (story.headNote) {
    const nSize = size * 0.85;
    const note = story.headNote;
    parts.push({
      h: nSize * 1.4,
      draw: (ctx, x, y, w) => {
        ctx.font = fontCss(style.body, { i: true }, nSize);
        ctx.fillStyle = style.ink;
        ctx.textAlign = align === 'center' ? 'center' : 'left';
        ctx.fillText(note, anchorX(x, w), y + nSize);
        ctx.textAlign = 'left';
      },
    });
  }

  // Devam sayfalarında başlık mütevazı olur.
  const headPlan = story.headNote ? { ...plan, headBoost: plan.headBoost * 0.55, stack: false } : plan;
  const headLines = fitHeadline(env, headPlan, W, availH * (plan.short ? 0.36 : 0.24));
  const headFace = asFace(plan.headFont);
  const cap = capRatio(env, headFace);
  const lead = plan.headFont.lead;
  const firstSize = headLines[0].size;
  const accent = plan.caps ? firstSize * 0.16 : firstSize * 0.04;
  let headH = accent + cap * firstSize;
  for (let i = 1; i < headLines.length; i++) headH += headLines[i].size * lead;
  const lastSize = headLines[headLines.length - 1].size;
  headH += lastSize * (plan.caps ? 0.1 : 0.2);

  parts.push({
    h: headH,
    draw: (ctx, x, y, w) => {
      ctx.fillStyle = style.ink;
      let baseline = y + accent + cap * headLines[0].size;
      headLines.forEach((line, i) => {
        if (i > 0) baseline += line.size * lead;
        ctx.font = fontCss(headFace, {}, line.size);
        const lx = align === 'center' ? x + (w - line.w) / 2 : x;
        ctx.fillText(line.text, lx, baseline);
      });
    },
  });

  const deck = plan.deck && !story.headNote ? firstSentence(story.blocks) : null;
  if (deck) {
    const dSize = size * (plan.lead ? 1.55 : 1.22);
    const avail = Math.min(W, Math.max(W * 0.86, 300));
    const lines = wrapPlain(deck, style.body, { i: true }, dSize, avail, measure, align === 'center' ? 'center' : 'left');
    const dLead = dSize * 1.24;
    const pad = size * 0.5;
    parts.push({
      h: pad + lines.length * dLead,
      draw: (ctx, x, y, w) => {
        const lx = x + (w - avail) * (align === 'center' ? 0.5 : 0);
        lines.forEach((line, i) => drawLine(ctx, line, lx, y + pad + i * dLead, dLead, style.ink));
      },
    });
  }

  const byText = `${plan.bylinePrefix}: ${story.author}  ·  ${story.dateText}`;
  const bySize = clamp(size * 0.82, 22, 38);
  const byLines = wrapPlain(byText, label, { i: true }, bySize, W, measure, align === 'center' ? 'center' : 'left');
  const byLead = bySize * 1.3;
  const byPad = size * 0.55;
  const rules = plan.bylineRules;
  parts.push({
    h: byPad + byLines.length * byLead + (rules ? byPad * 0.9 : byPad * 0.2),
    draw: (ctx, x, y, w) => {
      if (rules) hrule(ctx, x, x + w, y + byPad * 0.45, 'hair', style.ink);
      byLines.forEach((line, i) => drawLine(ctx, line, x, y + byPad * 0.7 + i * byLead, byLead, style.ink));
      if (rules) hrule(ctx, x, x + w, y + byPad * 0.85 + byLines.length * byLead, 'hair', style.ink);
    },
  });

  const below = size * 0.55;
  const total = parts.reduce((sum, p) => sum + p.h, 0) + below;
  return {
    h: total,
    draw: (ctx, x, y, w) => {
      let cursor = y;
      for (const part of parts) {
        part.draw(ctx, x, cursor, w);
        cursor += part.h;
      }
    },
  };
}

// --- Fotoğraf grupları ---

interface Cell {
  photo: NewsPhoto;
  x: number;
  w: number;
  caption: Line[];
}

interface Row {
  cells: Cell[];
  pure: number;
  capH: number;
}

interface Group {
  colStart: number;
  colSpan: number;
  w: number;
  anchor: 'top' | 'mid' | 'bottom';
  midAt: number;
  rows: Row[];
  gap: number;
  capLead: number;
}

const PHI_MIN = 0.74;

function groupHeight(group: Group, phi: number): number {
  let h = group.gap * (group.rows.length - 1);
  for (const row of group.rows) h += row.pure * phi + row.capH;
  return h;
}

function buildGroup(
  env: Env,
  plan: LeafPlan,
  photos: NewsPhoto[],
  w: number,
  f: number,
  place: Pick<Group, 'colStart' | 'colSpan' | 'anchor' | 'midAt'>,
  allowFallback: boolean,
): Group {
  const { style, measure } = env;
  const gap = Math.max(14, f * 0.5);
  const size = clamp(f * style.body.sizeAdj * 0.8, 22, 36);
  const capLead = size * 1.22;
  const aspect = (p: NewsPhoto) => clamp(p.w / p.h, 0.62, 2.3);

  // Fotoğrafları satırlara dağıt: satır yüksekliği hedefe yaklaşana kadar yan yana diz.
  const targetRowH = clamp(w * 0.42 * plan.rowFactor, 260, 1500);
  const rowsOfPhotos: NewsPhoto[][] = [];
  let current: NewsPhoto[] = [];
  let sum = 0;
  for (const photo of photos) {
    current.push(photo);
    sum += aspect(photo);
    if ((w - gap * (current.length - 1)) / sum <= targetRowH) {
      rowsOfPhotos.push(current);
      current = [];
      sum = 0;
    }
  }
  if (current.length) rowsOfPhotos.push(current);

  const rows: Row[] = rowsOfPhotos.map((rowPhotos, rowIndex) => {
    const totalAspect = rowPhotos.reduce((s, p) => s + aspect(p), 0);
    const usable = w - gap * (rowPhotos.length - 1);
    const pure = usable / totalAspect;
    let x = 0;
    const cells: Cell[] = rowPhotos.map((photo, i) => {
      const cw = usable * (aspect(photo) / totalAspect);
      const fallback = allowFallback && rowIndex === 0 && i === 0 ? plan.fallbackCaption : null;
      const text = photo.caption.trim() || fallback;
      const caption = text ? wrapPlain(text, style.body, { i: true }, size, cw, measure, 'left') : [];
      const cell = { photo, x, w: cw, caption };
      x += cw + gap;
      return cell;
    });
    const maxLines = Math.max(0, ...cells.map((c) => c.caption.length));
    return { cells, pure, capH: maxLines ? maxLines * capLead + size * 0.28 : 0 };
  });

  return { ...place, w, rows, gap, capLead };
}

// --- Yaprak: tek bir haberin bloğu ---

interface Slot {
  col: number;
  y: number;
  h: number;
}

interface Placed {
  item: Item;
  slot: number;
  y: number;
  h: number;
}

interface PourResult {
  placed: Placed[];
  fits: boolean;
  used: number[];
}

function pour(items: Item[], slots: Slot[], scale = 1): PourResult {
  const placed: Placed[] = [];
  const used = slots.map(() => 0);
  let s = 0;
  if (!slots.length) return { placed, fits: items.length === 0, used };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const h = item.h * scale;
    if (item.kind === 'gap') {
      if (used[s] === 0) continue;
      if (used[s] + h >= slots[s].h) {
        s++;
        if (s >= slots.length) {
          // Sondaki boşluk taşsa da metin sığmıştır.
          if (i === items.length - 1) return { placed, fits: true, used };
          return { placed, fits: false, used };
        }
        continue;
      }
      used[s] += h;
      continue;
    }

    let need = h;
    if (item.kind === 'line' && item.drop) need = Math.max(need, item.drop.lines * h);
    if (item.kind === 'line' && item.keepNext) {
      let next = i + 1;
      while (next < items.length && items[next].kind === 'gap') next++;
      if (next < items.length) need += items[next].h * scale;
    }

    while (used[s] + need > slots[s].h + 0.5) {
      s++;
      if (s >= slots.length) return { placed, fits: false, used };
    }
    placed.push({ item, slot: s, y: used[s], h });
    used[s] += h;
  }
  return { placed, fits: true, used };
}

/** Metnin sığdığı en küçük ortak alt sınırı bulur; böylece sütunlar eşit dolar. */
function balanceSlots(items: Item[], slots: Slot[], Hb: number): { slots: Slot[]; limit: number } {
  const capped = (limit: number) =>
    slots.map((slot) => ({ ...slot, h: Math.min(slot.h, limit - slot.y) })).filter((slot) => slot.h > 0);
  let lo = 0;
  let hi = Hb;
  while (hi - lo > 2) {
    const mid = (lo + hi) / 2;
    if (pour(items, capped(mid)).fits) hi = mid;
    else lo = mid;
  }
  return { slots: capped(hi), limit: hi };
}

interface Leaf {
  plan: LeafPlan;
  W: number;
  innerW: number;
  sideW: number;
  f: number;
  header: Header;
  tc: number;
  colW: number;
  gutter: number;
  pad: number;
  items: Item[];
  groups: Group[];
  above: Group | null;
  side: Group | null;
  minH: number;
}

function placements(leaf: Leaf, Hb: number, phi: number) {
  return leaf.groups.map((group) => {
    const h = groupHeight(group, phi);
    const y =
      group.anchor === 'top' ? 0 : group.anchor === 'bottom' ? Hb - h : Math.round((Hb - h) * group.midAt);
    return { group, y, h };
  });
}

function computeSlots(leaf: Leaf, Hb: number, phi: number): Slot[] | null {
  const positions = placements(leaf, Hb, phi);
  if (positions.some((p) => p.y < -0.5)) return null;
  const slots: Slot[] = [];
  for (let col = 0; col < leaf.tc; col++) {
    const blockers = positions
      .filter((p) => col >= p.group.colStart && col < p.group.colStart + p.group.colSpan)
      .sort((a, b) => a.y - b.y);
    let cursor = 0;
    for (const b of blockers) {
      if (b.y < cursor - 0.5) return null;
      const end = b.y > 0 ? b.y - leaf.pad : 0;
      if (end > cursor) slots.push({ col, y: cursor, h: end - cursor });
      cursor = b.y + b.h + leaf.pad;
    }
    if (Hb > cursor) slots.push({ col, y: cursor, h: Hb - cursor });
  }
  return slots;
}

function fitsAt(leaf: Leaf, Hb: number, phi: number): boolean {
  const slots = computeSlots(leaf, Hb, phi);
  if (!slots) return false;
  return leaf.items.length === 0 || pour(leaf.items, slots).fits;
}

function minBody(leaf: Leaf, phi: number): number {
  let lower = 0;
  for (let col = 0; col < leaf.tc; col++) {
    const stacked = leaf.groups
      .filter((g) => col >= g.colStart && col < g.colStart + g.colSpan)
      .reduce((sum, g) => sum + groupHeight(g, phi) + leaf.pad, 0);
    lower = Math.max(lower, stacked);
  }
  lower = Math.max(lower - leaf.pad, 0);

  if (leaf.items.length === 0) return lower;
  if (fitsAt(leaf, lower, phi)) return lower;

  const need = itemsHeight(leaf.items);
  let hi = Math.max(lower + 1, lower + need / leaf.tc);
  while (!fitsAt(leaf, hi, phi)) {
    hi = hi * 1.2 + 40;
    if (hi > 200000) return Infinity;
  }
  let lo = lower;
  while (hi - lo > 1.5) {
    const mid = (lo + hi) / 2;
    if (fitsAt(leaf, mid, phi)) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

function buildLeaf(env: Env, plan: LeafPlan, W: number, f: number, availH: number): Leaf | null {
  const { style, measure } = env;
  const photos = plan.story.photos;
  const gutter = style.gutter;
  const useSide = plan.placement === 'side' && photos.length > 0 && W >= 720;
  const sideW = useSide ? Math.round(W * plan.sideRatio) : 0;
  const innerW = useSide ? W - sideW - gutter : W;

  const chars = countChars(plan.story.blocks);
  const baseSize = f * plan.bodyFactor * style.body.sizeAdj;
  // Kısa yazı birkaç satırı dolduracak kadar büyür.
  const size = plan.short
    ? clamp(innerW / (Math.max(chars / 4, 14) * 0.46), baseSize * 1.15, baseSize * 3)
    : baseSize;
  const header = layoutHeader(env, plan, innerW, f * plan.bodyFactor, availH);

  const charW = size * 0.46;
  let tc = plan.short ? 1 : clamp(Math.round((innerW + gutter) / (plan.charsTarget * charW + gutter)), 1, 8);
  const columnWidth = (count: number) => (innerW - gutter * (count - 1)) / count;
  // Yazı azsa sütun sayısını düşür: her sütunda en az birkaç satır olsun, boş sütun kalmasın.
  while (tc > 1 && chars / (columnWidth(tc) / charW) / tc < 6) tc--;
  const colW = columnWidth(tc);
  if (colW / charW < 13) return null;

  const items = typesetBlocks(plan.story.blocks, {
    face: style.body,
    size,
    leading: style.leading,
    width: colW,
    paragraph: style.paragraph,
    dropCap: plan.dropCap && !plan.short ? { lines: tc >= 2 ? 3 : 2, capRatio: capRatio(env, style.body) } : null,
    defaultAlign: plan.short ? 'center' : 'justify',
    measure,
    tailNote: plan.story.tailNote,
  });

  // Fotoğrafların yerleşimi
  const groups: Group[] = [];
  let above: Group | null = null;
  let side: Group | null = null;
  const [hero, ...rest] = photos;
  const spanCols = clamp(Math.round(tc * plan.spanRatio), 1, tc);
  const spanW = spanCols * colW + (spanCols - 1) * gutter;
  const startCol = plan.colStart === 'left' ? 0 : plan.colStart === 'right' ? tc - spanCols : Math.floor((tc - spanCols) / 2);
  const allPlace = { colStart: 0, colSpan: tc, midAt: 0.5 };
  const stripAnchor = plan.placement === 'bottom' ? 'top' : 'bottom';

  if (hero) {
    if (plan.placement === 'mosaic') {
      groups.push(buildGroup(env, plan, photos, innerW, f, { ...allPlace, anchor: plan.lead ? 'top' : 'bottom' }, true));
    } else {
      if (useSide) {
        side = buildGroup(env, plan, [hero], sideW, f, { colStart: 0, colSpan: 1, anchor: 'top', midAt: 0 }, true);
      } else if (plan.placement === 'above') {
        above = buildGroup(env, plan, [hero], innerW, f, { colStart: 0, colSpan: 1, anchor: 'top', midAt: 0 }, true);
      } else if (plan.placement === 'top' || plan.placement === 'side') {
        groups.push(buildGroup(env, plan, [hero], innerW, f, { ...allPlace, anchor: 'top' }, true));
      } else if (plan.placement === 'bottom') {
        groups.push(buildGroup(env, plan, [hero], innerW, f, { ...allPlace, anchor: 'bottom' }, true));
      } else if (plan.placement === 'inset') {
        groups.push(
          buildGroup(env, plan, [hero], spanW, f, { colStart: startCol, colSpan: spanCols, anchor: 'top', midAt: 0 }, true),
        );
      } else {
        groups.push(
          buildGroup(env, plan, [hero], spanW, f, { colStart: startCol, colSpan: spanCols, anchor: 'mid', midAt: plan.midAt }, true),
        );
      }
      if (rest.length) {
        const loneVertical = rest.length === 1 && rest[0].h > rest[0].w && tc >= 2;
        if (loneVertical) {
          const span = clamp(Math.round(tc * 0.5), 1, tc - 1);
          const stripW = span * colW + (span - 1) * gutter;
          const colStart = plan.colStart === 'left' ? tc - span : 0;
          groups.push(buildGroup(env, plan, rest, stripW, f, { colStart, colSpan: span, anchor: stripAnchor, midAt: 0.5 }, false));
        } else {
          groups.push(buildGroup(env, plan, rest, innerW, f, { ...allPlace, anchor: stripAnchor }, false));
        }
      }
    }
  }

  const leaf: Leaf = {
    plan,
    W,
    innerW,
    sideW,
    f,
    header,
    tc,
    colW,
    gutter,
    pad: Math.max(16, size * 0.7),
    items,
    groups,
    above,
    side,
    minH: 0,
  };

  const body = minBody(leaf, PHI_MIN);
  if (!Number.isFinite(body)) return null;
  const aboveH = above ? groupHeight(above, PHI_MIN) + leaf.pad : 0;
  const sideMin = side ? groupHeight(side, PHI_MIN) : 0;
  leaf.minH = Math.ceil(Math.max(header.h + aboveH + body, sideMin));
  return leaf;
}

interface LeafDraw {
  ops: DrawOp[];
  fillerArea: number;
  photoArea: number;
  crop: number;
}

function drawPhotoOp(env: Env, photo: NewsPhoto, x: number, y: number, w: number, h: number): DrawOp {
  const { style } = env;
  const rng = env.rng.fork();
  return (ctx) => {
    const rendered = renderPhoto(photo, w, h, style.fx, style.ink, rng);
    ctx.drawImage(rendered, Math.round(x), Math.round(y));
    if (style.fx.kind !== 'faded' || style.columnRule !== 'none') {
      ctx.strokeStyle = style.ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, rendered.width - 2, rendered.height - 2);
    }
    rendered.width = 0;
  };
}

function groupOps(env: Env, group: Group, x: number, y: number, phi: number, ops: DrawOp[]): number {
  let cursor = y;
  let area = 0;
  group.rows.forEach((row, index) => {
    if (index > 0) cursor += group.gap;
    const h = row.pure * phi;
    for (const cell of row.cells) {
      ops.push(drawPhotoOp(env, cell.photo, x + cell.x, cursor, cell.w, h));
      area += cell.w * h;
      if (cell.caption.length) {
        const capTop = cursor + h + group.capLead * 0.2;
        ops.push((ctx) => {
          cell.caption.forEach((line, i) => {
            drawLine(ctx, line, x + cell.x, capTop + i * group.capLead, group.capLead, env.style.ink);
          });
        });
      }
    }
    cursor += h + row.capH;
  });
  return area;
}

function finalizeLeaf(env: Env, leaf: Leaf, x: number, y: number, H: number): LeafDraw {
  const { style } = env;
  const { plan, header, innerW, sideW, gutter } = leaf;
  const ops: DrawOp[] = [];
  let fillerArea = 0;
  let photoArea = 0;

  const textX = leaf.side && plan.sideLeft ? x + sideW + gutter : x;

  // Yan fotoğraf: bloğun yüksekliğini doldursun, kırpma sınırını aşarsa altı dolgu olur.
  if (leaf.side) {
    const pure = leaf.side.rows[0].pure;
    const capH = leaf.side.rows[0].capH;
    const phi = clamp((H - capH) / pure, PHI_MIN, 1.75);
    const sideX = plan.sideLeft ? x : x + innerW + gutter;
    photoArea += groupOps(env, leaf.side, sideX, y, phi, ops);
    const usedH = groupHeight(leaf.side, phi);
    const rest = H - usedH;
    if (rest > 120) {
      ops.push(lazyFiller(env, { x: sideX, y: y + usedH + leaf.pad, w: sideW, h: rest - leaf.pad }, leaf.f));
      fillerArea += sideW * rest;
    }
    const ruleX = plan.sideLeft ? textX - gutter / 2 : sideX - gutter / 2;
    if (style.columnRule !== 'none') {
      ops.push((ctx) => {
        ctx.fillStyle = style.ink;
        ctx.fillRect(ruleX - 1, y, 2, H);
      });
    }
  }

  const hasFlexPhoto = leaf.groups.length > 0 || leaf.above !== null;
  const aboveFor = (phi: number) => (leaf.above ? groupHeight(leaf.above, phi) + leaf.pad : 0);
  const bodyAvail = (phi: number) => H - header.h - aboveFor(phi);

  // Metin sığdığı sürece fotoğrafı büyüt.
  let phi = PHI_MIN;
  if (hasFlexPhoto) {
    let lo = PHI_MIN;
    let hi = plan.phiMax;
    if (minBody(leaf, hi) <= bodyAvail(hi)) {
      lo = hi;
    } else {
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (minBody(leaf, mid) <= bodyAvail(mid)) lo = mid;
        else hi = mid;
      }
    }
    phi = lo;
  }

  const crop = hasFlexPhoto ? Math.abs(phi - 1) : 0;

  let cursor = y;
  if (leaf.above) {
    const aboveGroup = leaf.above;
    photoArea += groupOps(env, aboveGroup, textX, cursor, phi, ops);
    cursor += groupHeight(aboveGroup, phi) + leaf.pad;
  }

  const headerY = cursor;
  ops.push((ctx) => header.draw(ctx, textX, headerY, innerW));
  cursor += header.h;

  const available = bodyAvail(phi);
  const textBody = minBody(leaf, phi);
  const slack = available - textBody;
  const lineH = (plan.story.blocks.length ? leaf.f * plan.bodyFactor * style.body.sizeAdj * style.leading : 40);
  const fillerMin = Math.max(170, lineH * 5);

  let Hb = available;
  let filler: Rect | null = null;
  if (slack >= fillerMin) {
    Hb = textBody;
    const gap = leaf.pad * 0.8;
    filler = { x: textX, y: cursor + textBody + gap, w: innerW, h: slack - gap };
    fillerArea += filler.w * filler.h;
  }

  const bodyTop = cursor;
  let slots = computeSlots(leaf, Hb, phi) ?? [];

  // Fotoğraf bloğu uzattıysa metin sütunları dolduramaz ve sağda bomboş sütun kalır:
  // metni sütunlara dengeli dağıt, altta kalan alanı dolguya ver.
  const columnRuns: { from: number; to: number; limit: number }[] = [];
  if (leaf.items.length && slots.length) {
    const balanced = balanceSlots(leaf.items, slots, Hb);
    if (Hb - balanced.limit >= fillerMin) {
      const gap = leaf.pad * 0.8;
      const tops = new Map<number, number>();
      for (const slot of slots) {
        if (slot.y + slot.h >= Hb - 0.5) tops.set(slot.col, Math.max(slot.y, balanced.limit));
      }
      for (let col = 0; col < leaf.tc; col++) {
        if (!tops.has(col)) continue;
        let end = col;
        while (tops.has(end + 1)) end++;
        let top = 0;
        for (let c = col; c <= end; c++) top = Math.max(top, tops.get(c)!);
        const h = Hb - top - gap;
        if (h >= fillerMin) {
          const rect: Rect = {
            x: textX + col * (leaf.colW + gutter),
            y: bodyTop + top + gap,
            w: (end - col + 1) * leaf.colW + (end - col) * gutter,
            h,
          };
          ops.push(lazyFiller(env, rect, leaf.f));
          fillerArea += rect.w * rect.h;
          columnRuns.push({ from: col, to: end, limit: top });
        }
        col = end;
      }
      if (columnRuns.length) slots = balanced.slots;
    }
  }

  // Hafif satır aralığı artışıyla sütunları doldur.
  let scale = 1;
  if (leaf.items.length && slots.length) {
    let lo = 1;
    let hi = 1.12;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      if (pour(leaf.items, slots, mid).fits) lo = mid;
      else hi = mid;
    }
    scale = lo;
  }
  const poured = pour(leaf.items, slots, scale);

  // Sütun içi yerleşimi dik hizala: küçük artığı satırlara yay.
  const bySlot = new Map<number, Placed[]>();
  for (const p of poured.placed) {
    if (!bySlot.has(p.slot)) bySlot.set(p.slot, []);
    bySlot.get(p.slot)!.push(p);
  }
  const lastSlot = Math.max(-1, ...bySlot.keys());

  bySlot.forEach((placed, slotIndex) => {
    const slot = slots[slotIndex];
    const lastItem = placed[placed.length - 1];
    const usedHeight = lastItem.y + lastItem.h;
    const spare = slot.h - usedHeight;
    const baseLine = lastItem.h;
    const shouldSpread = spare > 0 && placed.length > 1 && (slotIndex !== lastSlot ? spare < baseLine * 3 : spare < baseLine * 1.2);
    const extra = shouldSpread ? spare / (placed.length - 1) : 0;

    placed.forEach((p, i) => {
      const colX = textX + slot.col * (leaf.colW + gutter);
      const top = bodyTop + slot.y + p.y + extra * i;
      const item = p.item;
      if (item.kind === 'line') {
        ops.push((ctx) => {
          drawLine(ctx, item.line, colX, top, p.h, style.ink);
          if (item.drop) {
            const drop = item.drop;
            const baseline = top + (drop.lines - 1) * p.h + p.h * 0.78;
            ctx.font = fontCss(drop.face, { b: true }, drop.size);
            ctx.fillStyle = drop.color ?? style.ink;
            ctx.fillText(drop.letter, colX, baseline);
          }
        });
      } else if (item.kind === 'ornament') {
        ops.push((ctx) => colOrnament(ctx, colX + leaf.colW / 2, top + p.h / 2, p.h * 0.28, style.ink, 0));
      }
    });

    // Son sütunda boşluk kaldıysa küçük bir süs.
    if (slotIndex === lastSlot && spare > baseLine * 3 && !filler && !columnRuns.length) {
      const colX = textX + slot.col * (leaf.colW + gutter);
      const cy = bodyTop + slot.y + usedHeight + Math.min(spare / 2, baseLine * 2);
      ops.push((ctx) => colOrnament(ctx, colX + leaf.colW / 2, cy, baseLine * 0.35, style.ink, 1));
    }
  });

  // Fotoğraflar metinden sonra değil, metnin yerine; sütun çizgileri fotoğrafların arkasında kalmasın.
  const positions = placements(leaf, Hb, phi);
  for (const { group, y: gy } of positions) {
    const gx = textX + group.colStart * (leaf.colW + gutter);
    photoArea += groupOps(env, group, gx, bodyTop + gy, phi, ops);
  }

  if (style.columnRule !== 'none' && leaf.tc > 1) {
    const ruleW = style.columnRule === 'hair' ? 1.5 : 2.5;
    for (let c = 0; c < leaf.tc - 1; c++) {
      const rx = textX + (c + 1) * leaf.colW + c * gutter + gutter / 2;
      const blocked = positions
        .filter((p) => c >= p.group.colStart && c + 1 < p.group.colStart + p.group.colSpan)
        .sort((a, b) => a.y - b.y);
      let from = 0;
      const segments: [number, number][] = [];
      for (const b of blocked) {
        if (b.y > from) segments.push([from, b.y - leaf.pad * 0.5]);
        from = b.y + b.h + leaf.pad * 0.5;
      }
      // Dolgunun içinden sütun çizgisi geçmesin.
      const run = columnRuns.find((r) => c >= r.from && c + 1 <= r.to);
      const ruleEnd = run ? run.limit : Hb;
      if (ruleEnd > from) segments.push([from, ruleEnd]);
      ops.push((ctx) => {
        ctx.fillStyle = style.ink;
        for (const [a, b] of segments) ctx.fillRect(rx - ruleW / 2, bodyTop + a, ruleW, Math.max(0, b - a));
      });
    }
  }

  if (filler) ops.push(lazyFiller(env, filler, leaf.f));

  return { ops, fillerArea, photoArea, crop };
}

// --- Rastgele plan ve ağaç ---

let planCounter = 0;

function makePlan(env: Env, story: Story, lead: boolean, soloPage: boolean): LeafPlan {
  const { style, rng } = env;
  const count = story.photos.length;
  const chars = countChars(story.blocks);
  const short = chars > 0 && chars < 320;
  const photoOnly = chars === 0 && count > 0;
  const landscape = count > 0 && story.photos[0].w >= story.photos[0].h;
  let placement: Placement = 'top';
  const verticalInRest = story.photos.slice(1).some((p) => p.h > p.w);
  if (count >= 5 || (photoOnly && count >= 2)) {
    placement = rng.pick<Placement>(photoOnly ? ['mosaic'] : ['mosaic', 'mosaic', 'top', 'above']);
  } else if (count >= 2 && (short || verticalInRest)) {
    // Dikey fotoğraf tek başına sayfa genişliğinde bir şerit olamaz; yan yana dizmek hem sığar hem güzel durur.
    placement = rng.pick<Placement>(['mosaic', 'mosaic', 'mosaic', 'side', 'inset']);
  } else if (count >= 1 && short) {
    // Kısa yazıda fotoğraf başroldedir, metin onu tamamlar.
    placement = rng.pick<Placement>(landscape ? ['above', 'top', 'bottom'] : ['side', 'side', 'top']);
  } else if (count >= 1) {
    placement = rng.pick<Placement>(
      landscape
        ? ['above', 'top', 'top', 'inset', 'inset', 'mid', 'bottom', 'side']
        : ['inset', 'inset', 'mid', 'side', 'side', 'top'],
    );
  }

  const headFont = !lead && rng.chance(0.3) ? style.headAlt : style.head;
  const caps = !headFont.blackletter && (headFont.caps || style.headCaps);

  return {
    id: planCounter++,
    story,
    lead,
    placement,
    spanRatio: rng.range(0.45, 0.8),
    colStart: rng.pick(['left', 'right', 'center', 'left', 'right']),
    sideRatio: rng.range(0.34, 0.55),
    sideLeft: rng.chance(0.5),
    midAt: rng.range(0.22, 0.6),
    charsTarget: rng.range(27, 38),
    headFont,
    caps,
    headBoost: soloPage ? (short ? rng.range(1.25, 2.1) : rng.range(1, 1.3)) : rng.range(0.92, 1.15),
    deck: rng.chance(lead ? style.deck : style.deck * 0.6),
    kicker: rng.chance(lead ? style.kicker : style.kicker * 0.5) ? rng.pick(KICKERS) : null,
    dropCap: rng.chance(style.dropCap),
    bylinePrefix: rng.pick(BYLINES),
    bylineRules: rng.chance(0.5),
    stack: lead && style.stackFit && rng.chance(0.75),
    align: style.headAlign,
    fallbackCaption: rng.chance(0.65) ? rng.pick(CAPTIONS) : null,
    bodyFactor: lead ? rng.range(1, 1.06) : 1,
    short,
    rowFactor: rng.range(0.6, 1.7),
    phiMax: photoOnly ? 1.75 : 1.3,
  };
}

function buildTree(env: Env, stories: Story[], k: number, leadIncluded: boolean, solo: boolean): TreeNode {
  const { rng } = env;
  if (stories.length === 1) {
    return { t: 'leaf', k, plan: makePlan(env, stories[0], leadIncluded, solo) };
  }

  const canRow = k >= 2;
  const stack = !canRow || rng.chance(stories.length > 3 ? 0.42 : 0.5);

  // Baş haber daha az haberle kendine yer açar.
  const firstCount = stories.length === 2 ? 1 : rng.int(1, Math.max(1, Math.ceil(stories.length / 2)));
  const a = stories.slice(0, firstCount);
  const b = stories.slice(firstCount);

  if (stack) {
    return {
      t: 'col',
      k,
      children: [buildTree(env, a, k, leadIncluded, false), buildTree(env, b, k, false, false)],
    };
  }

  const leadShare = leadIncluded ? rng.range(0.55, 0.75) : rng.range(0.4, 0.6);
  const k1 = clamp(Math.round(k * leadShare), 1, k - 1);
  return {
    t: 'row',
    k,
    children: [buildTree(env, a, k1, leadIncluded, false), buildTree(env, b, k - k1, false, false)],
  };
}

// --- Yerleştirme ---

interface PageContext {
  env: Env;
  rect: Rect;
  colW: number;
  leafCache: Map<string, Leaf | null>;
}

function nodeWidth(ctx: PageContext, k: number) {
  return k * ctx.colW + (k - 1) * ctx.env.style.gutter;
}

function getLeaf(ctx: PageContext, plan: LeafPlan, W: number, f: number): Leaf | null {
  const key = `${plan.id}|${Math.round(W)}|${f}`;
  if (!ctx.leafCache.has(key)) ctx.leafCache.set(key, buildLeaf(ctx.env, plan, W, f, ctx.rect.h));
  return ctx.leafCache.get(key)!;
}

function storyGap(ctx: PageContext) {
  return ruleHeight(ctx.env.style.storyRule) + 40;
}

function nodeMin(ctx: PageContext, node: TreeNode, f: number): number {
  if (node.t === 'leaf') {
    const leaf = getLeaf(ctx, node.plan, nodeWidth(ctx, node.k), f);
    return leaf ? leaf.minH : Infinity;
  }
  if (node.t === 'row') return Math.max(...node.children.map((c) => nodeMin(ctx, c, f)));
  return (
    node.children.reduce((sum, c) => sum + nodeMin(ctx, c, f), 0) + storyGap(ctx) * (node.children.length - 1)
  );
}

interface Assembled {
  ops: DrawOp[];
  fillerArea: number;
  photoArea: number;
  crop: number;
  leaves: number;
}

function assign(ctx: PageContext, node: TreeNode, x: number, y: number, h: number, f: number, out: Assembled) {
  const { style } = ctx.env;
  if (node.t === 'leaf') {
    const leaf = getLeaf(ctx, node.plan, nodeWidth(ctx, node.k), f)!;
    const drawn = finalizeLeaf(ctx.env, leaf, x, y, h);
    out.ops.push(...drawn.ops);
    out.fillerArea += drawn.fillerArea;
    out.photoArea += drawn.photoArea;
    out.crop += drawn.crop;
    out.leaves++;
    return;
  }

  if (node.t === 'row') {
    let cursor = x;
    node.children.forEach((child, i) => {
      assign(ctx, child, cursor, y, h, f, out);
      cursor += nodeWidth(ctx, child.k) + style.gutter;
      if (i < node.children.length - 1 && style.columnRule !== 'none') {
        const rx = cursor - style.gutter / 2;
        out.ops.push((c) => {
          c.fillStyle = style.ink;
          c.fillRect(rx - 1.5, y, 3, h);
        });
      }
    });
    return;
  }

  const mins = node.children.map((c) => nodeMin(ctx, c, f));
  const gap = storyGap(ctx);
  const extra = h - mins.reduce((a, b) => a + b, 0) - gap * (node.children.length - 1);
  const totalMin = mins.reduce((a, b) => a + b, 0) || 1;
  let cursor = y;
  node.children.forEach((child, i) => {
    const ch = mins[i] + extra * (mins[i] / totalMin);
    assign(ctx, child, x, cursor, ch, f, out);
    cursor += ch;
    if (i < node.children.length - 1) {
      const ry = cursor + (gap - ruleHeight(style.storyRule)) / 2;
      const w = nodeWidth(ctx, node.k);
      out.ops.push((c) => hrule(c, x, x + w, ry, style.storyRule, style.ink));
      cursor += gap;
    }
  });
}

/** Sayfaya sığan en büyük yazı boyutu. */
function largestF(ctx: PageContext, tree: TreeNode, lo: number, hi: number): number | null {
  if (nodeMin(ctx, tree, lo) > ctx.rect.h) return null;
  let best = lo;
  let a = lo;
  let b = hi;
  while (a <= b) {
    const mid = Math.floor((a + b) / 2);
    if (nodeMin(ctx, tree, mid) <= ctx.rect.h) {
      best = mid;
      a = mid + 1;
    } else {
      b = mid - 1;
    }
  }
  return best;
}

export interface PageLayout {
  ops: DrawOp[];
  score: number;
  f: number;
}

function evaluate(ctx: PageContext, tree: TreeNode, f: number): PageLayout {
  const { env, rect } = ctx;
  const out: Assembled = { ops: [], fillerArea: 0, photoArea: 0, crop: 0, leaves: 0 };
  assign(ctx, tree, rect.x, rect.y, rect.h, f, out);
  const area = rect.w * rect.h;
  const fontOff = Math.abs(f - env.style.fPref) / env.style.fPref;
  const score =
    -2 * fontOff -
    3.2 * (out.fillerArea / area) -
    0.5 * (out.crop / Math.max(1, out.leaves)) +
    0.5 * Math.min(out.photoArea / area, 0.38);
  return { ops: out.ops, score, f };
}

function tryStories(env: Env, stories: Story[], rect: Rect, attempts: number): PageLayout | null {
  const { style, rng } = env;
  const colW = (rect.w - style.gutter * (style.cols - 1)) / style.cols;
  let best: PageLayout | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const ctx: PageContext = { env, rect, colW, leafCache: new Map() };
    const tree = buildTree(env, stories, style.cols, true, stories.length === 1);
    const f1 = largestF(ctx, tree, style.fMin, style.fPref);
    if (f1 === null) continue;

    const options = [f1];
    if (f1 === style.fPref) {
      const f2 = largestF(ctx, tree, style.fPref, style.fMax);
      if (f2 !== null && f2 !== f1) options.push(f2);
    }
    for (const f of options) {
      const layout = evaluate(ctx, tree, f);
      // Biraz rastgelelik: her seferinde hep aynı "en iyi" kurgu seçilmesin.
      const score = layout.score + rng.range(0, 0.22);
      if (score > bestScore) {
        bestScore = score;
        best = layout;
      }
    }
  }
  return best;
}

const MAX_STORIES_PER_PAGE = 7;

export function layoutPage(
  env: Env,
  queue: Story[],
  rect: Rect,
  pageNumber: number,
): { layout: PageLayout; rest: Story[] } {
  const top = Math.min(queue.length, MAX_STORIES_PER_PAGE);
  for (let n = top; n >= 1; n--) {
    const layout = tryStories(env, queue.slice(0, n), rect, n === 1 ? 14 : 22);
    if (layout) return { layout, rest: queue.slice(n) };
  }

  // Tek başına bile sığmıyor: yazıyı bölüp kalanını sonraki sayfaya devret.
  const [story, ...others] = queue;
  const split = splitStory(env, story, rect, pageNumber);
  return { layout: split.layout, rest: [split.tail, ...others] };
}

function splitStory(env: Env, story: Story, rect: Rect, pageNumber: number): { layout: PageLayout; tail: Story } {
  const { style } = env;
  const headNote = `(Baştarafı ${pageNumber}. sayfada)`;
  const tailNote = `(Devamı ${pageNumber + 1}. sayfada)`;
  const tailOf = (blocks: Block[], photos: NewsPhoto[]): Story => ({
    ...story,
    key: `${story.key}+`,
    blocks,
    photos,
    headNote,
  });

  // 1) Metnin tamamı sığıyor, fotoğraf fazlaysa: metin bölünmesin, fotoğraflar sonraki sayfaya geçsin.
  for (let count = Math.min(story.photos.length - 1, 8); count >= 1; count--) {
    const head: Story = { ...story, photos: story.photos.slice(0, count), tailNote };
    const layout = tryStories(env, [head], rect, 8);
    if (layout) return { layout, tail: tailOf([], story.photos.slice(count)) };
  }

  // 2) Metin tek sayfadan uzun: her kurgu için sayfayı tam dolduran metin miktarını ara.
  // Fotoğraflar büyükse (örn. dikey) bu sayfaya daha azı girer, gerisi devamına kalır.
  const total = countChars(story.blocks);
  const colW = (rect.w - style.gutter * (style.cols - 1)) / style.cols;
  const available = story.photos.length;
  const photoCounts = [...new Set([Math.min(available, 2), Math.min(available, 1), 0])];

  for (const photoCount of photoCounts) {
    const photos = story.photos.slice(0, photoCount);
    let best: { layout: PageLayout; limit: number; score: number } | null = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const plan = makePlan(env, { ...story, photos, tailNote }, true, false);
      plan.short = false;
      const tree: TreeNode = { t: 'leaf', k: style.cols, plan };
      const withLimit = (limit: number) => {
        plan.story = { ...plan.story, blocks: splitBlocks(story.blocks, limit)[0] };
        return { env, rect, colW, leafCache: new Map() } as PageContext;
      };

      let lo = 0;
      let hi = total;
      for (let i = 0; i < 11 && hi - lo > 40; i++) {
        const mid = Math.floor((lo + hi) / 2);
        if (nodeMin(withLimit(mid), tree, style.fPref) <= rect.h) lo = mid;
        else hi = mid;
      }
      const ctx = withLimit(lo);
      if (nodeMin(ctx, tree, style.fPref) > rect.h) continue;
      // Ne metin ne fotoğraf ilerliyorsa bu sayfa işe yaramaz.
      if (countChars(plan.story.blocks) === 0 && photoCount === 0) continue;

      const layout = evaluate(ctx, tree, style.fPref);
      const score = layout.score + (lo / Math.max(1, total)) * 0.6 + env.rng.range(0, 0.1);
      if (!best || score > best.score) best = { layout, limit: lo, score };
    }

    if (best) {
      const tailBlocks = splitBlocks(story.blocks, best.limit)[1];
      return { layout: best.layout, tail: tailOf(tailBlocks, story.photos.slice(photoCount)) };
    }
  }

  throw new Error(`“${story.title}” sayfaya dizilemedi.`);
}

/** Sayı içinde kullanılacak kısa, tek satırlık sayfa başı. */
export function runningHead(env: Env, rect: Rect, title: string, date: string, page: number): DrawOp {
  const { style } = env;
  const size = 30;
  return (ctx) => {
    ctx.font = fontCss(style.label, { b: true }, size);
    ctx.fillStyle = style.ink;
    ctx.fillText(date, rect.x, rect.y + size);
    ctx.textAlign = 'right';
    ctx.fillText(`Sayfa ${page}`, rect.x + rect.w, rect.y + size);
    ctx.textAlign = 'center';
    const face = asFace(style.mast);
    ctx.font = fontCss(face, {}, size * 1.9);
    ctx.fillText(title, rect.x + rect.w / 2, rect.y + size * 1.25);
    ctx.textAlign = 'left';
    hrule(ctx, rect.x, rect.x + rect.w, rect.y + size * 1.9, style.mastRule, style.ink);
  };
}

export const RUNNING_HEAD_H = 95;
