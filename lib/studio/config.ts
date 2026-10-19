export const MAX_INPUT_BYTES = 50_000_000;
export function pngBytes(url: string): number {
  const data = url.slice(url.indexOf(",") + 1);
  return data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}
export const MODEL = "gpt-image-2.5-sunburst";
export const QUALITIES = ["max", "xhigh", "high", "medium", "low"] as const;
export type Quality = typeof QUALITIES[number];
export const SIZES = ["3840x2160", "2160x3840", "2880x2880", "3456x2304", "2304x3456", "2560x1440", "1536x1024", "1024x1536", "1024x1024"];
export const PRICING = { textInput: 5, imageInput: 8, imageOutput: 30, checked: "2026-10-18", url: "https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst" };
export type StudioPayload = { prompt: string; quality: Quality; size: string; image?: string; mask?: string };
export type Usage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { image_tokens?: number; text_tokens?: number } };
export function usageCost(usage?: Usage): number | null {
  const d = usage?.input_tokens_details;
  if (typeof d?.image_tokens !== "number" || typeof d?.text_tokens !== "number" || typeof usage?.output_tokens !== "number") return null;
  return (d.image_tokens * PRICING.imageInput + d.text_tokens * PRICING.textInput + usage.output_tokens * PRICING.imageOutput) / 1e6;
}
export function sizeError(size: string): string | null {
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return "分辨率格式应为 宽x高，例如 3840x2160";
  const w = Number(m[1]), h = Number(m[2]);
  if (w % 16 || h % 16 || w < 16 || h < 16 || w > 3840 || h > 3840 || w * h < 655360 || w * h > 8294400 || w / h < 1 / 3 || w / h > 3) return "宽高须为 16 的倍数，单边 ≤3840，像素总数 655,360–8,294,400，宽高比 1:3–3:1。";
  return null;
}
export function validatePayload(value: unknown): StudioPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("无效请求");
  const p = value as StudioPayload;
  if (typeof p.prompt !== "string" || !p.prompt.trim() || p.prompt.length > 32000) throw new Error("请输入 1–32000 字符的 Prompt");
  if (!QUALITIES.includes(p.quality)) throw new Error("无效画质");
  if (typeof p.size !== "string") throw new Error("缺少分辨率");
  const error = sizeError(p.size); if (error) throw new Error(error);
  for (const image of [p.image, p.mask]) {
    if (image !== undefined && (typeof image !== "string" || image.length > Math.ceil(MAX_INPUT_BYTES / 3) * 4 + 22 || pngBytes(image) >= MAX_INPUT_BYTES || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image))) throw new Error("API 输入及蒙版必须是小于 50 MB 的 PNG 文件");
  }
  if (p.mask && !p.image) throw new Error("蒙版需要原图");
  return { prompt: p.prompt.trim(), quality: p.quality, size: p.size, ...(p.image ? { image: p.image } : {}), ...(p.mask ? { mask: p.mask } : {}) };
}
