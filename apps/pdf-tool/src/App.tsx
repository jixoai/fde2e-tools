/*
 * PDF 工具站 —— apps/pdf-tool/src/App.tsx
 *
 * 迁移自原单文件 index.html（2026-10-30 规范化进 fde2e-tools）。
 * **功能与行为保真红线**（详见 openspec change project-bootstrap）：
 * - 所有可交互元素 id 不变：input-content / load-sample / render-btn /
 *   export-btn / file-input / preview / status / ai-guide / export-area——
 *   已有智能体按 ai-guide 里的 id 操作 DOM。
 * - 输入类一律非受控（ref 读 DOM 值）：智能体程序化 set .value 后点按钮
 *   仍能正确工作（受控组件会丢这类输入）。
 * - 状态行文案、marked/html2pdf 调用参数、?autoload=sample 契约逐字保留。
 * 视觉升级到 solid-glass 标准（shadcn 官方件 + 主题 token）。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { normalizeWorkerContainer, openHtml2pdfWorker, withColorGuard } from "@fde2e-tools/shared/export-kit";
import { statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { Label } from "@fde2e-tools/shared/ui/label";
import { CONTENT_CSS } from "./content-css";
import { SAMPLE_MD } from "./sample";
import { registerAppTools } from "./webmcp";

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是「网页内容 → PDF」纯静态工具：零后端、零上传、全部 JS 本地内嵌（无外网依赖）。

操作步骤：
1. 把内容填入输入框 <textarea id="input-content">（Markdown 或 HTML 均可，自动识别）。
   也可以：点按钮 id=load-sample（文案「载入示例」）载入内置示例周报；
   或用 <input type="file" id="file-input"> 选择本地 .html / .md / .txt 文件（选完自动载入并渲染）。
2. 点按钮 id=render-btn（文案「渲染预览」），右侧 <iframe id="preview"> 显示渲染效果。
3. 点按钮 id=export-btn（文案「导出 PDF」），浏览器开始下载 pdf-tool-export.pdf（A4 纵向）。
4. 浏览器弹出下载即完成；状态行 id=status 显示「导出成功：文件已由浏览器下载」。

备注：
- URL 参数 ?autoload=sample（或 ?autoload=示例）可自动载入示例并渲染好预览，直接从第 3 步开始。
- 所有可交互元素都有稳定 id 与清晰文案；id=status 实时反馈每一步结果（成功 ok 色 / 失败 error 色）。
- Markdown 用内置 marked.js 渲染；HTML 内容原样进入预览（沙箱 iframe，内容里的脚本不会执行）。
- 导出由 html2pdf.js（html2canvas + jsPDF）在浏览器本地完成，无需服务器。
- 输入为空时点「导出 PDF」会先自动渲染；内容为空会给出错误提示。`;

interface Status {
  msg: string;
  kind: StatusKind;
}

function looksLikeHtml(t: string): boolean {
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(t) ||
    /<\/(div|p|h[1-6]|body|table|section|article|span)>/i.test(t);
}

/** 解析 HTML 文档，取 body 内容并内联其中的 <style>（外链样式不会生效） */
function extractBody(html: string): string {
  try {
    const d = new DOMParser().parseFromString(html, "text/html");
    const styles = Array.prototype.map
      .call(d.querySelectorAll("style"), (s: HTMLStyleElement) => s.textContent)
      .join("\n");
    return (styles ? "<style>" + styles + "</style>" : "") + d.body.innerHTML;
  } catch {
    return html;
  }
}

function docShell(bodyHtml: string): string {
  return (
    "<!doctype html><html><head><meta charset='utf-8'><style>" +
    CONTENT_CSS +
    "</style></head><body>" +
    bodyHtml +
    "</body></html>"
  );
}

export default function App() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportAreaRef = useRef<HTMLDivElement>(null);
  // 最近一次渲染的 HTML（导出数据源，避免读取沙箱 iframe）——与原版 exportSource 同语义
  const exportSourceRef = useRef("");
  const [status, setStatus] = useState<Status>({
    msg: "等待输入：粘贴内容或点「载入示例」开始。",
    kind: "ok",
  });
  const [previewSrcDoc, setPreviewSrcDoc] = useState("");
  const [fileName, setFileName] = useState("");

  // 把内容排版样式注入主文档（选择器都带 .pdf-content 前缀，不影响页面本身）
  useEffect(() => {
    const styleEl = document.createElement("style");
    styleEl.textContent = CONTENT_CSS;
    document.head.appendChild(styleEl);
    return () => {
      styleEl.remove();
    };
  }, []);

  function render(): boolean {
    const t = inputRef.current?.value ?? "";
    if (!t.trim()) {
      setStatus({ msg: "输入为空：请先粘贴内容、选择文件，或点「载入示例」。", kind: "error" });
      return false;
    }
    let html: string;
    if (looksLikeHtml(t)) {
      html = t;
      setStatus({ msg: "已按 HTML 渲染预览。", kind: "ok" });
    } else {
      try {
        html = window.marked.parse(t);
      } catch (e) {
        setStatus({
          msg: "Markdown 解析失败：" + (e instanceof Error && e.message ? e.message : String(e)),
          kind: "error",
        });
        return false;
      }
      setStatus({ msg: "已按 Markdown 渲染预览。", kind: "ok" });
    }
    exportSourceRef.current = html;
    setPreviewSrcDoc(docShell('<div class="pdf-content">' + extractBody(html) + "</div>"));
    return true;
  }

  function loadSample() {
    if (!inputRef.current) return;
    inputRef.current.value = SAMPLE_MD;
    if (render()) {
      setStatus({ msg: "示例周报已载入并渲染预览，点「导出 PDF」即可下载。", kind: "ok" });
    }
  }

  function onFileChange() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      if (!inputRef.current) return;
      inputRef.current.value = String(r.result || "");
      if (render()) {
        setFileName(f.name);
        setStatus({ msg: "已载入文件 " + f.name + "，预览已更新。", kind: "ok" });
      }
    };
    r.onerror = () => setStatus({ msg: "文件读取失败，请重试。", kind: "error" });
    r.readAsText(f);
  }

  async function onExport() {
    if (!exportSourceRef.current && !render()) return;
    const exportArea = exportAreaRef.current;
    if (!exportArea) return;
    setStatus({ msg: "正在导出 PDF…", kind: "ok" });
    exportArea.innerHTML = extractBody(exportSourceRef.current);
    const opt = {
      margin: [12, 12, 14, 12],
      filename: "pdf-tool-export.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, windowWidth: 820, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] },
    };
    // B1 色守卫：导出前把全文档 oklch 变量钉成 sRGB（html2canvas 1.4.x 不识别
    // oklch 会直接抛错），导出落定后卸载恢复主题原样。守卫已共享化为
    // @fde2e-tools/shared/export-kit（export-pdf-png 迁移），行为逐字同源。
    // 管线改显式分步（export-pdf-png）：toContainer 后做容器归一化——html2pdf
    // 只把克隆 position 重置为 relative 不重置 left，export-area 的 left:-10000
    // 会让克隆整体漂出容器，产物近空白（3058 字节空壳——2026-10-31 排障实证；
    // 归一化后产物含完整正文）。状态行/文件名/调用参数契约逐字不变。
    try {
      await withColorGuard(async () => {
        const worker = openHtml2pdfWorker().set(opt).from(exportArea);
        await worker.toContainer();
        normalizeWorkerContainer(worker, 794, exportArea.scrollHeight);
        await worker.save();
      }, exportArea);
      setStatus({ msg: "导出成功：文件已由浏览器下载", kind: "ok" });
    } catch (err: unknown) {
      setStatus({
        msg: "导出失败：" + (err instanceof Error && err.message ? err.message : String(err)),
        kind: "error",
      });
    }
  }

  // WebMCP：render_preview / export_pdf（原生或官方 polyfill，均幂等）
  useEffect(() => {
    void registerAppTools();
  }, []);

  // ?autoload=sample / ?autoload=示例：自动载入示例并渲染预览（React 18 StrictMode
  // 下 useEffect 双跑＝loadSample 幂等，行为不变）
  useEffect(() => {
    let q: string | null = null;
    try {
      q = new URLSearchParams(window.location.search).get("autoload");
    } catch {
      q = null;
    }
    if (q && (q === "sample" || q === "示例")) loadSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-14">
      <h1 className="mt-2 mb-1 text-[28px] font-semibold text-foreground">
        PDF 工具站 · 把网页内容变成 PDF
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        粘贴 Markdown 或 HTML → 渲染预览 → 一键导出 PDF。纯前端工具，内容不离开本机。
      </p>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(340px,1fr)_minmax(340px,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>1 · 输入内容</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <textarea
              id="input-content"
              ref={inputRef}
              placeholder="在此粘贴 Markdown 或 HTML 内容……"
              spellCheck={false}
              className="min-h-[320px] w-full resize-y rounded-lg border border-input bg-background/60 p-3 font-mono text-[15px]/6 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
            />
            <div className="flex flex-wrap gap-2.5">
              <Button id="load-sample" variant="outline" size="lg" className="flex-1" onClick={loadSample}>
                载入示例
              </Button>
              <Button id="render-btn" size="lg" className="flex-1" onClick={() => render()}>
                渲染预览
              </Button>
            </div>
            <Label htmlFor="file-input" className="text-muted-foreground">
              或选择文件（.html / .md / .txt）：
            </Label>
            {/* 原生 input sr-only 保形：id/fileInput 契约不变（agent 程序化
                setInputFiles 兼容），视觉走官方按钮（视觉打磨 2026-10-30 修复项 3） */}
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                id="file-input"
                ref={fileRef}
                type="file"
                accept=".html,.md,.txt,text/html,text/markdown,text/plain"
                onChange={onFileChange}
                className="sr-only"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                选择文件
              </Button>
              {fileName && (
                <span className="text-sm text-muted-foreground">{fileName}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · 预览与导出</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* 视觉打磨 2026-10-30 修复项 2：空态暗色占位覆盖层（iframe 常驻保
                id=preview 契约；有渲染内容后覆盖层卸载，白底文档正常显示） */}
            <div className="relative">
              <iframe
                id="preview"
                ref={previewRef}
                sandbox=""
                title="渲染预览"
                srcDoc={previewSrcDoc}
                className="h-[560px] w-full rounded-lg border border-input bg-white"
              />
              {!previewSrcDoc && (
                <div
                  aria-hidden
                  className="bg-background pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg"
                >
                  <p className="m-0 text-sm text-muted-foreground">
                    载入内容后此处显示预览
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button id="export-btn" size="lg" className="flex-1" onClick={onExport}>
                导出 PDF
              </Button>
            </div>
            <p id="status" className={"min-h-[26px] text-base font-semibold " + statusTextClass(status.kind)}>
              {status.msg}
            </p>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        PDF 工具站 · 纯静态零后端 · marked.js + html2pdf.js 均已本地内嵌
      </footer>

      {/* 导出工作区：离屏容器，html2pdf 在其上生成 PDF（非 display:none，保证可渲染） */}
      <div
        id="export-area"
        ref={exportAreaRef}
        className="pdf-content"
        style={{ position: "fixed", left: "-10000px", top: 0, width: "794px", background: "#ffffff" }}
      />
    </div>
  );
}
