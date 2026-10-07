// Both browser and Worker callers impose a byte limit before parsing text.
export async function readMusicResponse(response, maxBytes = 256 * 1024) {
  if (!response.body) return '';
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel(); throw new Error('RESPONSE_TOO_LARGE');
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
