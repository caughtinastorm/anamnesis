/** Bounded transport: the deadline covers headers AND the complete response body. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 12000, maxBytes = 32 * 1024 * 1024) {
  const controller = new AbortController();
  let reader;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Sync request timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });
  const request = async () => {
    const response = await fetch(url, {
      ...options, signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Remote response exceeds the download limit.');
    if (!response.body) return response;
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Remote response exceeds the download limit.');
      chunks.push(value);
    }
    return new Response(new Blob(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  try { return await Promise.race([request(), deadline]); }
  finally {
    clearTimeout(timer);
    controller.abort();
    // Cancellation must never hold up rejection on a broken/hostile stream.
    reader?.cancel().catch(() => {});
  }
}
