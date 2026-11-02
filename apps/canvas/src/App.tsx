/*
 * Canvas 画布工具 —— apps/canvas/src/App.tsx
 *
 * 最小可用闭环：JSON spec → Satori → SVG 预览 → PNG 导出；WebMCP 工具
 * render_card / inspect_layout / export_svg / export_canvas_png。
 * 输入非受控（ref 读 DOM 值）：智能体程序化 set value 后点按钮必须生效。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { Label } from "@fde2e-tools/shared/ui/label";
import { Textarea } from "@fde2e-tools/shared/ui/textarea";
import { downloadBlob } from "@fde2e-tools/shared/download";
import { renderSpec, registerAppTools, subscribeRender, subscribeInspect } from "./webmcp";
import { svgToPng, svgDataUrl, type RenderResult } from "./render";

const SAMPLE_SPEC = {
  width: 1080,
  height: 1440,
  background: "#0b1020",
  root: {
    type: "div",
    props: {
      id: "card",
      style: {
        width: "100%",
        height: "100%",
        padding: 80,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#0b1020",
        color: "#ffffff",
        fontFamily: "Noto Sans SC",
      },
      children: [
        {
          type: "div",
          props: {
            id: "badge",
            style: {
              display: "flex",
              alignSelf: "flex-start",
              padding: "12px 22px",
              borderRadius: 999,
              backgroundColor: "#16233a",
              color: "#8fb4ff",
              fontSize: 24,
              fontWeight: 700,
            },
            children: "FDE2E · CANVAS",
          },
        },
        {
          type: "div",
          props: {
            id: "title-block",
            style: { display: "flex", flexDirection: "column", gap: 24 },
            children: [
              {
                type: "div",
                props: {
                  id: "title",
                  style: { fontSize: 96, fontWeight: 700, lineHeight: 1.12, whiteSpace: "nowrap" },
                  children: "用 JSON 排版",
                },
              },
              {
                type: "div",
                props: {
                  id: "subtitle",
                  style: { fontSize: 40, fontWeight: 400, color: "#9fb3d1" },
                  children: "Satori 确定性出图 · SVG / PNG",
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            id: "footer",
            style: { display: "flex", justifyContent: "space-between", alignItems: "flex-end" },
            children: [
              {
                type: "div",
                props: {
                  id: "meta",
                  style: { fontSize: 24, color: "#6f86a8" },
                  children: "2026 · FDE2E",
                },
              },
              {
                type: "svg",
                props: {
                  width: 120,
                  height: 120,
                  viewBox: "0 0 120 120",
                  children: [
                    { type: "circle", props: { cx: 60, cy: 60, r: 50, fill: "#2f6bff" } },
                    {
                      type: "path",
                      props: { d: "M35 60 L55 80 L90 40", stroke: "#ffffff", strokeWidth: 8, fill: "none" },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },
};

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是 Canvas 画布工具：JSON spec 经 Satori 渲染为 SVG，再可导出 PNG。纯静态、零后端。

spec 形状：
{
  "width": 1080, "height": 1440, "background": "#0b1020",
  "root": {
    "type": "div",
    "props": {
      "id": "card",
      "style": { "width": "100%", "height": "100%", "padding": 80, "display": "flex" },
      "children": [ ... ]
    }
  }
}
- children 必须在 props.children（Satori 只认这个位置）；顶层 children 会被归一。
- 节点类型：div/span/p/img/svg；svg 子树允许 path/circle/rect/defs/g/...。
- img.src 允许 data:image/... 或 asset:<id>（list_assets/get_asset 查 id；外部图片先 import_asset）。
- 排版流程：render_card → inspect_layout（rect/overflow/off_canvas/contrast）→ 改 spec → export_svg/export_canvas_png。
- 字体：list_fonts/get_asset 取 fontUrl；Satori 不支持时用 text_to_svg 转 path。字体授权由使用方负责，工具不拦截。
- style 不支持 writingMode/columns/fontStretch；外部 url()/@import 会被拒绝。

操作：
- 编辑 <textarea id="spec-input">，点 id=render-btn（渲染）→ 预览 <img id=canvas-preview>；
- 点 id=export-svg-btn 下载 canvas-export.svg；点 id=export-png-btn 下载 canvas-export.png；
- 状态行 id=status 实时反馈。

WebMCP 工具：
- render_card({spec}) → renderId/尺寸/摘要/警告（不回整段 SVG）
- inspect_layout({renderId?, ids?, format?}) → rect/type/text + blocking/advisory 警告
- export_svg({renderId?, inlinePaths?}) → 自包含 SVG
- export_canvas_png({renderId?, scale?, background?, filename?}) → 下载单张 PNG
- list_fonts / list_recipes / list_styles → 摘要列表`;

interface Status {
  msg: string;
  kind: StatusKind;
}

export default function App() {
  const specRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<Status>({ msg: "等待渲染…", kind: "ok" });
  const [svg, setSvg] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [inspectWarnings, setInspectWarnings] = useState<string[]>([]);

  function setKind(msg: string, kind: StatusKind = "ok") {
    setStatus({ msg, kind });
  }

  async function doRender(): Promise<RenderResult | null> {
    const raw = specRef.current?.value ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setKind("spec JSON 解析失败：" + (e instanceof Error ? e.message : String(e)), "error");
      return null;
    }
    setKind("正在渲染…", "ok");
    try {
      const { result: r } = await renderSpec(parsed);
      setResult(r);
      setSvg(r.svg);
      setWarnings(r.warnings.map((w) => `[${w.code}] ${w.message}`));
      setKind(`渲染完成：${r.spec.width}×${r.spec.height} px · ${r.nodes.length} 个布局节点`, "ok");
      return r;
    } catch (e) {
      setSvg(null);
      setResult(null);
      setKind("渲染失败：" + (e instanceof Error ? e.message : String(e)), "error");
      return null;
    }
  }

  async function onExportSvg() {
    const r = result ?? (await doRender());
    if (!r) return;
    downloadBlob(new Blob([r.svg], { type: "image/svg+xml" }), "canvas-export.svg");
    setKind(`已导出 canvas-export.svg（${new TextEncoder().encode(r.svg).length} bytes）`, "ok");
  }

  async function onExportPng() {
    const r = result ?? (await doRender());
    if (!r) return;
    try {
      setKind("正在导出 PNG…", "ok");
      const png = await svgToPng(r.svg, r.spec, { scale: 1 });
      downloadBlob(new Blob([png.bytes], { type: "image/png" }), "canvas-export.png");
      setKind(`已导出 canvas-export.png（${png.width}×${png.height} · ${png.bytes.length} bytes）`, "ok");
    } catch (e) {
      setKind("PNG 导出失败：" + (e instanceof Error ? e.message : String(e)), "error");
    }
  }

  function loadSample() {
    if (specRef.current) specRef.current.value = JSON.stringify(SAMPLE_SPEC, null, 2);
    void doRender();
  }

  useEffect(() => {
    void registerAppTools();
    if (specRef.current) specRef.current.value = JSON.stringify(SAMPLE_SPEC, null, 2);
    void doRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WebMCP 渲染也更新预览（AI 出图后人类立即看到同一结果；订阅的是同一份 state）
  useEffect(() => subscribeRender((s) => {
    if (!s) return;
    setResult(s.result);
    setSvg(s.result.svg);
    setWarnings(s.result.warnings.map((w) => `[${w.code}] ${w.message}`));
    if (specRef.current) specRef.current.value = JSON.stringify(s.input, null, 2);
    setKind(`渲染完成：${s.result.spec.width}×${s.result.spec.height} px · ${s.result.nodes.length} 个布局节点`, "ok");
  }), []);

  // inspect_layout 的布局警告同步到页面（AI 与人类看到同一份证据）
  useEffect(() => subscribeInspect((ws) => {
    setInspectWarnings(ws.map((w) => `[${w.code}] ${w.message}`));
  }), []);

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-14">
      <h1 className="mt-2 mb-1 text-[28px] font-semibold text-foreground">
        Canvas 画布工具 · 用 JSON 排版，导出 SVG/PNG
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        Satori 确定性渲染：同一份 spec 出同样的图；纯静态、零后端、零上传。
      </p>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(340px,1fr)_minmax(340px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>1 · Canvas spec</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <Label htmlFor="spec-input" className="text-muted-foreground">
              JSON spec（width/height/root）
            </Label>
            <Textarea
              id="spec-input"
              ref={specRef}
              spellCheck={false}
              defaultValue=""
              className="min-h-[520px] font-mono text-[12px]/5"
            />
            <div className="flex flex-wrap gap-2.5">
              <Button id="render-btn" onClick={() => void doRender()}>
                渲染
              </Button>
              <Button id="load-sample-btn" variant="outline" onClick={loadSample}>
                载入示例
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · 预览与导出</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="overflow-auto rounded-lg border border-input bg-muted/30 p-2">
              {svg ? (
                <img
                  id="canvas-preview"
                  src={svgDataUrl(svg)}
                  alt="Canvas 渲染结果"
                  className="mx-auto block h-auto max-h-[560px] w-auto max-w-full"
                />
              ) : (
                <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                  等待渲染…
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button id="export-svg-btn" className="flex-1" onClick={() => void onExportSvg()}>
                导出 SVG
              </Button>
              <Button id="export-png-btn" className="flex-1" variant="outline" onClick={() => void onExportPng()}>
                导出 PNG
              </Button>
            </div>
            <p id="status" className={"min-h-[26px] text-base font-semibold " + statusTextClass(status.kind)}>
              {status.msg}
            </p>
            {warnings.length > 0 && (
              <pre id="warnings" className="max-h-[180px] overflow-auto rounded-md border border-input bg-muted/30 p-2 text-[12px]/5 text-muted-foreground">
                {warnings.join("\n")}
              </pre>
            )}
            {inspectWarnings.length > 0 && (
              <pre id="inspect-warnings" className="max-h-[180px] overflow-auto rounded-md border border-input bg-muted/30 p-2 text-[12px]/5 text-muted-foreground">
                {inspectWarnings.join("\n")}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        canvas · Satori 确定性出图 · JSON spec → SVG / PNG · 纯静态零后端
      </footer>
    </div>
  );
}
