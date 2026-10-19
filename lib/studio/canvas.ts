import { MAX_INPUT_BYTES, pngBytes } from "./config";
import { blendPixels } from "./pixels";
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("无法解码图片，请使用 JPEG、PNG 或 WebP")); img.src = url; });
}
export function canvas(w: number, h: number) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
export function context(c: HTMLCanvasElement) { const ctx = c.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("浏览器无法创建画布"); return ctx; }
export async function normalizePhoto(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("请先把照片导出为 sRGB JPEG、PNG 或 WebP；不支持 RAW / HEIC / TIFF。");
  if (file.size > 100_000_000) throw new Error("本地导入支持最大 100 MB 的照片。");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (img.naturalWidth * img.naturalHeight > 60_000_000) throw new Error("当前工作台支持最多 6000 万像素，请先导出较小副本。");
    const original = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("读取照片失败")); reader.readAsDataURL(file);
    });
    return { url: original, width: img.naturalWidth, height: img.naturalHeight, name: file.name };
  } finally { URL.revokeObjectURL(url); }
}
export type Stroke = { points: { x: number; y: number }[]; radius: number; erase: boolean };
export function drawStrokes(c: HTMLCanvasElement, strokes: Stroke[]) {
  const ctx = context(c); ctx.clearRect(0, 0, c.width, c.height);
  for (const stroke of strokes) {
    ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = "#efbb71"; ctx.lineWidth = stroke.radius * 2; ctx.lineCap = ctx.lineJoin = "round";
    const first = stroke.points[0]; if (!first) continue;
    ctx.beginPath(); ctx.arc(first.x, first.y, stroke.radius, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(first.x, first.y);
    for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}
export function maskCanvas(w: number, h: number, strokes: Stroke[]) { const c = canvas(w, h); drawStrokes(c, strokes); return c; }
export function hasSelection(c: HTMLCanvasElement) { const d = context(c).getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }
export async function prepareInput(url: string, width: number, height: number, selection?: HTMLCanvasElement) {
  const image = await loadImage(url), c = canvas(width, height); context(c).drawImage(image, 0, 0, width, height);
  const imageUrl = c.toDataURL("image/png");
  let mask: string | undefined;
  if (selection) {
    const m = canvas(width, height), ctx = context(m);
    ctx.fillStyle = "black"; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "destination-out"; ctx.drawImage(selection, 0, 0, width, height);
    mask = m.toDataURL("image/png");
  }
  if (pngBytes(imageUrl) >= MAX_INPUT_BYTES || (mask && pngBytes(mask) >= MAX_INPUT_BYTES)) throw new Error("处理后的 API 输入超过 50 MB 文件限制，请调整输入尺寸；本地原图不受影响。");
  return { image: imageUrl, mask };
}
export async function composite(originalUrl: string, generatedUrl: string, selection: HTMLCanvasElement) {
  const [original, generated] = await Promise.all([loadImage(originalUrl), loadImage(generatedUrl)]);
  const c = canvas(original.naturalWidth, original.naturalHeight), ctx = context(c);
  ctx.drawImage(original, 0, 0); const base = ctx.getImageData(0, 0, c.width, c.height);
  ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(generated, 0, 0, c.width, c.height);
  const result = blendPixels(base.data, ctx.getImageData(0, 0, c.width, c.height).data, context(selection).getImageData(0, 0, c.width, c.height).data);
  base.data.set(result); ctx.putImageData(base, 0, 0); return c.toDataURL("image/png");
}
