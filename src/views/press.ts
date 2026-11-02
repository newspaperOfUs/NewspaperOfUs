import { h } from '../dom';
import { trackOverlay } from './shared';

export function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Sayfa dosyaya çevrilemedi.'))), type, quality);
  });
}

/** Resmi JPEG olarak yeniden kodlar; genişlik verilirse küçültür. */
export async function reencode(blob: Blob, quality: number, width?: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width ?? bitmap.width;
  canvas.height = Math.round((bitmap.height / bitmap.width) * canvas.width);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const result = await toBlob(canvas, 'image/jpeg', quality);
  canvas.width = 0;
  return result;
}

export function saveFile(href: string, name: string) {
  const link = h('a', { href, download: name });
  document.body.append(link);
  link.click();
  link.remove();
}

export function zoom(url: string, alt: string) {
  const close = () => {
    untrack();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const untrack = trackOverlay(close);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const overlay = h('div', { class: 'zoom', onclick: close }, h('img', { src: url, alt }));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
}

export async function printImages(urls: string[]) {
  const sheet = h(
    'div',
    { id: 'print-sheet' },
    urls.map((src) => h('img', { src, alt: '' })),
  );
  document.body.append(sheet);
  let closed = false;
  const clear = () => {
    closed = true;
    untrack();
    sheet.remove();
    window.removeEventListener('afterprint', clear);
  };
  const untrack = trackOverlay(clear);
  window.addEventListener('afterprint', clear);
  await Promise.all([...sheet.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
  if (!closed) window.print();
}
