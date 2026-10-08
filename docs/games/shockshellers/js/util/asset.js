// Asset bytes. The production build gzips resources that compress well (the models shrink ~5x); a
// gzip header marks them, so development files and already-compressed media pass straight through.
export async function fetchAsset(url) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Asset unavailable (${response.status})`);
  const bytes = await response.arrayBuffer(), head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export const fetchAssetBlob = async (url, type) => new Blob([await fetchAsset(url)], { type });
