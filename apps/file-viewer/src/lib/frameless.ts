/**
 * 无壳渲染支持 —— src/lib/frameless.ts
 *
 * 契约（file-viewer-frameless）：`?frameless=1` 时隐藏一切 viewer 注入的 chrome，
 * 只留内容本体；`size=WxH` 让内容盒严格等于目标尺寸；渲染落定后暴露
 * `data-frameless-ready="1"`（失败/错误态 `"error"`），供 BU `waitFor` 使用。
 *
 * 就绪信号的设计取舍：
 * - 解码器内容有异步首帧（sandbox iframe / PDF / 图片 / 媒体）——单靠「挂载后
 *   两帧」会把空白画面当就绪。因此 iframe 解码器（svg/html/pdf）经
 *   `onContentReady` 显式回调；图片/音视频由壳层读元素状态（img.complete /
 *   readyState）判定；文本类异步解码器（markdown/docx/pptx）由 DOM 静默帧判定。
 * - 任何分支都有 15s 有界兜底，绝不让调用方无限等待。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { FramelessSize } from '@/lib/viewer-url';

/** 根节点属性（写在 <html> 上，body/背景一并可被 CSS 收口）。 */
export const FRAMELESS_ATTR = 'data-frameless';
/** 就绪信号属性（写在 <html> 上）：'1' 成功 / 'error' 失败。 */
export const FRAMELESS_READY_ATTR = 'data-frameless-ready';

export type FramelessReadyValue = '1' | 'error';

/** 等待上限：解码器首帧迟迟不来也必须落定，避免调用方无限等待。 */
const READY_TIMEOUT_MS = 15_000;
/** DOM 静默帧阈值：连续两帧无变更且无加载标记/待载媒体 → 视为首帧可绘。 */
const QUIET_FRAMES = 2;

/** 写就绪信号（幂等；值同当前则不重复写）。 */
export function writeFramelessReady(value: FramelessReadyValue): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(FRAMELESS_READY_ATTR, value);
}

/** 清就绪信号（切回带壳模式/卸载时）。 */
export function clearFramelessReady(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.removeAttribute(FRAMELESS_READY_ATTR);
}

/** 读当前就绪信号（WebMCP 回执/断言用）。 */
export function readFramelessReady(): FramelessReadyValue | null {
  if (typeof document === 'undefined') return null;
  const value = document.documentElement.getAttribute(FRAMELESS_READY_ATTR);
  return value === '1' || value === 'error' ? value : null;
}

/**
 * 无壳文档态：<html data-frameless="1">（CSS 收口 body 背景/滚动）+ 就绪信号复位。
 * 非 frameless 时彻底清属性（零副作用，带壳形态完全不变）。
 */
export function useFramelessDocument(enabled: boolean): void {
  useEffect(() => {
    const html = document.documentElement;
    if (!enabled) {
      html.removeAttribute(FRAMELESS_ATTR);
      html.removeAttribute(FRAMELESS_READY_ATTR);
      return;
    }
    html.setAttribute(FRAMELESS_ATTR, '1');
    html.removeAttribute(FRAMELESS_READY_ATTR);
    return () => {
      html.removeAttribute(FRAMELESS_ATTR);
      html.removeAttribute(FRAMELESS_READY_ATTR);
    };
  }, [enabled]);
}

/** 无壳根内容盒的尺寸样式（缺省＝视口，由 CSS 铺满）。 */
export function framelessRootStyle(
  size: FramelessSize | undefined,
  background: string | undefined,
): CSSProperties | undefined {
  if (!size && !background) return undefined;
  return {
    ...(size ? { width: `${size.width}px`, height: `${size.height}px` } : {}),
    ...(background ? { backgroundColor: background } : {}),
  };
}

/** 元素是否处于待载状态（媒体首帧未可绘）。 */
function isMediaPending(el: Element): boolean {
  if (el instanceof HTMLImageElement) return !(el.complete && el.naturalWidth > 0);
  if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) return el.readyState < 1;
  return false;
}

/**
 * 就绪观测器（ReadyShell 内调用）：返回 `onContentReady` 供解码器在内容首帧
 * 可绘时显式上报（sandbox iframe svg/html、PDF 原生查看器）。
 *
 * contentKey＝当前解码器身份：解码器切换时观测器必须重启（旧 ready 不得冒充
 * 新内容的就绪）；重启即撤下旧信号，等新首帧重新落定。
 *
 * 判定：解码器根出现 + 无加载标记 + 媒体元素已可绘 + iframe 已上报回调 +
 * DOM 连续静默帧 → `data-frameless-ready="1"`；`[data-viewer-error]` → "error"。
 */
export function useFramelessReadyWatcher(enabled: boolean, contentKey = ''): () => void {
  const contentReadyRef = useRef(false);

  const markContentReady = useCallback(() => {
    contentReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    contentReadyRef.current = false;
    clearFramelessReady(); // 新解码器/重试：旧就绪信号立即失效
    let cancelled = false;
    let rafId = 0;
    let observer: MutationObserver | null = null;
    let quietFrames = 0;
    const startedAt = performance.now();
    const root = document.querySelector('[data-decoder-root]');

    // DOM 变更（异步解码器注入内容）即重置静默帧计数
    if (root) {
      observer = new MutationObserver(() => {
        quietFrames = 0;
      });
      // 只观察节点级变更：视频 timeupdate 会高频改 data-* 属性，观察 attributes
      // 会让静默帧永远达不到（媒体就绪被属性噪声掩盖）。
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    }

    const finish = (value: FramelessReadyValue) => {
      if (cancelled) return;
      cancelled = true;
      if (observer) observer.disconnect();
      writeFramelessReady(value);
    };

    const tick = () => {
      if (cancelled) return;
      const errorPane = document.querySelector('[data-viewer-error]');
      if (errorPane) {
        finish('error');
        return;
      }
      const decoderRoot = document.querySelector('[data-decoder-root]');
      if (!decoderRoot) {
        if (performance.now() - startedAt > READY_TIMEOUT_MS) finish('1');
        else rafId = requestAnimationFrame(tick);
        return;
      }
      const loading = decoderRoot.querySelector('[data-decoder-loading]');
      const media = Array.from(
        decoderRoot.querySelectorAll('img, iframe, video, audio, object, embed'),
      );
      const mediaPending = media.some(isMediaPending);
      // iframe（sandbox svg/html、PDF 原生查看器）不走 DOM 可观测路径——必须等解码器上报
      const hasIframe = media.some((el) => el instanceof HTMLIFrameElement);
      const pending = Boolean(loading) || mediaPending || (hasIframe && !contentReadyRef.current);

      if (pending) {
        quietFrames = 0;
      } else {
        quietFrames += 1;
      }

      if (quietFrames >= QUIET_FRAMES) {
        // 静默达标后再等两帧确认首帧已绘制（避免「刚提交 DOM、尚未合成」的窗口）
        rafId = requestAnimationFrame(() => {
          rafId = requestAnimationFrame(() => finish('1'));
        });
        return;
      }
      // 超时兜底：任何卡死路径都要落定，不让调用方无限等待
      if (performance.now() - startedAt > READY_TIMEOUT_MS) {
        finish('1');
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (observer) observer.disconnect();
    };
  }, [enabled, contentKey]);

  return markContentReady;
}
