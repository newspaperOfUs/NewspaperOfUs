/** Editörün ProseMirror dokümanını dizgiciye uygun, düz bir blok listesine çevirir. */

export interface RunStyle {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  color?: string;
}

export interface Run extends RunStyle {
  text: string;
}

export type BlockKind = 'p' | 'h2' | 'h3' | 'quote' | 'li' | 'hr';
export type Align = 'left' | 'center' | 'right' | 'justify';

export interface Block {
  kind: BlockKind;
  runs: Run[];
  align?: Align;
  marker?: string;
}

interface PMNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: PMNode[];
}

/** Repodan gelen doküman güvenilmez: yanlış tipler yok sayılır, tek dosya uygulamayı düşürmez. */
function childrenOf(node: PMNode): PMNode[] {
  return Array.isArray(node.content) ? node.content.filter((child) => child && typeof child === 'object') : [];
}

function runFromText(node: PMNode): Run {
  const run: Run = { text: typeof node.text === 'string' ? node.text : '' };
  for (const mark of Array.isArray(node.marks) ? node.marks : []) {
    if (!mark) continue;
    if (mark.type === 'bold') run.b = true;
    else if (mark.type === 'italic') run.i = true;
    else if (mark.type === 'underline') run.u = true;
    else if (mark.type === 'strike') run.s = true;
    else if (mark.type === 'textStyle' && typeof mark.attrs?.color === 'string') {
      run.color = mark.attrs.color;
    }
  }
  return run;
}

function inlineRuns(node: PMNode): Run[] {
  const runs: Run[] = [];
  for (const child of childrenOf(node)) {
    if (child.type === 'text') runs.push(runFromText(child));
    else if (child.type === 'hardBreak') runs.push({ text: '\n' });
  }
  return runs;
}

function alignOf(node: PMNode): Align | undefined {
  const value = node.attrs?.textAlign;
  return value === 'left' || value === 'center' || value === 'right' || value === 'justify'
    ? value
    : undefined;
}

export function docToBlocks(doc: unknown): Block[] {
  const blocks: Block[] = [];

  const walk = (node: PMNode, context: { kind?: BlockKind; marker?: string }) => {
    switch (node.type) {
      case 'doc':
        childrenOf(node).forEach((child) => walk(child, {}));
        break;
      case 'paragraph': {
        const runs = inlineRuns(node);
        if (runs.some((r) => r.text.trim())) {
          blocks.push({
            kind: context.kind ?? 'p',
            runs,
            align: alignOf(node),
            marker: context.marker,
          });
        }
        // Liste maddesinin ikinci paragrafında işaret tekrar etmesin.
        context.marker = undefined;
        break;
      }
      case 'heading': {
        const runs = inlineRuns(node);
        const level = node.attrs?.level === 3 ? 'h3' : 'h2';
        if (runs.some((r) => r.text.trim())) blocks.push({ kind: level, runs, align: alignOf(node) });
        break;
      }
      case 'blockquote':
        childrenOf(node).forEach((child) => walk(child, { kind: 'quote' }));
        break;
      case 'bulletList':
        childrenOf(node).forEach((item) => walk(item, { kind: 'li', marker: '•' }));
        break;
      case 'orderedList': {
        const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
        childrenOf(node).forEach((item, i) => walk(item, { kind: 'li', marker: `${start + i}.` }));
        break;
      }
      case 'listItem':
        childrenOf(node).forEach((child) => walk(child, context));
        break;
      case 'horizontalRule':
        blocks.push({ kind: 'hr', runs: [] });
        break;
    }
  };

  try {
    if (doc && typeof doc === 'object') walk(doc as PMNode, {});
  } catch {
    // Aşırı iç içe doküman yığını taşırır.
    return [];
  }
  return blocks;
}

export function blocksToPlainText(blocks: Block[]): string {
  return blocks
    .map((b) => b.runs.map((r) => r.text).join(''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countChars(blocks: Block[]): number {
  return blocks.reduce((sum, b) => sum + b.runs.reduce((s, r) => s + r.text.length, 0), 0);
}

/**
 * Metni kabaca `limit` karakterden, kelime sınırında ikiye böler.
 * Uzun yazılar sayfaya sığmayınca "devamı sonraki sayfada" yapmak için kullanılır.
 */
export function splitBlocks(blocks: Block[], limit: number): [Block[], Block[]] {
  const head: Block[] = [];
  let used = 0;

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const length = block.runs.reduce((s, r) => s + r.text.length, 0);
    if (used + length <= limit) {
      head.push(block);
      used += length;
      continue;
    }

    const remaining = limit - used;
    // Başlıklar ve çok küçük kalan alanlar bölünmez; blok bütünüyle sonraki sayfaya geçer.
    if (block.kind === 'hr' || block.kind === 'h2' || block.kind === 'h3' || remaining < 40) {
      return [head, blocks.slice(bi)];
    }

    const [a, b] = splitRuns(block.runs, remaining);
    if (!a.length) return [head, blocks.slice(bi)];
    head.push({ ...block, runs: a });
    return [head, [{ ...block, runs: b, marker: undefined }, ...blocks.slice(bi + 1)]];
  }

  return [head, []];
}

function splitRuns(runs: Run[], limit: number): [Run[], Run[]] {
  const fullText = runs.map((r) => r.text).join('');
  let cut = fullText.lastIndexOf(' ', limit);
  if (cut <= 0) return [[], runs];
  cut += 1;

  const a: Run[] = [];
  const b: Run[] = [];
  let offset = 0;
  for (const run of runs) {
    const end = offset + run.text.length;
    if (end <= cut) a.push(run);
    else if (offset >= cut) b.push(run);
    else {
      a.push({ ...run, text: run.text.slice(0, cut - offset) });
      b.push({ ...run, text: run.text.slice(cut - offset) });
    }
    offset = end;
  }
  return [a, b];
}
