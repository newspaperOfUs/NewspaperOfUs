import type { Rng } from './rng';
import type { RuleKind } from './styles';

export function ruleHeight(kind: RuleKind): number {
  switch (kind) {
    case 'hair':
      return 2;
    case 'thin':
      return 3;
    case 'medium':
      return 6;
    case 'thick':
      return 12;
    case 'double':
      return 11;
    case 'scotch':
      return 19;
    case 'oxford':
      return 24;
    case 'dots':
      return 10;
    case 'diamond':
      return 22;
    case 'wave':
      return 14;
  }
}

/** Yatay çizgi; `y` kuralın üst kenarı. */
export function hrule(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, kind: RuleKind, color: string) {
  const w = x2 - x1;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (kind) {
    case 'hair':
      ctx.fillRect(x1, y, w, 2);
      break;
    case 'thin':
      ctx.fillRect(x1, y, w, 3);
      break;
    case 'medium':
      ctx.fillRect(x1, y, w, 6);
      break;
    case 'thick':
      ctx.fillRect(x1, y, w, 12);
      break;
    case 'double':
      ctx.fillRect(x1, y, w, 3);
      ctx.fillRect(x1, y + 8, w, 3);
      break;
    case 'scotch':
      ctx.fillRect(x1, y, w, 12);
      ctx.fillRect(x1, y + 17, w, 2.5);
      break;
    case 'oxford':
      ctx.fillRect(x1, y, w, 2.5);
      ctx.fillRect(x1, y + 7, w, 10);
      ctx.fillRect(x1, y + 22, w, 2.5);
      break;
    case 'dots':
      for (let x = x1 + 5; x < x2; x += 16) {
        ctx.beginPath();
        ctx.arc(x, y + 5, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'diamond': {
      const cx = (x1 + x2) / 2;
      const cy = y + 11;
      const pad = 30;
      ctx.fillRect(x1, cy - 1.5, w / 2 - pad, 3);
      ctx.fillRect(cx + pad, cy - 1.5, w / 2 - pad, 3);
      diamond(ctx, cx, cy, 11);
      diamond(ctx, cx - 22, cy, 5);
      diamond(ctx, cx + 22, cy, 5);
      break;
    }
    case 'wave': {
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = x1; x <= x2; x += 4) {
        const py = y + 7 + Math.sin((x - x1) / 7) * 4.5;
        if (x === x1) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
      break;
    }
  }
}

export function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();
}

export function heartPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.95);
  ctx.bezierCurveTo(cx - r * 1.5, cy - r * 0.1, cx - r * 0.85, cy - r * 1.15, cx, cy - r * 0.35);
  ctx.bezierCurveTo(cx + r * 0.85, cy - r * 1.15, cx + r * 1.5, cy - r * 0.1, cx, cy + r * 0.95);
  ctx.closePath();
}

/** Logonun arma motifi: ışınlar saçan kalp. */
export function heartBurst(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, rng: Rng) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const rays = rng.int(20, 32);
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const long = i % 2 === 0;
    const inner = r * 0.62;
    const outer = r * (long ? 1 : 0.84);
    ctx.lineWidth = Math.max(1.5, r * (long ? 0.028 : 0.016));
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(2, r * 0.03);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.56, 0, Math.PI * 2);
  ctx.stroke();
  heartPath(ctx, cx, cy + r * 0.02, r * 0.34);
  ctx.fill();
  ctx.restore();
}

/** Sütun içi küçük süs: yıldız, elmas veya kalp üçlüsü. */
export function colOrnament(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, kind: number) {
  ctx.save();
  ctx.fillStyle = color;
  const spots = [-size * 2.2, 0, size * 2.2];
  for (const dx of spots) {
    if (kind === 0) diamond(ctx, cx + dx, cy, size * 0.55);
    else if (kind === 1) {
      heartPath(ctx, cx + dx, cy, size * 0.55);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx + dx, cy, size * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
