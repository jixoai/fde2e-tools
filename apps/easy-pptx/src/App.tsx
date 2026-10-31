/*
 * 幻灯生成站 —— apps/pptx/src/App.tsx
 *
 * 「大纲 JSON → .pptx」纯客户端生成站（pptxgenjs MIT，零后端零上传）。
 * 惯例对齐 pdf-tool 范式：
 * - 可交互元素 id 稳定：input-json / load-sample / preview-btn / generate-pptx-btn /
 *   preview / status / ai-guide——ai-guide 是行为的一部分；
 * - 输入非受控（ref 读 DOM 值）：智能体程序化 set value 后点按钮必须生效；
 * - 解析单源＝spec.ts（同一份解析驱动预览与 pptx 模型）。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { scrollStatusIntoView, statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { sampleDeckJson } from "./sample";
import { generatePptx } from "./generate";
import { getExportName, setExportName } from "./export-name";
import { deckStats, parseDeckJson, type DeckSpec } from "./spec";
import { registerAppTools } from "./webmcp";

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是「大纲 JSON → .pptx」纯静态生成站：pptxgenjs（MIT）在浏览器本地生成（16:9），零后端、零上传。

输入格式 <textarea id="input-json">：
{"slides":[{"title":"页标题","bullets":["要点1","要点2"],"notes":"演讲者备注"}]}
- 每页必须有 title；bullets 是字符串数组（可省略）；notes 可省略。

操作步骤：
1. 把 slides JSON 填入输入区；点按钮 id=load-sample（文案「载入示例」）可载入内置示例幻灯（多页/bullets/备注）。
2. 点按钮 id=preview-btn（文案「刷新预览」），下方 <div id="preview"> 显示页面大纲（标题/要点/备注标记）。
3. 点按钮 id=generate-pptx-btn（文案「生成 .pptx 下载」），浏览器开始下载 pptx-export.pptx。
4. 状态行 id=status 显示「已生成 pptx-export.pptx（N 页）」即完成。

备注：
- URL 参数 ?sample=1（或 sample/示例）自动载入示例并刷新预览，不触发生成——URL 不承载数据（大数据走本输入区或 WebMCP 传参）。
- WebMCP 工具：create_pptx（slides[, filename] → 生成并下载）、add_slide（向当前 slides 追加一页）。
- 所有可交互元素都有稳定 id；id=status 实时反馈（成功 ok 色 / 失败 error 色）。`;

interface Status {
  msg: string;
  kind: StatusKind;
}

export default function App() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<Status>({
    msg: "等待输入：粘贴 slides JSON 或点「载入示例」开始。",
    kind: "ok",
  });
  const [preview, setPreview] = useState<DeckSpec | null>(null);

  // 生成反馈折叠线修复：状态更新即滚入视口（block:nearest，已在视口则零滚动）
  function showStatus(s: Status) {
    setStatus(s);
    scrollStatusIntoView();
  }

  function refreshPreview(): DeckSpec | null {
    const t = inputRef.current?.value ?? "";
    try {
      const spec = parseDeckJson(t);
      setPreview(spec);
      const st = deckStats(spec);
      showStatus({
        msg: `已按输入刷新预览：${st.slideCount} 页 · ${st.bulletCount} 条要点。`,
        kind: "ok",
      });
      return spec;
    } catch (e) {
      setPreview(null);
      showStatus({
        msg: e instanceof Error && e.message ? e.message : String(e),
        kind: "error",
      });
      return null;
    }
  }

  async function onGenerate() {
    const spec = refreshPreview();
    if (!spec) return;
    const filename = getExportName();
    showStatus({ msg: "正在生成 .pptx…", kind: "ok" });
    try {
      await generatePptx(spec, filename);
      const st = deckStats(spec);
      showStatus({
        msg: `已生成 ${filename}（${st.slideCount} 页 · ${st.bulletCount} 条要点）`,
        kind: "ok",
      });
    } catch (e) {
      showStatus({
        msg: "生成失败：" + (e instanceof Error && e.message ? e.message : String(e)),
        kind: "error",
      });
    } finally {
      setExportName(undefined); // 复位缺省契约名（WebMCP filename 只管单次生成）
    }
  }

  function loadSample() {
    if (!inputRef.current) return;
    inputRef.current.value = sampleDeckJson();
    const spec = refreshPreview();
    if (spec) {
      showStatus({ msg: "示例幻灯已载入并刷新预览，点「生成 .pptx 下载」即可。", kind: "ok" });
    }
  }

  // WebMCP：create_pptx / add_slide（原生或官方 polyfill，均幂等）
  useEffect(() => {
    void registerAppTools();
  }, []);

  // ?sample=1 / sample / 示例：载入示例并刷新预览（不触发生成）
  useEffect(() => {
    let q: string | null = null;
    try {
      q = new URLSearchParams(window.location.search).get("sample");
    } catch {
      q = null;
    }
    if (q && (q === "sample" || q === "1" || q === "示例")) loadSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-14">
      <h1 className="mt-2 mb-1 text-[28px] font-semibold text-foreground">
        幻灯生成站 · 从大纲 JSON 生成真正的 .pptx 文件
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        粘贴 slides 大纲 → 页面预览 → 一键生成 .pptx（16:9）。pptxgenjs 在浏览器本地生成，内容不离开本机。
      </p>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(340px,1fr)_minmax(340px,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>1 · 输入大纲（slides JSON）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <textarea
              id="input-json"
              ref={inputRef}
              placeholder={'{"slides":[{"title":"页标题","bullets":["要点"],"notes":"备注"}]}'}
              spellCheck={false}
              className="min-h-[320px] w-full resize-y rounded-lg border border-input bg-background/60 p-3 font-mono text-[14px]/6 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
            />
            <div className="flex flex-wrap gap-2.5">
              <Button id="load-sample" variant="outline" size="lg" className="flex-1" onClick={loadSample}>
                载入示例
              </Button>
              <Button id="preview-btn" variant="outline" size="lg" className="flex-1" onClick={() => refreshPreview()}>
                刷新预览
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · 预览与生成</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div id="preview" className="max-h-[440px] min-h-[160px] overflow-auto rounded-lg border border-input bg-background/60 p-4">
              {preview ? (
                <ol className="m-0 flex list-none flex-col gap-3 p-0">
                  {preview.slides.map((s, i) => (
                    <li key={i} className="rounded-md border border-input bg-background/70 px-3 py-2">
                      <p className="m-0 text-[15px] font-semibold text-foreground">
                        {i + 1}. {s.title}
                      </p>
                      {s.bullets.length > 0 && (
                        <ul className="m-0 mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted-foreground">
                          {s.bullets.map((b, bi) => (
                            <li key={bi}>{b}</li>
                          ))}
                        </ul>
                      )}
                      {s.notes && (
                        <p className="m-0 mt-1 text-xs text-muted-foreground">备注：{s.notes}</p>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="flex h-[120px] flex-col items-center justify-center">
                  <p className="m-0 text-sm text-muted-foreground">
                    载入大纲后此处显示幻灯页面预览
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button id="generate-pptx-btn" size="lg" className="flex-1" onClick={() => void onGenerate()}>
                生成 .pptx 下载
              </Button>
            </div>
            <p id="status" className={"min-h-[26px] text-base font-semibold " + statusTextClass(status.kind)}>
              {status.msg}
            </p>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        幻灯生成站 · 纯静态零后端 · pptxgenjs（MIT）浏览器本地生成 · 生成库独立分包
      </footer>
    </div>
  );
}
