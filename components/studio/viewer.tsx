"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { drawStrokes, type Stroke } from "@/lib/studio/canvas";
type Props = { before?: string; after?: string; width: number; height: number; strokes: Stroke[]; onStrokes: (s: Stroke[]) => void; tool: "pan" | "brush" | "erase"; radius: number; disabled: boolean; showMask: boolean };
export default function Viewer({ before, after, width, height, strokes, onStrokes, tool, radius, disabled, showMask }: Props) {
  const viewport = useRef<HTMLDivElement>(null), mask = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState({ w: 900, h: 600 });
  const [zoom, setZoom] = useState<number | null>(null), [pan, setPan] = useState({ x: 0, y: 0 }), [split, setSplit] = useState(50);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; stroke?: Stroke } | null>(null);
  const scale = zoom ?? Math.min((frame.w - 48) / width, (frame.h - 48) / height, 1);
  useEffect(() => { const el = viewport.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setFrame({ w: entry.contentRect.width, h: entry.contentRect.height })); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { setZoom(null); setPan({ x: 0, y: 0 }); }, [before, width, height]);
  useEffect(() => { if (mask.current) drawStrokes(mask.current, strokes); }, [strokes, width, height]);
  const position = (event: React.PointerEvent) => {
    const rect = mask.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(width, (event.clientX - rect.left) / scale)), y: Math.max(0, Math.min(height, (event.clientY - rect.top) / scale)) };
  };
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) setZoom(Math.max(.05, Math.min(8, scale * (e.deltaY > 0 ? .9 : 1.1))));
      else setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [scale]);
  const finish = () => { if (drag.current?.stroke) onStrokes([...strokes, drag.current.stroke]); drag.current = null; };
  return <div className="viewer-shell">
    <div className="viewer-toolbar"><span>{before ? `${width.toLocaleString()} × ${height.toLocaleString()}` : "你的下一张作品，从这里开始"}</span><div className="button-group"><button onClick={() => { setZoom(null); setPan({ x: 0, y: 0 }); }}>适应</button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>100%</button><button aria-label="缩小" onClick={() => setZoom(Math.max(.05, scale / 1.25))}>−</button><span>{Math.round(scale * 100)}%</span><button aria-label="放大" onClick={() => setZoom(Math.min(8, scale * 1.25))}>＋</button></div></div>
    <div ref={viewport} className={`viewport tool-${tool}`}
      onPointerDown={e => {
        if (!before || disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const d: NonNullable<typeof drag.current> = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        if (tool !== "pan" && mask.current) { d.stroke = { points: [position(e)], radius, erase: tool === "erase" }; drawStrokes(mask.current, [...strokes, d.stroke]); }
        drag.current = d;
      }} onPointerMove={e => {
        const d = drag.current; if (!d) return;
        if (d.stroke && mask.current) { d.stroke.points.push(position(e)); drawStrokes(mask.current, [...strokes, d.stroke]); }
        else setPan({ x: d.panX + e.clientX - d.x, y: d.panY + e.clientY - d.y });
      }} onPointerUp={finish} onPointerCancel={finish}>
      {before ? <div className="image-plane" style={{ width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, left: (frame.w - width) / 2, top: (frame.h - height) / 2 }}>
        <img src={before} alt="Before" draggable={false} style={{ width, height }} />
        {after && <><img src={after} alt="After" draggable={false} style={{ width, height, clipPath: `inset(0 0 0 ${split}%)` }} /><div className="split-line" style={{ left: `${split}%`, width: 1 / scale }} /></>}
        <canvas ref={mask} width={width} height={height} style={{ opacity: showMask ? .48 : 0 }} />
      </div> : <div className="empty-stage"><div className="sun-orbit">✳</div><p>让光影，恰到好处。</p><span>导入已调色照片进行精修<br />或用文字创造一张全新作品</span><div className="empty-meta">SUNBURST · MAX QUALITY · LOCAL STUDIO</div></div>}
      {after && <><span className="compare-label before-label">BEFORE</span><span className="compare-label after-label">AFTER</span></>}
    </div>
    <div className="viewer-bottom">{after ? <><span>Before</span><input aria-label="Before / After 滑块" type="range" min="0" max="100" value={split} onChange={e => setSplit(+e.target.value)} /><span>After</span></> : <span>{tool === "pan" ? "拖动平移 · 滚轮移动 · ⌘ + 滚轮缩放" : "涂抹金色区域为编辑选区 · 使用橡皮擦修整边缘"}</span>}</div>
  </div>;
}
