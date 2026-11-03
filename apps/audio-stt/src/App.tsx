/*
 * 本地语音转文字站 —— apps/audio-stt/src/App.tsx（audio-stt-tts tasks 3.1/3.2/3.4/3.5/3.6）
 *
 * 惯例对齐仓内工具站范式：id 稳定（input-file / model-select / transcribe-btn /
 * export-srt / export-vtt / export-txt / export-json / copy-btn / audio-player /
 * segments / status / ai-guide）；输入类非受控；状态行终态词（已转写/失败/请先）。
 *
 * 段级同步（3.5）：RAF＋二分＋DOM class（禁 60fps setState）；点段跳播；
 * 悬停暂停跟随；编辑段文（contentEditable——本批先落段文编辑回写 doc，
 * 词级 LCS 插值随词级高亮批落地）。
 */
import { useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { scrollStatusIntoView, statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { Label } from "@fde2e-tools/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@fde2e-tools/shared/ui/select";
import { downloadBlob } from "@fde2e-tools/shared/download";
import { FileTextIcon, MicIcon } from "lucide-react";
import {
  STT_MODELS, transcribe, isSupportedFile, SUPPORTED_EXT, type EnginePhase, type SttModelId,
} from "./engine";
import { startRealtime, type RealtimeHandle } from "./realtime";
import { emptyDoc, type TranscriptDoc } from "./transcript";
import { toSrt, toVtt, toTxt, toJson } from "./export-formats";
import { registerAppTools } from "./webmcp";

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是「音频 → 带时间轴文本」纯静态转写站：whisper-base q8（多语兜底 77MB）与
SenseVoice-Small int8（中文优先 228MB）在浏览器本地推理，零后端、音频不离开设备。

操作步骤：
1. 选模型 <select id="model-select">（缺省 whisper-base-q8；中文优先选 sensevoice）。
2. 音频文件填 <input id="input-file" type="file">（支持 ${SUPPORTED_EXT.join("/")}；必填）。
3. 点按钮 id=transcribe-btn（文案「开始转写」）→ 首次先下载模型（状态行显示进度）
   → 转写完成状态行「已转写 xxx（N 段 · M 秒音频）」。
4. 段列表 <div id="segments"> 按时间轴渲染；点段跳播（<audio id="audio-player">）；
   段文可直接编辑（contentEditable，编辑即更新导出内容）。
5. 导出：export-srt / export-vtt / export-txt / export-json 四按钮
   （audio-stt-srt.srt 等命名契约）；copy-btn 复制全文。

备注：
- 长音频自动 30s 分片转写（每 6 片重建 pipeline——GPU 泄漏防御）。
- WebMCP 工具：transcribe_audio（返回 TranscriptDoc JSON：segments+words）、
  list_models（模型档位与体积）、get_capabilities（能力面）。
- 转写完全本地；首次使用需下载所选模型。
- id=status 实时反馈（成功 ok 色 / 失败 error 色）。`;

interface Status {
  msg: string;
  kind: StatusKind;
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({
    msg: "等待转写：选模型、选音频文件，点「开始转写」（首次使用需下载模型）。",
    kind: "ok",
  });
  const [modelId, setModelId] = useState<SttModelId>("whisper-base-q8");
  const [phase, setPhase] = useState<EnginePhase>({ phase: "idle" });
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<TranscriptDoc>(() => emptyDoc("transformers", "whisper-base-q8"));
  const [warn, setWarn] = useState<string | null>(null);
  const [activeSeg, setActiveSeg] = useState<number | null>(null);
  const [micOn, setMicOn] = useState(false);
  const micRef = useRef<RealtimeHandle | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const hoverRef = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    registerAppTools();
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  function showStatus(s: Status) {
    setStatus(s);
    scrollStatusIntoView();
  }

  // 段级同步：RAF＋二分＋DOM class（3.5——禁 60fps setState）
  const segList = doc.segments;
  useEffect(() => {
    if (segList.length === 0) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const player = document.getElementById("audio-player");
      if (!(player instanceof HTMLAudioElement) || !player.duration) return;
      const t = player.currentTime;
      // 二分当前段
      let lo = 0, hi = segList.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const s = segList[mid];
        const end = s.end ?? s.start + 30;
        if (t < s.start) hi = mid - 1;
        else if (t > end) lo = mid + 1;
        else { found = mid; break; }
      }
      if (found !== -1 && found !== activeSeg) {
        setActiveSeg(found);
        if (!hoverRef.current && listRef.current) {
          const el = listRef.current.children[found] as HTMLElement | undefined;
          el?.scrollIntoView({ block: "nearest" });
        }
      }
      // 词级高亮（3.5）：当前段内按词时间直接改 DOM class（同 RAF，禁 setState）
      const seg = segList[found];
      const li = listRef.current?.children[found] as HTMLElement | undefined;
      if (seg?.words && li) {
        const spans = li.querySelectorAll<HTMLElement>("[data-word]");
        spans.forEach((sp) => {
          const ws = Number(sp.dataset.start);
          const we = Number(sp.dataset.end);
          const on = t >= ws && t < we;
          if (sp.dataset.on !== String(on)) {
            sp.dataset.on = String(on);
            sp.classList.toggle("bg-primary/20", on);
            sp.classList.toggle("rounded", on);
          }
        });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [segList, activeSeg]);

  async function toggleMic() {
    if (micOn) {
      await micRef.current?.stop();
      micRef.current = null;
      setMicOn(false);
      showStatus({ msg: "已停止麦克风实时转写。", kind: "ok" });
      return;
    }
    try {
      setBusy(true);
      setDoc(emptyDoc("sherpa", "zipformer-bilingual-streaming"));
      const handle = await startRealtime(
        (detail, pct) => setPhase({ phase: "loading", detail, pct }),
        (partial) => {
          setPhase({ phase: "ready" });
          setDoc(partial);
          (window as unknown as { __sttDoc?: unknown }).__sttDoc = partial;
        },
      );
      micRef.current = handle;
      setMicOn(true);
      showStatus({ msg: "实时转写中：请对麦克风说话（句界自动落段；再点一次停止）。", kind: "ok" });
    } catch (e) {
      showStatus({ msg: `实时转写启动失败：${e instanceof Error ? e.message : String(e)}`, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function handleTranscribe() {
    const input = fileRef.current;
    const file = input?.files?.[0];
    if (!file) {
      showStatus({ msg: "请先选择音频文件（#input-file）。", kind: "error" });
      return;
    }
    if (!isSupportedFile(file.name)) {
      showStatus({ msg: `不支持的格式「${file.name.split(".").pop()}」——支持：${SUPPORTED_EXT.join(" / ")}。`, kind: "error" });
      return;
    }
    if (busy) return;
    setBusy(true);
    setWarn(null);
    setDoc(emptyDoc(modelId === "whisper-base-q8" ? "transformers" : "sherpa", modelId));
    // 音频载入播放器
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(file);
    audioUrlRef.current = url;
    const player = document.getElementById("audio-player");
    if (player instanceof HTMLAudioElement) player.src = url;
    const t0 = performance.now();
    try {
      const cancelRef = { cancelled: false };
      cancelRefGlobal.current = cancelRef;
      const result = await transcribe(file, modelId, setPhase, (partial) => setDoc(partial), cancelRef);
      setDoc(result.doc);
      (window as unknown as { __sttDoc?: unknown }).__sttDoc = result.doc;
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      setWarn(result.hallucinationWarning ? "检测到输出疑似重复幻觉（同文过半重复）——建议换模型或检查音频质量。" : null);
      showStatus({
        msg: `已转写 ${file.name}（${result.doc.segments.length} 段 · ${fmtTime(result.doc.duration ?? 0)} 音频 · 耗时 ${elapsed}s）`,
        kind: "ok",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showStatus({ msg: msg === "已取消" ? "已取消转写。" : `转写失败：${msg}`, kind: msg === "已取消" ? "warn" : "error" });
    } finally {
      setBusy(false);
    }
  }

  function download(fmt: "srt" | "vtt" | "txt" | "json") {
    if (doc.segments.length === 0) {
      showStatus({ msg: "请先转写（点 id=transcribe-btn），再导出。", kind: "error" });
      return;
    }
    const content = fmt === "srt" ? toSrt(doc) : fmt === "vtt" ? toVtt(doc) : fmt === "txt" ? toTxt(doc) : toJson(doc);
    downloadBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), `audio-stt-${fmt}.${fmt === "txt" ? "txt" : fmt}`);
    showStatus({ msg: `已下载 audio-stt-${fmt}.${fmt}`, kind: "ok" });
  }

  function copyAll() {
    if (doc.segments.length === 0) {
      showStatus({ msg: "请先转写，再复制。", kind: "error" });
      return;
    }
    void navigator.clipboard.writeText(toTxt(doc));
    showStatus({ msg: "已复制全文到剪贴板。", kind: "ok" });
  }

  // 段文编辑回写 doc（3.5；contentEditable blur 时批量回写——禁每键 setState）
  function onSegmentBlur(e: React.FocusEvent<HTMLSpanElement>, segId: number) {
    const newText = e.currentTarget.textContent ?? "";
    if (newText === (doc.segments[segId]?.text ?? "")) return;
    setDoc((d) => ({
      ...d,
      segments: d.segments.map((s) => (s.id === segId ? { ...s, text: newText } : s)),
    }));
  }

  const loadingPct = phase.phase === "loading" ? phase.pct : phase.phase === "ready" ? 100 : 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <MicIcon className="size-5" aria-hidden />
          本地语音转文字
          <span className="font-mono text-xs text-muted-foreground">stt.tool.fde2e.com</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Whisper / SenseVoice 在本浏览器推理——音频不离开设备；产物带时间轴，可导出 SRT/VTT/TXT/JSON。
        </p>
      </header>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">转写</CardTitle>
          <CardDescription>首次使用所选模型需下载（体积见模型选择）；完成后断网也可用。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="model-select">模型</Label>
              <Select value={modelId} onValueChange={(v) => setModelId(typeof v === "string" ? (v as SttModelId) : modelId)}>
                <SelectTrigger id="model-select" aria-label="模型" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STT_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="input-file">音频文件（{SUPPORTED_EXT.join("/")}）</Label>
              <input
                id="input-file"
                type="file"
                accept="audio/*,video/mp4,video/quicktime"
                ref={fileRef}
                className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-0.5"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button id="transcribe-btn" onClick={handleTranscribe} disabled={busy || phase.phase === "loading"}>
              {busy ? "转写中…" : "开始转写"}
            </Button>
            <Button id="mic-btn" variant="outline" onClick={toggleMic} disabled={busy && !micOn}>
              <MicIcon aria-hidden /> {micOn ? "停止实时" : "麦克风实时"}
            </Button>
            {busy && (
              <Button variant="outline" onClick={() => { if (cancelRefGlobal.current) cancelRefGlobal.current.cancelled = true; }}>
                取消
              </Button>
            )}
          </div>

          {(phase.phase === "loading" || busy) && (
            <div className="flex flex-col gap-1" role="status" aria-live="polite">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${loadingPct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {phase.phase === "loading" ? phase.detail : "处理中…"}（{loadingPct}%）
              </p>
            </div>
          )}

          <audio id="audio-player" controls className="w-full" aria-label="源音频回放" />

          {warn && (
            <p className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400" role="alert">
              {warn}
            </p>
          )}

          <p id="status" className={`text-sm ${statusTextClass(status.kind)}`} role="status" aria-live="polite">
            {status.msg}
          </p>
        </CardContent>
      </Card>

      {doc.segments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">转写稿（{doc.segments.length} 段）</CardTitle>
            <CardDescription>点段跳播 · 悬停暂停跟随 · 段文可编辑（编辑即生效于导出）</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul
              id="segments"
              ref={listRef}
              className="flex max-h-96 flex-col gap-1 overflow-y-auto"
              onMouseEnter={() => { hoverRef.current = true; }}
              onMouseLeave={() => { hoverRef.current = false; }}
            >
              {doc.segments.map((s) => (
                <li
                  key={s.id}
                  data-seg={s.id}
                  data-active={activeSeg === s.id ? "true" : "false"}
                  className={`flex cursor-pointer gap-3 rounded-lg px-2 py-1.5 text-sm ${activeSeg === s.id ? "bg-primary/10" : "hover:bg-muted/50"}`}
                  onClick={() => {
                    const p = document.getElementById("audio-player");
                    if (p instanceof HTMLAudioElement) p.currentTime = s.start;
                  }}
                >
                  <span className="shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">{fmtTime(s.start)}</span>
                  {s.words ? (
                    <span
                      className="min-w-0 flex-1 rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => onSegmentBlur(e, s.id)}
                    >
                      {s.words.map((w, wi) => (
                        <span
                          key={wi}
                          data-word
                          data-start={w.start}
                          data-end={w.end ?? s.end ?? w.start + 1}
                        >
                          {w.text}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      className="min-w-0 flex-1 rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onBlur={(e) => onSegmentBlur(e, s.id)}
                    >
                      {s.text}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div id="export-actions" className="flex flex-wrap gap-2">
              <Button id="export-srt" variant="outline" size="sm" onClick={() => download("srt")}>
                <FileTextIcon aria-hidden /> SRT
              </Button>
              <Button id="export-vtt" variant="outline" size="sm" onClick={() => download("vtt")}>VTT</Button>
              <Button id="export-txt" variant="outline" size="sm" onClick={() => download("txt")}>TXT</Button>
              <Button id="export-json" variant="outline" size="sm" onClick={() => download("json")}>JSON</Button>
              <Button id="copy-btn" variant="outline" size="sm" onClick={copyAll}>复制全文</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

/** 全局取消句柄（webmcp 复用同一路径） */
export const cancelRefGlobal: { current: { cancelled: boolean } | null } = { current: null };
