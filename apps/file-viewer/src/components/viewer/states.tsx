/**
 * 壳级状态视图 —— src/components/viewer/states.tsx
 *
 * 三类非解码器状态（禁白屏纪律）：
 * - ContractErrorState：URL 契约不合法（缺 url / 非绝对地址 / 非 http(s)）——
 *   附 #ai-guide 页内说明（智能体空参/错参进站时的自发现面，本仓工具族惯例）；
 * - LoadErrorState：fetch 非 2xx / 网络错——重试＋直链下载；
 * - ViewerLoadingState：字节拉取与解码器 chunk 加载期骨架。
 */
import { CloudOffIcon, FileXIcon, RefreshCwIcon } from 'lucide-react';
import { AiGuide } from '@fde2e-tools/shared/ai-guide';
import { Button } from '@fde2e-tools/shared/ui/button';
import { Skeleton } from '@fde2e-tools/shared/ui/skeleton';
import { DECODERS } from '@/decoders/registry';

/** 居中卡纸态的公共骨架（E2E 标记：data-viewer-error——壳级错误态统一可断言）。 */
function StatePane({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center" data-viewer-error="true">
      {children}
    </div>
  );
}

function StateIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-control flex size-16 items-center justify-center rounded-2xl">
      {children}
    </div>
  );
}

/* ---- #ai-guide（页内智能体用法说明）------------------------------------
 * 示例链接升级为绝对地址（img-tool 同款），示例文件＝同源 /demo 夹具（public/
 * demo 随构建迁出，零 CORS 依赖即可体验各解码器）；解码器 id 清单从解码器
 * 注册表单源枚举（ai-guide 不手抄第二份）。 */
const ABS_BASE =
  typeof window === 'undefined' || window.location.origin === 'null'
    ? ''
    : window.location.origin + window.location.pathname;

const DEMO_FILES = [
  { file: 'demo/欢迎.md', label: 'Markdown' },
  { file: 'demo/数据.csv', label: 'CSV' },
  { file: 'demo/配置.json', label: 'JSON' },
  { file: 'demo/图标.svg', label: 'SVG' },
];

/** 同源夹具的预览链接：/?url=<encodeURIComponent(夹具绝对URL)>（契约原样拼装）。 */
function demoPreviewLink(file: string): string {
  return `${ABS_BASE}?url=${encodeURIComponent(`${ABS_BASE}${file}`)}`;
}

/** 解码器 id 清单（注册表单源枚举，与解码器 Select 同源）。 */
const DECODER_ID_LIST = DECODERS.map((d) => d.id).join(' ');

const AI_GUIDE_TEXT = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是「通用文件预览」纯静态工具：零后端、零上传——浏览器按 URL 契约直接拉取文件并在本地渲染。

URL 契约（打开即预览，三参数）：
/?url=<encodeURIComponent(绝对URL)>&name=<显示名>&decoder=<解码器id>
1. url（必填）：文件绝对 URL（http/https），encodeURIComponent 编码后放入。
2. name（可选）：显示名；缺省取 URL 路径末段（影响解码判定与下载命名）。
3. decoder（可选）：强制解码器 id（未登记 id 视为无效，回自动判定）。
   自动判定顺序：扩展名 > Content-Type > 文本兜底（未支持格式不渲染乱码，呈「未支持＋下载」态）。
   解码器 id 清单（14 个）：${DECODER_ID_LIST}
   （text 支持编码切换：UTF-8 / auto / GBK / Big5 / Shift_JIS / Latin-1。）

示例链接（同源 /demo 夹具，零 CORS 依赖，直接可开）：
`;

const AI_GUIDE_TAIL = `
备注：
- 二进制嗅探命中未支持格式时呈「未支持＋下载」态（data-viewer-error-kind=unsupported-binary），绝不渲染乱码。
- 解码器切换会回写 URL 参数（replaceState），链接保持可分享；浏览器返回键可回上一解码器。
- 「在新窗口打开原始内容」＝ 文件 URL 追加 ?raw（已带 query 则 &raw；与 omni 服务端 ?raw 契约对齐）。`;

/** 契约错误：缺 url / 非法 url——给出用法说明（站内自解释）。 */
export function ContractErrorState({ message }: { message: string }) {
  return (
    <StatePane>
      <StateIcon>
        <FileXIcon className="size-7 text-muted-foreground" aria-hidden />
      </StateIcon>
      <div className="space-y-1.5">
        <p className="font-medium">预览地址不合法</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        <p className="max-w-md font-mono text-xs text-muted-foreground/80">
          /?url=&lt;encodeURIComponent(绝对URL)&gt;&amp;name=&lt;显示名&gt;&amp;decoder=&lt;解码器id&gt;
        </p>
      </div>
      {/* ai-guide 嵌在契约错误态：whitespace-pre-wrap 下换行缩进需以 {string}
          表达式传入（shared/ai-guide.tsx 头注约定），示例链接用 JSX <a> */}
      <div className="w-full max-w-2xl text-left">
        <AiGuide>
          {AI_GUIDE_TEXT}
          {DEMO_FILES.map(({ file, label }, i) => (
            <span key={file}>
              {i > 0 && '\n'}
              {`- ${label}: `}
              <a href={demoPreviewLink(file)}>{demoPreviewLink(file)}</a>
            </span>
          ))}
          {AI_GUIDE_TAIL}
        </AiGuide>
      </div>
    </StatePane>
  );
}

/** 加载失败：网络错/非 2xx——重试＋直链下载（直链 = 原始 url，浏览器自己处理）。 */
export function LoadErrorState({
  message,
  status,
  url,
  onRetry,
}: {
  message: string;
  status?: number;
  url: string;
  onRetry: () => void;
}) {
  return (
    <StatePane>
      <StateIcon>
        <CloudOffIcon className="size-7 text-muted-foreground" aria-hidden />
      </StateIcon>
      <div className="space-y-1.5">
        <p className="font-medium">文件加载失败</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {status ? `服务端返回 HTTP ${status}` : message}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onRetry}>
          <RefreshCwIcon data-icon="inline-start" aria-hidden />
          重试
        </Button>
        <Button variant="outline" render={<a href={url} download="true" />}>
          直链下载
        </Button>
      </div>
    </StatePane>
  );
}

/** 加载期骨架：顶栏占位＋主体脉冲。 */
export function ViewerLoadingState() {
  return (
    <div className="flex h-full flex-col gap-3 p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-7 w-40 rounded-md" />
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="size-7 rounded-md" />
      </div>
      <div className="glass-control flex flex-1 items-center justify-center rounded-xl">
        <div className="w-full max-w-lg space-y-3 px-6">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    </div>
  );
}
