/*
 * 专业幻灯编辑器 —— apps/pptx/src/App.tsx
 *
 * 「真幻灯工作区」（office-editorial-upgrade）：solid-glass 外框 ＋ PPTist
 * Vue 编辑器岛（整库嵌入，AGPL 隔离目录 src/pptist/，vendored 源码零改动）。
 * 惯例沿用全仓范式：可交互元素 id 稳定（load-sample-btn / import-pptx-btn /
 * import-pptx-file / export-pptx-btn / status / ai-guide）；输入类非受控；
 * 状态行文案含终态词、中间态不含；PPTist 大库 dynamic import 懒加载；
 * 首载用 PPTist 默认示例，?sample=1 重置为确定性双页示例。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { scrollStatusIntoView, statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { getIsland, mountPPTist, PPTIST_ISLAND_CLASS, type StatusSink } from "./bridge";
import { exportSlidesLongPng, exportSlidesPdf, exportSlidesPng } from "./export";
import { resolveExportName } from "./export-name";
import { importFromBytes, loadSampleDeck, registerAppTools } from "./webmcp";

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是专业幻灯编辑器（pptx.tool.fde2e.com）：PPTist 编辑器整库嵌入（节编辑/文本形状表格图表/
主题/放映），Pinia store 为编程面，导出真 .pptx、导入既有 .pptx。纯前端零上传（AGPL 目录隔离，
见根 README 许可分区）。轻量「大纲 JSON→文件」快速档在 easy-pptx.tool.fde2e.com。

WebMCP 工具（store 驱动；编辑器未就绪时返回 ok:false——请重试而非断言成功）：
- add_slide({layout?, title?, bullets?, index?})：新增一页（layout=title|bullets|blank，缺省 bullets；
  index 缺省插到当前页之后）。
- set_title({slideIndex?, text})：设置指定页标题（缺省当前页；无标题元素则创建）。
- add_bullets({slideIndex?, items[]})：向指定页追加要点列表（自动排版在既有内容下方）。
- export_pptx({filename?})：导出真 .pptx 下载（缺省 pptx-export.pptx；文本/形状/表格/图表基础项可靠）。
- import_pptx({base64})：导入 .pptx 置换画布（pptxtojson 解析，复杂版式有损）。
- export_pdf({filename?, pages?})：矢量 PDF 下载（缺省 pptx-export.pdf；16:9 横向，每页幻灯一页；真实文本层
  可搜索可复制；标题 32pt 加粗/要点 18pt 项目符号/右下页码）。可选 pages 选页（[2,3] 或 "2-3"，1-based；
  越界报错；选择导出文件名 pptx-export-p2-3.pdf）。
- export_png({pages?})：逐页 PNG 多文件下载（pptx-page-01.png 起＝原 deck 页码；多文件间隔触发）。可选 pages 选页。
- export_long_png({filename?, pages?})：幻灯纵向拼一张长图（缺省 pptx-long.png；每页卡框＋间隔带＋
  「— i/n —」页码标注；超 16384px 自动缩放）。可选 pages 选页（选择导出文件名 pptx-long-p2-3.png）。

操作提示：
- 页面按钮：载入示例（load-sample-btn，重置为确定性三页示例）、导入 .pptx（import-pptx-btn）、
  导出 .pptx（export-pptx-btn）、导出 PDF（export-pdf-btn）、导出逐页 PNG（export-png-btn）、
  导出长图 PNG（export-long-png-btn）；画布本身是完整 PPTist 编辑器（页签/元素/主题/放映原生交互）。
- 状态行 id=status 实时反馈（成功 ok 色 / 失败 error 色）。
- URL 参数 ?sample=1（或 sample/示例）：重置为内置示例演示。
- PPTist 自带的「AI 生成/图片搜索」等云特性依赖其上游服务端（server.pptist.cn），本站纯静态
  不代理——点击会得到上游错误提示；核心编辑/导入/导出全部离线可用。
- 本站内嵌 PPTist（AGPL-3.0），源码依 §13 随站点提供：https://github.com/jixoai/fde2e-tools
  （apps/pptx 目录，含 vendored 副本与许可边界说明）。`;

interface Status {
  msg: string;
  kind: StatusKind;
}

export default function App() {
  const islandRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ msg: "等待编辑器内核加载…", kind: "ok" });
  const [booted, setBooted] = useState(false);

  const showStatus: StatusSink = (msg, kind) => {
    setStatus({ msg, kind });
    scrollStatusIntoView();
  };

  // 启动编辑器 + WebMCP 注册（单例；StrictMode 双跑安全）
  useEffect(() => {
    const el = islandRef.current;
    if (!el) return;
    let cancelled = false;
    void (async () => {
      try {
        await mountPPTist(el, (msg, kind) => {
          if (!cancelled) showStatus(msg, kind);
        });
        if (!cancelled) {
          setBooted(true);
          window.scrollTo(0, 0); // boot 完成回首屏（移动端 scroll anchoring 小项）
        }
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

  // ?sample=1 / sample / 示例：重置确定性示例演示（不触发导出）
  useEffect(() => {
    let q: string | null = null;
    try {
      q = new URLSearchParams(window.location.search).get("sample");
    } catch {
      q = null;
    }
    if (!q || !(q === "sample" || q === "1" || q === "示例")) return;
    void (async () => {
      for (let i = 0; i < 200; i++) {
        if (getIsland()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (loadSampleDeck()) {
        showStatus("示例演示已载入：画布可直接编辑，或点「导出 .pptx」下载。", "ok");
      } else {
        showStatus("示例载入失败：编辑器尚未就绪。", "error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onExport() {
    const m = getIsland();
    if (!m) {
      showStatus("请先等待编辑器就绪再导出。", "error");
      return;
    }
    const filename = resolveExportName(undefined);
    try {
      showStatus("正在导出 .pptx…", "ok");
      const prevTitle = m.slides.title;
      m.slides.$patch({ title: filename.replace(/\.pptx$/i, "") });
      try {
        await m.export.exportPPTX(m.slides.slides, true, true);
      } finally {
        m.slides.$patch({ title: prevTitle });
      }
      showStatus(`已生成 ${filename}（${m.slides.slides.length} 页）`, "ok");
    } catch (e) {
      showStatus("导出失败：" + (e instanceof Error ? e.message : String(e)), "error");
    }
  }

  /** 展示级导出（openspec: export-pdf-png）：PDF／逐页 PNG／长图，人机同路径 */
  async function onExportShow(kind: "pdf" | "png" | "long") {
    showStatus(kind === "pdf" ? "正在导出 PDF…" : kind === "png" ? "正在导出逐页 PNG…" : "正在导出长图 PNG…", "ok");
    try {
      const r = kind === "pdf" ? await exportSlidesPdf() : kind === "png" ? await exportSlidesPng() : await exportSlidesLongPng();
      if (!r.ok) throw new Error(r.error);
      const detail =
        kind === "pdf"
          ? `（矢量 PDF · ${r.pages} 页横向${r.notice ? ` · ${r.notice}` : ""}）`
          : kind === "png"
            ? `（${r.pages} 个文件：${(r.files ?? []).join("、")}）`
            : `（${r.width}×${r.height} px${r.notice ? ` · ${r.notice}` : ""}）`;
      showStatus(`已生成 ${r.filename}${detail}`, "ok");
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
      showStatus(`已载入 ${file.name}：${out.slideCount ?? 0} 页（可继续编辑后导出）。`, "ok");
    } catch (e) {
      showStatus("导入失败：" + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-14">
      <h1 className="mt-2 mb-1 text-[28px] font-semibold text-foreground">
        专业幻灯编辑器 · 真幻灯工作区
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        PPTist 编辑器整库嵌入（AGPL 目录隔离）＋store 驱动 WebMCP（add_slide / set_title / add_bullets
        语义建页，导入导出真 .pptx）。AI 与人共用同一块画布，内容不离开本机。
      </p>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>演示操作</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2.5">
          <Button
            id="load-sample-btn"
            variant="outline"
            onClick={() => {
              if (loadSampleDeck()) showStatus("示例演示已载入：画布可直接编辑，或点「导出 .pptx」下载。", "ok");
              else showStatus("示例载入失败：编辑器尚未就绪。", "error");
            }}
          >
            载入示例
          </Button>
          <Button id="import-pptx-btn" variant="outline" disabled={!booted} onClick={() => fileRef.current?.click()}>
            导入 .pptx
          </Button>
          <input
            id="import-pptx-file"
            ref={fileRef}
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
          <Button id="export-pptx-btn" disabled={!booted} onClick={() => void onExport()}>
            导出 .pptx
          </Button>
          <Button id="export-pdf-btn" variant="outline" disabled={!booted} onClick={() => void onExportShow("pdf")}>
            导出 PDF
          </Button>
          <Button id="export-png-btn" variant="outline" disabled={!booted} onClick={() => void onExportShow("png")}>
            导出逐页 PNG
          </Button>
          <Button id="export-long-png-btn" variant="outline" disabled={!booted} onClick={() => void onExportShow("long")}>
            导出长图 PNG
          </Button>
          <p id="status" className={"min-w-[280px] flex-1 text-base font-semibold " + statusTextClass(status.kind)}>
            {status.msg}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>幻灯画布（PPTist 内核 · 可直接编辑）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="pptist-island-wrap rounded-lg border border-input">
            <div id="app" ref={islandRef} className={PPTIST_ISLAND_CLASS} />
          </div>
        </CardContent>
      </Card>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        专业幻灯编辑器 · 纯静态零后端 · PPTist v2（AGPL-3.0，apps/pptx 目录独立许可，源码：
        <a href="https://github.com/jixoai/fde2e-tools" target="_blank" rel="noreferrer" className="underline hover:text-foreground">github.com/jixoai/fde2e-tools</a>）· 大库懒加载独立分包 ·
        轻量快速档 easy-pptx.tool.fde2e.com
      </footer>
    </div>
  );
}
