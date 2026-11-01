import { ADS, PANEL_QUOTES, SIDE_NOTES, SLOGANS } from './copy';
import { drawTracked, type DrawOp, type Env, type Rect } from './layout';
import { colOrnament, heartBurst, hrule, ruleHeight } from './ornaments';
import type { Rng } from './rng';
import { drawLine, fontCss, wrapPlain, type Face, type Line } from './typeset';

/** Aynı sayıda aynı ilan iki kez çıkmasın diye karıştırılmış, tükenen deste. */
export class FillerDeck {
  private ads: typeof ADS;

  constructor(rng: Rng) {
    this.ads = rng.shuffle(ADS);
  }

  get remaining() {
    return this.ads.length;
  }

  peek() {
    return this.ads[this.ads.length - 1];
  }

  take() {
    this.ads = this.ads.slice(0, -1);
  }
}

interface AdBox {
  headLines: Line[];
  bodyLines: Line[];
  headLead: number;
  bodyLead: number;
  h: number;
}

const AD_PADDING = 36;

function buildAd(env: Env, ad: { head: string; body: string }, w: number, f: number): AdBox {
  const { style, measure } = env;
  const inner = w - 44;
  const bodySize = Math.max(25, f * style.body.sizeAdj * 0.86);
  const headSize = bodySize * 1.2;
  const headLines = wrapPlain(ad.head, style.label, { b: true }, headSize, inner, measure, 'center');
  const bodyLines = wrapPlain(ad.body, style.body, {}, bodySize, inner, measure, 'center');
  const headLead = headSize * 1.2;
  const bodyLead = bodySize * 1.22;
  return {
    headLines,
    bodyLines,
    headLead,
    bodyLead,
    h: headLines.length * headLead + 12 + bodyLines.length * bodyLead + AD_PADDING,
  };
}

/** Süslü çerçeve içinde arma + slogan + söz: büyük boşluklar ilan yığınına dönüşmesin. */
function panelOp(env: Env, rect: Rect): DrawOp {
  const { style, rng, measure } = env;
  const { x, y, w, h } = rect;
  const pad = Math.min(70, w * 0.07);
  const inner = w - pad * 2;

  const headFace: Face = { family: style.head.family, regular: style.head.weight, bold: style.head.weight, sizeAdj: 1 };
  const slogan = rng.pick(SLOGANS);
  const sloganSize = Math.max(40, Math.min(h * 0.14, (inner / Math.max(9, slogan.length * 0.5)) * 1.5));
  const sloganLines = wrapPlain(slogan, headFace, {}, sloganSize, inner, measure, 'center');
  const sloganLead = sloganSize * 1.14;

  const quote = rng.pick(PANEL_QUOTES);
  const quoteSize = Math.max(30, Math.min(sloganSize * 0.5, 58));
  const quoteLines = wrapPlain(quote, style.body, { i: true }, quoteSize, inner * 0.86, measure, 'center');
  const quoteLead = quoteSize * 1.28;

  const textH = sloganLines.length * sloganLead;
  const quoteH = quoteLines.length * quoteLead;
  const showQuote = textH + quoteH + 150 < h;
  const contentH = textH + (showQuote ? quoteH + 70 : 0);
  const burstR = clamp((h - contentH - 110) / 2, 0, Math.min(inner * 0.26, 300));
  const showBurst = burstR > 40;
  const totalH = contentH + (showBurst ? burstR * 2 + 30 : 0);
  const burstRng = rng.fork();
  const ornament = rng.int(0, 2);

  return (ctx) => {
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);

    let cursor = y + (h - totalH) / 2;
    if (showBurst) {
      heartBurst(ctx, x + w / 2, cursor + burstR, burstR, style.spot ?? style.ink, burstRng);
      cursor += burstR * 2 + 30;
    }
    sloganLines.forEach((line, i) => drawLine(ctx, line, x + pad, cursor + i * sloganLead, sloganLead, style.ink));
    cursor += textH;
    if (showQuote) {
      colOrnament(ctx, x + w / 2, cursor + 30, 11, style.ink, ornament);
      cursor += 70;
      const left = x + pad + (inner - inner * 0.86) / 2;
      quoteLines.forEach((line, i) => drawLine(ctx, line, left, cursor + i * quoteLead, quoteLead, style.ink));
    }
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Yazıların bırakığı boşluğu doldurur: dar şeritte süs + tek cümle, geniş alanda panel + ilanlar.
 * İlanları ancak çizim anında tüketmek gerekir, yoksa denenen her kurgu desteyi eritir;
 * bu yüzden layout tarafı bunu `lazyFiller` ile sarar.
 */
export function fillerOps(env: Env, rect: Rect, f: number): DrawOp[] {
  const { style, rng, deck } = env;
  const ops: DrawOp[] = [];
  const { x, y, w, h } = rect;

  if (h < 60) return ops;

  if (h < 230) {
    const size = Math.max(26, f * style.body.sizeAdj);
    const text = rng.pick([...SLOGANS, ...SIDE_NOTES]);
    const lines = wrapPlain(text, style.body, { i: true }, size, w * 0.92, env.measure, 'center');
    const lead = size * 1.25;
    const textH = lines.length * lead;
    const ornament = rng.int(0, 2);
    ops.push((ctx) => {
      const top = y + Math.max(0, (h - textH - size * 1.2) / 2);
      colOrnament(ctx, x + w / 2, top + size * 0.4, size * 0.34, style.ink, ornament);
      lines.forEach((line, i) => {
        drawLine(ctx, line, x + (w - w * 0.92) / 2, top + size + i * lead, lead, style.ink);
      });
    });
    return ops;
  }

  const ruleKind = style.storyRule;
  ops.push((ctx) => hrule(ctx, x, x + w, y, ruleKind, style.ink));
  const top = y + ruleHeight(ruleKind) + 18;
  const available = y + h - top;

  // İlan payı sınırlı; gerisi panele kalır. Deste bittiyse her yer panel olur.
  const adsWanted = deck.remaining > 0 ? Math.min(available * 0.42, w > 760 ? 430 : 720) : 0;
  const panelH = available > 480 ? available - adsWanted - (adsWanted ? 22 : 0) : 0;
  if (panelH > 0) ops.push(panelOp(env, { x, y: top, w, h: panelH }));

  const adsTop = panelH > 0 ? top + panelH + 22 : top;
  const adsH = y + h - adsTop;
  if (adsH < 120 || deck.remaining === 0) return ops;

  const columns = Math.max(1, Math.min(6, Math.round(w / 430)));
  const gap = 20;
  const colW = (w - gap * (columns - 1)) / columns;

  for (let c = 0; c < columns; c++) {
    const colX = x + c * (colW + gap);
    const boxes: AdBox[] = [];
    let used = 0;
    while (deck.remaining > 0) {
      const box = buildAd(env, deck.peek(), colW, f);
      const extra = boxes.length ? gap : 0;
      if (used + extra + box.h > adsH) break;
      deck.take();
      boxes.push(box);
      used += extra + box.h;
    }

    if (!boxes.length) {
      const midY = adsTop + adsH / 2;
      ops.push((ctx) => colOrnament(ctx, colX + colW / 2, midY, 16, style.ink, 1));
      continue;
    }

    const grow = (adsH - used) / boxes.length;
    let boxY = adsTop;
    for (const box of boxes) {
      const boxH = box.h + grow;
      const yTop = boxY;
      const doubled = rng.chance(0.3);
      const textTop = yTop + (boxH - (box.h - AD_PADDING)) / 2;
      ops.push((ctx) => {
        ctx.strokeStyle = style.ink;
        ctx.lineWidth = 2;
        ctx.strokeRect(colX + 1, yTop + 1, colW - 2, boxH - 2);
        if (doubled) {
          ctx.lineWidth = 1;
          ctx.strokeRect(colX + 7, yTop + 7, colW - 14, boxH - 14);
        }
        box.headLines.forEach((line, i) => {
          drawLine(ctx, line, colX + 22, textTop + i * box.headLead, box.headLead, style.spot ?? style.ink);
        });
        const bodyTop = textTop + box.headLines.length * box.headLead + 12;
        box.bodyLines.forEach((line, i) => {
          drawLine(ctx, line, colX + 22, bodyTop + i * box.bodyLead, box.bodyLead, style.ink);
        });
      });
      boxY += boxH + gap;
    }
  }

  return ops;
}

/** Seçilen kurgu çizilirken dolguyu üretir; seçilmeyen kurgular ilan harcamaz. */
export function lazyFiller(env: Env, rect: Rect, f: number): DrawOp {
  return (ctx) => {
    for (const op of fillerOps(env, rect, f)) op(ctx);
  };
}

/** Logonun yanındaki küçük kutu. */
export function earOps(env: Env, rect: Rect, title: string, body: string): DrawOp {
  const { style, measure } = env;
  const size = Math.min(30, rect.w / 12);
  const titleSize = size * 1.02;
  const lines = wrapPlain(body, style.body, { i: true }, size, rect.w - 34, measure, 'center');
  const lead = size * 1.2;
  const contentH = titleSize * 1.45 + lines.length * lead;
  return (ctx) => {
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 7, rect.y + 7, rect.w - 14, rect.h - 14);
    const top = rect.y + (rect.h - contentH) / 2;
    ctx.font = fontCss(style.label, { b: true }, titleSize);
    ctx.fillStyle = style.spot ?? style.ink;
    drawTracked(ctx, title, rect.x + rect.w / 2, top + titleSize * 0.95, titleSize * 0.09, 'center');
    lines.forEach((line, i) => {
      drawLine(ctx, line, rect.x + 17, top + titleSize * 1.45 + i * lead, lead, style.ink);
    });
  };
}
