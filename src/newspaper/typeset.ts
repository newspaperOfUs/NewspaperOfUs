import type { Align, Block, Run, RunStyle } from './doc';
import { hyphenPoints } from './hyphenate';

/** Gövde metni için bir font ailesi. */
export interface Face {
  family: string;
  regular: number;
  bold: number;
  /** Yazı boyutunu aileler arasında dengeler (küçük x-yükseklikli fontlar için > 1). */
  sizeAdj: number;
}

export function fontCss(face: Pick<Face, 'family' | 'regular' | 'bold'>, style: RunStyle, size: number) {
  return `${style.i ? 'italic ' : ''}${style.b ? face.bold : face.regular} ${size}px "${face.family}", serif`;
}

/** Metin genişliği ölçer. Testlerde sahte, tarayıcıda canvas tabanlı olanı kullanılır. */
export type WidthFn = (face: Face, style: RunStyle, text: string, size: number) => number;

/** 100px'te ölçüp ölçekler: font boyutu aramasında aynı kelime tekrar ölçülmez. */
export function canvasWidthFn(ctx: CanvasRenderingContext2D): WidthFn {
  const cache = new Map<string, number>();
  return (face, style, text, size) => {
    const key = `${face.family}|${style.b ? 1 : 0}${style.i ? 1 : 0}|${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      ctx.font = fontCss(face, style, 100);
      width = ctx.measureText(text).width;
      cache.set(key, width);
    }
    return (width * size) / 100;
  };
}

export interface Frag {
  text: string;
  style: RunStyle;
  w: number;
}

export interface LineWord {
  frags: Frag[];
  w: number;
}

export interface Line {
  words: LineWord[];
  natural: number;
  avail: number;
  indent: number;
  align: Align;
  size: number;
  face: Face;
  spaceW: number;
  /** Gövde tipi dışında zorla uygulanan biçim (ara başlıklar için). */
  marker?: string;
  markerW?: number;
}

export interface DropCap {
  letter: string;
  size: number;
  lines: number;
  width: number;
  color?: string;
  face: Face;
}

export type Item =
  | { kind: 'line'; h: number; line: Line; keepNext?: boolean; drop?: DropCap }
  | { kind: 'gap'; h: number }
  | { kind: 'ornament'; h: number };

interface Word {
  frags: { text: string; style: RunStyle }[];
  breakAfter?: boolean;
}

function styleOf(run: Run): RunStyle {
  const { b, i, u, s, color } = run;
  return { b, i, u, s, color };
}

export function tokenize(runs: Run[]): Word[] {
  const words: Word[] = [];
  let current: Word | null = null;

  const flush = () => {
    if (current) words.push(current);
    current = null;
  };

  for (const run of runs) {
    for (const part of run.text.split(/(\n|[ \t\r ]+)/)) {
      if (!part) continue;
      if (part === '\n') {
        flush();
        if (words.length) words[words.length - 1].breakAfter = true;
      } else if (/^[ \t\r ]+$/.test(part)) {
        flush();
      } else {
        current ??= { frags: [] };
        current.frags.push({ text: part, style: styleOf(run) });
      }
    }
  }
  flush();
  return words;
}

function plain(word: Word) {
  return word.frags.map((f) => f.text).join('');
}

function splitWord(word: Word, offset: number): [Word, Word] {
  const head: Word = { frags: [] };
  const tail: Word = { frags: [], breakAfter: word.breakAfter };
  let seen = 0;
  for (const frag of word.frags) {
    const end = seen + frag.text.length;
    if (end <= offset) head.frags.push(frag);
    else if (seen >= offset) tail.frags.push(frag);
    else {
      head.frags.push({ ...frag, text: frag.text.slice(0, offset - seen) });
      tail.frags.push({ ...frag, text: frag.text.slice(offset - seen) });
    }
    seen = end;
  }
  return [head, tail];
}

export interface BreakOptions {
  face: Face;
  size: number;
  width: WidthFn;
  /** Satır numarasına göre kullanılabilir genişlik ve soldan girinti. */
  lineBox: (index: number) => { avail: number; indent: number };
  align: Align;
  hyphenate?: boolean;
}

function toLineWord(word: Word, opts: BreakOptions, hyphen = false): LineWord {
  const frags: Frag[] = word.frags.map((f, i) => {
    const last = i === word.frags.length - 1;
    const text = hyphen && last ? `${f.text}-` : f.text;
    return { text, style: f.style, w: opts.width(opts.face, f.style, text, opts.size) };
  });
  return { frags, w: frags.reduce((sum, f) => sum + f.w, 0) };
}

/** Açgözlü satır kırma + heceleme. Dar gazete sütunlarında boşlukları dengeli tutar. */
export function breakLines(input: Word[], opts: BreakOptions): Line[] {
  const { face, size, width, lineBox, align } = opts;
  const spaceW = width(face, {}, ' ', size);
  const queue = [...input];
  const lines: Line[] = [];
  let current: LineWord[] = [];
  let currentW = 0;

  const finish = (lastOfPara: boolean) => {
    const box = lineBox(lines.length);
    lines.push({
      words: current,
      natural: currentW,
      avail: box.avail,
      indent: box.indent,
      align: lastOfPara && (align === 'justify' || align === 'left') ? 'left' : align,
      size,
      face,
      spaceW,
    });
    current = [];
    currentW = 0;
  };

  while (queue.length) {
    const word = queue.shift()!;
    const avail = lineBox(lines.length).avail;
    const lw = toLineWord(word, opts);
    const gap = current.length ? spaceW : 0;

    if (currentW + gap + lw.w <= avail) {
      current.push(lw);
      currentW += gap + lw.w;
      if (word.breakAfter) finish(true);
      continue;
    }

    const room = avail - currentW - gap;
    const split = opts.hyphenate !== false ? trySplit(word, room, opts) : null;
    if (split) {
      const head = toLineWord(split[0], opts, true);
      current.push(head);
      currentW += gap + head.w;
      finish(false);
      queue.unshift(split[1]);
    } else if (current.length) {
      finish(false);
      queue.unshift(word);
    } else {
      // Satırdan uzun kelime (URL vb.): harf sınırından zorla böl.
      const [head, tail] = hardSplit(word, avail, opts);
      const lwHead = toLineWord(head, opts);
      current.push(lwHead);
      currentW = lwHead.w;
      if (tail.frags.length) {
        finish(false);
        queue.unshift(tail);
      } else if (word.breakAfter) {
        finish(true);
      }
    }
  }

  if (current.length) finish(true);
  return lines;
}

function trySplit(word: Word, room: number, opts: BreakOptions): [Word, Word] | null {
  if (room < opts.size * 1.2) return null;
  const points = hyphenPoints(plain(word));
  for (let i = points.length - 1; i >= 0; i--) {
    const [head, tail] = splitWord(word, points[i]);
    if (toLineWord(head, opts, true).w <= room) return [head, tail];
  }
  return null;
}

function hardSplit(word: Word, avail: number, opts: BreakOptions): [Word, Word] {
  const text = plain(word);
  let cut = text.length;
  while (cut > 1 && toLineWord(splitWord(word, cut)[0], opts).w > avail) cut--;
  return splitWord(word, cut);
}

export interface BodyOptions {
  face: Face;
  size: number;
  leading: number;
  width: number;
  paragraph: 'indent' | 'gap';
  dropCap?: { lines: number; capRatio: number } | null;
  /** Editörde hizalama seçilmemiş paragrafların hizası. */
  defaultAlign?: Align;
  measure: WidthFn;
  /** Yazı sonuna eklenen "(Devamı 2. sayfada)" gibi not. */
  tailNote?: string;
}

/** Blokları sütunlara dökülmeye hazır satırlara çevirir. */
export function typesetBlocks(blocks: Block[], opts: BodyOptions): Item[] {
  const items: Item[] = [];
  const { face, size, leading, width, measure } = opts;
  const lineH = size * leading;
  let previous: Block['kind'] | null = null;
  let dropUsed = false;

  const pushLines = (lines: Line[], h: number, keepNext = false, drop?: DropCap) => {
    lines.forEach((line, i) => {
      const item: Item = { kind: 'line', h, line, keepNext: keepNext || undefined };
      if (i === 0 && drop) item.drop = drop;
      items.push(item);
    });
  };

  const defaultAlign: Align = opts.defaultAlign ?? 'justify';

  blocks.forEach((block, index) => {
    if (block.kind === 'hr') {
      items.push({ kind: 'ornament', h: lineH * 1.5 });
      previous = 'hr';
      return;
    }

    if (block.kind === 'h2' || block.kind === 'h3') {
      const big = block.kind === 'h2';
      const headSize = size * (big ? 1.32 : 1.1);
      const runs = block.runs.map((r) => ({ ...r, b: true, i: big ? r.i : true }));
      if (items.length) items.push({ kind: 'gap', h: lineH * 0.55 });
      const lines = breakLines(tokenize(runs), {
        face,
        size: headSize,
        width: measure,
        lineBox: () => ({ avail: width, indent: 0 }),
        align: block.align ?? 'center',
        hyphenate: false,
      });
      pushLines(lines, headSize * 1.18, true);
      items.push({ kind: 'gap', h: lineH * 0.25 });
      previous = block.kind;
      return;
    }

    if (block.kind === 'quote') {
      const pad = size * 1.1;
      if (items.length) items.push({ kind: 'gap', h: lineH * 0.35 });
      const runs = block.runs.map((r) => ({ ...r, i: true }));
      const lines = breakLines(tokenize(runs), {
        face,
        size,
        width: measure,
        lineBox: () => ({ avail: width - pad * 2, indent: pad }),
        align: block.align ?? defaultAlign,
      });
      pushLines(lines, lineH);
      items.push({ kind: 'gap', h: lineH * 0.35 });
      previous = 'quote';
      return;
    }

    if (block.kind === 'li') {
      const hang = size * 1.5;
      const lines = breakLines(tokenize(block.runs), {
        face,
        size,
        width: measure,
        lineBox: () => ({ avail: width - hang, indent: hang }),
        align: block.align ?? defaultAlign,
      });
      if (lines[0] && block.marker) {
        lines[0].marker = block.marker;
        lines[0].markerW = measure(face, {}, block.marker, size);
      }
      pushLines(lines, lineH);
      previous = 'li';
      return;
    }

    // Normal paragraf
    const isFirst = index === 0 || previous === 'h2' || previous === 'h3' || previous === 'hr';
    let runs = block.runs;
    let drop: DropCap | undefined;
    let box: BreakOptions['lineBox'];

    if (opts.paragraph === 'gap' && items.length && !isFirst) {
      items.push({ kind: 'gap', h: lineH * 0.45 });
    }

    const canDrop = opts.dropCap && !dropUsed && index === 0 && startsWithLetter(runs);
    if (canDrop) {
      dropUsed = true;
      const { lines: dropLines, capRatio } = opts.dropCap!;
      const dropped = dropFirstLetter(runs);
      runs = dropped.rest;
      const dropSize = ((dropLines - 1) * lineH + size * capRatio) / capRatio;
      const dropW = measure(face, { b: true }, dropped.letter, dropSize) + size * 0.3;
      drop = { letter: dropped.letter, size: dropSize, lines: dropLines, width: dropW, color: dropped.color, face };
      box = (i) => (i < dropLines ? { avail: width - dropW, indent: dropW } : { avail: width, indent: 0 });
    } else {
      const indent = opts.paragraph === 'indent' && !isFirst && previous === 'p' ? size * 1.15 : 0;
      box = (i) => (i === 0 ? { avail: width - indent, indent } : { avail: width, indent: 0 });
    }

    const lines = breakLines(tokenize(runs), {
      face,
      size,
      width: measure,
      lineBox: box,
      align: block.align ?? defaultAlign,
    });
    pushLines(lines, lineH, false, drop);
    previous = 'p';
  });

  if (opts.tailNote) {
    const runs: Run[] = [{ text: opts.tailNote, i: true, b: true }];
    const lines = breakLines(tokenize(runs), {
      face,
      size,
      width: measure,
      lineBox: () => ({ avail: width, indent: 0 }),
      align: 'right',
      hyphenate: false,
    });
    pushLines(lines, lineH);
  }

  return items;
}

function startsWithLetter(runs: Run[]) {
  const first = runs.find((r) => r.text.trim());
  return !!first && /^\s*\p{L}/u.test(first.text);
}

function dropFirstLetter(runs: Run[]): { letter: string; color?: string; rest: Run[] } {
  const rest = runs.map((r) => ({ ...r }));
  const first = rest.find((r) => r.text.trim())!;
  const text = first.text.trimStart();
  const [letter] = text;
  first.text = text.slice(letter.length);
  return { letter: letter.toLocaleUpperCase('tr'), color: first.color, rest };
}

export function itemsHeight(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.h, 0);
}

/** Tek stilli kısa metni (başlık altı, altyazı) satırlara böler. */
export function wrapPlain(
  text: string,
  face: Face,
  style: RunStyle,
  size: number,
  avail: number,
  measure: WidthFn,
  align: Align,
): Line[] {
  return breakLines(tokenize([{ text, ...style }]), {
    face,
    size,
    width: measure,
    lineBox: () => ({ avail, indent: 0 }),
    align,
    hyphenate: false,
  });
}

/** Satırı canvas'a çizer: `top` satır kutusunun üstü, `lineH` kutunun yüksekliği. */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  line: Line,
  x: number,
  top: number,
  lineH: number,
  ink: string,
) {
  const baseline = top + lineH * 0.78;
  let cursor = x + line.indent;
  let gap = line.spaceW;
  const spare = line.avail - line.natural;
  const gaps = line.words.length - 1;

  if (line.align === 'justify' && gaps > 0) {
    // Çok gevşek satırlarda boşluğu sınırla; eski gazetelerde bile nehir istemeyiz.
    gap += Math.min(spare / gaps, line.spaceW * 3);
  } else if (line.align === 'center') {
    cursor += spare / 2;
  } else if (line.align === 'right') {
    cursor += spare;
  }

  if (line.marker) {
    ctx.font = fontCss(line.face, {}, line.size);
    ctx.fillStyle = ink;
    ctx.fillText(line.marker, x + line.indent - (line.markerW ?? 0) - line.size * 0.35, baseline);
  }

  for (const word of line.words) {
    for (const frag of word.frags) {
      ctx.font = fontCss(line.face, frag.style, line.size);
      ctx.fillStyle = frag.style.color ?? ink;
      ctx.fillText(frag.text, cursor, baseline);
      if (frag.style.u) ctx.fillRect(cursor, baseline + line.size * 0.1, frag.w, Math.max(1.5, line.size * 0.055));
      if (frag.style.s) ctx.fillRect(cursor, baseline - line.size * 0.27, frag.w, Math.max(1.5, line.size * 0.055));
      cursor += frag.w;
    }
    cursor += gap;
  }
}
