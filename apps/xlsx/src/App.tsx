/*
 * 专业表格编辑器 —— apps/xlsx/src/App.tsx
 *
 * 「真编辑器工作区」（office-editorial-upgrade）：solid-glass 外框包 Univer
 * 真表格网格画布（多 sheet 页签/单元格编辑/公式引擎）。惯例沿用全仓范式：
 * - 可交互元素 id 稳定：load-sample-btn / import-xlsx-btn / import-xlsx-file /
 *   export-xlsx-btn / status / ai-guide；
 * - 输入类非受控（hidden file input）；状态行文案含终态词、中间态不含；
 * - Univer 内核 dynamic import（editor.ts → univer-boot.ts，独立 chunk）；
 *   首载建示例簿（工厂 seed 单源），?sample=1 重置示例。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { scrollStatusIntoView, statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { bootEditor, getHost, loadSampleWorkbook, type StatusSink } from "./editor";
import { resolveExportName } from "./export-name";
import { importFromBytes, registerAppTools } from "./webmcp";
import { snapshotToXlsxBytes } from "./bridge";
import { downloadBlob } from "@fde2e-tools/shared/download";

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是专业表格编辑器（xlsx.tool.fde2e.com）：Univer 真表格网格（多 sheet 页签/公式引擎/
样式），SheetJS 双向桥导入导出真 .xlsx。纯前端零上传。轻量「数据→文件」快速档在
easy-xlsx.tool.fde2e.com。

WebMCP 工具（直接驱动编辑器内核，不经 DOM 输入区；编辑器未就绪时写工具返回 ok:false，
禁静默失败——请重试而非断言成功）：
- set_cells({sheet?, startRow?, startCol?, values[][]})：写二维数据（字符串/数字/布尔/null）。
- set_formula({sheet?, range, formula})：写公式并返回引擎计算值（=SUM(C2:C3)、跨表 Sheet2!A1）。
- format_range({sheet?, range, styles})：bold/italic/color/bg/align/numfmt/border（all/outside/四边/内部）。
- add_sheet({name?, rows?})：建表（重名报错）。
- import_xlsx({base64[, filename]})：导入 .xlsx（值/公式保留；样式与列宽不保留）为可编辑工作簿。
- export_xlsx({filename?})：导出真 .xlsx 下载（缺省 xlsx-export.xlsx；值/公式保留，样式与列宽 v1 不落文件）。
- get_snapshot()：只读全簿快照（v 值 + f 公式）——先读后写。

操作提示：
- 页面按钮：载入示例（load-sample-btn）、导入 .xlsx（import-xlsx-btn）、导出 .xlsx（export-xlsx-btn）；
  状态行 id=status 实时反馈（成功 ok 色 / 失败 error 色）。
- URL 参数 ?sample=1（或 sample/示例）：重置为内置示例工作簿（含公式与样式）。
- 网格本身可直接编辑：点选单元格输入、工具栏加粗/底色、sheet 页签增删改（Univer 原生交互）。`;

interface Status {
  msg: string;
  kind: StatusKind;
}

export default function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({
    msg: "等待编辑器内核加载…",
    kind: "ok",
  });
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
          window.scrollTo(0, 0); // boot 完成回首屏（移动端 scroll anchoring 小项）
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

  // ?sample=1 / sample / 示例：重置示例工作簿（不触发导出）
  useEffect(() => {
    let q: string | null = null;
    try {
      q = new URLSearchParams(window.location.search).get("sample");
    } catch {
      q = null;
    }
    if (!q || !(q === "sample" || q === "1" || q === "示例")) return;
    void (async () => {
      // 等首簿建完（bootEditor 返回时首簿已在建/已建），再重置一次示例
      for (let i = 0; i < 100; i++) {
        if (getHost()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await loadSampleWorkbook(showStatus);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onExport() {
    const h = getHost();
    if (!h) {
      showStatus("请先等待编辑器就绪再导出。", "error");
      return;
    }
    const filename = resolveExportName(undefined);
    try {
      const wb = h.api.getActiveWorkbook();
      if (!wb) throw new Error("当前无活动工作簿");
      showStatus("正在导出 .xlsx…", "ok");
      const snapshot = wb.save() as Parameters<typeof snapshotToXlsxBytes>[0];
      const { bytes, stats } = await snapshotToXlsxBytes(snapshot);
      downloadBlob(
        new Blob([bytes as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        filename,
      );
      showStatus(`已生成 ${filename}（${stats.length} 个工作表 · ${stats.reduce((a, s) => a + s.cells, 0)} 格）`, "ok");
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
      showStatus(`已载入 ${file.name}：${(out.sheetNames ?? []).length} 个工作表 · ${out.cells ?? 0} 格（可继续编辑后导出）。`, "ok");
    } catch (e) {
      showStatus("导入失败：" + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-14">
      <h1 className="mt-2 mb-1 text-[28px] font-semibold text-foreground">
        专业表格编辑器 · 真表格网格工作区
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        Univer 网格编辑（多 sheet / 公式引擎 / 样式）＋SheetJS 双向桥（.xlsx 导入导出）。AI 经 WebMCP
        直接驱动编辑器内核，内容不离开本机。
      </p>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>工作簿操作</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2.5">
          <Button
            id="load-sample-btn"
            variant="outline"
            onClick={() => {
              showStatus("正在载入示例…", "ok");
              void loadSampleWorkbook(showStatus);
            }}
          >
            载入示例
          </Button>
          <Button id="import-xlsx-btn" variant="outline" onClick={() => fileRef.current?.click()}>
            导入 .xlsx
          </Button>
          <input
            id="import-xlsx-file"
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
          <Button id="export-xlsx-btn" disabled={!booted} onClick={() => void onExport()}>
            导出 .xlsx
          </Button>
          <p id="status" className={"min-w-[280px] flex-1 text-base font-semibold " + statusTextClass(status.kind)}>
            {status.msg}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>表格网格（Univer 内核 · 可直接编辑）</CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={canvasRef} className="univer-canvas-wrap overflow-hidden rounded-lg border border-input" />
        </CardContent>
      </Card>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        专业表格编辑器 · 纯静态零后端 · Univer preset-sheets-core（Apache-2.0）+ SheetJS 社区版双向桥 ·
        内核懒加载独立分包 · 轻量快速档 easy-xlsx.tool.fde2e.com
      </footer>
    </div>
  );
}
