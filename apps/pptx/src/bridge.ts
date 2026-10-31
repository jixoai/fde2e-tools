/*
 * PPTist Vue 岛桥 —— apps/pptx/src/bridge.ts
 *
 * 职责：dynamic import 整个 PPTist（大库懒加载独立 chunk，体积纪律）→ 在
 * React 外框的容器里 createApp 挂载 vendored App.vue（boot 配方与上游 main.ts
 * 逐字同形：prosemirror css / animate.css / 三份 scss / Directive / pinia）→
 * 暴露 Pinia store 与 useExport/useImport 编程面（AI 与 WebMCP 的唯一驱动通道；
 * vendored 源码零改动）。
 *
 * 注意：本文件是本仓胶水层（非 vendored），与 PPTist 状态强耦合——按 AGPL 隔离
 * 纪律与 apps/pptx/README.md 一并视为 AGPL 侧代码。
 */

/* ---------- vendored 编程面的结构化最小面（仅声明 glue 实际消费的字段） ---------- */

export type StatusSink = (msg: string, kind: "ok" | "error" | "warn") => void;

export interface PPTTextElement {
  type: "text";
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
  content: string;
  defaultFontName?: string;
  defaultColor?: string;
  bold?: boolean;
  lineHeight?: number;
  outline?: unknown;
  textType?: string;
  vAlign?: string;
  [key: string]: unknown;
}

export type PPTElement = PPTTextElement | ({ type: string; id: string; left: number; top: number; width: number; height: number; rotate: number } & Record<string, unknown>);

export interface PPTSlide {
  id: string;
  elements: PPTElement[];
  fill?: string;
  background?: unknown;
  note?: string;
  [key: string]: unknown;
}

export interface SlidesStoreApi {
  title: string;
  slides: PPTSlide[];
  slideIndex: number;
  viewportSize: number;
  viewportRatio: number;
  currentSlide: PPTSlide;
  setSlides(slides: PPTSlide[]): void;
  addSlide(slide: PPTSlide | PPTSlide[]): void;
  updateSlide(props: Partial<PPTSlide>, slideId?: string): void;
  deleteSlide(slideId: string | string[]): void;
  updateSlideIndex(index: number): void;
  addElement(element: PPTElement | PPTElement[]): void;
  updateElement(data: { id: string | string[]; props: Record<string, unknown>; slideId?: string }): void;
  removeSlideProps(data: { id: string; propName: string | string[] }): void;
  $patch(state: Partial<{ title: string }>): void;
}

export interface ExportApi {
  exporting: { value: boolean };
  exportPPTX(slides: PPTSlide[], masterOverwrite: boolean, ignoreMedia: boolean): Promise<void> | void;
}

export interface ImportApi {
  exporting: { value: boolean };
  importPPTXFile(files: FileList | File[], options?: { cover?: boolean; fixedViewport?: boolean }): void;
}

/* ---------- 动态加载 PPTist 岛 ---------- */

interface PPTistModules {
  slides: SlidesStoreApi;
  export: ExportApi;
  import: ImportApi;
  /** 语义钩子（useCreateElement/createTextElement 同形）暂只走自建元素工厂 */
  ready: true;
}

let islandPromise: Promise<PPTistModules> | null = null;
let island: PPTistModules | null = null;

/**
 * 挂载 PPTist 岛（单例；StrictMode 双跑安全）。boot 配方＝上游 src/main.ts
 * 逐字（除了入口挂载点由 React 外框给定）。
 */
export function mountPPTist(container: HTMLElement, onStatus: StatusSink): Promise<PPTistModules> {
  if (islandPromise) return islandPromise;
  islandPromise = (async () => {
    onStatus("正在加载幻灯编辑器内核（PPTist，首次约 2-4 秒）…", "ok");
    const { createApp } = await import("vue");
    const { createPinia } = await import("pinia");
    // 上游 src/main.ts 同款 boot 配方（逐字：全局样式三份 scss + Directive + pinia）
    await import("prosemirror-view/style/prosemirror.css");
    await import("animate.css");
    await import("./pptist/assets/styles/prosemirror.scss");
    await import("./pptist/assets/styles/global.scss");
    await import("./pptist/assets/styles/font.scss");
    const directiveMod = await import("./pptist/directive");
    const { default: PPTistApp } = await import("./pptist/App.vue");
    const { useSlidesStore, useMainStore, useSnapshotStore } = await import("./pptist/store");
    const useExport = (await import("./pptist/hooks/useExport")).default;
    const useImport = (await import("./pptist/hooks/useImport")).default;

    const app = createApp(PPTistApp);
    app.use(directiveMod.default);
    const pinia = createPinia();
    app.use(pinia);
    app.mount(container);

    // pinia 安装后 store/hook 在组件外可用（useExport 内部 useSlidesStore 同 pinia）
    const slides = useSlidesStore(pinia);
    void useMainStore(pinia);
    void useSnapshotStore(pinia);
    const exportApi = useExport();
    const importApi = useImport();

    island = {
      slides: slides as unknown as SlidesStoreApi,
      export: exportApi as unknown as ExportApi,
      import: importApi as unknown as ImportApi,
      ready: true,
    };
    // 初始 deck 落定门：App.vue onMounted 异步载 mock（setSlides），就绪信号
    // 必须等「deck 非空且长度稳定」——否则 status 先报就绪、写入与 mock 载入
    // 竞态（add_slide 空画布分支/sample 重置被 mock 覆盖，绿门实证 4≠3）。
    const settleDeadline = Date.now() + 30000;
    let lastLen = -1;
    while (Date.now() < settleDeadline) {
      const len = slides.slides.length;
      if (len > 0 && len === lastLen) break;
      lastLen = len;
      await new Promise((r) => setTimeout(r, 150));
    }
    onStatus("幻灯编辑器就绪：画布可直接编辑，AI 可经 WebMCP 驱动 store。", "ok");
    return island;
  })();
  return islandPromise;
}

export function getIsland(): PPTistModules | null {
  return island;
}

/** 就绪等待（未就绪超时显式失败——禁静默失败，与 univer-write-gate 同语义） */
export async function withPPTist<T>(fn: (m: PPTistModules) => Promise<T> | T, timeoutMs = 60000): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (island) break;
    if (Date.now() > deadline) {
      return { ok: false, error: "幻灯编辑器尚未就绪（内核加载中），命令已拒绝——请稍后重试" };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  try {
    return { ok: true, value: await fn(island) };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}

/* ---------- 语义元素工厂（store 驱动的 add_slide/set_title/add_bullets 用） ---------- */

let elSeq = 0;
function newId(): string {
  elSeq += 1;
  return `fde2e${Date.now().toString(36).slice(-5)}${elSeq.toString(36)}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const VIEWPORT_SIZE = 1000; // PPTist viewportSize 基数（默认 1000）
export const VIEWPORT_RATIO = 0.5625; // 16:9

/** 标题元素（画布基数 1000 宽；与 useCreateElement.createTextElement 同 schema） */
export function buildTitleElement(text: string): PPTTextElement {
  return {
    type: "text",
    id: newId(),
    left: 100,
    top: 120,
    width: 800,
    height: 64,
    rotate: 0,
    content: `<p>${escapeHtml(text)}</p>`,
    defaultColor: "#1f2937",
    defaultFontName: "",
    bold: true,
    lineHeight: 1.2,
    textType: "title",
  };
}

/** 要点列表元素（每行一个 • 前缀段落，与 digest 实调通过的形态一致） */
export function buildBulletsElement(items: string[], top: number): PPTTextElement {
  const lis = items.map((it) => `<p>• ${escapeHtml(it)}</p>`).join("");
  const height = Math.max(60, items.length * 36 + 16);
  return {
    type: "text",
    id: newId(),
    left: 100,
    top,
    width: 800,
    height,
    rotate: 0,
    content: lis,
    defaultColor: "#374151",
    defaultFontName: "",
    lineHeight: 1.4,
    textType: "content",
  };
}

/** 空白页元素（PPTist 惯例 fill 白底） */
export function buildBlankSlide(): PPTSlide {
  return { id: newId(), fill: "#ffffff", elements: [] };
}

/** slide 内已用区域的最低底部（add_bullets 自动排版用） */
export function slideContentBottom(slide: PPTSlide): number {
  let bottom = 180;
  for (const el of slide.elements) {
    if (el.type === "text") bottom = Math.max(bottom, el.top + el.height);
  }
  return bottom;
}
