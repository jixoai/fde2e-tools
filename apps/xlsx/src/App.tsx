/*
 * 表格生成站 —— apps/xlsx/src/App.tsx
 *
 * 「数据 → .xlsx」纯客户端生成站（SheetJS 社区版 Apache-2.0，零后端零上传）。
 * 惯例对齐 pdf-tool 范式：
 * - 可交互元素 id 稳定：input-json / input-tsv / load-sample / preview-btn /
 *   generate-xlsx-btn / preview / status / ai-guide——ai-guide 是行为的一部分；
 * - 输入类非受控（ref 读 DOM 值）：智能体程序化 set value 后点按钮必须生效；
 * - 状态行文案含终态词（已生成/已载入/已按/失败/请先），中间态不含终态词。
 * 解析单源＝spec.ts（预览与生成同一份解析）；生成库动态 import 按需分包。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { scrollStatusIntoView, statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { Label } from "@fde2e-tools/shared/ui/label";
import { sampleWorkbookJson } from "./sample";
import { generateXlsx } from "./generate";
import { getExportName, setExportName } from "./export-name";
import { parseTsv, parseWorkbookJson, workbookStats, type WorkbookSpec } from "./spec";
import { registerAppTools } from "./webmcp";

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是「数据 → .xlsx」纯静态生成站：SheetJS 社区版（Apache-2.0）在浏览器本地生成，零后端、零上传。

两种输入（任选其一；两者都有内容时 JSON 优先）：
1. JSON 输入 <textarea id="input-json">：{"sheets":[{"name":"表名","rows":[[单元格,...],...]}]}
   - rows 是二维数组；单元格支持 字符串/数字/布尔/null；表名 ≤31 字符且不得重复（省略 name 自动 Sheet1..N）。
2. 粘贴表格 <textarea id="input-tsv">：直接粘贴 TSV（Tab 分列、换行分行）；形如「## 表名」的行开启新工作表（缺省首表 Sheet1）；纯数字单元格自动转数字。

操作步骤：
1. 把数据填入上述输入区；点按钮 id=load-sample（文案「载入示例」）可载入内置示例工作簿（含负数/小数/布尔/多表）。
2. 点按钮 id=preview-btn（文案「刷新预览」），下方 <div id="preview"> 显示解析出的工作表结构（首行按表头样式）。
3. 点按钮 id=generate-xlsx-btn（文案「生成 .xlsx 下载」），浏览器开始下载 xlsx-export.xlsx。
4. 状态行 id=status 显示「已生成 xlsx-export.xlsx（N 个工作表 · M 行）」即完成。

备注：
- URL 参数 ?sample=1（或 sample/示例）自动载入示例并刷新预览，不触发生成——URL 不承载数据（大数据走本输入区或 WebMCP 传参）。
- WebMCP 工具：create_xlsx（sheets[, filename] → 生成并下载）、add_sheet_sample（向当前工作簿追加一张示例表）。
- 所有可交互元素都有稳定 id；id=status 实时反馈（成功 ok 色 / 失败 error 色）。`;

interface Status {
  msg: string;
  kind: StatusKind;
}

export default function App() {
  const inputJsonRef = useRef<HTMLTextAreaElement>(null);
  const inputTsvRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<Status>({
    msg: "等待输入：粘贴 JSON、粘贴表格，或点「载入示例」开始。",
    kind: "ok",
  });
  const [preview, setPreview] = useState<WorkbookSpec | null>(null);

  // 生成反馈折叠线修复：状态更新即滚入视口（block:nearest，已在视口则零滚动）
  function showStatus(s: Status) {
    setStatus(s);
    scrollStatusIntoView();
  }

  // 解析单源：读两个输入区（JSON 优先），返回解析后的工作簿；人话错误进状态行
  function resolveSpec(): WorkbookSpec {
    const json = inputJsonRef.current?.value ?? "";
    const tsv = inputTsvRef.current?.value ?? "";
    if (!json.trim() && !tsv.trim()) {
      throw new Error("输入为空：请先粘贴 JSON、粘贴表格，或点「载入示例」。");
    }
    return json.trim() ? parseWorkbookJson(json) : parseTsv(tsv);
  }

  function refreshPreview(): WorkbookSpec | null {
    try {
      const spec = resolveSpec();
      setPreview(spec);
      const st = workbookStats(spec);
      showStatus({
        msg: `已按输入刷新预览：${st.sheetCount} 个工作表 · ${st.rowCount} 行。`,
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
    showStatus({ msg: "正在生成 .xlsx…", kind: "ok" });
    try {
      await generateXlsx(spec, filename);
      const st = workbookStats(spec);
      showStatus({
        msg: `已生成 ${filename}（${st.sheetCount} 个工作表 · ${st.rowCount} 行）`,
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
    if (!inputJsonRef.current) return;
    inputJsonRef.current.value = sampleWorkbookJson();
    const spec = refreshPreview();
    if (spec) {
      showStatus({ msg: "示例工作簿已载入并刷新预览，点「生成 .xlsx 下载」即可。", kind: "ok" });
    }
  }

  // WebMCP：create_xlsx / add_sheet_sample（原生或官方 polyfill，均幂等）
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
        表格生成站 · 从数据生成真正的 .xlsx 文件
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        粘贴 JSON 或表格 → 结构预览 → 一键生成 .xlsx。SheetJS 在浏览器本地生成，内容不离开本机。
      </p>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(340px,1fr)_minmax(340px,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>1 · 输入数据（JSON 或粘贴表格）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Label htmlFor="input-json" className="text-muted-foreground">
              JSON（{"{"}sheets:[{"{"}name, rows{"}"}]{"}"}；优先）
            </Label>
            <textarea
              id="input-json"
              ref={inputJsonRef}
              placeholder={'{"sheets":[{"name":"表名","rows":[["列A","列B"],[1,2]]}]}'}
              spellCheck={false}
              className="min-h-[180px] w-full resize-y rounded-lg border border-input bg-background/60 p-3 font-mono text-[14px]/6 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
            />
            <Label htmlFor="input-tsv" className="text-muted-foreground">
              粘贴表格（TSV：Tab 分列，「## 表名」分工作表）
            </Label>
            <textarea
              id="input-tsv"
              ref={inputTsvRef}
              placeholder={"从 Excel 复制直接粘贴；## 表名 开启新工作表"}
              spellCheck={false}
              className="min-h-[120px] w-full resize-y rounded-lg border border-input bg-background/60 p-3 font-mono text-[14px]/6 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
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
            <div id="preview" className="max-h-[520px] min-h-[160px] overflow-auto rounded-lg border border-input bg-background/60 p-3">
              {preview ? (
                <div className="flex flex-col gap-4">
                  {preview.sheets.map((s) => (
                    <div key={s.name}>
                      <p className="m-0 mb-1.5 text-sm font-semibold text-foreground">{s.name}</p>
                      <div className="overflow-x-auto rounded-md border border-input">
                        <table className="w-full border-collapse text-sm">
                          <tbody>
                            {s.rows.map((row, ri) => (
                              <tr key={ri} className={ri === 0 ? "bg-muted/60 font-semibold" : undefined}>
                                {row.map((cell, ci) => (
                                  <td
                                    key={ci}
                                    className={
                                      "border border-input px-2.5 py-1 whitespace-nowrap " +
                                      (typeof cell === "number"
                                        ? "text-right font-mono tabular-nums"
                                        : "text-foreground")
                                    }
                                  >
                                    {cell === null || cell === undefined ? "" : String(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-[120px] flex-col items-center justify-center">
                  <p className="m-0 text-sm text-muted-foreground">
                    载入数据后此处显示工作表结构预览
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button id="generate-xlsx-btn" size="lg" className="flex-1" onClick={() => void onGenerate()}>
                生成 .xlsx 下载
              </Button>
            </div>
            <p id="status" className={"min-h-[26px] text-base font-semibold " + statusTextClass(status.kind)}>
              {status.msg}
            </p>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        表格生成站 · 纯静态零后端 · SheetJS 社区版（Apache-2.0）浏览器本地生成 · 生成库独立分包
      </footer>
    </div>
  );
}
