/**
 * 解码器注册表 —— src/decoders/registry.ts（扩展点核心）
 *
 * 新增一个解码器只改这里（＋新建独立目录），布局壳零改动：
 *   1. 新建 `src/decoders/<id>/index.tsx`，默认导出 `React` 组件
 *      （props 见 DecoderFile，含底部工具条/信息栏——解码器自治）；
 *   2. 在 DECODERS 数组登记 { id, label, exts, mimes?, binary?, component }。
 *
 * 解析规则 resolveDecoder：forced（URL &decoder=）> 扩展名 > mime > text 兜底。
 * 注意：mime 匹配按登记顺序先到先得——前缀通配（如 image/*）的解码器必须登记在
 * 精确 mime 解码器（如 svg）之后。
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** 布局壳传给每个解码器的统一 props（字节由壳一次性 fetch）。 */
export interface DecoderFile {
  /** 原始文件 URL（顶层）或 blob: 地址（zip 条目内嵌预览） */
  url: string;
  /** 文件名（解码判定与下载命名依据） */
  name: string;
  /** 响应 Content-Type（可能为空串） */
  mime: string;
  /** 原始字节（全量；大媒体直连流式路径为空数组——见 shouldStreamDirect） */
  bytes: Uint8Array;
  /** 文件体积（字节；整载路径 = bytes.byteLength，直连路径来自 HEAD Content-Length，未知为 null） */
  size?: number | null;
  /** 内嵌预览深度（zip→zip 递归防爆；顶层为 0） */
  depth?: number;
}

export interface Decoder {
  id: string;
  /** 解码器 Select 显示名 */
  label: string;
  /** 按扩展名判定（小写，不含点） */
  exts: string[];
  /** 按响应 Content-Type 兜底判定（支持 'image/*' 前缀通配；已归一化小写） */
  mimes?: string[];
  /** 二进制解码器（信息展示用；文本兜底时不接管——兜底恒为 text） */
  binary?: boolean;
  /** React.lazy 组件——每解码器独立 chunk，按需加载 */
  component: LazyExoticComponent<ComponentType<DecoderFile>>;
}

/**
 * 登记表。顺序约定（mime 通配优先级）：svg 必须在 image 之前——无扩展名的
 * image/svg+xml 若被 image/* 先截走会进 <img>（img 上下文禁脚本其实更安全，
 * 但会禁用 svg 动画与交互，且与「svg 统一 sandbox iframe」规格不符）。
 */
export const DECODERS: Decoder[] = [
  {
    id: 'svg',
    label: 'SVG',
    exts: ['svg'],
    mimes: ['image/svg+xml'],
    binary: true,
    component: lazy(() => import('./svg')),
  },
  {
    id: 'image',
    label: '图片',
    exts: ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur', 'tif', 'tiff'],
    mimes: ['image/*'],
    binary: true,
    component: lazy(() => import('./image')),
  },
  {
    id: 'video',
    label: '视频',
    exts: ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv', 'avi'],
    mimes: ['video/*'],
    binary: true,
    component: lazy(() => import('./video')),
  },
  {
    id: 'audio',
    label: '音频',
    exts: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
    mimes: ['audio/*'],
    binary: true,
    component: lazy(() => import('./audio')),
  },
  {
    id: 'pdf',
    label: 'PDF',
    exts: ['pdf'],
    mimes: ['application/pdf'],
    binary: true,
    component: lazy(() => import('./pdf')),
  },
  {
    id: 'markdown',
    label: 'Markdown',
    exts: ['md', 'markdown', 'mdx'],
    mimes: ['text/markdown', 'text/x-markdown'],
    component: lazy(() => import('./markdown')),
  },
  {
    id: 'json',
    label: 'JSON',
    exts: ['json', 'jsonc', 'map', 'geojson', 'webmanifest', 'har'],
    mimes: ['application/json', 'application/manifest+json', 'text/json', 'application/geo+json'],
    component: lazy(() => import('./json')),
  },
  {
    id: 'csv',
    label: 'CSV',
    exts: ['csv', 'tsv'],
    mimes: ['text/csv', 'text/tab-separated-values'],
    component: lazy(() => import('./csv')),
  },
  {
    id: 'html',
    label: 'HTML',
    exts: ['html', 'htm', 'xhtml'],
    mimes: ['text/html', 'application/xhtml+xml'],
    component: lazy(() => import('./html')),
  },
  {
    id: 'docx',
    label: 'Word 文档',
    exts: ['docx'],
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    binary: true,
    component: lazy(() => import('./docx')),
  },
  {
    id: 'xlsx',
    label: 'Excel 表格',
    exts: ['xlsx', 'xlsm', 'xls'],
    mimes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ],
    binary: true,
    component: lazy(() => import('./xlsx')),
  },
  {
    id: 'pptx',
    label: 'PPT 幻灯片',
    exts: ['pptx'],
    mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    binary: true,
    component: lazy(() => import('./pptx')),
  },
  {
    id: 'zip',
    label: 'ZIP 压缩包',
    exts: ['zip'],
    mimes: ['application/zip', 'application/x-zip-compressed'],
    binary: true,
    component: lazy(() => import('./zip')),
  },
  {
    id: 'text',
    label: '文本',
    exts: ['txt', 'log', 'text', 'srt', 'vtt', 'license', 'readme'],
    mimes: ['text/*'],
    component: lazy(() => import('./text')),
  },
];

/** 兜底解码器 id：未支持格式默认走文本（二进制嗅探拦截后呈「未支持＋下载」态）。 */
export const FALLBACK_DECODER_ID = 'text';

/** 直连流式解码器集合：原始 URL 直接喂给媒体元素，不做整载 fetch。 */
export const STREAMING_DECODER_IDS = new Set(['video', 'audio']);

/**
 * 是否走「原始 URL 直连流式」路径（不经整载 fetch/blob）。
 * 判定只看扩展名/forced id（fetch 前唯一可得的信息）——视频/音频常达数百 MB，
 * 整载进 arrayBuffer 会压垮标签页内存；媒体元素直连 src 即流式播放，且天然
 * 吃服务端 Range（拖进度零全量）。zip 内嵌条目传 blob: url，直连同样成立。
 */
export function shouldStreamDirect(filename: string, forcedId?: string): boolean {
  return STREAMING_DECODER_IDS.has(resolveDecoder(filename, '', forcedId).id);
}

/** 取扩展名（小写、不含点；无扩展名/点开头/结尾点 → 空串）。 */
export function extOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** 归一化 mime：剥参数（`; charset=…`）、trim、小写。 */
export function normalizeMime(mime: string | undefined | null): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase();
}

function mimeMatches(pattern: string, mime: string): boolean {
  if (pattern.endsWith('/*')) return mime.startsWith(pattern.slice(0, -1));
  return pattern === mime;
}

/**
 * 解码器判定（规格核心）：forced > 扩展名 > mime > text 兜底。
 * forced 传入未登记的 id 时忽略（回自动判定），不报错。
 */
export function resolveDecoder(
  filename: string,
  mime: string | undefined | null,
  forcedId?: string,
): Decoder {
  if (forcedId) {
    const forced = DECODERS.find((d) => d.id === forcedId);
    if (forced) return forced;
  }
  const ext = extOf(filename);
  if (ext) {
    const byExt = DECODERS.find((d) => d.exts.includes(ext));
    if (byExt) return byExt;
  }
  const m = normalizeMime(mime);
  if (m) {
    const byMime = DECODERS.find((d) => d.mimes?.some((p) => mimeMatches(p, m)));
    if (byMime) return byMime;
  }
  return DECODERS.find((d) => d.id === FALLBACK_DECODER_ID)!;
}
