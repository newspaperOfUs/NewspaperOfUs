function parseColor(color: string): [number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    const n = parseInt(value, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = color.trim().match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');

/** Yazarın seçtiği koyu renk karanlık zeminde kaybolmasın: tonu aynı kalır, açıklığı artar. */
export function liftForDark(color: string, minLightness = 0.75): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (lightness >= minLightness) return color;

  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta + 6) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }

  const chroma = (1 - Math.abs(2 * minLightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = minLightness - chroma / 2;
  const [r1, g1, b1] =
    hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${toHex(r1 + m)}${toHex(g1 + m)}${toHex(b1 + m)}`;
}
