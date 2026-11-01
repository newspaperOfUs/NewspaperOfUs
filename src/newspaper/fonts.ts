import catalog from './fonts.json';
import type { Style } from './styles';

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

type Catalog = Record<string, { pkg: string; subsets: string[]; faces: [number, string][] }>;

const loaded = new Map<string, Promise<void>>();

function loadFamily(family: string): Promise<void> {
  let promise = loaded.get(family);
  if (!promise) {
    const entry = (catalog as unknown as Catalog)[family];
    if (!entry) throw new Error(`Katalogda olmayan font: ${family}`);
    const faces = entry.subsets.flatMap((subset) =>
      entry.faces.map(([weight, style]) => {
        const url = `${import.meta.env.BASE_URL}fonts/${entry.pkg}-${subset}-${weight}-${style}.woff2`;
        const face = new FontFace(family, `url(${url}) format("woff2")`, {
          weight: String(weight),
          style,
          unicodeRange: subset === 'latin' ? LATIN : LATIN_EXT,
        });
        document.fonts.add(face);
        return face.load();
      }),
    );
    promise = Promise.all(faces).then(() => undefined);
    loaded.set(family, promise);
  }
  return promise;
}

/** Sadece bu sayının kullandığı fontlar indirilir. */
export async function loadStyleFonts(style: Style): Promise<void> {
  const families = new Set([style.mast, style.head, style.headAlt, style.body, style.label].map((f) => f.family));
  await Promise.all([...families].map(loadFamily));
}
