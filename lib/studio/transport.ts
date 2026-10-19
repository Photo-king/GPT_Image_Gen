import type { StudioPayload } from "./config";
// Multipart on both network hops avoids Base64 expansion on the wire.
export function payloadForm(payload: StudioPayload, confirmation?: { quoteId: string; confirmed: boolean }): FormData {
  const form = new FormData();
  const { image, mask, ...settings } = payload;
  form.set("metadata", JSON.stringify({ payload: settings, ...confirmation }));
  for (const [name, url] of [["image", image], ["mask", mask]] as const) {
    if (!url) continue;
    const encoded = url.slice(url.indexOf(",") + 1);
    const chunks: BlobPart[] = [];
    // Chunk size divisible by four, so each Base64 block decodes independently.
    for (let offset = 0; offset < encoded.length; offset += 65536) {
      const raw = atob(encoded.slice(offset, offset + 65536));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      chunks.push(bytes);
    }
    form.set(name, new Blob(chunks, { type: "image/png" }), `${name}.png`);
  }
  return form;
}
