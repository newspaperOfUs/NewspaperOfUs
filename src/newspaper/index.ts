import { docToBlocks } from './doc';
import { FillerDeck } from './filler';
import { loadStyleFonts } from './fonts';
import { layoutPage, PAGE_H, PAGE_W, runningHead, RUNNING_HEAD_H, type DrawOp, type Env, type NewsPhoto, type Rect, type Story } from './layout';
import { layoutMasthead } from './masthead';
import { distressInk, foldMarks, makePaper, showThrough } from './paper';
import { createCanvas, type SourcePhoto } from './photo';
import { Rng } from './rng';
import { resolveStyle, type Style } from './styles';
import { canvasWidthFn } from './typeset';

export interface NewspaperPost {
  id: string;
  title: string;
  author: string;
  date: string;
  doc: unknown;
  photos: (SourcePhoto & { caption: string })[];
}

export interface NewspaperInput {
  name: string;
  posts: NewspaperPost[];
  seed: number;
  volume: number;
  issueNumber: number;
  /** Yalnızca test için: belirli bir dönemi zorlar. */
  era?: string;
}

export interface NewspaperResult {
  pages: HTMLCanvasElement[];
  styleName: string;
  seed: number;
}

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatShort(iso: string) {
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseDate(iso));
}

function formatLong(iso: string) {
  return new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(parseDate(iso))
    .toLocaleUpperCase('tr');
}

function weight(post: NewspaperPost, blocksLength: number): number {
  return blocksLength + post.photos.length * 400 + 200;
}

/** Baş haberi rastgele seç ama uzun ve fotoğraflı yazılar öne çıkma şansı daha yüksek olsun. */
function orderStories(posts: NewspaperPost[], rng: Rng): Story[] {
  const stories = posts.map((post) => {
    const blocks = docToBlocks(post.doc);
    const photos: NewsPhoto[] = post.photos.map((p) => ({ ...p, caption: p.caption ?? '' }));
    const story: Story = {
      key: post.id,
      title: post.title,
      author: post.author,
      dateText: formatShort(post.date),
      blocks,
      photos,
    };
    const chars = blocks.reduce((sum, b) => sum + b.runs.reduce((s, r) => s + r.text.length, 0), 0);
    return { story, weight: weight(post, chars) };
  });

  const total = stories.reduce((sum, s) => sum + s.weight, 0);
  let pick = rng.range(0, total);
  let leadIndex = 0;
  for (let i = 0; i < stories.length; i++) {
    pick -= stories[i].weight;
    if (pick <= 0) {
      leadIndex = i;
      break;
    }
  }
  const [lead] = stories.splice(leadIndex, 1);
  return [lead.story, ...rng.shuffle(stories).map((s) => s.story)];
}

function printPage(ops: DrawOp[], style: Style, rng: Rng): HTMLCanvasElement {
  const paper = makePaper(PAGE_W, PAGE_H, style, rng.fork());
  const ink = createCanvas(PAGE_W, PAGE_H);
  const ctx = ink.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';
  ctx.fontKerning = 'normal';
  if ('textRendering' in ctx) ctx.textRendering = 'geometricPrecision';
  for (const op of ops) op(ctx);

  distressInk(ink, style, rng.fork());
  showThrough(paper, ink, style);

  const paperCtx = paper.getContext('2d')!;
  paperCtx.globalCompositeOperation = 'multiply';
  paperCtx.drawImage(ink, 0, 0);
  paperCtx.globalCompositeOperation = 'source-over';
  foldMarks(paper, style, rng.fork());

  ink.width = 0;
  return paper;
}

export async function renderNewspaper(input: NewspaperInput): Promise<NewspaperResult> {
  const rng = new Rng(input.seed);
  const style = resolveStyle(rng.fork(), input.era);
  await loadStyleFonts(style);

  const measureCanvas = createCanvas(16, 16);
  const ctx = measureCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fontKerning = 'normal';
  if ('textRendering' in ctx) ctx.textRendering = 'geometricPrecision';

  const layoutRng = rng.fork();
  const env: Env = {
    style,
    rng: layoutRng,
    measure: canvasWidthFn(ctx),
    ctx,
    deck: new FillerDeck(rng.fork()),
  };

  const margin = style.margin;
  const contentW = PAGE_W - margin * 2;
  const issueDate = input.posts.map((p) => p.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  const issue = {
    name: input.name,
    volume: input.volume,
    number: input.issueNumber,
    dateLong: formatLong(issueDate),
  };

  const queue = orderStories(input.posts, rng.fork());
  const pageOps: DrawOp[][] = [];
  let remaining = queue;
  const maxPages = 40;

  while (remaining.length) {
    if (pageOps.length >= maxPages) throw new Error('Seçilen içerik çok uzun: en fazla 40 sayfa üretilebilir.');
    const pageNumber = pageOps.length + 1;
    const ops: DrawOp[] = [];
    let top: number;

    if (pageNumber === 1) {
      const mast = layoutMasthead(env, issue, { x: margin, y: margin, w: contentW, h: 0 });
      ops.push(...mast.ops);
      top = margin + mast.h;
    } else {
      const headRect: Rect = { x: margin, y: margin * 0.8, w: contentW, h: RUNNING_HEAD_H };
      ops.push(runningHead(env, headRect, input.name, issue.dateLong, pageNumber));
      top = margin * 0.8 + RUNNING_HEAD_H + 20;
    }

    const rect: Rect = { x: margin, y: top, w: contentW, h: PAGE_H - margin - top };
    const { layout, rest } = layoutPage(env, remaining, rect, pageNumber);
    ops.push(...layout.ops);
    pageOps.push(ops);
    remaining = rest;
  }

  const printRng = rng.fork();
  const pages = pageOps.map((ops) => printPage(ops, style, printRng.fork()));
  return { pages, styleName: style.name, seed: input.seed };
}
