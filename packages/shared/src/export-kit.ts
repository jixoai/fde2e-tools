/*
 * 展示级导出套件 —— packages/shared/src/export-kit.ts
 *
 * 「节点 → PNG 长图」「位图序列 → PDF」的共享单源（openspec: export-pdf-png）。
 * 底层库＝pdf-tool 已 vendored 的 html2pdf.bundle.min.js（内含 html2canvas
 * 1.4.x + jsPDF；UMD 只暴露 window.html2pdf，html2canvas/jspdf 均不泄漏为全局
 * ——probe 实证——故一律走 worker API：toCanvas 取位图、prop.pdf 取 jsPDF 实例）。
 * 各站在 index.html 以普通 <script> 载入同一份副本（sha 一致，站点独立可部署）。
 *
 * - withColorGuard：oklch 色守卫（自 apps/pdf-tool/src/export-color-guard.ts
 *   通用化迁入）。TW4/solid-glass 令全元素色值走 oklch，html2canvas 1.4.x 不
 *   识别直接抛错（probe 复现：裸捕获 100% 炸）——守卫＝导出瞬间把全文档 oklch
 *   自定义属性钉成 sRGB ＋ 通配兜底，导出落定（成功或失败）后卸载恢复主题。
 *   【签名说明】任务书原形 withColorGuard(node, fn)：node 参数被裁掉——守卫是
 *   文档级注入（html2canvas 克隆整文档，任何元素的非 sRGB 计算色都会炸），
 *   传 node 是死 API，诚实删参。
 * - renderNodeToPng：整节点全高一张；超浏览器 canvas 上限 16384px 先降 scale
 *   （内容零丢失，只是变“薄”），仍超（节点本身 > 16384 css px）则截断＋把
 *   「内容过长已截断至 X px」画进产物（诚实标注）＋返回 truncated 元信息。
 * - pngsToPdf：jsPDF 每图一页（contain 适配）。jsPDF 构造器不可 new
 *   （prop.pdf.constructor = Object，probe 实证）——经一次性 probe worker 取
 *   jsPDF 文档实例，deletePage(1)（先读 pageSize 再删，删空后 pageSize getter
 *   炸 mediaBox——probe 实证）后 addPage/addImage 逐页组装，output("blob") 产出。
 * - stackPngsVertically：多张同宽 PNG 纵向拼一张长图（pptx export_long_png 用）；
 *   超上限统一降 scale（内容零丢失），低于 MIN_STACK_SCALE 才截断＋标注。
 *
 * 依赖许可：html2canvas（MIT）/ jsPDF（MIT）——记入仓库根 README 许可分区。
 */

/* ---------- oklch → sRGB（自 pdf-tool 迁入，逐字节同源） ---------- */

/** oklch(L C H [/ alpha]) → sRGB。OKLab→线性 sRGB 用标准矩阵，带 alpha 输出 rgba() */
export function oklchToCssSrgb(input: string): string | null {
  const m = input.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+(?:deg)?)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i,
  );
  if (!m) return null;
  const pct = (s: string, scale = 1) =>
    s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s);
  const L = pct(m[1]);
  const C = pct(m[2]);
  const Hdeg = m[3].endsWith("deg") ? parseFloat(m[3]) : parseFloat(m[3]);
  const alpha = m[4] !== undefined ? pct(m[4]) : 1;
  if (!isFinite(L) || !isFinite(C) || !isFinite(Hdeg)) return null;

  // oklch → oklab
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const mm = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  // OKLab → 线性 sRGB（Björn Ottosson 标准矩阵）
  let lr = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
  let lg = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
  let lb = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s;
  const gamma = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  const [r, g, bl] = [gamma(lr), gamma(lg), gamma(lb)];
  if (alpha >= 1) {
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(bl)}`;
  }
  return `rgba(${r}, ${g}, ${bl}, ${Math.round(alpha * 1000) / 1000})`;
}

interface VarBundle {
  /** 选择器原文 → 该选择器下含 oklch 的自定义属性（已转 sRGB） */
  blocks: Map<string, Map<string, string>>;
}

/**
 * 遍历全部 stylesheet（递归 media/supports 层；@layer 层内规则经 cssRules 递归
 * 不可达——CSSRule.LAYER_RULE 的 cssRules 在 type 分支外，此处按 selectorText
 * 收集不受影响），收集**任意选择器**下含 oklch 的自定义属性。
 *
 * 【export-pdf-png 扩展】原 pdf-tool 版只钉 :root/.dark——xlsx 站实测（?sample=
 * 重载后）Univer 在自家容器上定义局部主题变量（--color-foreground: oklch(...)），
 * :root 钉扎覆盖不到，wrap 子树计算色仍是 oklch，html2canvas 100% 炸。扩为
 * 「任意选择器的 oklch 变量全量钉扎」：按选择器原文逐块收集，导出时整块重发
 * （同特异性、插入在 head 末尾必胜原规则；@layer 内定义经层递归同样收集）。
 * media/supports 内的变量定义拍平收集（导出恒亮态白底，暗色偏好不影响产物）。
 */
function collectOklchVars(): VarBundle {
  const blocks: VarBundle["blocks"] = new Map();
  const visit = (rules: CSSRuleList) => {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i] as CSSRule;
      const t = rule.type as number;
      if (t === CSSRule.MEDIA_RULE || t === CSSRule.SUPPORTS_RULE || t === 11 /* LAYER_RULE（TW4 层内变量同样钉扎） */) {
        visit((rule as CSSMediaRule).cssRules);
        continue;
      }
      if (rule.type !== CSSRule.STYLE_RULE) continue;
      const style = rule as CSSStyleRule;
      const selector = style.selectorText || "";
      if (!selector) continue;
      for (let p = 0; p < style.style.length; p++) {
        const prop = style.style[p];
        if (!prop.startsWith("--")) continue;
        const value = style.style.getPropertyValue(prop);
        if (!value.includes("oklch")) continue;
        const converted = oklchToCssSrgb(value.trim());
        if (converted) {
          let vars = blocks.get(selector);
          if (!vars) {
            vars = new Map();
            blocks.set(selector, vars);
          }
          vars.set(prop, converted);
        }
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // 跨域 stylesheet 不可读——本仓产物同源，理论不发生；跳过防炸
    }
  }
  return { blocks };
}

const GUARD_ID = "fde2e-export-color-guard";
/* 通配兜底不带 !important：特异性让显式 border 简写照常生效，兜底只命中
   「没有任何显式色」的元素（其 border-color 默认 currentColor，html2canvas
   对 currentColor 沿链解析后可能仍是 oklch——钉成中性 sRGB）。 */
const WILDCARD_FALLBACK = `
*, *::before, *::after {
  border-color: #d8dde5;
  outline-color: #0f62d6;
  caret-color: #1c2330;
  accent-color: #0f62d6;
  column-rule-color: #d8dde5;
}`;

/* ---------- 导出子树的字面量 oklch 计算色内联钉扎 ---------- */

/** 需要盯的计算色属性（html2canvas 解析面） */
const SWEEP_PROPS = [
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "caret-color",
  "accent-color",
  "column-rule-color",
  "fill",
  "stroke",
  "text-decoration-color",
] as const;

/** oklch/oklab/lab/lch 计算值 → sRGB；解析不了返回 null（调用方按属性兜底） */
function anyToCssSrgb(computed: string): string | null {
  const v = computed.trim();
  if (v.startsWith("oklch(")) return oklchToCssSrgb(v);
  // oklab/lab/lch 计算值（含 color-mix(in oklab …) 归一产物）：无通用解析器，
  // 交调用方按属性兜底
  if (/^(oklab|lab|lch)\(/.test(v) || v.includes("color-mix")) return null;
  return null;
}

/** 无法转换时的中性兜底（与视觉语义就近；白底导出安全） */
const SWEEP_FALLBACK: Record<string, string> = {
  color: "#1c2330",
  "background-color": "rgba(255, 255, 255, 0)",
  "border-color": "#d8dde5",
  "outline-color": "#0f62d6",
  "caret-color": "#1c2330",
  "accent-color": "#0f62d6",
  "column-rule-color": "#d8dde5",
  fill: "#1c2330",
  stroke: "#1c2330",
  "text-decoration-color": "#1c2330",
};

/**
 * 遍历 scope 子树，把非 sRGB（oklch 族）计算色内联钉成 sRGB。
 * 【export-pdf-png 实证】变量钉扎（:root/.dark 乃至任意选择器）挡不住
 * **字面量路径**——Univer 在自家容器上定义局部主题变量/字面 oklch 规则，
 * wrap 子树计算色仍是 oklch，html2canvas 直接炸。内联样式特异性最高、
 * 随克隆复制，是唯一可靠通道；视觉无损（写回的就是解析后的同色 sRGB）。
 * 返回撤销函数（摘除全部内联覆盖，页面恢复原样）。
 */
function sweepScopeColors(scope: HTMLElement): () => void {
  const undo: Array<[HTMLElement, string]> = [];
  const targets: Array<Element> = [scope, ...scope.querySelectorAll("*")];
  for (const el of targets) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);
    for (const prop of SWEEP_PROPS) {
      const value = cs.getPropertyValue(prop);
      if (!value) continue;
      if (!/oklch|oklab|lab\(|lch\(|color-mix/.test(value)) continue;
      const converted = anyToCssSrgb(value) ?? SWEEP_FALLBACK[prop];
      el.style.setProperty(prop, converted);
      undo.push([el, prop]);
    }
  }
  return () => {
    for (let i = undo.length - 1; i >= 0; i--) {
      const [el, prop] = undo[i];
      el.style.removeProperty(prop);
      if (!el.getAttribute("style")) el.removeAttribute("style");
    }
  };
}

/**
 * 注入色守卫（导出前调用）。返回卸载函数——导出 promise 落定（成功或失败）
 * 后必须调用，恢复主题原样。守卫样式元素只建一次、缓存复用（重复导出复用
 * 同一 style 元素，仅重新置顶盖过后续注入的同特异性规则）。
 *
 * scope（可选，export-pdf-png 扩展）：导出目标子树。给定时对子树做**字面量
 * oklch 计算色内联钉扎**（变量钉扎挡不住 Univer 局部主题变量/字面量规则
 * ——probe 实证），导出后摘除内联覆盖恢复原样。
 */
export function installExportColorGuard(scope?: HTMLElement): () => void {
  const sweepUndo = scope ? sweepScopeColors(scope) : null;
  let guard = document.getElementById(GUARD_ID) as HTMLStyleElement | null;
  if (!guard) {
    const { blocks } = collectOklchVars();
    const parts: string[] = [];
    for (const [selector, vars] of blocks) {
      if (!vars.size) continue;
      const lines = [...vars.entries()].map(([k, v]) => `  ${k}: ${v};`);
      parts.push(`${selector} {\n${lines.join("\n")}\n}`);
    }
    parts.push(WILDCARD_FALLBACK);
    guard = document.createElement("style");
    guard.id = GUARD_ID;
    guard.textContent = parts.filter(Boolean).join("\n");
    document.head.appendChild(guard);
  } else {
    document.head.appendChild(guard); // 复用时置顶 head 末尾
  }
  return () => {
    guard?.remove();
    sweepUndo?.();
  };
}

/** 色守卫包住整个导出 promise（落定即卸载，成功失败都不漏）。scope 语义同上。 */
export async function withColorGuard<T>(fn: () => Promise<T>, scope?: HTMLElement): Promise<T> {
  const uninstall = installExportColorGuard(scope);
  try {
    return await fn();
  } finally {
    uninstall();
  }
}

/* ---------- vendored worker 的结构化最小面 ---------- */

interface Html2pdfWorker {
  set(opt: Record<string, unknown>): Html2pdfWorker;
  from(el: HTMLElement): Html2pdfWorker;
  toContainer(): Html2pdfWorker;
  toCanvas(): Html2pdfWorker;
  toPdf(): Html2pdfWorker;
  /** 全管线（toCanvas→toPdf）后触发浏览器下载（文件名取 opt.filename） */
  save(): Html2pdfWorker;
  output(type: string): Promise<unknown>;
  /**
   * 运行时 thenable（await worker＝等全部链式步骤落定）。类型面不声明 then——
   * TS1062（类型不得在自己的 then 回调里自引用）；调用方对步骤调用直接 await。
   */
  /** 各步骤产物（canvas/pdf/container/img） */
  prop: {
    canvas?: HTMLCanvasElement;
    pdf?: JsPdfDoc;
    container?: HTMLElement;
    img?: HTMLImageElement;
  };
  opt: {
    html2canvas?: Record<string, unknown>;
    jsPDF?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export type { Html2pdfWorker };

/**
 * 取 vendored worker（app 需要自定义管线时用——docx export_pdf 的 pagebreak
 * 分页走 .save() 全管线；xlsx 网格 PDF 走 renderNodeToPng+pngsToPdf 组合）。
 * bundle 未载入（缺 <script>）时抛人话错误。
 */
export function openHtml2pdfWorker(): Html2pdfWorker {
  return html2pdf();
}

/** jsPDF 文档实例的结构化最小面（只用公开 API；构造器不可 new——probe 实证） */
export interface JsPdfDoc {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  addPage(format: string | [number, number], orientation: string): JsPdfDoc;
  deletePage(target: number): JsPdfDoc;
  addImage(
    data: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): JsPdfDoc;
  getNumberOfPages(): number;
  output(type: "blob"): Blob;
}

function html2pdf(): Html2pdfWorker {
  const fn = (window as unknown as { html2pdf?: () => Html2pdfWorker }).html2pdf;
  if (typeof fn !== "function") {
    throw new Error("html2pdf 内核未载入（vendored bundle 缺失）——请检查页面 <script> 引入");
  }
  return fn();
}

/** blob → dataURL（jsPDF addImage 只吃 dataURL/字节） */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("blob 读取失败"));
    r.readAsDataURL(blob);
  });
}

/* ---------- 节点 → PNG 长图 ---------- */

/** 浏览器 canvas 单边上限（Chrome/Firefox/Safari 实测同值量级，取保守值） */
export const CANVAS_MAX_EDGE = 16384;

export interface PngRenderResult {
  blob: Blob;
  width: number;
  height: number;
  /** 内容被截断（节点原生高度超上限且无法再降 scale） */
  truncated: boolean;
  /** 截断时的诚实标注文案（已同时画进产物底部） */
  notice?: string;
}

/**
 * 离屏挂载助手：固定定位移出视口（非 display:none——html2canvas 需要可渲染
 * 布局）。返回卸载函数。调用方负责填内容后渲染。
 */
export function mountOffscreen(node: HTMLElement, width?: number): () => void {
  node.style.position = "fixed";
  node.style.left = "-10000px";
  node.style.top = "0";
  node.style.zIndex = "-1";
  node.style.background = "#ffffff";
  if (width) node.style.width = `${width}px`;
  document.body.appendChild(node);
  return () => node.remove();
}

/**
 * 【容器归一化】html2pdf 的容器只把克隆的 position 重置为 relative，不重置
 * left/top——调用方节点带 left:-10000（离屏挂载）时克隆整体漂出容器，容器
 * 高度塌 0，画布随之 1588×0（本轮排障实证）。这里把克隆与容器尺寸全部归一：
 * 克隆回到容器原点、容器按目标 css 尺寸定宽高（宽高调用方已知，不信 html2pdf
 * 的推断）。renderNodeToPng 与 .save() 全管线（docx 分页 PDF）共用。
 */
export function normalizeWorkerContainer(worker: Html2pdfWorker, cssWidth: number, cssHeight?: number): void {
  const containerEl = worker.prop.container;
  if (!containerEl) throw new Error("渲染失败（html2pdf 容器未创建）");
  const cloneEl = containerEl.firstElementChild as HTMLElement | null;
  if (cloneEl) {
    cloneEl.style.position = "relative";
    cloneEl.style.left = "0";
    cloneEl.style.top = "0";
    cloneEl.style.margin = "0";
    cloneEl.style.zIndex = "auto";
  }
  containerEl.style.width = `${cssWidth}px`;
  if (cssHeight !== undefined) containerEl.style.height = `${cssHeight}px`;
}

/**
 * 节点 → PNG blob（整节点全高一张）。
 * html2canvas 对 <canvas> 子元素按位图原样拷贝（1.4.x CanvasElementContainer
 * 走 drawImage——Univer 网格捕获 probe 实证可用）。
 * 上限策略：height*scale > 16384 先降 scale（保全部内容）；节点原生高度已超
 * 16384 则 scale=1 且裁高截断＋诚实标注（画进产物＋元信息双通道）。
 */
export async function renderNodeToPng(
  node: HTMLElement,
  opts: { width?: number; scale?: number; imageType?: "png" | "jpeg"; quality?: number } = {},
): Promise<PngRenderResult> {
  const rect = node.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    throw new Error("导出内容为空（节点尺寸为 0）——请确认编辑器已渲染内容");
  }
  const cssWidth = opts.width ?? Math.ceil(rect.width);
  const cssHeight = Math.ceil(rect.height);
  const requested = opts.scale ?? 2;

  let scale = requested;
  let cropHeight: number | null = null;
  let truncated = false;
  let notice: string | undefined;
  if (cssHeight * scale > CANVAS_MAX_EDGE) {
    scale = CANVAS_MAX_EDGE / cssHeight;
    if (scale < 1) {
      // 节点原生高度已超上限：scale 钉 1（再小会糊成一维条），裁高截断
      scale = 1;
      cropHeight = CANVAS_MAX_EDGE;
      truncated = true;
      notice = `内容过长已截断至 ${CANVAS_MAX_EDGE} px（原文档高 ${cssHeight} px）`;
    }
  }

  const worker = html2pdf()
    .set({
      html2canvas: {
        scale,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        scrollX: 0,
        scrollY: 0,
        // 【不要设 windowWidth】——它会按该宽度重排克隆文档，元素坐标漂移
        // （裁剪窗/内容错位、离屏节点高度归零，本轮排障实证）；缺省=原视口
        // 布局克隆，元素边界与真实 DOM 一致。
      },
    })
    .from(node);
  await worker.toContainer();
  normalizeWorkerContainer(worker, cssWidth, cropHeight ?? cssHeight);
  if (cropHeight !== null) {
    // 截断路径才显式裁剪：以容器真实文档坐标为裁剪原点（html2canvas 缺省
    // 会整树渲染，显式窗只裁到上限高，防 16384 上限画布创建失败）
    const containerEl = worker.prop.container;
    if (!containerEl) throw new Error("渲染失败（html2pdf 容器未创建）");
    const cr = containerEl.getBoundingClientRect();
    const h2c = (worker.opt.html2canvas ??= {});
    h2c.x = Math.round(cr.left + window.scrollX);
    h2c.y = Math.round(cr.top + window.scrollY);
    h2c.width = cssWidth;
    h2c.height = cropHeight;
  }
  await worker.toCanvas();
  const canvas = worker.prop.canvas;
  if (!canvas) throw new Error("渲染失败（html2canvas 未产出画布）");
  if (truncated && notice) drawNotice(canvas, notice);
  const blob = await canvasToBlob(canvas, opts.imageType === "jpeg" ? "image/jpeg" : "image/png", opts.quality ?? 1);
  worker.prop.container?.remove(); // worker 不自清——防反复导出泄漏
  return { blob, width: canvas.width, height: canvas.height, truncated, notice };
}

/** 把截断标注画进产物底部（诚实标注双通道之一） */
function drawNotice(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const band = Math.max(36, Math.round(canvas.width / 40));
  ctx.fillStyle = "#1c2330";
  ctx.fillRect(0, canvas.height - band, canvas.width, band);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(band * 0.42)}px system-ui, sans-serif`;
  ctx.fillText(text, 12, canvas.height - band / 2);
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error(`画布编码失败（canvas.toBlob 空，canvas ${canvas.width}×${canvas.height}）`)),
      type,
      quality,
    );
  });
}

/* ---------- 位图序列 → PDF ---------- */

export interface PdfAssembleResult {
  blob: Blob;
  pages: number;
  /** 每页放置的图片尺寸提示（pt 换算前的 mm 版面） */
  pageSize: { width: number; height: number };
}

export interface PngsToPdfOptions {
  /** 缺省 portrait（docx/xlsx 纵向；pptx 传 landscape＋pageSize） */
  orientation?: "portrait" | "landscape";
  /** jsPDF format：命名（"a4"）或自定义 [宽,高]（mm——pptx 按幻灯纵横比传） */
  pageSize?: string | [number, number];
  /** 图像格式声明（addImage 的 format 参数） */
  imageFormat?: "PNG" | "JPEG";
}

/** 一次性 probe worker：换回 jsPDF 文档实例（1 页占位，调用方 deletePage(1)） */
async function probeJsPdf(pageSize: string | [number, number], orientation: string): Promise<JsPdfDoc> {
  const host = document.createElement("div");
  host.textContent = "fde2e export probe";
  // 内联钉扎：host 挂在 body 上，会继承页面级 oklch 计算色（xlsx 站实证——
  // 变量钉扎只护调用方 scope，probe host 必须自钉），html2canvas 解析必炸
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:100px;height:60px;background:#ffffff;color:#1c2330;" +
    "border-color:#d8dde5;outline-color:#0f62d6;caret-color:#1c2330;accent-color:#0f62d6;column-rule-color:#d8dde5;";
  document.body.appendChild(host);
  // probe 自带守卫（scope=host）：调用方可能没有守卫（pptx 走 html-to-image 不需要
  // 外层守卫），而 html2canvas 对**文档底色**（body 计算背景）的兜底解析同样会撞
  // oklch（pptx 站实证）——守卫的变量钉扎＋子树内联钉扎在这里缺一不可。
  const uninstallGuard = installExportColorGuard(host);
  const worker = html2pdf()
    .set({
      jsPDF: { unit: "mm", format: pageSize, orientation },
      html2canvas: { backgroundColor: "#ffffff", logging: false, scale: 1 },
    })
    .from(host);
  try {
    await worker.toContainer();
    // 容器同样继承 body 色（host 的内联色不随克隆上浮到容器）——显式钉全套
    // （color 之外还有 TW4 preflight 的 border-color: var(--color-*) oklch 路径）
    const container = worker.prop.container;
    if (container) {
      const s = container.style;
      s.setProperty("color", "#1c2330");
      s.setProperty("border-color", "#d8dde5");
      s.setProperty("outline-color", "#0f62d6");
      s.setProperty("caret-color", "#1c2330");
      s.setProperty("accent-color", "#0f62d6");
      s.setProperty("column-rule-color", "#d8dde5");
    }
    await worker.toPdf();
    const pdf = worker.prop.pdf;
    if (!pdf) throw new Error("PDF 内核初始化失败（jsPDF 实例缺失）");
    return pdf;
  } finally {
    uninstallGuard();
    host.remove();
    worker.prop.container?.remove();
  }
}

/**
 * 位图（PNG/JPEG blob）序列 → 每图一页 PDF。
 * 版面＝pageSize 全幅 contain 居中（不裁内容、不拉伸）。
 */
export async function pngsToPdf(blobs: Blob[], opts: PngsToPdfOptions = {}): Promise<PdfAssembleResult> {
  if (!blobs.length) throw new Error("没有可组装的图像（入参为空）");
  const orientation = opts.orientation ?? "portrait";
  const format = opts.pageSize ?? "a4";
  const imageFormat = opts.imageFormat ?? "PNG";
  const pdf = await probeJsPdf(format, orientation);
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  pdf.deletePage(1); // probe 占位页（先读 pageSize 再删——删空后 getter 炸）
  for (const blob of blobs) {
    const dataUrl = await blobToDataURL(blob);
    const img = await loadImage(dataUrl);
    const scale = Math.min(pw / img.width, ph / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    pdf.addPage(format, orientation);
    pdf.addImage(dataUrl, imageFormat, (pw - w) / 2, (ph - h) / 2, w, h);
  }
  const out = pdf.output("blob");
  return { blob: out, pages: blobs.length, pageSize: { width: pw, height: ph } };
}

function loadImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("图像解码失败（blob 非法？）"));
    img.src = src;
  });
}

/* ---------- 多张同宽 PNG 纵向拼长图 ---------- */

/** 低于该 scale 认为过小（再小则截断＋诚实标注） */
const MIN_STACK_SCALE = 0.12;

export interface StackResult {
  blob: Blob;
  width: number;
  height: number;
  truncated: boolean;
  notice?: string;
}

/**
 * 同宽 PNG 序列 → 单张纵向长图（pptx export_long_png 用）。
 * 总高超上限统一降 scale（内容零丢失）；低于 MIN_STACK_SCALE 才截断＋标注。
 */
export async function stackPngsVertically(blobs: Blob[], opts: { gap?: number } = {}): Promise<StackResult> {
  if (!blobs.length) throw new Error("没有可拼接的图像（入参为空）");
  const gap = opts.gap ?? 0;
  const images: Array<{ dataUrl: string; width: number; height: number }> = [];
  for (const blob of blobs) {
    const dataUrl = await blobToDataURL(blob);
    images.push({ dataUrl, ...(await loadImage(dataUrl)) });
  }
  const width = Math.max(...images.map((i) => i.width));
  const rawHeight = images.reduce((a, i) => a + i.height, 0) + gap * (images.length - 1);
  let scale = 1;
  if (rawHeight > CANVAS_MAX_EDGE) scale = CANVAS_MAX_EDGE / rawHeight;
  let truncated = false;
  let notice: string | undefined;
  if (scale < MIN_STACK_SCALE) {
    scale = MIN_STACK_SCALE;
    truncated = true;
  }
  // 按上限内可容纳的张数截断（scale 已钉最小值）
  let kept = images.length;
  if (truncated) {
    let acc = 0;
    kept = 0;
    for (const im of images) {
      const h = im.height * scale;
      if (acc + h > CANVAS_MAX_EDGE) break;
      acc += h;
      kept++;
    }
    if (kept < 1) kept = 1;
    notice = `内容过长已截断：仅保留前 ${kept}/${images.length} 页`;
  }
  const outW = Math.round(width * scale);
  const outH = Math.min(CANVAS_MAX_EDGE, Math.round(rawHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画布创建失败（长图尺寸超浏览器上限）");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  let y = 0;
  for (const im of images.slice(0, kept)) {
    const img = new Image();
    img.src = im.dataUrl;
    await img.decode();
    ctx.drawImage(img, 0, Math.round(y), Math.round(im.width * scale), Math.round(im.height * scale));
    y += im.height * scale + gap;
    if (y > CANVAS_MAX_EDGE) break;
  }
  if (truncated && notice) drawNotice(canvas, notice);
  const blob = await canvasToBlob(canvas);
  return { blob, width: outW, height: outH, truncated, notice };
}
