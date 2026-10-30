/**
 * 图片解码器 —— src/decoders/image/index.tsx
 *
 * 缩放（滚轮，光标锚点）/平移（拖拽）/旋转/适配（1:1 与适宽切换），纯 transform
 * 实现（零 canvas 光栅化，任意大图零额外内存）。底部信息：原始尺寸/体积/类型/缩放比。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DownloadIcon,
  ImageIcon,
  MaximizeIcon,
  RotateCwIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { DecoderShell, InfoItem, ToolButton, useObjectUrl, downloadBytes } from '@/decoders/parts';
import { normalizeMime, type DecoderFile } from '@/decoders/registry';
import { formatBytes, formatPercent } from '@/lib/format';

const ZOOM_STEP = 1.15;
const MAX_SCALE = 40;
const MIN_SCALE = 0.05;

interface Transform {
  scale: number;
  x: number;
  y: number;
  rotate: number;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0, rotate: 0 };

export default function ImageDecoder({ name, mime, bytes }: DecoderFile) {
  const objectUrl = useObjectUrl(bytes, mime || 'image/png');
  const containerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  /** 载入后自适应：缩到恰好放进容器（不超过 1:1）。 */
  const fitInto = useCallback(() => {
    const container = containerRef.current;
    if (!container || !natural) return;
    const scale = Math.min(
      container.clientWidth / natural.w,
      container.clientHeight / natural.h,
      1,
    );
    setTransform({ ...IDENTITY, scale });
  }, [natural]);

  // 首次量到原始尺寸即适配一次
  const fittedRef = useRef(false);
  useEffect(() => {
    if (natural && !fittedRef.current) {
      fittedRef.current = true;
      fitInto();
    }
  }, [natural, fitInto]);
  useEffect(() => {
    fittedRef.current = false;
    setTransform(IDENTITY);
    setNatural(null);
  }, [objectUrl]);

  // 滚轮缩放（光标锚点）：wheel 默认行为必须阻止，走原生监听（React 合成事件为 passive）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTransform((t) => {
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const scale = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE);
        const rect = container.getBoundingClientRect();
        // 容器中心为原点；缩放前后保持光标下的内容点不动
        const cx = e.clientX - rect.left - rect.width / 2 - t.x;
        const cy = e.clientY - rect.top - rect.height / 2 - t.y;
        const k = scale / t.scale;
        return { ...t, scale, x: cx - k * cx, y: cy - k * cy };
      });
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: transform.x, baseY: transform.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setTransform((t) => ({ ...t, x: drag.baseX + (e.clientX - drag.startX), y: drag.baseY + (e.clientY - drag.startY) }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const zoomBy = (factor: number) =>
    setTransform((t) => ({ ...t, scale: clamp(t.scale * factor, MIN_SCALE, MAX_SCALE) }));
  const rotate = () => setTransform((t) => ({ ...t, rotate: (t.rotate + 90) % 360 }));
  const actualSize = () => setTransform(IDENTITY);

  return (
    <DecoderShell
      main={
        <div
          ref={containerRef}
          className="relative h-full cursor-grab overflow-hidden active:cursor-grabbing select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={fitInto}
        >
          {/* 加载骨架（vision P2）：图片量到原始尺寸前呈居中占位框，避免空白主体 */}
          {!natural ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="glass-control flex size-24 items-center justify-center rounded-2xl">
                <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden />
              </div>
            </div>
          ) : null}
          {objectUrl ? (
            <img
              src={objectUrl}
              alt={name}
              draggable={false}
              className={`absolute top-1/2 left-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 ${natural ? '' : 'opacity-0'}`}
              style={{
                transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotate}deg)`,
              }}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }}
            />
          ) : null}
        </div>
      }
      footer={
        <>
          <InfoItem label="原始尺寸" value={natural ? `${natural.w} × ${natural.h}` : '…'} />
          <InfoItem label="体积" value={formatBytes(bytes.byteLength)} />
          <InfoItem label="类型" value={normalizeMime(mime) || '未知'} />
          <div className="ml-auto flex items-center gap-1">
            <InfoItem label="缩放" value={formatPercent(transform.scale)} />
            <ToolButton title="缩小" onClick={() => zoomBy(1 / ZOOM_STEP)}>
              <ZoomOutIcon className="size-3.5" aria-hidden />
            </ToolButton>
            <ToolButton title="放大" onClick={() => zoomBy(ZOOM_STEP)}>
              <ZoomInIcon className="size-3.5" aria-hidden />
            </ToolButton>
            <ToolButton title="旋转 90°" onClick={rotate}>
              <RotateCwIcon className="size-3.5" aria-hidden />
            </ToolButton>
            <ToolButton title="适配窗口（双击同效）" onClick={fitInto} active>
              <MaximizeIcon className="size-3.5" aria-hidden />
            </ToolButton>
            <ToolButton title="原始尺寸 1:1" onClick={actualSize}>
              1:1
            </ToolButton>
            <ToolButton title="下载原图" onClick={() => downloadBytes(bytes, name, mime)}>
              <DownloadIcon className="size-3.5" aria-hidden />
            </ToolButton>
          </div>
        </>
      }
    />
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
