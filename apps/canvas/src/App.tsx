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
import { Input } from "@fde2e-tools/shared/ui/input";
import { Label } from "@fde2e-tools/shared/ui/label";
import { Textarea } from "@fde2e-tools/shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@fde2e-tools/shared/ui/select";
import { downloadBlob } from "@fde2e-tools/shared/download";
import {
  renderSpec,
  registerAppTools,
  subscribeRender,
  subscribeInspect,
  generateBackgroundAsset,
  applyShaderAsset,
} from "./webmcp";
import { svgToPng, svgDataUrl, type RenderResult } from "./render";
import {
  getAsset,
  listAssets,
  listGeneratedAssets,
  listImportedAssets,
  subscribeAssets,
  type Asset,
} from "./assets";
import { getShaderPreset, SHADER_PRESETS } from "./shaders/presets";
import { DEMOS, getDemo } from "./demos";

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
- 字体：list_fonts/get_asset 取内置 fontUrl；Satori 不支持时用 text_to_svg 转 path。字体授权由使用方负责，工具不拦截。
- style 不支持 writingMode/columns/fontStretch；外部 url()/@import 会被拒绝。

字体目录（常用中英文，不托管字体字节）：
- list_font_catalog({language?:"zh"|"en", style?:"sans"|"serif"|"display"|"hand"|"mono", q?}) → id/family/languages/styles/weights/license/source/url|cssUrl/usage/builtin/notes
- 内置 Noto Sans SC：usage="satori"，spec 里 fontFamily:"Noto Sans SC" 直接排版（离线可用，Regular/Bold）
- 外部字体：usage="text_to_svg"，先 font_info({url}) 再 text_to_svg({url,text,fontSize,...})；或写进 preprocess.text
- 无直链条目只给官方来源页/cssUrl（不编造 404 链接）；中文 WOFF2 较大（1.5–2.7MB），按需加载并缓存

图标库（六族同源 SVG，不是 react-icons 运行时）：
- search_icons({q?, library?: "lucide"|"tabler"|"heroicons"|"bootstrap"|"fontawesome"|"material", limit?}) → id/library/name/tags/viewBox/license
- get_icon({id? | library+name, color?, size? 16–512, strokeWidth?}) → {assetId,width,height}（type=shape 资产）
- spec 里用 img.src="asset:<id>"；任意官方 SVG 仍走 import_asset({url,type:"svg"})（清洗/外部 href 拒绝）

Demo 学习路径：
- list_demos({level?:"basic"|"advanced"|"preprocess", q?}) → 摘要（id/title/level/features/explain 前 200 字）
- get_demo({id}) → 完整 spec/explain，可直接 render_card；preprocess demo 演示 pre:<key> 多素材组合

spec 预处理 preprocess（渲染前把素材准备好；不是新渲染引擎）：
  "preprocess": {
    "bg":    { "type": "shader", "preset": "mesh-sunset", "width": 1080, "height": 1440 },
    "glass": { "type": "shader", "preset": "glass-prism", "source": "bg" },
    "logo":  { "type": "icon", "library": "lucide", "name": "sparkles", "color": "#ffffff", "size": 96 },
    "title": { "type": "text", "text": "FDE2E", "font": "inter", "fontUrl": "https://...woff2", "fontSize": 120 },
    "photo": { "type": "image", "assetId": "bg-warm-sunset" }
  }
- 节点引用：img.src="pre:bg"；style.backgroundImage="url(pre:glass)"；SVG 子节点 href/xlink:href/src="pre:key"
- 按对象插入顺序串行解析；shader.source 只能指向更早声明的 key 或 asset:<id>（否则 E_PREPROCESS_ORDER）
- 限制：条目 ≤8、text ≤2000 字、icon size 16–512、总产物 ≤24MB；错误统一 E_PREPROCESS_* + key，不产生半张图
- image 支持 url（https/私网校验）或 assetId；icon 支持 library+name 或官方 svg url；text 支持 font（目录 id）/fontUrl
- render_card 返回 preprocess:{count,keys,assetIds}；产物注册进资产库（背景 background / 图标与文本 shape）

操作：
- 编辑 <textarea id="spec-input">，点 id=render-btn（渲染）→ 预览 <img id=canvas-preview>；
- 点 id=export-svg-btn 下载 canvas-export.svg；点 id=export-png-btn 下载 canvas-export.png；
- 状态行 id=status 实时反馈。

WebMCP 工具：
- render_card({spec}) → renderId/尺寸/摘要/警告/preprocess 摘要（不回整段 SVG）
- inspect_layout({renderId?, ids?, format?}) → rect/type/text + blocking/advisory 警告
- export_svg({renderId?, inlinePaths?}) → 自包含 SVG
- export_canvas_png({renderId?, scale?, background?, filename?}) → 下载单张 PNG
- list_fonts / list_font_catalog / list_recipes / list_styles / list_demos / get_demo → 摘要/目录
- search_icons / get_icon → 六族图标搜索与 shape 资产
- list_assets / get_asset / import_asset → 素材库
- font_info / text_to_svg / font_glyphs → 外部字体解析与转 path

Paper Shaders 背景（内置、WebGL2 页面内光栅化；不开放 GLSL/React 创作）：
- list_shader_presets({tag?, needsImage?}) → 预设摘要（mesh/glass/paper），不含全量默认参数
- generate_background({preset,width?,height?,params?,format?,quality?,name?,tags?}) → 生成型预设（mesh-sunset/mesh-aurora）出背景资产
- apply_shader({preset,sourceAssetId|sourceDataUrl,width?,height?,params?,format?,quality?,name?}) → 处理型预设（glass-prism/paper-default）加工已有图片；源资产不变
- shader_to_asset({width,height,chain:[{preset,params?,source?}],format?,quality?,name?,tags?}) → 1–4 步链式；缺省 source=上一步输出；每步按目标尺寸重绘
- 返回 {ok,assetId,width,height,format,bytes,steps}，不返回 data URL；spec 里用 img.src="asset:<id>"
- 全幅背景写法：img 节点 style={position:"absolute",left:0,top:0,width:"100%",height:"100%"}，父节点 position:"relative"
- 参数：mesh = colors(≤10)/positions/waveX/waveXShift/waveY/waveYShift/mixing/grainMixer/grainOverlay；
  glass = colorBack/colorShadow/colorHighlight/shadows/size/angle/distortionShape(prism|lens|contour|cascade|flat)/highlights/shape(lines|linesIrregular|wave|zigzag|pattern)/distortion/shift/blur/edges/stretch/margin*/grain*；
  paper = colorBack/colorPaper/colorShadow/blending/distortion/clip/angle/seed/roughness*/fiber*/folds*/wrinkles/wrinkleSize/crumples/crumpleCount(2–15)/drops
- 尺寸 16–4096；链长 1–4；输入只接受 asset:<id> 或 data:image/(png|jpeg|webp)；WebGL2 缺失返回 E_SHADER_NO_WEBGL2
- 典型链路：mesh-sunset → glass-prism（渐变上玻璃棱镜）；mesh-sunset → paper-default（纸纹压印）；import_asset 图片 → paper-default`;

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
  const [shaderPresetId, setShaderPresetId] = useState("mesh-sunset");
  const [shaderStatus, setShaderStatus] = useState<Status>({ msg: "选择预设后点「生成背景」…", kind: "ok" });
  const [shaderPreview, setShaderPreview] = useState<string | null>(null);
  const [generatedAssets, setGeneratedAssets] = useState<Asset[]>([]);
  const [otherAssets, setOtherAssets] = useState<Asset[]>([]);
  const [demoId, setDemoId] = useState(DEMOS[0]?.id ?? "");
  const [demoStatus, setDemoStatus] = useState<Status>({ msg: "选择 demo 后点「载入 Demo」…", kind: "ok" });
  const shaderWidthRef = useRef<HTMLInputElement>(null);
  const shaderHeightRef = useRef<HTMLInputElement>(null);

  function demoLabel(id: string): string {
    const demo = getDemo(id);
    return demo ? `${demo.level} · ${demo.title}` : "选择 demo";
  }

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
      const { result: r, applied } = await renderSpec(parsed);
      // 并发时只让最后发起的渲染更新 UI；慢的旧渲染直接丢弃
      if (!applied) return r;
      setResult(r);
      setSvg(r.svg);
      setWarnings(r.warnings.map((w) => `[${w.code}] ${w.message}`));
      // 新一轮渲染后旧 inspect 警告已过期（vision 复核：s18 曾残留上一张画布的 overflow）
      setInspectWarnings([]);
      setKind(`渲染完成：${r.spec.width}×${r.spec.height} px · ${r.nodes.length} 个布局节点`, "ok");
      return r;
    } catch (e) {
      setSvg(null);
      setResult(null);
      setInspectWarnings([]);
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

  /** 载入内置 demo（basic/advanced/preprocess）到 spec 输入框并立即渲染。 */
  async function loadDemo(id: string) {
    const demo = getDemo(id);
    if (!demo) {
      setDemoStatus({ msg: `未知 demo：${id}`, kind: "error" });
      return;
    }
    if (specRef.current) specRef.current.value = JSON.stringify(demo.spec, null, 2);
    setDemoStatus({ msg: `正在载入 ${demo.level} · ${demo.title}…`, kind: "ok" });
    const rendered = await doRender();
    setDemoStatus({
      msg: rendered
        ? `已载入 ${demo.title} · ${demo.features.join(" / ")}`
        : `demo ${demo.id} 渲染失败（见上方状态行）`,
      kind: rendered ? "ok" : "error",
    });
  }

  async function onGenerateShader() {
    const preset = getShaderPreset(shaderPresetId);
    if (!preset) {
      setShaderStatus({ msg: `未知预设：${shaderPresetId}`, kind: "error" });
      return;
    }
    const width = Number(shaderWidthRef.current?.value || preset.recommendedSize.width);
    const height = Number(shaderHeightRef.current?.value || preset.recommendedSize.height);
    setShaderStatus({ msg: `正在生成 ${preset.name}…`, kind: "ok" });
    try {
      let result;
      if (preset.needsImage) {
        // 处理型预设：默认取最近生成的 shader 资产，其次取已导入图片
        const newestGenerated = [...generatedAssets].reverse().find((a) => a.dataUrl);
        const source =
          newestGenerated ??
          listAssets({ type: "background" }).find((a) => a.dataUrl && a.style === "imported");
        if (!source) {
          setShaderStatus({
            msg: `${preset.name} 需要图片输入：先用 mesh 预设生成背景，或 import_asset 导入图片`,
            kind: "error",
          });
          return;
        }
        result = await applyShaderAsset({ preset: preset.id, sourceAssetId: source.id, width, height });
      } else {
        result = await generateBackgroundAsset({ preset: preset.id, width, height });
      }
      const asset = getAsset(result.assetId);
      setShaderPreview(asset?.dataUrl ?? null);
      setShaderStatus({
        msg:
          `已生成 ${result.assetId} · ${result.width}×${result.height} · ${result.format} · ${result.bytes} bytes` +
          (result.steps.length > 1 ? ` · ${result.steps.length} 步` : ""),
        kind: "ok",
      });
    } catch (e) {
      setShaderStatus({ msg: "生成失败：" + (e instanceof Error ? e.message : String(e)), kind: "error" });
    }
  }

  /** 把生成/预处理资产插入当前 spec：背景铺满、shape 以 160×160 插入。 */
  function useAssetInSpec(assetId: string) {
    const raw = specRef.current?.value ?? "";
    let spec: Record<string, unknown>;
    try {
      spec = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      setShaderStatus({ msg: "当前 spec 不是合法 JSON，无法插入资产", kind: "error" });
      return;
    }
    const root = spec.root as { props?: Record<string, unknown> } | undefined;
    if (!root || typeof root !== "object") {
      setShaderStatus({ msg: "当前 spec 缺 root 节点，无法插入资产", kind: "error" });
      return;
    }
    const asset = getAsset(assetId);
    const props = root.props ?? {};
    const style = (props.style && typeof props.style === "object" ? props.style : {}) as Record<string, unknown>;
    style.position = style.position ?? "relative";
    props.style = style;
    const children = Array.isArray(props.children) ? props.children : [];
    children.unshift(
      asset?.type === "shape"
        ? {
            type: "img",
            props: { id: `asset-${assetId}`, src: `asset:${assetId}`, style: { width: 160, height: 160 } },
          }
        : {
            type: "img",
            props: {
              id: `bg-${assetId}`,
              src: `asset:${assetId}`,
              style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
            },
          },
    );
    props.children = children;
    root.props = props;
    spec.root = root;
    if (specRef.current) specRef.current.value = JSON.stringify(spec, null, 2);
    setShaderStatus({
      msg:
        asset?.type === "shape"
          ? `已把 asset:${assetId} 插入 spec（160×160），正在渲染…`
          : `已把 asset:${assetId} 作为全幅背景插入 spec，正在渲染…`,
      kind: "ok",
    });
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
    setInspectWarnings([]);
    if (specRef.current) specRef.current.value = JSON.stringify(s.input, null, 2);
    setKind(`渲染完成：${s.result.spec.width}×${s.result.spec.height} px · ${s.result.nodes.length} 个布局节点`, "ok");
  }), []);

  // inspect_layout 的布局警告同步到页面（AI 与人类看到同一份证据）
  useEffect(() => subscribeInspect((ws) => {
    setInspectWarnings(ws.map((w) => `[${w.code}] ${w.message}`));
  }), []);

  // shader 生成资产订阅：AI 经 WebMCP 生成的资产立即出现在人类 UI，并自动预览最新一张
  useEffect(() => {
    let lastId: string | null = null;
    return subscribeAssets(() => {
      const list = listGeneratedAssets();
      setGeneratedAssets(list);
      setOtherAssets(listImportedAssets().filter((a) => !a.source.startsWith("shader:")));
      const newest = list[list.length - 1];
      if (newest?.dataUrl) setShaderPreview(newest.dataUrl);
      if (newest && newest.id !== lastId) {
        lastId = newest.id;
        setShaderStatus({
          msg: `已生成 ${newest.id} · ${newest.width}×${newest.height} · ${newest.bytes ?? 0} bytes`,
          kind: "ok",
        });
      }
    });
  }, []);

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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>3 · Demo 学习路径</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-[13px] text-muted-foreground">
            {DEMOS.length} 个内置 demo（basic / advanced / preprocess）：一键载入完整 spec 并渲染。
            preprocess demo 演示 <code>pre:&lt;key&gt;</code> 声明式生成 shader / icon / image / text 素材。
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[280px] flex-col gap-1">
              <Label htmlFor="demo-select-trigger" className="text-muted-foreground">
                Demo
              </Label>
              <Select value={demoId} onValueChange={(value) => setDemoId(String(value ?? ""))}>
                <SelectTrigger id="demo-select-trigger" className="w-full">
                  <SelectValue>{(value) => demoLabel(String(value ?? ""))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(["basic", "advanced", "preprocess"] as const).map((level) => (
                    <SelectGroup key={level}>
                      <SelectLabel>{level}</SelectLabel>
                      {DEMOS.filter((d) => d.level === level).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button id="demo-load-btn" onClick={() => void loadDemo(demoId)}>
              载入 Demo
            </Button>
            <Button
              id="preprocess-demo-btn"
              variant="outline"
              onClick={() => void loadDemo("preprocess-four-assets")}
            >
              载入预处理示例
            </Button>
          </div>
          <p id="demo-status" className={"min-h-[24px] text-sm font-semibold " + statusTextClass(demoStatus.kind)}>
            {demoStatus.msg}
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>4 · Shader 背景</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {SHADER_PRESETS.map((p) => (
              <Button
                key={p.id}
                id={`shader-preset-${p.id}`}
                size="sm"
                variant={shaderPresetId === p.id ? "default" : "outline"}
                onClick={() => setShaderPresetId(p.id)}
              >
                {p.name}
                {p.needsImage ? " · 需图片" : ""}
              </Button>
            ))}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {getShaderPreset(shaderPresetId)?.needsImage
              ? "处理型预设：默认用最近生成的 shader 资产或已导入图片作为输入，源资产不变。"
              : "生成型预设：页面内 WebGL2 光栅化，返回 asset:<id>，可直接用于 spec 全幅背景。"}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="shader-width">宽</Label>
              <Input
                id="shader-width"
                ref={shaderWidthRef}
                type="number"
                min={16}
                max={4096}
                defaultValue={1080}
                className="w-[110px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="shader-height">高</Label>
              <Input
                id="shader-height"
                ref={shaderHeightRef}
                type="number"
                min={16}
                max={4096}
                defaultValue={1440}
                className="w-[110px]"
              />
            </div>
            <Button id="shader-generate-btn" onClick={() => void onGenerateShader()}>
              生成背景
            </Button>
          </div>
          <div className="overflow-auto rounded-lg border border-input bg-muted/30 p-2">
            {shaderPreview ? (
              <img
                id="shader-preview"
                src={shaderPreview}
                alt="Shader 生成预览"
                className="mx-auto block h-auto max-h-[360px] w-auto max-w-full"
              />
            ) : (
              <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                还没有生成结果…
              </div>
            )}
          </div>
          <p id="shader-status" className={"min-h-[26px] text-base font-semibold " + statusTextClass(shaderStatus.kind)}>
            {shaderStatus.msg}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground">生成资产（{generatedAssets.length}）</Label>
            {generatedAssets.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                还没有生成的 shader 资产；AI 生成后会自动出现在这里。
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {generatedAssets.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-muted/30 px-2 py-1.5 text-[12px]"
                  >
                    <span className="font-mono font-semibold">{a.id}</span>
                    <span className="text-muted-foreground">
                      {a.name} · {a.width}×{a.height} · {a.bytes ?? 0} bytes
                    </span>
                    <Button size="xs" variant="outline" onClick={() => setShaderPreview(a.dataUrl ?? null)}>
                      预览
                    </Button>
                    <Button
                      id={`shader-use-${a.id}`}
                      size="xs"
                      variant="outline"
                      onClick={() => useAssetInSpec(a.id)}
                    >
                      用于 spec
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground">图标 / 文本 / 预处理资产（{otherAssets.length}）</Label>
            {otherAssets.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                还没有图标/文本/预处理资产；用 get_icon、preprocess 或 import_asset 生成后会自动出现在这里。
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {otherAssets.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-muted/30 px-2 py-1.5 text-[12px]"
                  >
                    <span className="font-mono font-semibold">{a.id}</span>
                    <span className="text-muted-foreground">
                      {a.type} · {a.name} · {a.width ?? "?"}×{a.height ?? "?"} · {a.bytes ?? 0} bytes
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">{a.source}</span>
                    <Button size="xs" variant="outline" onClick={() => setShaderPreview(a.dataUrl ?? null)}>
                      预览
                    </Button>
                    <Button
                      id={`asset-use-${a.id}`}
                      size="xs"
                      variant="outline"
                      onClick={() => useAssetInSpec(a.id)}
                    >
                      用于 spec
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        canvas · Satori 确定性出图 · JSON spec → SVG / PNG · 纯静态零后端 · Powered by{" "}
        <a
          className="font-semibold text-link"
          href="https://shaders.paper.design"
          target="_blank"
          rel="noreferrer"
        >
          Paper Shaders
        </a>
      </footer>
    </div>
  );
}
