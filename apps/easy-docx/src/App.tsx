/*
 * 文档生成站 —— apps/docx/src/App.tsx
 *
 * 「Markdown 子集 → .docx」纯客户端生成站（docx 库 MIT，零后端零上传）。
 * 惯例对齐 pdf-tool 范式：
 * - 可交互元素 id 稳定：input-md / load-sample / preview-btn / generate-docx-btn /
 *   preview / status / ai-guide——ai-guide 是行为的一部分；
 * - 输入非受控（ref 读 DOM 值）：智能体程序化 set value 后点按钮必须生效；
 * - 解析单源＝md-parse.ts（同一 AST 驱动预览与 docx 模型，预览与产物不漂移）。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { scrollStatusIntoView, statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { SAMPLE_MD } from "./sample";
import { generateDocx } from "./docx-gen";
import { getExportName, setExportName } from "./export-name";
import {
  docStats,
  parseMarkdownSub,
  statsSummary,
  type Block,
  type Inline,
} from "./md-parse";
import { registerAppTools } from "./webmcp";

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是「Markdown 子集 → .docx」纯静态生成站：docx 库（MIT）在浏览器本地生成，零后端、零上传。

支持语法（子集）：
- 标题：#/##/###（#### 及更深按普通段落）
- 段落：每个非空非结构行一个段落
- 列表：「- 」无序 /「1. 」有序（数字+.+空格）
- 表格：连续以 | 开头的行（|---|---| 分隔行可选，会被跳过）
- 行内：**粗体** / *斜体*

操作步骤：
1. 把 Markdown 填入输入框 <textarea id="input-md">；点按钮 id=load-sample（文案「载入示例」）可载入内置示例文档（含标题/粗斜/列表/表格）。
2. 点按钮 id=preview-btn（文案「刷新预览」），下方 <div id="preview"> 显示解析出的文档结构（与产物同源）。
3. 点按钮 id=generate-docx-btn（文案「生成 .docx 下载」），浏览器开始下载 easy-docx-export.docx（v2 F19 缺省名；旧名 docx-export.docx 可传 filename 复现）。
4. 状态行 id=status 显示「已生成 easy-docx-export.docx（…）」即完成。

备注：
- URL 参数 ?sample=1（或 sample/示例）自动载入示例并刷新预览，不触发生成——URL 不承载数据（大数据走本输入区或 WebMCP 传参）。
- WebMCP 工具：create_docx（markdown[, filename] → 生成并下载）、append_docx_markdown（向当前文档追加 md 片段）。
- 所有可交互元素都有稳定 id；id=status 实时反馈（成功 ok 色 / 失败 error 色）。`;

interface Status {
  msg: string;
  kind: StatusKind;
}

function InlineRuns({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((seg, i) =>
        seg.bold ? (
          <strong key={i}>{seg.text}</strong>
        ) : seg.italic ? (
          <em key={i}>{seg.text}</em>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function BlocksView({ blocks }: { blocks: Block[] }) {
  // 有序列表序号：与 docx 产物一致（连续 ordered 段递增）
  const ordinals = new Array<number>(blocks.length);
  let ord = 0;
  blocks.forEach((b, i) => {
    if (b.kind === "ordered") {
      ord += 1;
      ordinals[i] = ord;
    } else {
      ord = 0;
    }
  });
  return (
    <div className="flex flex-col gap-2.5 text-[15px]/7 text-foreground">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return b.level === 1 ? (
              <h2 key={i} className="m-0 mt-1 text-xl font-bold">{<InlineRuns inlines={b.inlines} />}</h2>
            ) : b.level === 2 ? (
              <h3 key={i} className="m-0 mt-1 text-lg font-bold">{<InlineRuns inlines={b.inlines} />}</h3>
            ) : (
              <h4 key={i} className="m-0 mt-1 text-base font-bold">{<InlineRuns inlines={b.inlines} />}</h4>
            );
          case "paragraph":
            return <p key={i} className="m-0">{<InlineRuns inlines={b.inlines} />}</p>;
          case "bullet":
            return (
              <div key={i} className="ml-4 flex gap-2">
                <span aria-hidden className="select-none">•</span>
                <span>{<InlineRuns inlines={b.inlines} />}</span>
              </div>
            );
          case "ordered":
            return (
              <div key={i} className="ml-4 flex gap-2">
                <span className="font-mono text-muted-foreground">{ordinals[i]}.</span>
                <span>{<InlineRuns inlines={b.inlines} />}</span>
              </div>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-md border border-input">
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={ri} className={ri === 0 ? "bg-muted/60 font-semibold" : undefined}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="border border-input px-2.5 py-1">
                            <InlineRuns inlines={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

export default function App() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<Status>({
    msg: "等待输入：输入 Markdown 或点「载入示例」开始。",
    kind: "ok",
  });
  const [preview, setPreview] = useState<Block[] | null>(null);

  // 生成反馈折叠线修复：状态更新即滚入视口（block:nearest，已在视口则零滚动）
  function showStatus(s: Status) {
    setStatus(s);
    scrollStatusIntoView();
  }

  function refreshPreview(): Block[] | null {
    const t = inputRef.current?.value ?? "";
    try {
      const blocks = parseMarkdownSub(t);
      setPreview(blocks);
      showStatus({ msg: `已按输入刷新预览：${statsSummary(blocks)}。`, kind: "ok" });
      return blocks;
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
    const blocks = refreshPreview();
    if (!blocks) return;
    const filename = getExportName();
    showStatus({ msg: "正在生成 .docx…", kind: "ok" });
    try {
      await generateDocx(blocks, filename);
      const s = docStats(blocks);
      showStatus({
        msg: `已生成 ${filename}（${statsSummary(blocks)} · 共 ${s.headings + s.paragraphs + s.bullets + s.ordered} 块）`,
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
    inputRef.current.value = SAMPLE_MD;
    const blocks = refreshPreview();
    if (blocks) {
      showStatus({ msg: "示例文档已载入并刷新预览，点「生成 .docx 下载」即可。", kind: "ok" });
    }
  }

  // WebMCP：create_docx / append_docx_markdown（原生或官方 polyfill，均幂等）
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
        文档生成站 · 从 Markdown 生成真正的 .docx 文件
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        输入 Markdown 子集 → 结构预览 → 一键生成 .docx。docx 库在浏览器本地生成，内容不离开本机。
      </p>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(340px,1fr)_minmax(340px,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>1 · 输入 Markdown（子集）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <textarea
              id="input-md"
              ref={inputRef}
              placeholder={"# 标题\n\n段落与 **粗** *斜*…\n- 列表项"}
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
                <BlocksView blocks={preview} />
              ) : (
                <div className="flex h-[120px] flex-col items-center justify-center">
                  <p className="m-0 text-sm text-muted-foreground">
                    载入内容后此处显示文档结构预览
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button id="generate-docx-btn" size="lg" className="flex-1" onClick={() => void onGenerate()}>
                生成 .docx 下载
              </Button>
            </div>
            <p id="status" className={"min-h-[26px] text-base font-semibold " + statusTextClass(status.kind)}>
              {status.msg}
            </p>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        文档生成站 · 纯静态零后端 · docx 库（MIT）浏览器本地生成 · 解析单源（预览=产物） · 生成库独立分包
      </footer>
    </div>
  );
}
