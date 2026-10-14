/** Bound actual streamed bytes even when Content-Length is absent or incorrect. */
export async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('Upstream response body is missing');
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel();
    throw new Error('Upstream response exceeds the size limit');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Upstream response exceeds the size limit');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readResponseJson<T>(response: Response, maxBytes: number): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readResponseBytes(response, maxBytes))) as T;
}
