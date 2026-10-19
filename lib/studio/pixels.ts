// Exact passthrough for every unselected decoded RGBA pixel.
export function blendPixels(original: Uint8ClampedArray, generated: Uint8ClampedArray, mask: Uint8ClampedArray): Uint8ClampedArray {
  if (original.length !== generated.length || original.length !== mask.length || original.length % 4) throw new Error("像素尺寸不一致");
  const out = new Uint8ClampedArray(original);
  for (let i = 0; i < out.length; i += 4) {
    const weight = mask[i + 3] / 255;
    if (weight === 0) continue;
    for (let c = 0; c < 4; c++) out[i + c] = Math.round(original[i + c] * (1 - weight) + generated[i + c] * weight);
  }
  return out;
}
