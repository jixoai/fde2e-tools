/*
 * audio-tts WebMCP 注册 —— apps/audio-tts/src/webmcp.ts（tasks 2.6）
 *
 * 三工具：create_speech（结构化参数型）/ list_voices / get_capabilities（只读）。
 * schema 单源：enum/min/max/default 从 manifest supports 派生（能力面 Requirement）；
 * ok:false 全带 error（interface-lint 硬断言）；输出含用户可控内容标
 * untrustedContentHint。复用页面全链路（输入区→generate-btn→状态行）。
 */
import { safeFilename } from "@fde2e-tools/shared/download";
import {
  clickById,
  normalizeExecuteResult,
  readStatus,
  registerWebMCPTools,
  waitForStatusChange,
  type WebMCPToolDef,
} from "@fde2e-tools/shared/webmcp";
import { KOKORO_V1_1_ZH_INT8, totalBytes } from "@fde2e-tools/audio-engine/manifest";
import { VOICES, voiceByName } from "./voices";

const SPEED = KOKORO_V1_1_ZH_INT8.supports.speed ?? { min: 0.5, max: 2, default: 1 };
const DEFAULT_NAME = "audio-tts-export.wav";

function setInputValue(id: string, value: string): void {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) {
    throw new Error(`页面未就绪（#${id} 缺失）`);
  }
  el.value = value;
}

type AudioTtsBridgeWindow = Window & {
  __audioTtsSetOptions?: (options: { voice: string; speed: number }) => void;
};

/** 等 React 受控 Select/Slider 的真实可见值落地；不用 rAF（后台任务窗会暂停帧时钟）。 */
async function waitForUiValue(id: string, expected: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((document.getElementById(id)?.textContent ?? "").includes(expected)) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return false;
}

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "create_speech",
      title: "合成语音",
      description:
        `把文本合成为语音并下载 .wav（Kokoro v1.1-zh，浏览器本地合成，24kHz）。` +
        `text 支持 2000+ 字长文（自动切句流式合成）；voice=音色名（见 list_voices，缺省 zf_001）；` +
        `speed ${SPEED.min}-${SPEED.max}（缺省 ${SPEED.default}）；filename 可自定义下载名。` +
        `首次调用需先装载模型（约 ${Math.round(totalBytes(KOKORO_V1_1_ZH_INT8) / 1048576)}MB，状态行显示进度）。` +
        `返回 ok/filename/durationSec/sentenceCount/message。注意：本模型不支持情绪/语气标签。`,
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "要合成的文本（中英混说；必填非空）" },
          voice: { type: "string", description: `音色名（如 zf_001/zm_050/af_maple；缺省 zf_001）` },
          speed: { type: "number", minimum: SPEED.min, maximum: SPEED.max, description: `语速（缺省 ${SPEED.default}）` },
          filename: { type: "string", description: "下载文件名（缺省 audio-tts-export.wav）" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const text = String(input.text ?? "").trim();
        if (!text) return { ok: false, error: "text 必填非空（要合成的文本）。" };
        const voiceName = String(input.voice ?? "zf_001");
        const v = voiceByName(voiceName);
        if (!v) {
          return {
            ok: false,
            error: `未知音色「${voiceName}」——用 list_voices 查可用音色名（如 zf_001/zm_050/af_maple）。`,
          };
        }
        const speedRaw = input.speed;
        const speed = speedRaw === undefined ? SPEED.default : Number(speedRaw);
        if (!Number.isFinite(speed) || speed < SPEED.min || speed > SPEED.max) {
          return { ok: false, error: `speed 超界：${speedRaw}（允许 ${SPEED.min}-${SPEED.max}）。` };
        }
        const filename = safeFilename(
          typeof input.filename === "string" ? input.filename : undefined,
          DEFAULT_NAME,
          ".wav",
        );

        // input-text/export-name 是非受控输入，可直接写；voice/speed 是 Base UI
        // 受控组件，必须经 App 权威 setter，禁止 DOM 伪赋值后回显请求参数。
        setInputValue("input-text", text);
        setInputValue("export-name", filename);
        const bridgeWindow = window as AudioTtsBridgeWindow;
        if (typeof bridgeWindow.__audioTtsSetOptions !== "function") {
          return { ok: false, error: "页面未就绪（TTS 音色/语速状态桥缺失）" };
        }
        bridgeWindow.__audioTtsSetOptions({ voice: v.name, speed });
        const [voiceApplied, speedApplied] = await Promise.all([
          waitForUiValue("voice-select", v.name),
          waitForUiValue("speed-value", speed.toFixed(1)),
        ]);
        if (!voiceApplied || !speedApplied) {
          return { ok: false, error: `音色/语速状态未生效：期望 ${v.name} @ ${speed.toFixed(1)}×` };
        }

        const baseline = readStatus().message;
        if (!clickById("generate-btn")) return { ok: false, error: "页面未就绪（#generate-btn 缺失）" };
        const status = await waitForStatusChange(600_000, 400, baseline);
        if (!/已合成/.test(status.message)) {
          return { ok: false, error: status.message, message: status.message };
        }

        // 从状态行提取句数与时长；随后复用页面下载按钮，filename 才是实际产物名，
        // 而不是只在回执里回显请求值。
        const m = status.message.match(/(\d+) 句 · ([\d.]+)s/);
        const player = document.getElementById("audio-player");
        const src = player instanceof HTMLAudioElement ? player.src : "";
        if (!clickById("download-btn")) return { ok: false, error: "页面未就绪（#download-btn 缺失）" };
        const downloadStatus = await waitForStatusChange(15_000, 400, status.message);
        if (!downloadStatus.message.includes("已下载")) {
          return { ok: false, error: downloadStatus.message, message: downloadStatus.message };
        }
        return {
          ok: true,
          filename,
          sentenceCount: m ? Number(m[1]) : undefined,
          durationSec: m ? Number(m[2]) : undefined,
          audioUrl: src || undefined,
          voice: v.name,
          speed,
          message: downloadStatus.message,
          synthesisMessage: status.message,
        };
      },
    },
    {
      name: "list_voices",
      title: "列出音色",
      description:
        "枚举 Kokoro v1.1-zh 的 103 个音色（sid/name/分组）。返回 voices[] 与分组说明——" +
        "create_speech 的 voice 参数取值域。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        return {
          ok: true,
          count: VOICES.length,
          voices: VOICES.map((v) => ({ sid: v.sid, name: v.name, group: v.group })),
          groups: { "zh-f": "中文女声", "zh-m": "中文男声", "en-f": "英文女声" },
        };
      },
    },
    {
      name: "get_capabilities",
      title: "查询能力面",
      description:
        "只读返回本站整份能力面（模型/引擎/音色数/语速范围/首载体积/许可；不支持的能力如实标注）" +
        "——schema 派生单源，agent 按此选参。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        const s = KOKORO_V1_1_ZH_INT8.supports;
        return {
          ok: true,
          model: {
            id: KOKORO_V1_1_ZH_INT8.modelId,
            name: KOKORO_V1_1_ZH_INT8.name,
            engine: KOKORO_V1_1_ZH_INT8.engine,
            license: KOKORO_V1_1_ZH_INT8.licenseTag,
            notice: KOKORO_V1_1_ZH_INT8.notice,
            totalBytes: totalBytes(KOKORO_V1_1_ZH_INT8),
          },
          sampleRate: 24000,
          numSpeakers: VOICES.length,
          speed: s.speed ?? null,
          languages: s.languages ?? [],
          // 如实声明不支持的能力（假控件禁令）
          supports: {
            emotionTags: false,
            inlineTags: false,
            wordTimestamps: false,
          },
        };
      },
    },
  ];
}

let started = false;

/** 幂等注册（StrictMode 双跑安全）；返回注册结果供调试 */
export function registerAppTools(): Promise<unknown> {
  if (started) return Promise.resolve(null);
  started = true;
  return registerWebMCPTools(buildTools()).then((r) => {
    if (!r.supported) return r;
    if (r.failures.length) console.warn("[audio-tts] WebMCP 注册失败项:", r.failures);
    void normalizeExecuteResult; // 保持与 polyfill 归一说明同源引用（页面侧由 shared 处理）
    return r;
  });
}
