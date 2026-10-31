/*
 * TipTap 编辑器主机 —— apps/docx/src/editor.ts
 *
 * 职责：dynamic import TipTap（core/starter-kit/table ≈150KB gzip 级独立 chunk，
 * 体积纪律）→ 在文档页容器上建编辑器（单例，StrictMode 双跑安全）→ 就绪标记。
 * 真相源＝TipTap JSON（getJSON）；AI 经 WebMCP 命令驱动（与内核直调，无 DOM 桥）。
 */
import { markdownToDoc } from "./md-lite";

/* ---------- TipTap Editor 的结构化最小面（类型留在 chunk 内不进主包） ---------- */

export interface FacadeEditor {
  commands: {
    setContent(content: unknown, emitUpdate?: boolean): boolean;
    insertContentAt(position: number | "end", value: unknown): boolean;
    focus(position?: string | number): boolean;
    toggleBold(): boolean;
    toggleItalic(): boolean;
    toggleHeading(level: 1 | 2 | 3): boolean;
    toggleBulletList(): boolean;
    toggleOrderedList(): boolean;
    toggleBlockquote(): boolean;
    toggleCodeBlock(): boolean;
    insertTable(opts: { rows: number; cols: number; withHeaderRow?: boolean }): boolean;
    undo(): boolean;
    redo(): boolean;
  };
  getJSON(): { type: string; content?: unknown[] };
  getHTML(): string;
  getText(opts?: Record<string, unknown>): string;
  isEmpty: boolean;
  /** ProseMirror 文档末位光标点（insertContentAt 追加用） */
  state: { doc: { content: { size: number } } };
}

export type StatusSink = (msg: string, kind: "ok" | "error" | "warn") => void;

let editorPromise: Promise<FacadeEditor> | null = null;
let editor: FacadeEditor | null = null;

/** 示例文档（首载与 ?sample= 共用；md 子集单源解析） */
export function sampleMarkdown(): string {
  // 示例＝真实业务内容（青旅门店周报），不用工程术语/内部开发提示（P0-4）。
  // 含三级标题、无序/有序列表、表格、引用与行内粗体（撑起 PDF 与长图版式）。
  return `# 青旅门店周报

**2026 年第 43 周（10 月 19 日 — 10 月 25 日）** · 前厅运营组

本周整体入住率 82%，环比提升 6 个百分点；周五起连续三晚满房，团建包栋贡献了主要增量。服务质量评分 4.8/5，零投诉结案。

## 一、经营概况

- 入住间夜 412，同比增长 18%
- 平均房价 268 元，会员价订单占比 46%
- 餐饮收入 1.86 万元，早餐加购率 61%
- 直订渠道占比 52%，OTA 平台 31%

### 1.1 房型表现

| 房型 | 入住间夜 | 平均房价 | 出租率 |
| --- | --- | --- | --- |
| 四人间床位 | 168 | 96 | 92% |
| 双人标间 | 112 | 258 | 86% |
| 家庭套房 | 48 | 432 | 74% |
| 露台大床房 | 52 | 312 | 81% |

## 二、本周问题与处理

1. 周六凌晨热水压力不足，工程组已于当日 10 点前完成加压泵更换
2. 两间客房空调异响，更换风机后复测正常
3. 团建客人退房延迟 40 分钟，已调整保洁排班

## 三、下周重点

- 上线四人间加床方案，周末加床费 30 元
- 推出淡季长住套餐（周租 520 元，含双早）
- 与两家本地旅行社签署协议价，锁定周中房量
- 完成前台夜班交接清单，减少漏单

> 备注：会员复购率连续四周上升，长住客占比已达 23%。
`;
}

/** 启动编辑器（单例）；onReady 在编辑器可交互时回调 */
export function bootEditor(container: HTMLElement, onStatus: StatusSink): Promise<FacadeEditor> {
  if (editorPromise) return editorPromise;
  editorPromise = (async () => {
    onStatus("正在加载编辑器内核（TipTap）…", "ok");
    const mod = await import("./tiptap-boot");
    editor = await mod.mountTiptap(container, markdownToDoc(sampleMarkdown()));
    onStatus("编辑器就绪：可直接编辑，AI 可经 WebMCP 语义算子驱动。", "ok");
    return editor;
  })();
  return editorPromise;
}

export function getEditor(): FacadeEditor | null {
  return editor;
}

/** 工具统一入口：等就绪（TipTap 快，2s 上限兜底）后执行；超时显式 ok:false */
export async function withEditor<T>(fn: (ed: FacadeEditor) => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const deadline = Date.now() + 15000;
  for (;;) {
    if (editor) break;
    if (Date.now() > deadline) return { ok: false, error: "编辑器尚未就绪（内核加载中），写命令已拒绝——请稍后重试" };
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return { ok: true, value: await fn(editor) };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}

/** 编辑器状态核验（绿门「WebMCP 写入→编辑器状态核验」用） */
export function editorState(): { ready: boolean; chars: number; text: string } {
  if (!editor) return { ready: false, chars: 0, text: "" };
  const text = editor.getText();
  return { ready: true, chars: text.length, text };
}

/** sample 重载（页面按钮与 ?sample= 共用） */
export function loadSampleDoc(onStatus: StatusSink): boolean {
  if (!editor) return false;
  editor.commands.setContent(markdownToDoc(sampleMarkdown()));
  onStatus("示例文档已载入：可直接编辑，或点「导出 .docx」下载。", "ok");
  return true;
}
