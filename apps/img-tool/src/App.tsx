/*
 * 图片处理工具站 —— apps/img-tool/src/App.tsx
 *
 * 迁移自原单文件 index.html（2026-10-30 规范化进 fde2e-tools）。
 * **功能与行为保真红线**：
 * - URL 参数契约一字不改（src/text/pos/size/color/bg/pad/w/h/label，见 painter.ts
 *   与页首 ai-guide）——已有智能体按参数调用。
 * - 可交互元素 id 不变：canvas-result / download-btn / copy-btn / src-input /
 *   load-url-btn / load-sample-btn / file-input / srcdrop / status / ai-guide。
 * - 底图两级加载（先 CORS 匿名，失败回退普通加载并标记画布受限）、导出闸门、
 *   下载/复制文案、粘贴与拖放行为逐字保留。
 * 视觉升级到 solid-glass 标准（shadcn 官方件 + 主题 token）。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { Input } from "@fde2e-tools/shared/ui/input";
import { Label } from "@fde2e-tools/shared/ui/label";
import { buildSampleDataURL, CORS_MSG, draw, drawPlaceholder, type DrawInfo } from "./painter";
import { imgBridge } from "./bridge";
import { registerAppTools } from "./webmcp";

// 示例链接升级为绝对地址，便于代理「复制链接地址」直接得到完整调用 URL（原版启动期同款升级）
const ABS_BASE =
  typeof window === "undefined" || window.location.origin === "null"
    ? ""
    : window.location.origin + window.location.pathname;

const EX_LINKS = [
  {
    label: "示例 1 · 打开即渲染",
    href:
      ABS_BASE +
      "?src=sample&text=%E6%B8%85%E6%99%A8%E7%9A%84%E9%9D%92%E6%97%85%0A%E4%BB%8E%E4%B8%80%E6%9D%AF%E5%92%96%E5%95%A1%E5%BC%80%E5%A7%8B&pos=bottom&label=%E6%95%88%E6%9E%9C%E5%9B%BE",
  },
  {
    label: "示例 2 · 打开即渲染",
    href:
      ABS_BASE +
      "?src=sample&w=1080&h=1440&text=%E9%9D%92%E6%97%85%E9%81%BF%E5%9D%91%E6%8C%87%E5%8D%97%0A%E4%BA%94%E6%9D%A1%E5%AE%9E%E6%88%98%E7%BB%8F%E9%AA%8C&pos=center&size=88&color=%23ffffff&bg=%23000000&pad=30&label=%E6%95%88%E6%9E%9C%E5%9B%BE",
  },
  {
    label: "示例 3 · 打开即渲染",
    href:
      ABS_BASE +
      "?src=https%3A%2F%2Fomni.fde2e.com%2Fuploads%2Fc2afc5d4-bbb6-468e-b76a-d9a350d5f250.png&text=%E7%B4%A0%E6%9D%90%E5%BA%93%E7%9B%B4%E8%AF%BB%E7%A4%BA%E4%BE%8B&pos=top&label=%E6%95%88%E6%9E%9C%E5%9B%BE",
  },
];

interface Status {
  msg: string;
  kind: StatusKind;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const srcInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 最近一次成功载入的底图与跨域状态（命令式状态，不驱动渲染）
  const baseImgRef = useRef<HTMLImageElement | null>(null);
  const baseTaintedRef = useRef(false);
  const [status, setStatus] = useState<Status>({
    msg: "等待底图：上传 / 粘贴 / 载入示例图，或带 ?src= 参数打开本页。",
    kind: "ok",
  });
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");

  function setKind(msg: string, kind: StatusKind = "ok") {
    setStatus({ msg, kind });
  }

  function afterRender(info: DrawInfo) {
    const taintNote = baseTaintedRef.current
      ? " · 画布受限（图源无 CORS 头，可看不可导）"
      : "";
    setKind(
      "渲染完成：" +
        info.W +
        "×" +
        info.H +
        " px" +
        (info.textOn ? " · 已叠加文字" : "") +
        (info.labelOn ? " · 已加角标" : "") +
        taintNote,
      baseTaintedRef.current ? "warn" : "ok",
    );
  }

  function useImage(img: HTMLImageElement, tainted: boolean) {
    baseImgRef.current = img;
    baseTaintedRef.current = tainted;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const info = draw(canvas, img);
    afterRender(info);
  }

  /** 底图加载（两级：先 CORS 匿名，失败回退普通加载）——语义与原版一致 */
  function loadImage(src: string, allowFallback: boolean) {
    setKind("正在加载底图…", "ok");
    const img = new Image();
    const isRemote = /^https?:/i.test(src);
    if (isRemote) img.crossOrigin = "anonymous";
    img.onload = () => useImage(img, false);
    img.onerror = () => {
      if (isRemote && allowFallback) {
        // 图源无 CORS 头：回退普通加载，渲染可用但画布受限
        const img2 = new Image();
        img2.onload = () => {
          baseImgRef.current = img2;
          baseTaintedRef.current = true;
          const canvas = canvasRef.current;
          if (canvas) {
            const info = draw(canvas, img2);
            if (info) afterRender(info);
          }
          setKind("已显示（画布受限：导出不可用）。" + CORS_MSG + "。", "warn");
        };
        img2.onerror = () => {
          setKind("底图加载失败：地址不可达或非图片（404/格式不支持/网络错误）。", "error");
        };
        img2.src = src;
      } else {
        setKind("底图加载失败：地址不可达或非图片（404/格式不支持/网络错误）。", "error");
      }
    };
    img.src = src;
  }

  function loadFromUrl(u: string | null) {
    const v = (u || "").trim();
    if (!v) {
      setKind("请先输入图片 URL。", "error");
      return;
    }
    if (v === "sample") {
      loadSample();
      return;
    }
    loadImage(v, true);
  }

  function loadSample() {
    loadImage(buildSampleDataURL(), false);
  }

  function readLocalFile(file: File | null) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      loadImage(String(r.result || ""), false);
      setFileName(file.name);
      setKind("已载入本地图片 " + file.name + "，正在渲染…", "ok");
    };
    r.onerror = () => setKind("本地文件读取失败，请重试。", "error");
    r.readAsDataURL(file);
  }

  function guardTaint(): boolean {
    if (baseTaintedRef.current) {
      setKind("导出失败：" + CORS_MSG + "。", "error");
      return true;
    }
    return false;
  }

  function onDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!baseImgRef.current) {
      setKind("还没有底图：先载入图片再导出。", "error");
      return;
    }
    if (guardTaint()) return;
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            setKind("导出失败：画布生成 PNG 为空。", "error");
            return;
          }
          // WebMCP export_png filename 参数（F1）：一次性覆盖后复位（页面按钮缺省名不变）
          const name = imgBridge.downloadName ?? "img-tool-" + canvas.width + "x" + canvas.height + ".png";
          imgBridge.downloadName = null;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          setKind("导出成功：浏览器已下载 " + name, "ok");
        },
        "image/png",
      );
    } catch {
      setKind("导出失败：" + CORS_MSG + "。", "error");
    }
  }

  function fallbackCopy(text: string): boolean {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-10000px";
    document.body.appendChild(ta);
    ta.select();
    let done = false;
    try {
      done = document.execCommand("copy");
    } catch {
      done = false;
    }
    ta.remove();
    if (!done) {
      setKind("复制失败：浏览器拒绝剪贴板访问，请改用「下载 PNG」。", "error");
    }
    return done;
  }

  function onCopy() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!baseImgRef.current) {
      setKind("还没有底图：先载入图片再复制。", "error");
      return;
    }
    if (guardTaint()) return;
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      setKind("复制失败：" + CORS_MSG + "。", "error");
      return;
    }
    const ok = () =>
      setKind("复制成功：PNG Data URL 已写入剪贴板（长度 " + dataUrl.length + " 字符）。", "ok");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(dataUrl).then(ok, () => {
        fallbackCopy(dataUrl) && ok();
      });
    } else {
      fallbackCopy(dataUrl) && ok();
    }
  }

  // ---------- 启动：占位 + ?src= 契约（StrictMode 双跑幂等） + WebMCP ----------
  useEffect(() => {
    // WebMCP 桥：把底图命令式状态暴露给注册工具（overlay_text 无 src 时重绘当前底图）
    imgBridge.redraw = () => {
      const canvas = canvasRef.current;
      const img = baseImgRef.current;
      if (!canvas || !img) return;
      const info = draw(canvas, img);
      if (info) afterRender(info);
    };
    imgBridge.hasImage = () => baseImgRef.current !== null;
    void registerAppTools();
    const canvas = canvasRef.current;
    if (canvas) drawPlaceholder(canvas);
    let q: URLSearchParams;
    try {
      q = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    if (q.get("src") !== null) loadFromUrl(q.get("src"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 全局粘贴（截图直贴） ----------
  useEffect(() => {
    function onPaste(ev: ClipboardEvent) {
      const items = ev.clipboardData && ev.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf("image/") === 0) {
          readLocalFile(items[i].getAsFile());
          setKind("已接收粘贴的图片，正在渲染…", "ok");
          ev.preventDefault();
          return;
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-14">
      <h1 className="mt-2 mb-1 text-[28px] font-semibold text-foreground">
        图片处理工具站 · URL 参数即绘制指令
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        带参数打开＝一次函数调用：底图加载 → 文字/角标叠加 → 画布渲染，一步到位。纯前端工具，图片不离开本机（仅浏览器直接拉取底图）。
      </p>

      <AiGuide>
        {`===== AI 使用说明（给自动化代理读的纯文本） =====
本页是「图片处理工具站」：URL 参数即绘制指令，打开页面＝一次函数调用，
渲染结果直接显示在 <canvas id="canvas-result">，无参数时也可手工上传/粘贴图片。

参数表（全部可组合，顺序无关；颜色要写成 %23rrggbb，即 # 的 URL 编码）：
- src      底图地址。支持 https 图片 URL（如 omni 素材库 /uploads/*.png）、data: URL；
           魔法值 src=sample 使用内置示例底图（离线可测）。省略时进入手工上传/粘贴模式。
- text     叠加文字。换行用 %0A（URL 编码的 \\n）；可省略。
- pos      文字块垂直位置：top | center | bottom（默认 bottom）。
- size     文字字号 px（省略时随画布宽度自适应，约宽度的 6%）。
- color    文字颜色 %23rrggbb（默认 %23ffffff 白色，无底衬时自动加深色投影保证可读）。
- bg       文字底衬颜色 %23rrggbb；bg=none 或省略＝无底衬（纯文字+投影）。
- pad      内边距 px（默认 24）：底衬厚度；pos=top/bottom 时也是文字块距画布边缘的距离。
- w / h    输出画布尺寸 px。只给 w 或 h：另一边按底图纵横比推算；
           同时给 w 与 h：底图按纵横比缩放至填满画布并居中裁切（cover），输出严格 w×h。
- label    左上角小角标文字（如「效果图」——AI 生成图禁冒充实拍的合规角标）。可省略。

示例链接（点击＝一次函数调用示范；三链接的参数已与上表自洽）：
1. 示例底图 + 底部文字 + 合规角标：
   `}
        <a className="ex-link" href={EX_LINKS[0].href}>
          {EX_LINKS[0].label}
        </a>
        {`
2. 固定 1080×1440 输出 + 居中白字黑底衬：
   `}
        <a className="ex-link" href={EX_LINKS[1].href}>
          {EX_LINKS[1].label}
        </a>
        {`
3. 直读 omni 素材库公开图（https 远程底图）：
   `}
        <a className="ex-link" href={EX_LINKS[2].href}>
          {EX_LINKS[2].label}
        </a>
        {`

取走结果：
- 点按钮 id=download-btn（文案「下载 PNG」）→ 浏览器下载 img-tool-<宽>x<高>.png。
- 点按钮 id=copy-btn（文案「复制结果为 Data URL」）→ PNG data: URL 写入剪贴板，
  可把产物再交给 from-url 类通道消费。状态行 id=status 实时反馈每一步。

跨域说明：页面先按 crossOrigin=anonymous 拉取底图（可导出）；若图源不返回 CORS 头，
自动回退为普通加载——渲染照常显示，但浏览器会把画布标记为受限，此时导出会得到一行人话提示：
「该图源不允许跨域读取，请先把图转入素材库再用其 /uploads 地址」。
data: URL 底图不受此限制，导出永远可用。`}
      </AiGuide>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(340px,1fr)_minmax(340px,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>1 · 图片来源</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              id="srcdrop"
              onDragOver={(ev) => {
                ev.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(ev) => {
                ev.preventDefault();
                setDragOver(false);
                const f = ev.dataTransfer?.files?.[0];
                if (f) {
                  readLocalFile(f);
                  setKind("已接收拖入文件 " + f.name + "，正在渲染…", "ok");
                }
              }}
              className={
                "flex flex-col gap-2.5 rounded-lg border-2 border-dashed p-3 " +
                (dragOver ? "border-ring" : "border-input")
              }
            >
              <Label htmlFor="src-input" className="text-muted-foreground">
                或输入图片 URL：
              </Label>
              <Input
                id="src-input"
                ref={srcInputRef}
                type="text"
                placeholder="https://…/uploads/xxx.png 或 data:image/png;base64,…"
                spellCheck={false}
                autoComplete="off"
                className="h-auto py-2.5 font-mono text-sm"
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") loadFromUrl(srcInputRef.current?.value ?? "");
                }}
              />
              <div className="flex flex-wrap gap-2.5">
                <Button
                  id="load-url-btn"
                  variant="outline"
                  onClick={() => loadFromUrl(srcInputRef.current?.value ?? "")}
                >
                  从 URL 载入
                </Button>
                <Button id="load-sample-btn" variant="outline" onClick={loadSample}>
                  载入示例图
                </Button>
              </div>
              <Label htmlFor="file-input" className="text-muted-foreground">
                或选择本地图片：
              </Label>
              {/* 原生 input sr-only 保形：id/fileInput 契约不变（agent 程序化
                  setInputFiles 兼容），视觉走官方按钮（视觉打磨 2026-10-30 修复项 3） */}
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  id="file-input"
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={() => readLocalFile(fileRef.current?.files?.[0] ?? null)}
                  className="sr-only"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  选择本地图片
                </Button>
                {fileName && (
                  <span className="text-sm text-muted-foreground">{fileName}</span>
                )}
              </div>
              <p className="m-0 text-sm text-muted-foreground">
                也可以直接 Ctrl/Cmd+V 粘贴截图，或把图片文件拖进本框。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · 渲染结果与导出</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <canvas
              id="canvas-result"
              ref={canvasRef}
              width={1200}
              height={800}
              className="block h-auto w-full rounded-lg border border-input"
            >
              当前浏览器不支持 canvas
            </canvas>
            <div className="flex flex-wrap gap-2.5">
              <Button id="download-btn" className="flex-1" onClick={onDownload}>
                下载 PNG
              </Button>
              <Button id="copy-btn" variant="outline" className="flex-1" onClick={onCopy}>
                复制结果为 Data URL
              </Button>
            </div>
            <p id="status" className={"min-h-[26px] text-base font-semibold " + statusTextClass(status.kind)}>
              {status.msg}
            </p>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        img-tool · 纯静态零后端零外链 · URL 参数即绘制指令 · 网页链接＝函数调用
      </footer>
    </div>
  );
}
