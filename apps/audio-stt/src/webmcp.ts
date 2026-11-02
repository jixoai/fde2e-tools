/*
 * audio-stt WebMCP 注册 —— apps/audio-stt/src/webmcp.ts（tasks 3.6）
 *
 * transcribe_audio（返回 TranscriptDoc JSON：segments+words，非裸文本）/
 * list_models / get_capabilities（只读）。模型档位/体积与 manifest 同源。
 */
import {
  clickById,
  registerWebMCPTools,
  waitForStatusChange,
  type WebMCPToolDef,
} from "@fde2e-tools/shared/webmcp";
import { WHISPER_BASE_Q8, SENSEVOICE_SMALL_INT8, totalBytes } from "@fde2e-tools/audio-engine/manifest";
import { SUPPORTED_EXT } from "./engine";

function setInputValue(id: string, value: string): void {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`页面未就绪（#${id} 缺失）`);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** 取当前 TranscriptDoc（App 的 module 态不可直接读——经 window 桥） */
function readDoc(): unknown {
  const w = window as unknown as { __sttDoc?: unknown };
  if (!w.__sttDoc) throw new Error("尚无转写产物（先跑一次 transcribe_audio 或页面转写）");
  return w.__sttDoc;
}

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "transcribe_audio",
      title: "转写音频",
      description:
        "把音频文件转写为带时间轴文本（TranscriptDoc JSON：segments[{id,text,start,end}]+language+engine+model）。" +
        "fileUrl＝音频 URL（本源可取，支持 " + SUPPORTED_EXT.join("/") + "）；model 见 list_models（缺省 whisper-base-q8）。" +
        "首次使用所选模型需下载（77-228MB）。音频全程本地推理不上传。",
      inputSchema: {
        type: "object",
        properties: {
          fileUrl: { type: "string", description: "音频文件 URL（同源或 CORS 开放；必填）" },
          model: { type: "string", enum: ["whisper-base-q8", "sensevoice-small-int8"], description: "转写模型（缺省 whisper-base-q8 多语兜底；中文优先 sensevoice）" },
        },
        required: ["fileUrl"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const fileUrl = String(input.fileUrl ?? "").trim();
        if (!fileUrl) return { ok: false, error: "fileUrl 必填（音频文件 URL）。" };
        let u: URL;
        try {
          u = new URL(fileUrl, location.href);
        } catch {
          return { ok: false, error: `fileUrl 不是合法 URL：${fileUrl}` };
        }
        const modelName = String(input.model ?? "whisper-base-q8");
        const name = fileUrl.split("/").pop() ?? "audio";
        // URL 路径不在白名单扩展时以 fetch 内容为准（decodeAudioData 判真），白名单只拦显式坏后缀
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        if (!SUPPORTED_EXT.includes(ext)) {
          return { ok: false, error: `不支持的格式「${ext}」——支持：${SUPPORTED_EXT.join(" / ")}。` };
        }
        // 写 URL 到隐藏桥输入（App 主链路复用：把 File 换成 fetch 回的 Blob）
        try {
          const resp = await fetch(u.href);
          if (!resp.ok) return { ok: false, error: `fileUrl 拉取失败：HTTP ${resp.status}` };
          const blob = await resp.blob();
          const file = new File([blob], name, { type: blob.type || "audio/wav" });
          const input2 = document.getElementById("input-file");
          if (!(input2 instanceof HTMLInputElement)) return { ok: false, error: "页面未就绪（#input-file 缺失）" };
          const dt = new DataTransfer();
          dt.items.add(file);
          input2.files = dt.files;
          // 选模型（若非缺省）
          if (modelName !== "whisper-base-q8") setInputValue("model-select", modelName);
          clickById("transcribe-btn");
          const status = await waitForStatusChange(1_800_000);
          if (!status.message.includes("已转写")) {
            return { ok: false, error: status.message, message: status.message };
          }
          const doc = readDoc() as { segments?: unknown[]; language?: string; engine?: string; model?: string; duration?: number };
          return {
            ok: true,
            doc,
            segmentCount: Array.isArray(doc.segments) ? doc.segments.length : 0,
            message: status.message,
            untrusted: true,
          };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      name: "list_models",
      title: "列出转写模型",
      description: "枚举可用转写模型（id/名称/引擎/体积/许可）。transcribe_audio 的 model 取值域。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        return {
          ok: true,
          models: [
            { id: WHISPER_BASE_Q8.modelId, name: WHISPER_BASE_Q8.name, engine: WHISPER_BASE_Q8.engine, totalBytes: totalBytes(WHISPER_BASE_Q8), license: WHISPER_BASE_Q8.licenseTag, notice: WHISPER_BASE_Q8.notice },
            { id: SENSEVOICE_SMALL_INT8.modelId, name: SENSEVOICE_SMALL_INT8.name, engine: SENSEVOICE_SMALL_INT8.engine, totalBytes: totalBytes(SENSEVOICE_SMALL_INT8), license: SENSEVOICE_SMALL_INT8.licenseTag, notice: SENSEVOICE_SMALL_INT8.notice },
          ],
        };
      },
    },
    {
      name: "get_capabilities",
      title: "查询能力面",
      description: "只读返回本站能力面（模型/引擎/分片参数/导出格式/支持格式清单）。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        return {
          ok: true,
          engines: ["transformers", "sherpa"],
          chunkSec: 30,
          rebuildEvery: 6,
          exportFormats: ["srt", "vtt", "txt", "json"],
          supportedExt: SUPPORTED_EXT,
          supports: {
            wordTimestamps: { "whisper-base-q8": true, "sensevoice-small-int8": true },
            microphoneRealtime: "planned", // 3.3 收口前如实标注
          },
        };
      },
    },
  ];
}

let started = false;

/** 幂等注册（StrictMode 双跑安全） */
export function registerAppTools(): Promise<unknown> {
  if (started) return Promise.resolve(null);
  started = true;
  return registerWebMCPTools(buildTools()).then((r) => {
    if (!r.supported) return r;
    if (r.failures.length) console.warn("[audio-stt] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
