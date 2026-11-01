/**
 * Sıkıştırmasız ZIP. PNG zaten sıkıştırılmış olduğu için tekrar sıkıştırmak boşa iş;
 * tarayıcılar çok sayıda art arda indirmeyi engellediğinden çok sayfalı gazete tek dosya iner.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size: number, fill: (view: DataView) => void): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

export async function storeZip(files: { name: string; blob: Blob }[], now = new Date()): Promise<Blob> {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const encoder = new TextEncoder();

  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(new Uint8Array(await file.blob.arrayBuffer()));
    const size = file.blob.size;
    const common = (view: DataView, at: number) => {
      view.setUint16(at, 20, true);
      view.setUint16(at + 2, 0x0800, true); // dosya adı UTF-8
      view.setUint16(at + 4, 0, true); // sıkıştırma yok
      view.setUint16(at + 6, time, true);
      view.setUint16(at + 8, date, true);
      view.setUint32(at + 10, crc, true);
      view.setUint32(at + 14, size, true);
      view.setUint32(at + 18, size, true);
      view.setUint16(at + 22, name.length, true);
    };

    const local = header(30 + name.length, (view) => {
      view.setUint32(0, 0x04034b50, true);
      common(view, 4);
    });
    local.set(name, 30);
    parts.push(local, file.blob);

    const entry = header(46 + name.length, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      common(view, 6);
      view.setUint32(42, offset, true);
    });
    entry.set(name, 46);
    central.push(entry);

    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = header(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, files.length, true);
    view.setUint16(10, files.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, offset, true);
  });

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
