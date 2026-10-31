/*
 * 专业文档编辑器 —— apps/docx/src/App.tsx
 *
 * 「真文档工作区」（office-editorial-upgrade）：solid-glass 外框包 TipTap
 * 富文本编辑器（白色文档纸面 + 工具栏）。惯例沿用全仓范式：
 * - 可交互元素 id 稳定：load-sample-btn / import-docx-btn / import-docx-file /
 *   export-docx-btn / status / ai-guide；
 * - 输入类非受控（hidden file input）；状态行文案含终态词、中间态不含；
 * - TipTap 与 docx/mammoth 桥 dynamic import 独立 chunk；
 *   首载建示例文档，?sample=1 重置示例。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { scrollStatusIntoView, statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { downloadBlob } from "@fde2e-tools/shared/download";
import { bootEditor, editorState, getEditor, loadSampleDoc, type StatusSink } from "./editor";
import { docJsonToDocxBytes } from "./docx-bridge";
import type { TiptapNode } from "./md-lite";
import { resolveExportName } from "./export-name";
import { importFromBytes, registerAppTools } from "./webmcp";

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是专业文档编辑器（docx.tool.fde2e.com）：TipTap 富文本 WYSIWYG（标题/段落/列表/表格/
粗斜体），docx 库导出真 .docx、mammoth 导入 .docx。纯前端零上传。轻量「Markdown→文件」
快速档在 easy-docx.tool.fde2e.com。

WebMCP 工具（直接驱动编辑器内核命令，不经 DOM 输入区；编辑器未就绪时返回 ok:false——
请重试而非断言成功）：
- set_content({content, format?})：整篇替换。format=html（缺省，h1-h3/p/ul/ol/table/strong/em）
  | markdown（子集）| json（TipTap JSON）。返回文档统计。
- append_markdown({markdown})：文末追加 Markdown 子集（#/##/###、- 列表、1. 列表、| 表格、
  **粗** *斜* \`代码\`、> 引用）。
- insert_heading({text, level?})：文末插标题（level 1-3 缺省 2）。
- insert_table({rows, cols, header?, data?})：文末插表格（data 行优先一维数组）。
- export_docx({filename?})：导出真 .docx 下载（缺省 docx-export.docx）。
- import_docx({base64})：导入 .docx 继续编辑（mammoth 语义转换）。

操作提示：
- 页面按钮：载入示例（load-sample-btn）、导入 .docx（import-docx-btn）、导出 .docx
  （export-docx-btn）；工具栏标题/粗斜/列表/表格按钮直接操作光标选区。
- 状态行 id=status 实时反馈（成功 ok 色 / 失败 error 色）。
- URL 参数 ?sample=1（或 sample/示例）：重置为内置示例文档。`;

interface Status {
  msg: string;
  kind: StatusKind;
}

function ToolbarButton(props: { id: string; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      id={props.id}
      type="button"
      disabled={props.disabled}
      onMouseDown={(e) => e.preventDefault() /* 防编辑器失焦 */}
      onClick={props.onClick}
      className={
        "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-md border border-input px-2 text-[13px] font-medium transition-colors " +
        "hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-40 " +
        (props.active ? "bg-accent text-accent-foreground" : "bg-background/60 text-foreground")
      }
    >
      {props.label}
    </button>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ msg: "等待编辑器内核加载…", kind: "ok" });
  const [booted, setBooted] = useState(false);

  const showStatus: StatusSink = (msg, kind) => {
    setStatus({ msg, kind });
    scrollStatusIntoView();
  };

  // 启动编辑器 + WebMCP 注册（单例；StrictMode 双跑安全）
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let cancelled = false;
    void (async () => {
      try {
        await bootEditor(el, (msg, kind) => {
          if (!cancelled) showStatus(msg, kind);
        });
        if (!cancelled) setBooted(true);
      } catch (e) {
        if (!cancelled) showStatus("编辑器启动失败：" + (e instanceof Error ? e.message : String(e)), "error");
      }
    })();
    void registerAppTools();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?sample=1 / sample / 示例：重置示例文档（不触发导出）
  useEffect(() => {
    let q: string | null = null;
    try {
      q = new URLSearchParams(window.location.search).get("sample");
    } catch {
      q = null;
    }
    if (!q || !(q === "sample" || q === "1" || q === "示例")) return;
    void (async () => {
      for (let i = 0; i < 100; i++) {
        if (getEditor()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!loadSampleDoc(showStatus)) showStatus("示例载入失败：编辑器尚未就绪。", "error");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cmd(fn: () => void, label: string) {
    return () => {
      const ed = getEditor();
      if (!ed) {
        showStatus("编辑器尚未就绪。", "error");
        return;
      }
      fn();
      showStatus(`已执行「${label}」。`, "ok");
    };
  }

  const onLoadSample = () => {
    if (!loadSampleDoc(showStatus)) showStatus("示例载入失败：编辑器尚未就绪。", "error");
  };

  async function onExport() {
    const ed = getEditor();
    if (!ed) {
      showStatus("请先等待编辑器就绪再导出。", "error");
      return;
    }
    const filename = resolveExportName(undefined);
    try {
      showStatus("正在导出 .docx…", "ok");
      const { bytes } = await docJsonToDocxBytes(ed.getJSON() as { type: string; content?: TiptapNode[] });
      downloadBlob(new Blob([bytes as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), filename);
      showStatus(`已生成 ${filename}（${editorState().chars} 字符）`, "ok");
    } catch (e) {
      showStatus("导出失败：" + (e instanceof Error ? e.message : String(e)), "error");
    }
  }

  async function onImportFile(file: File) {
    try {
      showStatus(`正在导入 ${file.name}…`, "ok");
      const bytes = await file.arrayBuffer();
      const out = await importFromBytes(bytes, file.name);
      if (!out.ok) throw new Error(out.error ?? "导入失败");
      showStatus(`已载入 ${file.name}：${out.chars ?? 0} 字符（可继续编辑后导出）。`, "ok");
    } catch (e) {
      showStatus("导入失败：" + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const dis = !booted;

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-14">
      <h1 className="mt-2 mb-1 text-[28px] font-semibold text-foreground">
        专业文档编辑器 · 真文档工作区
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        TipTap 富文本编辑（标题/列表/表格/粗斜体）＋docx 双向桥（导出真 .docx、导入继续编辑）。AI 经 WebMCP
        语义算子驱动，内容不离开本机。
      </p>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>文档操作</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton id="tb-h1" label="标题 1" disabled={dis} onClick={cmd(() => getEditor()?.commands.toggleHeading(1), "标题 1")} />
            <ToolbarButton id="tb-h2" label="标题 2" disabled={dis} onClick={cmd(() => getEditor()?.commands.toggleHeading(2), "标题 2")} />
            <ToolbarButton id="tb-h3" label="标题 3" disabled={dis} onClick={cmd(() => getEditor()?.commands.toggleHeading(3), "标题 3")} />
            <ToolbarButton id="tb-bold" label="粗体" disabled={dis} onClick={cmd(() => getEditor()?.commands.toggleBold(), "粗体")} />
            <ToolbarButton id="tb-italic" label="斜体" disabled={dis} onClick={cmd(() => getEditor()?.commands.toggleItalic(), "斜体")} />
            <ToolbarButton id="tb-bullet" label="• 列表" disabled={dis} onClick={cmd(() => getEditor()?.commands.toggleBulletList(), "无序列表")} />
            <ToolbarButton id="tb-ordered" label="1. 列表" disabled={dis} onClick={cmd(() => getEditor()?.commands.toggleOrderedList(), "有序列表")} />
            <ToolbarButton id="tb-quote" label="引用" disabled={dis} onClick={cmd(() => getEditor()?.commands.toggleBlockquote(), "引用")} />
            <ToolbarButton id="tb-code" label="代码块" disabled={dis} onClick={cmd(() => getEditor()?.commands.toggleCodeBlock(), "代码块")} />
            <ToolbarButton id="tb-undo" label="撤销" disabled={dis} onClick={cmd(() => getEditor()?.commands.undo(), "撤销")} />
            <ToolbarButton id="tb-redo" label="重做" disabled={dis} onClick={cmd(() => getEditor()?.commands.redo(), "重做")} />
            <span className="mx-1 h-6 w-px bg-input" />
            <ToolbarButton id="tb-table" label="插入表格 3×3" disabled={dis} onClick={cmd(() => getEditor()?.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true }), "插入表格")} />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button id="load-sample-btn" variant="outline" onClick={onLoadSample}>
              载入示例
            </Button>
            <Button id="import-docx-btn" variant="outline" disabled={dis} onClick={() => fileRef.current?.click()}>
              导入 .docx
            </Button>
            <input
              id="import-docx-file"
              ref={fileRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f);
              }}
            />
            <Button id="export-docx-btn" disabled={dis} onClick={() => void onExport()}>
              导出 .docx
            </Button>
            <p id="status" className={"min-w-[280px] flex-1 text-base font-semibold " + statusTextClass(status.kind)}>
              {status.msg}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>文档纸面（TipTap 内核 · 可直接编辑）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="docx-page docx-editor mx-auto max-w-[860px] rounded-lg border border-input shadow-none">
            <div ref={canvasRef} className="min-h-[560px]" />
          </div>
        </CardContent>
      </Card>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        专业文档编辑器 · 纯静态零后端 · TipTap v3（MIT）＋ docx@9（MIT）/ mammoth（BSD-2）双向桥 ·
        内核懒加载独立分包 · 轻量快速档 easy-docx.tool.fde2e.com
      </footer>
    </div>
  );
}
