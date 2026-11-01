// fonts.json'da listelenen font dosyalarını node_modules'tan public/fonts'a kopyalar.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = JSON.parse(readFileSync(join(root, 'src/newspaper/fonts.json'), 'utf8'));
const out = join(root, 'public/fonts');
mkdirSync(join(out, 'licenses'), { recursive: true });

let copied = 0;
for (const { pkg, subsets, faces } of Object.values(fonts)) {
  const dir = join(root, 'node_modules/@fontsource', pkg);
  for (const subset of subsets) {
    for (const [weight, style] of faces) {
      const name = `${pkg}-${subset}-${weight}-${style}.woff2`;
      const src = join(dir, 'files', name);
      if (!existsSync(src)) throw new Error(`Font dosyası yok: ${src}`);
      copyFileSync(src, join(out, name));
      copied++;
    }
  }
  // OFL lisansı fontla birlikte dağıtılmalı.
  const license = join(dir, 'LICENSE');
  if (existsSync(license)) copyFileSync(license, join(out, 'licenses', `${pkg}.txt`));
}
console.log(`${copied} font dosyası kopyalandı.`);
