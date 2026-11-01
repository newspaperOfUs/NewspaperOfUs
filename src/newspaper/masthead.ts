import { PRICES, SIDE_NOTES, SLOGANS, STAMPS, WEATHER } from './copy';
import { earOps } from './filler';
import { capRatio, drawTracked, type DrawOp, type Env, type Rect } from './layout';
import { heartBurst, hrule, ruleHeight } from './ornaments';
import type { DisplayFont } from './styles';
import { fontCss, type Face } from './typeset';

export interface IssueInfo {
  name: string;
  volume: number;
  number: number;
  dateLong: string;
}

interface Masthead {
  h: number;
  ops: DrawOp[];
}

function faceOf(font: DisplayFont): Face {
  return { family: font.family, regular: font.weight, bold: font.weight, sizeAdj: 1 };
}

function mastText(font: DisplayFont, text: string) {
  return font.caps ? text.toUpperCase() : text;
}

function datelineOps(env: Env, issue: IssueInfo, x: number, y: number, w: number, reversed: boolean): DrawOp {
  const { style, rng } = env;
  const size = Math.min(34, w / 66);
  const roman = toRoman(issue.volume);
  const left = rng.chance(0.5) ? `CİLT ${roman} · SAYI ${issue.number}` : `YIL ${roman} — SAYI ${issue.number}`;
  const right = rng.pick(PRICES);
  const center = issue.dateLong;
  return (ctx) => {
    ctx.font = fontCss(style.label, { b: true }, size);
    if (reversed) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
    } else {
      ctx.fillStyle = style.ink;
    }
    const base = y + size;
    ctx.textAlign = 'left';
    ctx.fillText(left, x, base);
    ctx.textAlign = 'center';
    ctx.fillText(center, x + w / 2, base);
    ctx.textAlign = 'right';
    ctx.fillText(right, x + w, base);
    ctx.textAlign = 'left';
    ctx.globalCompositeOperation = 'source-over';
  };
}

export function toRoman(value: number): string {
  const table: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let n = Math.max(1, Math.floor(value));
  let out = '';
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

function titleSizeFor(env: Env, font: DisplayFont, text: string, maxW: number, maxSize: number): number {
  const width = env.measure(faceOf(font), {}, text, 100);
  return Math.min((maxW / width) * 100, maxSize);
}

export function layoutMasthead(env: Env, issue: IssueInfo, rect: Rect): Masthead {
  const { style, rng } = env;
  const { x, y, w } = rect;
  const font = style.mast;
  const face = faceOf(font);
  const name = mastText(font, issue.name);
  const ops: DrawOp[] = [];
  const cap = capRatio(env, face);
  let cursor = y;

  // Üst şerit
  const stripSize = Math.min(30, w / 74);
  const slogan = rng.pick(SLOGANS);
  ops.push((ctx) => {
    ctx.font = fontCss(style.label, { i: true }, stripSize);
    ctx.fillStyle = style.ink;
    ctx.textAlign = 'center';
    ctx.fillText(slogan, x + w / 2, y + stripSize);
    ctx.textAlign = 'left';
  });
  cursor += stripSize * 1.5;

  const descent = (size: number) => (font.caps ? size * 0.06 : size * 0.2);

  switch (style.mastKind) {
    case 'banner': {
      const padX = 44;
      const size = titleSizeFor(env, font, name, w - padX * 2, 400);
      const bandH = cap * size + size * 0.42;
      const bandY = cursor;
      const dateH = 58;
      const baseline = bandY + (bandH + cap * size) / 2;
      const textW = env.measure(face, {}, name, size);
      const dateline = datelineOps(env, issue, x + 26, bandY + bandH + 12, w - 52, true);
      ops.push((ctx) => {
        ctx.fillStyle = style.spot ?? style.ink;
        ctx.fillRect(x, bandY, w, bandH);
        ctx.fillStyle = style.ink;
        ctx.fillRect(x, bandY + bandH, w, dateH);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.font = fontCss(face, {}, size);
        ctx.fillStyle = '#000';
        ctx.fillText(name, x + (w - textW) / 2, baseline);
        ctx.globalCompositeOperation = 'source-over';
        dateline(ctx);
      });
      cursor += bandH + dateH + 26;
      break;
    }

    case 'emblem': {
      const words = name.split(' ');
      const middle = Math.ceil(words.length / 2);
      const leftText = words.slice(0, middle).join(' ');
      const rightText = words.slice(middle).join(' ');
      const emblemSpace = 0.95; // emblem genişliği = boyut x bu oran
      const combined = env.measure(face, {}, leftText, 100) + env.measure(face, {}, rightText, 100);
      const size = Math.min((w - 40) / (combined / 100 + emblemSpace + 0.3), 330);
      const leftW = env.measure(face, {}, leftText, size);
      const rightW = env.measure(face, {}, rightText, size);
      const totalW = leftW + rightW + size * (emblemSpace + 0.3);
      const startX = x + (w - totalW) / 2;
      const titleTop = cursor + 18;
      const baseline = titleTop + cap * size;
      const burst = rng.fork();
      ops.push((ctx) => {
        ctx.font = fontCss(face, {}, size);
        ctx.fillStyle = style.ink;
        ctx.fillText(leftText, startX, baseline);
        ctx.fillText(rightText, startX + leftW + size * (emblemSpace + 0.3), baseline);
        heartBurst(
          ctx,
          startX + leftW + size * (emblemSpace / 2 + 0.15),
          baseline - (cap * size) / 2,
          size * (emblemSpace / 2),
          style.spot ?? style.ink,
          burst,
        );
      });
      cursor = baseline + descent(size) + 20;
      cursor = mastFooter(env, issue, x, cursor, w, ops);
      break;
    }

    case 'left': {
      const boxW = Math.round(w * 0.2);
      const size = titleSizeFor(env, font, name, w - boxW - 50, 360);
      const titleTop = cursor + 16;
      const baseline = titleTop + cap * size;
      const titleH = cap * size + descent(size);
      const boxRect = { x: x + w - boxW, y: titleTop, w: boxW, h: Math.max(titleH, 150) };
      const ear = earOps(env, boxRect, 'HAVA DURUMU', rng.pick(WEATHER));
      const titleColor = style.spot && rng.chance(0.5) ? style.spot : style.ink;
      ops.push((ctx) => {
        ctx.font = fontCss(face, {}, size);
        ctx.fillStyle = titleColor;
        ctx.fillText(name, x, baseline);
        ear(ctx);
      });
      cursor = titleTop + Math.max(titleH, 150) + 18;
      cursor = mastFooter(env, issue, x, cursor, w, ops);
      break;
    }

    case 'classic':
    default: {
      const earW = style.ears ? Math.round(w * 0.135) : 0;
      const titleW = style.ears ? w - earW * 2 - 60 : w - 20;
      const size = titleSizeFor(env, font, name, titleW, 390);
      const textW = env.measure(face, {}, name, size);
      const titleTop = cursor + 16;
      const titleH = cap * size + descent(size);
      const baseline = titleTop + cap * size;
      ops.push((ctx) => {
        ctx.font = fontCss(face, {}, size);
        ctx.fillStyle = style.ink;
        ctx.fillText(name, x + (w - textW) / 2, baseline);
      });
      let h = titleH;
      if (style.ears) {
        const earH = Math.max(titleH, 168);
        h = earH;
        const offset = (earH - titleH) / 2;
        // Başlık, kutulara göre dikeyde ortalanır.
        ops[ops.length - 1] = (ctx) => {
          ctx.font = fontCss(face, {}, size);
          ctx.fillStyle = style.ink;
          ctx.fillText(name, x + (w - textW) / 2, baseline + offset);
        };
        ops.push(earOps(env, { x, y: titleTop, w: earW, h: earH }, 'HAVA DURUMU', rng.pick(WEATHER)));
        ops.push(earOps(env, { x: x + w - earW, y: titleTop, w: earW, h: earH }, 'OKURLARA', rng.pick(SIDE_NOTES)));
      }
      cursor = titleTop + h + 18;
      cursor = mastFooter(env, issue, x, cursor, w, ops);
      break;
    }
  }

  if (style.stamp) {
    const text = rng.pick(STAMPS);
    // Üst şeridin sağında durur: logoyla ve kutularla çakışmaz.
    const angle = rng.range(-0.07, -0.02);
    const stampX = x + w - rng.range(190, 250);
    const stampY = y + stripSize * 0.15;
    const color = style.spot ?? '#a3201a';
    ops.push((ctx) => {
      ctx.save();
      ctx.translate(stampX, stampY);
      ctx.rotate(angle);
      ctx.font = fontCss(style.label, { b: true }, 30);
      const textW = ctx.measureText(text).width + (text.length - 1) * 3;
      ctx.globalAlpha = 0.78;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.strokeRect(-textW / 2 - 16, -32, textW + 32, 50);
      ctx.fillStyle = color;
      drawTracked(ctx, text, 0, 3, 3, 'center');
      ctx.restore();
    });
  }

  return { h: cursor - y, ops };
}

function mastFooter(env: Env, issue: IssueInfo, x: number, y: number, w: number, ops: DrawOp[]): number {
  const { style } = env;
  const rule = style.mastRule;
  ops.push((ctx) => hrule(ctx, x, x + w, y, rule, style.ink));
  let cursor = y + ruleHeight(rule) + 10;
  ops.push(datelineOps(env, issue, x + 4, cursor, w - 8, false));
  cursor += 46;
  ops.push((ctx) => hrule(ctx, x, x + w, cursor, 'thin', style.ink));
  return cursor + 3 + 24;
}
