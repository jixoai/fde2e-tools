/**
 * 视频解码器 —— src/decoders/video/index.tsx
 *
 * 自研控制层（替换原生 controls，Owner 2026-11-01 实测反馈）：
 * - 中央大播放/暂停钮；底部玻璃控制条（官方 Slider 进度＋缓冲带、时间、音量、
 *   倍速菜单、画中画、全屏）；
 * - 控制条自动隐藏：播放中 3s 无交互隐去，鼠标移动/触摸/按键唤醒；暂停常显；
 * - 键盘（播放器聚焦时）：空格/K 暂停、←/→ ±5s、F 全屏、M 静音。
 *
 * 手势层（Pointer Events 一套，鼠标/触摸同源；手势区 touch-action:none）：
 * - 上下滑＝亮度（0.3~1.6），左侧微条指示；
 * - 左/右半屏双击＝快退/快进 10s，同位置连击每多一击 +10s（上限 60s）；
 * - 按住水平滑动＝实时 seek（1px=200ms，实时写 currentTime，松手即生效）；
 * - 中区双击＝暂停/播放；长按 500ms＝2x 倍速，松开恢复。
 * 单击与双击用 250ms 延迟判定，位移/时长阈值防串扰。
 *
 * 大媒体仍走原始 URL 直连流式（不吃整载 blob）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FastForwardIcon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PictureInPicture2Icon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SunIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react';
import { Button } from '@fde2e-tools/shared/ui/button';
import { Slider } from '@fde2e-tools/shared/ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@fde2e-tools/shared/ui/dropdown-menu';
import { DecoderShell, InfoItem } from '@/decoders/parts';
import { normalizeMime, type DecoderFile } from '@/decoders/registry';
import { formatBytes, formatDuration } from '@/lib/format';
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  CLICK_DELAY_MS,
  HOLD_TOLERANCE_PX,
  LONG_PRESS_MS,
  applySeekStep,
  brightnessForDrag,
  clamp,
  classifyDrag,
  formatSeekDelta,
  isClickChain,
  seekRegion,
  seekIncrementForCount,
  seekStepForCount,
  seekTargetForDrag,
  type GestureMode,
  type SeekRegion,
} from './gestures';

/** 控制条无交互自动隐藏时长（播放中）。 */
const CONTROLS_HIDE_MS = 3000;
/** 键盘 ←/→ 步长（秒）。 */
const KEY_SEEK_SECONDS = 5;
/** 倍速菜单取值。 */
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** 手势浮层内容。 */
type Overlay =
  | { kind: 'seek'; delta: number }
  | { kind: 'scrub'; time: number; delta: number }
  | { kind: 'brightness'; value: number }
  | { kind: 'rate'; rate: number }
  | null;

/** 单次指针会话的手势状态。 */
interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  startAt: number;
  baseTime: number;
  baseBrightness: number;
  baseRate: number;
  mode: GestureMode;
  moved: boolean;
}

/** 连击序列状态（跨 pointerup 保留）。 */
interface ClickChain {
  at: number;
  x: number;
  y: number;
  count: number;
  region: SeekRegion;
  timer: number | null;
}

export default function VideoDecoder({ name, mime, bytes, url, size }: DecoderFile) {
  const [duration, setDuration] = useState<number | null>(null);
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [brightness, setBrightness] = useState(1);
  const [overlay, setOverlay] = useState<Overlay>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playingRef = useRef(false);
  const durationRef = useRef<number | null>(null);
  const brightnessRef = useRef(1);
  const gestureRef = useRef<GestureState | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const overlayTimerRef = useRef<number | null>(null);
  const clickRef = useRef<ClickChain>({ at: 0, x: 0, y: 0, count: 0, region: 'center', timer: null });

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  /** 播放中才排自动隐藏；暂停时控制条常显。 */
  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (!playingRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, [clearHideTimer]);

  /** 唤醒控制条并重置隐藏计时（鼠标移动/触摸/按键/控制条交互共用）。 */
  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const clearOverlayTimer = useCallback(() => {
    if (overlayTimerRef.current !== null) {
      window.clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
  }, []);

  /** 短时浮层（双击 seek 等离散反馈）。 */
  const flashOverlay = useCallback(
    (next: NonNullable<Overlay>, ms = 700) => {
      clearOverlayTimer();
      setOverlay(next);
      overlayTimerRef.current = window.setTimeout(() => {
        overlayTimerRef.current = null;
        setOverlay(null);
      }, ms);
    },
    [clearOverlayTimer],
  );

  // ---- 媒体事件：元数据/时间/缓冲/播放态/音量/倍速 ----
  // 直连 URL 后本地/缓存场景 metadata 事件可能在监听生效前已 fire——
  // 挂载即同步读值（幂等），事件监听兜底后续变化。
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const syncMeta = () => {
      const nextDuration = Number.isFinite(v.duration) ? v.duration : null;
      setDuration(nextDuration);
      durationRef.current = nextDuration;
      if (v.videoWidth > 0) setResolution({ w: v.videoWidth, h: v.videoHeight });
    };
    const syncTime = () => setCurrentTime(v.currentTime);
    const syncBuffered = () => {
      const ranges = v.buffered;
      setBufferedEnd(ranges.length > 0 ? ranges.end(ranges.length - 1) : 0);
    };
    const syncPlaying = () => {
      playingRef.current = !v.paused;
      setPlaying(!v.paused);
    };
    const syncVolume = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const syncRate = () => setRate(v.playbackRate);

    syncMeta();
    syncTime();
    syncBuffered();
    syncPlaying();
    syncVolume();
    syncRate();

    v.addEventListener('loadedmetadata', syncMeta);
    v.addEventListener('durationchange', syncMeta);
    v.addEventListener('resize', syncMeta);
    v.addEventListener('timeupdate', syncTime);
    v.addEventListener('progress', syncBuffered);
    v.addEventListener('play', syncPlaying);
    v.addEventListener('pause', syncPlaying);
    v.addEventListener('ended', syncPlaying);
    v.addEventListener('volumechange', syncVolume);
    v.addEventListener('ratechange', syncRate);
    return () => {
      v.removeEventListener('loadedmetadata', syncMeta);
      v.removeEventListener('durationchange', syncMeta);
      v.removeEventListener('resize', syncMeta);
      v.removeEventListener('timeupdate', syncTime);
      v.removeEventListener('progress', syncBuffered);
      v.removeEventListener('play', syncPlaying);
      v.removeEventListener('pause', syncPlaying);
      v.removeEventListener('ended', syncPlaying);
      v.removeEventListener('volumechange', syncVolume);
      v.removeEventListener('ratechange', syncRate);
    };
  }, [url]);

  // 播放态变化：播放中排自动隐藏，暂停常显
  useEffect(() => {
    if (playing) {
      scheduleHide();
    } else {
      clearHideTimer();
      setControlsVisible(true);
    }
  }, [playing, scheduleHide, clearHideTimer]);

  // 全屏/PiP 能力与状态
  useEffect(() => {
    setPipSupported(typeof document !== 'undefined' && document.pictureInPictureEnabled === true);
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // 卸载清理全部计时器
  useEffect(
    () => () => {
      clearHideTimer();
      clearHoldTimer();
      clearOverlayTimer();
      if (clickRef.current.timer !== null) window.clearTimeout(clickRef.current.timer);
    },
    [clearHideTimer, clearHoldTimer, clearOverlayTimer],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const seekTo = useCallback((time: number) => {
    const v = videoRef.current;
    if (!v) return;
    const max = Number.isFinite(v.duration) ? v.duration : time;
    const next = clamp(time, 0, max);
    v.currentTime = next;
    setCurrentTime(next);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  }, []);

  const togglePip = useCallback(() => {
    const v = videoRef.current;
    if (!v || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void v.requestPictureInPicture().catch(() => undefined);
  }, []);

  // ---- 键盘（仅播放器自身聚焦时生效，避免与控制钮/菜单按键串扰）----
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== stageRef.current) return;
    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        togglePlay();
        wakeControls();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekTo((videoRef.current?.currentTime ?? 0) - KEY_SEEK_SECONDS);
        wakeControls();
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekTo((videoRef.current?.currentTime ?? 0) + KEY_SEEK_SECONDS);
        wakeControls();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        toggleMute();
        wakeControls();
        break;
      default:
        break;
    }
  };

  // ---- 手势：单击/双击/长按/滑动 ----

  /** 单击延迟判定：250ms 内没有第二击才切换控制条显隐。 */
  const handleTap = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const region = seekRegion(clientX - rect.left, rect.width);
      const next = { at: performance.now(), x: clientX, y: clientY, region };
      const prev = clickRef.current;
      if (prev.timer !== null) window.clearTimeout(prev.timer);
      const count = isClickChain(prev.count > 0 ? prev : null, next) ? prev.count + 1 : 1;

      if (count === 1) {
        clickRef.current = {
          ...next,
          count,
          timer: window.setTimeout(() => {
            clickRef.current.timer = null;
            setControlsVisible((visible) => !visible);
            scheduleHide();
          }, CLICK_DELAY_MS),
        };
        return;
      }

      clickRef.current = { ...next, count, timer: null };

      if (region === 'center') {
        togglePlay();
        wakeControls();
        return;
      }

      const step = seekIncrementForCount(count);
      if (step <= 0) return;
      const v = videoRef.current;
      const dir = region === 'left' ? -1 : 1;
      const base = v?.currentTime ?? 0;
      const max = v && Number.isFinite(v.duration) ? v.duration : base;
      seekTo(applySeekStep(base, dir * step, max));
      // 浮层提示「本次连击序列累计」的跳转量（第 3 击显示 -20s）
      flashOverlay({ kind: 'seek', delta: dir * seekStepForCount(count) });
    },
    [flashOverlay, scheduleHide, seekTo, togglePlay, wakeControls],
  );

  const onGesturePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    const v = videoRef.current;
    if (!v) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stageRef.current?.focus({ preventScroll: true });
    clearHideTimer();
    // 新手势开始：取消尚未落地的单击显隐（避免拖拽过程中控制条突现/突隐）
    if (clickRef.current.timer !== null) {
      window.clearTimeout(clickRef.current.timer);
      clickRef.current.timer = null;
    }
    const gesture: GestureState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startAt: performance.now(),
      baseTime: v.currentTime,
      baseBrightness: brightnessRef.current,
      baseRate: v.playbackRate || 1,
      mode: 'pending',
      moved: false,
    };
    gestureRef.current = gesture;
    // 长按：无位移持续 500ms → 2x 倍速
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      const current = gestureRef.current;
      if (!current || current.mode !== 'pending' || current.moved) return;
      current.mode = 'hold';
      if (videoRef.current) videoRef.current.playbackRate = 2;
      setOverlay({ kind: 'rate', rate: 2 });
    }, LONG_PRESS_MS);
  };

  const onGesturePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const v = videoRef.current;
    if (!v) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;

    if (gesture.mode === 'hold') {
      gesture.moved = true;
      return;
    }

    if (gesture.mode === 'pending') {
      if (Math.hypot(dx, dy) > HOLD_TOLERANCE_PX) gesture.moved = true;
      const kind = classifyDrag(dx, dy);
      if (!kind) return;
      gesture.moved = true;
      clearHoldTimer();
      gesture.mode = kind;
      // 手势期间收起控制条，沉浸
      setControlsVisible(false);
      clearHideTimer();
    }

    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (gesture.mode === 'brightness') {
      const value = brightnessForDrag(gesture.baseBrightness, dy, rect.height);
      brightnessRef.current = value;
      setBrightness(value);
      setOverlay({ kind: 'brightness', value });
    } else if (gesture.mode === 'seek') {
      const target = seekTargetForDrag(gesture.baseTime, dx, durationRef.current ?? v.duration);
      // 实时提交：video.currentTime 支持边拖边写，观感即拖即到
      v.currentTime = target;
      setCurrentTime(target);
      setOverlay({ kind: 'scrub', time: target, delta: target - gesture.baseTime });
    }
  };

  const finishGesture = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    clearHoldTimer();

    if (gesture.mode === 'hold') {
      if (videoRef.current) videoRef.current.playbackRate = gesture.baseRate;
      setOverlay(null);
    } else if (gesture.mode === 'brightness') {
      // 亮度保留；浮层淡出
      setOverlay(null);
    } else if (gesture.mode === 'seek') {
      setOverlay(null);
    } else if (!cancelled) {
      handleTap(e.clientX, e.clientY);
    }

    // 暂停时控制条常显（与播放态的自动隐藏策略一致）
    if (!playingRef.current) setControlsVisible(true);
    scheduleHide();
  };

  const durationSafe = duration ?? 0;
  const bufferedPercent = durationSafe > 0 ? clamp((bufferedEnd / durationSafe) * 100, 0, 100) : 0;
  const volumeIcon = muted || volume === 0 ? VolumeXIcon : volume < 0.5 ? Volume1Icon : Volume2Icon;
  const VolumeIcon = volumeIcon;

  return (
    <DecoderShell
      main={
        <div
          ref={stageRef}
          tabIndex={0}
          role="region"
          aria-label={`视频播放器：${name}`}
          data-fv-video-stage="true"
          data-playing={playing ? 'true' : 'false'}
          className={`relative h-full w-full overflow-hidden outline-none select-none ${
            controlsVisible ? '' : 'cursor-none'
          }`}
          onKeyDown={onKeyDown}
          onPointerMove={() => {
            if (!gestureRef.current) wakeControls();
          }}
        >
          <video
            ref={videoRef}
            src={url}
            playsInline
            autoPlay
            preload="metadata"
            aria-label={name}
            data-fv-video="true"
            data-rate={rate}
            data-current-time={currentTime.toFixed(2)}
            className="h-full w-full object-contain"
            style={{ filter: `brightness(${brightness})` }}
          />

          {/* 手势层：整套指针手势（触摸/鼠标同源）；控制条与中央钮在更高层，不会误触 */}
          <div
            className="absolute inset-0 touch-none"
            data-fv-gesture="true"
            onPointerDown={onGesturePointerDown}
            onPointerMove={onGesturePointerMove}
            onPointerUp={(e) => finishGesture(e, false)}
            onPointerCancel={(e) => finishGesture(e, true)}
            onDoubleClick={(e) => e.preventDefault()}
          />

          {/* 亮度左侧微条：手势调节时可见，指示当前亮度百分比 */}
          {overlay?.kind === 'brightness' ? (
            <div
              className="pointer-events-none absolute top-1/2 left-3 z-20 flex -translate-y-1/2 flex-col items-center gap-2"
              data-fv-brightness={Math.round(overlay.value * 100)}
            >
              <div className="glass-control flex flex-col items-center gap-2 rounded-xl bg-background/85 px-2 py-2.5">
              <SunIcon className="size-4 text-foreground/80" aria-hidden />
              <div className="flex h-24 w-1.5 flex-col justify-end overflow-hidden rounded-full bg-foreground/15">
                <div
                  className="w-full rounded-full bg-primary transition-[height]"
                  style={{
                    height: `${clamp(((overlay.value - BRIGHTNESS_MIN) / (BRIGHTNESS_MAX - BRIGHTNESS_MIN)) * 100, 0, 100)}%`,
                  }}
                />
              </div>
              <span className="text-[11px] font-medium tabular-nums text-foreground/80">
                {Math.round(overlay.value * 100)}%
              </span>
              </div>
            </div>
          ) : null}

          {/* 中央手势浮层（玻璃小卡） */}
          {overlay && overlay.kind !== 'brightness' ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div
                className="glass-control flex items-center gap-2 rounded-xl bg-background/70 px-4 py-2 text-sm font-medium text-foreground"
                data-fv-overlay={overlay.kind}
              >
                {overlay.kind === 'seek' ? (
                  <>
                    {overlay.delta < 0 ? (
                      <RotateCcwIcon className="size-5" aria-hidden />
                    ) : (
                      <RotateCwIcon className="size-5" aria-hidden />
                    )}
                    <span className="tabular-nums">{formatSeekDelta(overlay.delta)}</span>
                  </>
                ) : overlay.kind === 'scrub' ? (
                  <>
                    <FastForwardIcon className="size-5" aria-hidden />
                    <span className="tabular-nums">{formatDuration(overlay.time)}</span>
                    <span className="text-xs tabular-nums text-foreground/70">
                      {formatSeekDelta(overlay.delta)}
                    </span>
                  </>
                ) : (
                  <>
                    <FastForwardIcon className="size-5" aria-hidden />
                    <span>{overlay.rate}× 快进播放</span>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {/* 中央大播放/暂停钮 */}
          <div
            className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-200 ${
              controlsVisible && overlay === null ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <Button
              variant="ghost"
              size="icon-lg"
              data-fv-play-toggle="true"
              aria-label={playing ? '暂停' : '播放'}
              className={`size-16 rounded-full border-0 bg-background/70 text-foreground glass-control hover:bg-background/80 ${
                controlsVisible && overlay === null ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
              onClick={togglePlay}
            >
              {playing ? <PauseIcon className="size-7" aria-hidden /> : <PlayIcon className="size-7" aria-hidden />}
            </Button>
          </div>

          {/* 底部控制条 */}
          <div
            className={`absolute inset-x-0 bottom-0 z-30 px-3 pb-3 transition-opacity duration-200 ${
              controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            data-fv-controls="true"
            data-visible={controlsVisible ? 'true' : 'false'}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => {
              clearHideTimer();
              setControlsVisible(true);
            }}
            onPointerLeave={scheduleHide}
            onPointerMove={() => {
              clearHideTimer();
            }}
          >
            <div className="glass-control rounded-xl bg-background/85 px-3 py-2">
              {/* 进度：缓冲带在下层，官方 Slider 在上层 */}
              <div className="flex items-center gap-3">
                <span className="w-11 text-right text-xs tabular-nums text-foreground/70">
                  {formatDuration(currentTime)}
                </span>
                <div className="relative flex-1" data-fv-progress="true">
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-foreground/25"
                      data-fv-buffered={Math.round(bufferedPercent)}
                      style={{ width: `${bufferedPercent}%` }}
                    />
                  </div>
                  <Slider
                    aria-label="播放进度"
                    value={currentTime}
                    min={0}
                    max={durationSafe > 0 ? durationSafe : 1}
                    step={0.01}
                    className="relative z-10 [&_[data-slot=slider-track]]:bg-transparent"
                    onValueChange={(value) => {
                      seekTo(typeof value === 'number' ? value : 0);
                      clearHideTimer();
                    }}
                  />
                </div>
                <span className="w-11 text-xs tabular-nums text-foreground/70">
                  {duration === null ? '--:--' : formatDuration(duration)}
                </span>
              </div>

              {/* 按钮行 */}
              <div className="mt-1 flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={playing ? '暂停' : '播放'}
                  data-fv-play-bar="true"
                  onClick={togglePlay}
                >
                  {playing ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={muted ? '取消静音' : '静音'}
                  onClick={toggleMute}
                >
                  <VolumeIcon aria-hidden />
                </Button>
                <div className="hidden w-20 items-center sm:flex">
                  <Slider
                    aria-label="音量"
                    value={muted ? 0 : volume}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={(value) => {
                      const v = videoRef.current;
                      if (!v) return;
                      const next = typeof value === 'number' ? value : 0;
                      v.volume = next;
                      v.muted = next === 0;
                    }}
                  />
                </div>

                <div className="ml-auto flex items-center gap-0.5">
                  <DropdownMenu
                    onOpenChange={(open) => {
                      if (open) {
                        setControlsVisible(true);
                        clearHideTimer();
                      } else {
                        scheduleHide();
                      }
                    }}
                  >
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 min-w-11 px-2 text-xs tabular-nums"
                          aria-label="播放速度"
                        />
                      }
                    >
                      {rate}×
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="top" className="min-w-28">
                      <DropdownMenuRadioGroup
                        value={String(rate)}
                        onValueChange={(value) => {
                          const v = videoRef.current;
                          if (!v) return;
                          const next = Number(value);
                          if (!Number.isFinite(next)) return;
                          v.playbackRate = next;
                          setRate(next);
                        }}
                      >
                        {RATES.map((option) => (
                          <DropdownMenuRadioItem key={option} value={String(option)} closeOnClick>
                            {option}×
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {pipSupported ? (
                    <Button variant="ghost" size="icon-sm" aria-label="画中画" onClick={togglePip}>
                      <PictureInPicture2Icon aria-hidden />
                    </Button>
                  ) : null}

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={fullscreen ? '退出全屏' : '全屏'}
                    onClick={toggleFullscreen}
                  >
                    {fullscreen ? <MinimizeIcon aria-hidden /> : <MaximizeIcon aria-hidden />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      }
      footer={
        <>
          <InfoItem label="时长" value={duration === null ? '…' : formatDuration(duration)} />
          <InfoItem
            label="分辨率"
            value={resolution ? `${resolution.w} × ${resolution.h}` : '…'}
          />
          {size !== null && size !== undefined ? (
            <InfoItem label="体积" value={formatBytes(size)} />
          ) : bytes.byteLength > 0 ? (
            <InfoItem label="体积" value={formatBytes(bytes.byteLength)} />
          ) : null}
          <InfoItem label="类型" value={normalizeMime(mime) || '未知'} />
        </>
      }
    />
  );
}
