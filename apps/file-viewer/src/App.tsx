/**
 * 布局壳 —— src/App.tsx
 *
 * 流程（规格）：解析 URL 契约 → fetch 原始字节（omni CORS）→ resolveDecoder
 * → 顶栏 + Suspense 懒加载解码器。解码器切换经 URL 参数回写（replaceState），
 * 链接保持可分享；重试只重拉字节，不重解析契约。
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ViewerTopBar } from '@/components/viewer/TopBar';
import { ContractErrorState, LoadErrorState, ViewerLoadingState } from '@/components/viewer/states';
import { resolveDecoder, shouldStreamDirect, type DecoderFile } from '@/decoders/registry';
import { applySearchParam, parseViewerSearch } from '@/lib/viewer-url';
import { registerAppTools } from './webmcp';

/** 字节拉取结果（与契约分离：decoder 参数变化不重拉）。 */
interface Fetched {
  url: string;
  mime: string;
  bytes: Uint8Array;
  /** 文件体积（整载 = bytes.byteLength；直连路径来自 HEAD，未知为 null） */
  size: number | null;
}

type LoadPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string; status?: number }
  | { kind: 'ready'; fetched: Fetched };

/** 直连流式 HEAD 预检的超时上限（静态服务毫秒级应答；超时按字段缺省继续，不阻塞预览）。 */
const STREAM_HEAD_TIMEOUT_MS = 4000;

export default function App() {
  const [search, setSearch] = useState(() => window.location.search);
  const [phase, setPhase] = useState<LoadPhase>({ kind: 'idle' });
  const [nonce, setNonce] = useState(0);

  const parsed = useMemo(() => parseViewerSearch(search), [search]);
  const targetUrl = 'error' in parsed ? null : parsed.url;
  const forcedDecoder = 'error' in parsed ? undefined : parsed.forcedDecoder;

  // 浏览器返回键（popstate）同步 search 态
  useEffect(() => {
    const onPop = () => setSearch(window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // WebMCP：preview_file（原生或官方 polyfill，均幂等；写 URL 即渲染——
  // pushState + popstate 与上面返回键同步通路复用）
  useEffect(() => {
    void registerAppTools();
  }, []);

  // 字节拉取：只依赖 url、forcedDecoder 与重试 nonce（name 变化不触发）。
  // forcedDecoder 在依赖里：强制解码器变化会改变拉取策略（媒体直连 vs 整载），
  // 不重拉会留下与新策略不符的旧字节（如 video 文件先直连后强制 text → 空文本）。
  useEffect(() => {
    const target = 'error' in parsed ? null : parsed;
    if (targetUrl === null || target === null) return;
    let cancelled = false;
    setPhase({ kind: 'loading' });
    void (async () => {
      // 大媒体直连流式（视频/音频）：不做整载 fetch——数百 MB 级媒体整载进
      // arrayBuffer 会压垮标签页内存；解码器直接拿原始 URL 喂 <video>/<audio>，
      // 天然吃服务端 Range（拖进度零全量）。这里只做 HEAD 预检补 mime/体积
      // （顶栏徽标与解码判定用）；HEAD 不支持/超时按字段缺省继续，不阻塞预览。
      if (shouldStreamDirect(target.name, target.forcedDecoder)) {
        let mime = '';
        let size: number | null = null;
        try {
          const head = await fetch(targetUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(STREAM_HEAD_TIMEOUT_MS),
          });
          if (head.ok) {
            mime = head.headers.get('content-type') ?? '';
            const len = Number(head.headers.get('content-length'));
            if (Number.isFinite(len) && len > 0) size = len;
          }
        } catch {
          // HEAD 失败：mime/体积缺省，直连播放不受影响
        }
        if (cancelled) return;
        setPhase({
          kind: 'ready',
          fetched: { url: targetUrl, mime, bytes: new Uint8Array(0), size },
        });
        return;
      }
      try {
        const resp = await fetch(targetUrl);
        if (!resp.ok) {
          if (!cancelled) setPhase({ kind: 'error', status: resp.status, message: '' });
          return;
        }
        const buffer = await resp.arrayBuffer();
        if (cancelled) return;
        setPhase({
          kind: 'ready',
          fetched: {
            url: targetUrl,
            mime: resp.headers.get('content-type') ?? '',
            bytes: new Uint8Array(buffer),
            size: buffer.byteLength,
          },
        });
      } catch (err) {
        if (!cancelled) {
          setPhase({ kind: 'error', message: err instanceof Error ? err.message : '网络错误' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetUrl, forcedDecoder, nonce]);

  /** 解码器切换：回写 URL 参数（保持链接可分享），不重拉字节。 */
  const handleSelectDecoder = useCallback(
    (id: string | null) => {
      const next = applySearchParam(search, 'decoder', id);
      window.history.replaceState(null, '', `${window.location.pathname}${next}`);
      setSearch(next);
    },
    [search],
  );

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  // ---- 契约错误态 ----
  if ('error' in parsed) {
    return <ContractErrorState message={parsed.error} />;
  }

  // ---- 加载/错误/就绪 ----
  return (
    <div className="flex h-full flex-col">
      {phase.kind === 'ready' ? (
        <ReadyShell
          target={parsed}
          fetched={phase.fetched}
          onSelectDecoder={handleSelectDecoder}
        />
      ) : phase.kind === 'error' ? (
        <LoadErrorState
          message={phase.message}
          status={phase.status}
          url={parsed.url}
          onRetry={retry}
        />
      ) : (
        <ViewerLoadingState />
      )}
    </div>
  );
}

/** 就绪态：顶栏（文件名/大小/解码器/动作）+ 懒加载解码器主体。 */
function ReadyShell({
  target,
  fetched,
  onSelectDecoder,
}: {
  target: { url: string; name: string; forcedDecoder?: string };
  fetched: Fetched;
  onSelectDecoder: (id: string | null) => void;
}) {
  const decoder = resolveDecoder(target.name, fetched.mime, target.forcedDecoder);
  const file: DecoderFile = {
    url: fetched.url,
    name: target.name,
    mime: fetched.mime,
    bytes: fetched.bytes,
    // 直连路径 bytes 为空数组，体积来自 HEAD 预检（顶栏徽标/媒体解码器页脚共用）
    size: fetched.size,
    depth: 0,
  };
  const DecoderComponent = decoder.component;
  return (
    <>
      <ViewerTopBar
        file={file}
        resolvedId={decoder.id}
        forcedId={target.forcedDecoder}
        onSelectDecoder={onSelectDecoder}
      />
      <main className="min-h-0 flex-1" data-decoder-root={decoder.id}>
        <Suspense fallback={<ViewerLoadingState />}>
          <DecoderComponent {...file} />
        </Suspense>
      </main>
    </>
  );
}
