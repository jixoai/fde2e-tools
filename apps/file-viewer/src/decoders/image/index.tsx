/**
 * 图片解码器 —— src/decoders/image/index.tsx
 *
 * 缩放（滚轮，光标锚点）/平移（拖拽，中心覆盖约束）/旋转/适配，纯 transform
 * 实现（零 canvas 光栅化，任意大图零额外内存）。底部信息：原始尺寸/体积/类型/缩放比。
 *
 * 体验规格（Owner 2026-11-01 实测反馈重修）：
 * - 打开即「适配 + 居中」：等比放入容器（大图缩小、小图最多 1:1），偏移归零。
 *   ResizeObserver 在容器尺寸变化时重算——懒加载/iframe 迟布局下首次量到
 *   0×0 也能自愈（旧实现只量一次，拿到 0 高度即把 scale 算成 0）。
 * - 平移边界：图片始终覆盖视窗中心点——位移上限 = 显示尺寸的一半（旋转 90°
 *   时宽高互换，按旋转后 AABB 近似）。
 * - 用户手动交互（拖拽/滚轮/1:1/旋转）即退出适配态；「适配」按钮/双击重新进入。
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
import {
  IDENTITY,
  clampPan,
  fitScale,
  zoomAnchor,
  zoomCenter,
  type Size,
  type Transform,
} from './geometry';

const ZOOM_STEP = 1.15;
const MAX_SCALE = 40;
const MIN_SCALE = 0.05;
/** 判定为「拖动」的最小位移（px）：小于该值的按下-抬起按单击处理。 */
const DRAG_THRESHOLD = 2;

export default function ImageDecoder({ name, mime, bytes }: DecoderFile) {
  const objectUrl = useObjectUrl(bytes, mime || 'image/png');
  const containerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  /** 是否处于「适配」态（容器尺寸变化时自动重算；手动交互即退出）。 */
  const [autoFit, setAutoFit] = useState(true);
  const autoFitRef = useRef(true);
  const writeAutoFit = useCallback((next: boolean) => {
    autoFitRef.current = next;
    setAutoFit(next);
  }, []);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);

  const measureContainer = useCallback((): Size | null => {
    const el = containerRef.current;
    if (!el) return null;
    const size = { w: el.clientWidth, h: el.clientHeight };
    return size.w > 0 && size.h > 0 ? size : null;
  }, []);

  /** 适配：等比放入容器（不超过 1:1）并回到居中（零偏移）。 */
  const fitInto = useCallback(() => {
    const container = measureContainer();
    if (!container || !natural) return;
    setTransform((t) => ({ ...IDENTITY, rotate: t.rotate, scale: fitScale(natural, container, t.rotate) }));
    writeAutoFit(true);
  }, [natural, measureContainer, writeAutoFit]);

  // 容器尺寸变化（懒加载/窗口缩放/iframe 迟布局）：适配态下自愈重算。
  // 首次 observe 回调也会触发一次，覆盖「图片先到、布局后到」的时序。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !natural) return;
    const ro = new ResizeObserver(() => {
      if (autoFitRef.current) fitInto();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [natural, fitInto]);

  // 载入原始尺寸后立即尝试适配（RO 兜底后续尺寸变化）
  useEffect(() => {
    if (natural) fitInto();
  }, [natural, fitInto]);

  // 切换文件：重置
  useEffect(() => {
    writeAutoFit(true);
    setTransform(IDENTITY);
    setNatural(null);
  }, [objectUrl, writeAutoFit]);

  // 滚轮缩放（光标锚点）：wheel 默认行为必须阻止，走原生监听（React 合成事件为 passive）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!natural) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      // 光标相对容器中心的坐标（与图片中心偏移解耦后传给纯函数）
      const point = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      };
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      writeAutoFit(false);
      setTransform((t) => zoomAnchor(t, point, factor, MIN_SCALE, MAX_SCALE, natural));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [natural, writeAutoFit]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary || !natural) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: transform.x,
      baseY: transform.y,
      moved: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !natural) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      writeAutoFit(false);
    }
    setTransform((t) => clampPan({ ...t, x: drag.baseX + dx, y: drag.baseY + dy }, natural));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const zoomBy = (factor: number) => {
    if (!natural) return;
    writeAutoFit(false);
    setTransform((t) => zoomCenter(t, factor, MIN_SCALE, MAX_SCALE, natural));
  };
  const rotate = () => {
    if (!natural) return;
    const container = measureContainer();
    setTransform((t) => {
      const rotate = (t.rotate + 90) % 360;
      // 适配态：旋转后按交换宽高重新适配（保持「整图可见」）
      if (autoFitRef.current && container) {
        return { ...t, rotate, scale: fitScale(natural, container, rotate), x: 0, y: 0 };
      }
      return clampPan({ ...t, rotate }, natural);
    });
  };
  const actualSize = () => {
    writeAutoFit(false);
    setTransform((t) => ({ ...IDENTITY, rotate: t.rotate }));
  };

  return (
    <DecoderShell
      main={
        <div
          ref={containerRef}
          className="relative h-full touch-none overflow-hidden select-none"
          data-fv-image-stage="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={fitInto}
          style={{ cursor: natural ? 'grab' : 'default' }}
        >
          {/* 加载骨架（vision P2）：图片量到原始尺寸前呈居中占位框，避免空白主体 */}
          {!natural ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="glass-control flex size-24 items-center justify-center rounded-2xl">
                <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden />
              </div>
            </div>
          ) : null}
          {/* 悬浮控件簇（vision/Owner 反馈④：缩放/旋转/适配能力常显可发现，不止页脚小图标） */}
          {natural ? (
            <div
              className="glass-control absolute top-3 right-3 z-10 flex items-center gap-0.5 rounded-xl bg-background/70 p-1"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <ToolButton title="缩小" onClick={() => zoomBy(1 / ZOOM_STEP)}>
                <ZoomOutIcon className="size-4" aria-hidden />
              </ToolButton>
              <ToolButton title="放大" onClick={() => zoomBy(ZOOM_STEP)}>
                <ZoomInIcon className="size-4" aria-hidden />
              </ToolButton>
              <ToolButton title="旋转 90°" onClick={rotate}>
                <RotateCwIcon className="size-4" aria-hidden />
              </ToolButton>
              <ToolButton title="适配窗口（双击同效）" onClick={fitInto} active={autoFit}>
                <MaximizeIcon className="size-4" aria-hidden />
              </ToolButton>
              <ToolButton title="原始尺寸 1:1" onClick={actualSize}>
                <span className="text-xs font-medium">1:1</span>
              </ToolButton>
            </div>
          ) : null}
          {objectUrl ? (
            <img
              src={objectUrl}
              alt={name}
              draggable={false}
              data-fv-image="true"
              data-scale={transform.scale}
              data-x={transform.x}
              data-y={transform.y}
              data-rotate={transform.rotate}
              data-auto-fit={autoFit ? 'true' : 'false'}
              // 居中只由 inline transform 的 translate(-50%,-50%) 承担：
              // Tailwind v4 的 -translate-x-1/2 会另写 CSS `translate` 属性，
              // 与之叠加会造成二次偏移（实测中心左移半个图宽＝「没有居中」根因）。
              className={`absolute top-1/2 left-1/2 max-w-none ${natural ? '' : 'opacity-0'}`}
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
            <ToolButton title="适配窗口（双击同效）" onClick={fitInto} active={autoFit}>
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
