/*
 * 本地语音合成站 —— apps/audio-tts/src/App.tsx（audio-stt-tts tasks 2.2-2.3）
 *
 * 惯例对齐仓内工具站范式：
 * - 可交互元素 id 稳定：input-text / voice-select / speed-range / generate-btn /
 *   play-btn / download-btn / audio-player / status / ai-guide；
 * - 输入类非受控（ref 读 DOM 值）：智能体程序化 set value 后点按钮必须生效；
 * - 状态行文案含终态词（已生成/已合成/失败/请先），中间态不含终态词。
 *
 * 能力面纪律（spec 假控件禁令）：Kokoro 无情绪标签——UI 无语气/情绪任何控件；
 * 语速滑杆范围与 manifest supports.speed 单源。
 * 首载引导：模型 ≈188MB，下载进度分片级（downloader onProgress 投影）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AiGuide } from "@fde2e-tools/shared/ai-guide";
import { scrollStatusIntoView, statusTextClass, type StatusKind } from "@fde2e-tools/shared/status";
import { Button } from "@fde2e-tools/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fde2e-tools/shared/ui/card";
import { Label } from "@fde2e-tools/shared/ui/label";
import { Slider } from "@fde2e-tools/shared/ui/slider";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@fde2e-tools/shared/ui/select";
import { downloadBlob } from "@fde2e-tools/shared/download";
import { AudioLinesIcon, DownloadIcon, PlayIcon, SquareIcon } from "lucide-react";
import { KOKORO_V1_1_ZH_INT8, totalBytes } from "@fde2e-tools/audio-engine/manifest";
import { ensureEngine, synthesize, type EnginePhase } from "./engine";
import { VOICES, VOICE_GROUPS } from "./voices";
import { splitSentences } from "./sentence";
import { encodeWav } from "./wav";
import { StreamingPlayer } from "./streaming-player";
import { saveGeneration, listGenerations, deleteGeneration, clearGenerations, type GenerationRecord } from "./history";
import { registerAppTools } from "./webmcp";

const DEFAULT_EXPORT_NAME = "audio-tts-export.wav";

const AI_GUIDE = `===== AI 使用说明（给自动化代理读的纯文本） =====
本页是「文本 → 语音」纯静态合成站：Kokoro v1.1-zh int8（Apache-2.0）经 sherpa-onnx
WASM 在浏览器本地合成，24kHz；零后端、文本与音频不离开设备。首次使用需下载模型
（约 188MB，之后走浏览器缓存）。

操作步骤：
1. 文本填入 <textarea id="input-text">（中英混说支持；长文自动切句流式合成）。
2. 音色 <select id="voice-select" aria-busy>：103 音色（zf_001…zm_100 中文＋3 英文），
   按名字（如 zf_001）或 sid 选择；value＝音色名。
3. 语速 #speed-range（0.5-2.0，缺省 1.0；滑杆显示当前值 #speed-value）。
4. 点按钮 id=generate-btn（文案「合成」）→ 状态行 id=status 显示「已合成 xxx.wav
   （N 句 · M 秒）」即完成；<audio id="audio-player"> 自动加载可试听。
5. 点 id=download-btn 下载 audio-tts-export.wav（可选 filename 自定义）。

备注：
- 首次点合成会先装载模型（状态行显示下载进度，请等待「已合成」终态）。
- 本模型不支持情绪/语气标签——工具入参无 style/emotion 类参数（能力如实声明）。
- WebMCP 工具：create_speech（text/voice/speed/filename? → 下载 wav，返回时长/句数）、
  list_voices（103 音色元数据）、get_capabilities（整份 supports 能力面）。
- 所有可交互元素都有稳定 id；id=status 实时反馈（成功 ok 色 / 失败 error 色）。`;

interface Status {
  msg: string;
  kind: StatusKind;
}

export default function App() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<Status>({
    msg: "等待合成：填文本、选音色，点「合成」开始（首次使用需下载模型约 188MB）。",
    kind: "ok",
  });
  const [speed, setSpeed] = useState(1.0);
  const [voice, setVoice] = useState("zf_001");
  const [enginePhase, setEnginePhase] = useState<EnginePhase>({ phase: "idle" });
  const [generating, setGenerating] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [progress, setProgress] = useState<{ file: string; pct: number } | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const lastWavRef = useRef<Blob | null>(null);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const playerRef = useRef<StreamingPlayer | null>(null);
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  // A/B 并排：两条 take（同文本不同参数）
  const [abSlots, setAbSlots] = useState<Array<{ url: string; label: string }>>([]);

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

  const startEngine = useCallback(async () => {
    const engine = await ensureEngine((p) => {
      setEnginePhase(p);
      if (p.phase === "loading") setProgress({ file: p.detail, pct: p.pct });
    });
    setProgress(null);
    return engine;
  }, []);

  async function handleGenerate() {
    const text = inputRef.current?.value.trim() ?? "";
    if (!text) {
      showStatus({ msg: "请先输入要合成的文本（#input-text）。", kind: "error" });
      return;
    }
    if (generating) return;
    setGenerating(true);
    cancelRef.current = { cancelled: false };
    const cancel = cancelRef.current;
    const t0 = performance.now();
    try {
      const engine = await startEngine();
      if (cancel.cancelled) return;

      const sentences = splitSentences(text);
      const v = VOICES.find((x) => x.name === voice);
      const sid = v?.sid ?? 3;
      const chunks: Float32Array[] = [];
      const player = new StreamingPlayer();
      playerRef.current = player;
      // 边合成边播：句合成完即入队（AudioBuffer 时钟链 gapless；pocket-tts 形态）
      for (const s of sentences) {
        if (cancel.cancelled) {
          player.stop();
          void player.dispose();
          return;
        }
        setEnginePhase({ phase: "loading", detail: `合成句 ${s.id + 1}/${sentences.length}`, pct: 0 });
        const out = synthesize(engine, s.text, sid, speed);
        chunks.push(out.samples);
        // 音频上下文需用户手势——合成按钮点击即是；首句起播
        player.enqueue(s.id, out.samples, out.sampleRate);
      }
      setEnginePhase({ phase: "ready", speakers: engine.tts.numSpeakers, sampleRate: engine.tts.sampleRate });

      const totalLen = chunks.reduce((a, c) => a + c.length, 0);
      const merged = new Float32Array(totalLen);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      const sampleRate = engine.tts.sampleRate;
      const wav = encodeWav(merged, sampleRate);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(wav);
      audioUrlRef.current = url;
      lastWavRef.current = wav;
      const playerEl = document.getElementById("audio-player");
      if (playerEl instanceof HTMLAudioElement) playerEl.src = url;
      setHasAudio(true);
      addToAb(wav, `${v?.name ?? sid} @ ${speed.toFixed(1)}×`);
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      const dur = (totalLen / sampleRate).toFixed(1);
      const filename = DEFAULT_EXPORT_NAME;
      // 历史入库（IndexedDB；失败不阻塞主流程）
      const durationSec = Number(dur);
      void saveGeneration({
        text, voice: v?.name ?? String(sid), speed, sentenceCount: sentences.length, durationSec, wav,
      }).then(() => void refreshHistory()).catch(() => undefined);
      showStatus({
        msg: `已合成 ${filename}（${sentences.length} 句 · ${dur}s 音频 · 耗时 ${elapsed}s${player.stats().underruns ? ` · 断流 ${player.stats().underruns}` : ""}）`,
        kind: "ok",
      });
      setExportNameInput(filename);
    } catch (e) {
      showStatus({
        msg: `合成失败：${e instanceof Error ? e.message : String(e)}`,
        kind: "error",
      });
    } finally {
      setGenerating(false);
      setEnginePhase((p) => (p.phase === "loading" ? { phase: "idle" } : p));
    }
  }

  function handleDownload() {
    if (!lastWavRef.current) {
      showStatus({ msg: "请先合成（点 id=generate-btn），再下载。", kind: "error" });
      return;
    }
    const nameEl = document.getElementById("export-name");
    const name = (nameEl instanceof HTMLInputElement ? nameEl.value : "").trim() || DEFAULT_EXPORT_NAME;
    downloadBlob(lastWavRef.current, name.toLowerCase().endsWith(".wav") ? name : `${name}.wav`);
    showStatus({ msg: `已下载 ${name}`, kind: "ok" });
  }

  function setExportNameInput(name: string) {
    const el = document.getElementById("export-name");
    if (el instanceof HTMLInputElement && !el.value) el.value = name;
  }

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listGenerations());
    } catch {
      // IndexedDB 不可用（隐私模式等）——历史面板降级隐藏
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  function addToAb(blob: Blob, label: string) {
    const url = URL.createObjectURL(blob);
    setAbSlots((slots) => {
      const next = [...slots, { url, label }];
      return next.length > 2 ? next.slice(next.length - 2) : next;
    });
  }

  const loadingPct =
    enginePhase.phase === "loading" ? enginePhase.pct : enginePhase.phase === "ready" ? 100 : 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <AudioLinesIcon className="size-5" aria-hidden />
          本地语音合成
          <span className="font-mono text-xs text-muted-foreground">audio-tts.tool.fde2e.com</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Kokoro v1.1 中文（103 音色 · 24kHz · 中英混说）——全部在本浏览器合成，文本与音频不离开设备。
        </p>
      </header>

      <AiGuide>{AI_GUIDE}</AiGuide>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">合成</CardTitle>
          <CardDescription>
            首次使用需下载模型（约 {Math.round(totalBytes(KOKORO_V1_1_ZH_INT8) / 1048576)}MB），完成后断网也可用。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="input-text">文本</Label>
            <textarea
              id="input-text"
              rows={6}
              defaultValue="你好，这是本地语音合成测试。今天天气不错，我们出去走走吧。"
              className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="合成文本"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="voice-select">音色（103 选）</Label>
              <Select value={voice} onValueChange={(v) => setVoice(typeof v === "string" ? v : voice)} items={undefined}>
                <SelectTrigger id="voice-select" aria-label="音色" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_GROUPS.map((g) => (
                    <SelectGroup key={g.id}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {VOICES.filter((v) => v.group === g.id).map((v) => (
                        <SelectItem key={v.name} value={v.name}>
                          {v.name}（sid {v.sid}）
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="speed-range">
                语速 <span id="speed-value" className="font-mono">{speed.toFixed(1)}×</span>
              </Label>
              <Slider
                id="speed-range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={[speed]}
                onValueChange={(v) => setSpeed(Array.isArray(v) ? (v[0] ?? 1) : typeof v === "number" ? v : speed)}
                aria-label="语速"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button id="generate-btn" onClick={handleGenerate} disabled={generating || enginePhase.phase === "loading"}>
              {generating ? "合成中…" : "合成"}
            </Button>
            {generating && (
              <Button
                variant="outline"
                onClick={() => {
                  cancelRef.current.cancelled = true;
                }}
              >
                <SquareIcon aria-hidden /> 取消
              </Button>
            )}
            <Button id="play-btn" variant="outline" disabled={!hasAudio}
              onClick={() => {
                const p = document.getElementById("audio-player");
                if (p instanceof HTMLAudioElement) void p.play();
              }}
            >
              <PlayIcon aria-hidden /> 播放
            </Button>
            <Button id="download-btn" variant="outline" disabled={!hasAudio} onClick={handleDownload}>
              <DownloadIcon aria-hidden /> 下载
            </Button>
            <input
              id="export-name"
              className="w-56 rounded-lg border border-input bg-background px-2 py-1.5 font-mono text-xs"
              placeholder={DEFAULT_EXPORT_NAME}
              aria-label="下载文件名（可选）"
            />
          </div>

          {(enginePhase.phase === "loading" || progress) && (
            <div className="flex flex-col gap-1" role="status" aria-live="polite">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${loadingPct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {enginePhase.phase === "loading" ? enginePhase.detail : "准备中…"}（{loadingPct}%）
              </p>
            </div>
          )}

          <audio id="audio-player" controls className="w-full" aria-label="合成结果试听" />

          <p id="status" className={`text-sm ${statusTextClass(status.kind)}`} role="status" aria-live="polite">
            {status.msg}
          </p>
        </CardContent>
      </Card>

      {abSlots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">A/B 对比</CardTitle>
            <CardDescription>最近两次合成并排（改参数重合成即产生新对比）；点播放钮播对应条。</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {abSlots.map((slot, i) => (
              <div key={slot.url + i} className="flex flex-col gap-2 rounded-lg border border-input p-3">
                <p className="font-mono text-xs text-muted-foreground">{["A", "B"][i]} · {slot.label}</p>
                <audio controls src={slot.url} className="w-full" aria-label={`对比条 ${["A", "B"][i]}`} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">生成历史</CardTitle>
            <CardDescription>本地 IndexedDB 存最近 50 条；replay／下载／删除；清空不可恢复。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {history.map((rec) => (
              <div key={rec.id} className="flex flex-col gap-2 rounded-lg border border-input p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{new Date(rec.createdAt).toLocaleString()}</span>
                  <span>{rec.voice}</span>
                  <span>{rec.speed.toFixed(1)}×</span>
                  <span>{rec.sentenceCount} 句</span>
                  <span>{rec.durationSec.toFixed(1)}s</span>
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm"
                      onClick={() => {
                        const url = URL.createObjectURL(rec.wav);
                        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
                        audioUrlRef.current = url;
                        const p = document.getElementById("audio-player");
                        if (p instanceof HTMLAudioElement) p.src = url;
                        setHasAudio(true);
                        lastWavRef.current = rec.wav;
                        showStatus({ msg: `已载入历史合成（${rec.voice} · ${rec.durationSec.toFixed(1)}s）`, kind: "ok" });
                      }}
                    >
                      载入
                    </Button>
                    <Button variant="ghost" size="sm"
                      onClick={() => downloadBlob(rec.wav, `audio-tts-${rec.id}.wav`)}
                    >
                      下载
                    </Button>
                    <Button variant="ghost" size="sm"
                      onClick={async () => {
                        if (rec.id !== undefined) await deleteGeneration(rec.id);
                        await refreshHistory();
                      }}
                    >
                      删除
                    </Button>
                  </span>
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{rec.text}</p>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={async () => {
                await clearGenerations();
                setHistory([]);
                showStatus({ msg: "已清空生成历史。", kind: "ok" });
              }}
            >
              清空历史
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
