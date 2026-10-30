/*
 * URL 拼接器 —— apps/url-tool/src/App.tsx
 *
 * 迁移自原单文件 index.html（2026-10-30 规范化进 fde2e-tools）。
 * **功能与行为保真红线**：
 * - URL 参数契约一字不改：?base=&mode=&<k>=<v>… 预填即出结果（base/mode/decode
 *   为保留键）；?decode=<q> 反向解码——已有智能体在用。
 * - packed 编码链（JSON→encodeURIComponent→base64url）与 query 拼接语义
 *   （保留重复键、base 已有 query 续接、相对地址字符串兜底）逐字保留。
 * - 可交互元素 id 不变：base-url / params-rows / add-param-btn / mode-query /
 *   mode-packed / mode-hint / result-url / copy-btn / open-btn / decode-panel /
 *   decode-table / decode-json / decode-load-btn / status / ai-guide。
 * - 参数行读值走 DOM（querySelectorAll .prow），与原版 collectPairs 同构——
 *   智能体程序化 set input.value 后点按钮仍能正确取值（非受控行）。
 * 视觉升级到 solid-glass 标准（shadcn 官方件 + 主题 token）。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { Input } from "@fde2e-tools/shared/ui/input";
import { Label } from "@fde2e-tools/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@fde2e-tools/shared/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fde2e-tools/shared/ui/table";
import { b64urlDecode, joinQuery, packedQ } from "./b64";
import { registerAppTools } from "./webmcp";

// 示例链接升级为绝对地址，便于代理「复制链接地址」直接得到完整调用 URL（原版启动期同款升级）
const ABS_BASE =
  typeof window === "undefined" || window.location.origin === "null"
    ? ""
    : window.location.origin + window.location.pathname;

const EX_PACK =
  "?base=https%3A%2F%2Fexample.com%2Fapi&mode=packed&title=%E4%BD%A0%E5%A5%BD&tag=abc";
const EX_DECODE =
  "?decode=JTdCJTIydGl0bGUlMjIlM0ElMjIlRTQlQkQlQTAlRTUlQTUlQkQlMjIlMkMlMjJ0YWclMjIlM0ElMjJhYmMlMjIlN0Q";

const MODE_HINT = {
  query: "查询串：k=v&k2=v2 直接追加；保留重复键。",
  packed: "packed：全部参数 JSON 化 → base64url → 单一 ?q=；重复键保留最后一个；非加密。",
} as const;

type Mode = keyof typeof MODE_HINT;

interface Status {
  msg: string;
  kind: StatusKind;
}

interface Row {
  id: number;
  k: string;
  v: string;
}

let nextRowId = 1;
function makeRow(k = "", v = ""): Row {
  return { id: nextRowId++, k, v };
}

// ---------- 启动期 URL 契约解析（一次） ----------
const QUERY = new URLSearchParams(window.location.search);
const HAS_DECODE = QUERY.has("decode");
const HAS_BASE = QUERY.has("base");
const INIT_BASE = HAS_BASE ? QUERY.get("base") || "" : "";
const INIT_MODE: Mode = QUERY.get("mode") === "packed" ? "packed" : "query";
function initRows(): Row[] {
  if (HAS_DECODE) return [makeRow(), makeRow()];
  if (HAS_BASE) {
    const rows: Row[] = [];
    QUERY.forEach((v, k) => {
      if (k === "base" || k === "mode" || k === "decode") return;
      rows.push(makeRow(k, v));
    });
    return rows;
  }
  return [makeRow(), makeRow()];
}

export default function App() {
  const baseUrlRef = useRef<HTMLInputElement>(null);
  const rowsElRef = useRef<HTMLDivElement>(null);
  const resultElRef = useRef<HTMLDivElement>(null);
  // 模式镜像 ref：事件里同步更新，buildResult 读它等价原版读 DOM checked
  const modeRef = useRef<Mode>(INIT_MODE);
  const [mode, setMode] = useState<Mode>(INIT_MODE);
  const [modeHint, setModeHint] = useState(MODE_HINT[INIT_MODE]);
  const [rows, setRows] = useState<Row[]>(initRows);
  const [result, setResult] = useState("（填写 base URL 后这里显示结果）");
  const [status, setStatus] = useState<Status>({
    msg: "等待输入：填写 base URL 与参数，结果实时生成。",
    kind: "ok",
  });
  // 解码视图（?decode=<q>）
  const [decodeVisible, setDecodeVisible] = useState(HAS_DECODE);
  const decodedPairsRef = useRef<[string, string][] | null>(null);
  const [decodePairs, setDecodePairs] = useState<[string, string][]>([]);
  const [decodeJson, setDecodeJson] = useState("");
  // 行结构变更后的跟进动作（重建结果/聚焦新行）
  const versionRef = useRef(0);
  const [version, setVersion] = useState(0);
  const pendingFocusRef = useRef(false);

  function setKind(msg: string, kind: StatusKind = "ok") {
    setStatus({ msg, kind });
  }

  function bumpVersion() {
    versionRef.current += 1;
    setVersion(versionRef.current);
  }

  /** 与原版 collectPairs 同构：从 DOM 收集非空键的键值对 */
  function collectPairs(): [string, string][] {
    const pairs: [string, string][] = [];
    rowsElRef.current?.querySelectorAll(".prow").forEach((row) => {
      const k = (row.querySelector(".pkey") as HTMLInputElement | null)?.value ?? "";
      const v = (row.querySelector(".pval") as HTMLInputElement | null)?.value ?? "";
      if (k.length > 0) pairs.push([k, v]);
    });
    return pairs;
  }

  function currentMode(): Mode {
    return modeRef.current;
  }

  /** 拼接主流程——与原版 buildResult 逐字同语义；返回结果字符串 */
  function buildResult(): string {
    const base = (baseUrlRef.current?.value ?? "").trim();
    const pairs = collectPairs();
    const modeNow = currentMode();
    if (!base) {
      setResult("（填写 base URL 后这里显示结果）");
      if (pairs.length === 0 && !baseUrlRef.current?.value) {
        setKind("等待输入：填写 base URL 与参数，结果实时生成。", "ok");
      } else {
        setKind("请先填写 base URL（如 https://example.com/api）。", "error");
      }
      return "";
    }
    let resultStr: string;
    if (modeNow === "packed") {
      const strip = base.split("?")[0].split("#")[0];
      resultStr = strip + "?q=" + packedQ(pairs);
    } else {
      resultStr = joinQuery(base, pairs);
    }
    setResult(resultStr);
    setKind(
      "已生成（" +
        (modeNow === "packed" ? "packed 紧凑包" : "标准查询串") +
        " 模式）：URL 长度 " +
        resultStr.length +
        " 字符，" +
        pairs.length +
        " 个参数。",
      "ok",
    );
    return resultStr;
  }

  function addRow(k = "", v = "") {
    setRows((r) => [...r, makeRow(k, v)]);
    bumpVersion();
  }

  function deleteRow(id: number) {
    setRows((r) => r.filter((row) => row.id !== id));
    bumpVersion();
  }

  function onAddParam() {
    pendingFocusRef.current = true;
    addRow("", "");
  }

  function switchMode(next: Mode) {
    modeRef.current = next;
    setMode(next);
    setModeHint(MODE_HINT[next]);
    buildResult();
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
    return done;
  }

  function onCopy() {
    // 先按当前 DOM 重建一次（等价原版「任何输入事件都实时重建」的最终态；
    // 对智能体程序化 set value 后直接点复制的路径也成立）
    buildResult();
    const text = (resultElRef.current?.textContent ?? "").trim();
    if (!text || text.indexOf("（") === 0) {
      setKind("还没有可复制的结果，先填写 base URL。", "error");
      return;
    }
    const ok = () => setKind("复制成功：" + text.length + " 字符已写入剪贴板。", "ok");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        ok,
        () => {
          if (fallbackCopy(text)) ok();
          else setKind("复制失败：浏览器拒绝剪贴板访问，请手动选择结果文本复制。", "error");
        },
      );
    } else {
      if (fallbackCopy(text)) ok();
      else setKind("复制失败：浏览器拒绝剪贴板访问，请手动选择结果文本复制。", "error");
    }
  }

  function onOpen() {
    buildResult();
    const text = (resultElRef.current?.textContent ?? "").trim();
    if (!text || text.indexOf("（") === 0) {
      setKind("还没有可打开的结果，先填写 base URL。", "error");
      return;
    }
    // noopener 形态按规范返回 null，无法据此判断是否被拦截，统一以正向提示为准
    window.open(text, "_blank", "noopener");
    setKind("已在新的浏览器标签打开结果 URL（若被弹窗拦截请允许后重试）。", "ok");
  }

  /** 解码视图（?decode=<q>）——与原版 showDecode 逐字同语义 */
  function showDecode(qRaw: string | null) {
    setDecodeVisible(true);
    try {
      if (!qRaw) throw new Error("decode 参数为空");
      const json = decodeURIComponent(b64urlDecode(qRaw));
      const obj: unknown = JSON.parse(json);
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
        throw new Error("packed 内容不是扁平键值对象");
      }
      const pairs = Object.keys(obj as Record<string, unknown>).map((k) => [
        k,
        String((obj as Record<string, unknown>)[k]),
      ]) as [string, string][];
      decodedPairsRef.current = pairs;
      setDecodePairs(pairs);
      setDecodeJson(JSON.stringify(obj, null, 2));
      setKind("解码成功：q 值还原出 " + pairs.length + " 个参数（见上方表格）。", "ok");
    } catch (e) {
      decodedPairsRef.current = null;
      setDecodePairs([]);
      setDecodeJson(
        "解码失败：" +
          (e instanceof Error && e.message ? e.message : String(e)) +
          "\n收到 q（前 200 字符）：" +
          String(qRaw).slice(0, 200),
      );
      setKind("解码失败：q 不是有效的 packed 参数（应为本页 packed 模式生成的 ?q= 值）。", "error");
    }
  }

  function onLoadDecoded() {
    const pairs = decodedPairsRef.current;
    if (!pairs) {
      setKind("没有可载入的解码结果。", "error");
      return;
    }
    modeRef.current = "packed";
    setMode("packed");
    setModeHint(MODE_HINT.packed);
    setRows(pairs.map((kv) => makeRow(kv[0], kv[1])));
    bumpVersion();
    setKind("已把解码出的参数载入构建器（packed 模式），补上 base URL 即可复现。", "warn");
  }

  // ---------- 行结构变更后：聚焦新行 + 重建结果（commit 后 DOM 才是最新） ----------
  useEffect(() => {
    if (version === 0) return;
    if (pendingFocusRef.current) {
      pendingFocusRef.current = false;
      const inputs = rowsElRef.current?.querySelectorAll(".prow:last-child .pkey");
      if (inputs && inputs.length) (inputs[0] as HTMLInputElement).focus();
    }
    buildResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // ---------- 启动：WebMCP + ?decode= 反向解码 / ?base= 预填即出结果（StrictMode 双跑幂等） ----------
  useEffect(() => {
    void registerAppTools();
    if (HAS_DECODE) {
      showDecode(QUERY.get("decode"));
      return;
    }
    if (HAS_BASE) {
      buildResult();
      const modeName = currentMode() === "packed" ? "packed 紧凑包" : "标准查询串";
      setKind("已按 URL 参数预填并生成结果（" + modeName + " 模式），按钮 id=copy-btn 可复制。", "ok");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-14">
      <h1 className="mt-2 mb-1 text-[28px] font-semibold text-foreground">
        URL 拼接器 · 把复杂参数拼成一个紧凑 URL
      </h1>
      <p className="mb-4 text-[17px] text-muted-foreground">
        base URL ＋ 参数键值对 → 最终 URL。标准查询串或 packed 紧凑包（JSON → base64url 塞进单一
        ?q=）。纯前端工具，数据不离开本机。
      </p>

      <AiGuide>
        {`===== AI 使用说明（给自动化代理读的纯文本） =====
本页是「URL 拼接器」：把 base URL ＋ 一组参数拼成最终 URL。何时用：参数过长、含特殊字符
（中文/换行/引号/&/=）、或需要紧凑传递时。

两种模式：
1. 查询串（标准 query）：k=v&k2=v2 追加到 base 后；保留重复键；base 已有 query 会续接。
2. packed（紧凑包）：全部参数 JSON 化 → encodeURIComponent → base64url → 塞进单一 ?q= 参数。
   适合超长/多特殊字符参数。注意：packed 只把多个参数折成一个，键重复时保留最后一个；
   它不是加密，任何人都能解开——勿放密码/密钥等敏感信息。

一次调用直达（URL 参数即输入，打开即出结果）：
- ?base=<base URL>&mode=query|packed&<k1>=<v1>&<k2>=<v2>…
  （base 与 mode 是保留键，其余参数全部成为拼接参数；打开后结果直接显示在 <div id="result-url">）
  示例 1 · 预填并出结果：
  `}
        <a className="ex-link" href={ABS_BASE + EX_PACK}>
          示例 1 · 打开即拼接（packed）
        </a>
        {`
- 反向解码：?decode=<packed URL 里的 q 值> → 打开自动解析出键值对表 <table id="decode-table">。
  智能体拿到别人的 packed URL，把 q 值贴进 ?decode= 即可还原。
  示例 2 · 解码 q 值（内容即示例 1 的产物）：
  `}
        <a className="ex-link" href={ABS_BASE + EX_DECODE}>
          示例 2 · 打开即解码
        </a>
        {`

手工操作：填写输入框 id=base-url；参数行在 id=params-rows（按钮 id=add-param-btn 加行，行尾 × 删行）；
模式单选 id=mode-query / id=mode-packed；结果实时更新；按钮 id=copy-btn 复制、id=open-btn 新窗口打开测试。
状态行 id=status 实时反馈。base64url 为本页自实现（UTF-8 安全），零外部依赖。`}
      </AiGuide>

      {/* 解码视图（?decode=<q> 时显示） */}
      {decodeVisible && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>解码结果（packed → 键值对）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Table id="decode-table" className="text-[15px]">
              <TableHeader>
                <TableRow>
                  <TableHead>键</TableHead>
                  <TableHead>值</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decodePairs.map((kv) => (
                  <TableRow key={kv[0]}>
                    <TableCell className="break-all whitespace-normal">{kv[0]}</TableCell>
                    <TableCell className="break-all whitespace-normal">{kv[1]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <pre
              id="decode-json"
              className="rounded-lg border border-input bg-background/60 p-3 font-mono text-[13px]/7 whitespace-pre-wrap break-all"
            >
              {decodeJson}
            </pre>
            <div className="flex flex-wrap gap-2.5">
              <Button id="decode-load-btn" variant="outline" onClick={onLoadDecoded}>
                载入到下方构建器（packed 模式）
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-4 md:grid-cols-[minmax(340px,1fr)_minmax(340px,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>1 · 输入</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Label htmlFor="base-url" className="text-muted-foreground">
              base URL：
            </Label>
            <Input
              id="base-url"
              ref={baseUrlRef}
              type="text"
              placeholder="https://example.com/api"
              spellCheck={false}
              autoComplete="off"
              defaultValue={INIT_BASE}
              onInput={() => buildResult()}
            />
            <Label className="text-muted-foreground">参数（键值对，可增删）：</Label>
            <div
              id="params-rows"
              ref={rowsElRef}
              className="flex flex-col gap-2"
              onInput={() => buildResult()}
            >
              {rows.map((row) => (
                <div key={row.id} className="prow flex items-stretch gap-2">
                  <Input
                    type="text"
                    className="pkey h-auto min-w-0 flex-[2_1_30%] py-2.5 font-mono text-sm"
                    placeholder="键（如 title）"
                    defaultValue={row.k}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Input
                    type="text"
                    className="pval h-auto min-w-0 flex-[3_1_50%] py-2.5 font-mono text-sm"
                    placeholder="值（支持中文 / 换行 / 特殊字符）"
                    defaultValue={row.v}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="pdel h-auto w-10 shrink-0 grow-0 p-2 text-base"
                    title="删除该参数行"
                    aria-label="删除该参数行"
                    onClick={() => deleteRow(row.id)}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button id="add-param-btn" variant="outline" onClick={onAddParam}>
                ＋ 添加参数
              </Button>
            </div>
            {/* RadioGroupItem 组合面覆盖（视觉打磨 2026-10-30 修复项 4）：solid-glass
                主题下官方选中态＝墨底白点（primary 实心）观感过重，这里改回经典
                shadcn 语言——玻璃底 + 墨环 + 墨点，明暗随主题 token 自动翻面。
                仅组合面 className，不改官方源文件。 */}
            <RadioGroup
              value={mode}
              onValueChange={(v) => switchMode(v as Mode)}
              className="flex w-full flex-wrap gap-4 rounded-lg border border-input p-3"
              aria-label="拼接模式"
            >
              <Label htmlFor="mode-query" className="cursor-pointer gap-2 font-semibold text-foreground">
                <RadioGroupItem
                  id="mode-query"
                  value="query"
                  className="data-checked:border-primary data-checked:bg-background [&>span>span]:bg-primary"
                />{" "}
                查询串（标准 query）
              </Label>
              <Label htmlFor="mode-packed" className="cursor-pointer gap-2 font-semibold text-foreground">
                <RadioGroupItem
                  id="mode-packed"
                  value="packed"
                  className="data-checked:border-primary data-checked:bg-background [&>span>span]:bg-primary"
                />{" "}
                packed（紧凑包 ?q=）
              </Label>
            </RadioGroup>
            <p id="mode-hint" className="m-0 text-sm text-muted-foreground">
              {modeHint}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · 结果</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div
              id="result-url"
              ref={resultElRef}
              className="min-h-[76px] rounded-lg border border-input bg-background/60 p-3.5 font-mono text-lg font-semibold break-all whitespace-pre-wrap text-foreground"
            >
              {result}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button id="copy-btn" className="flex-1" onClick={onCopy}>
                复制
              </Button>
              <Button id="open-btn" variant="outline" className="flex-1" onClick={onOpen}>
                打开测试
              </Button>
            </div>
            <p id="status" className={"min-h-[26px] text-base font-semibold " + statusTextClass(status.kind)}>
              {status.msg}
            </p>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-6 text-[13px] text-muted-foreground">
        url-tool · 纯静态零后端零依赖 · packed＝JSON→encodeURIComponent→base64url（非加密）
      </footer>
    </div>
  );
}
