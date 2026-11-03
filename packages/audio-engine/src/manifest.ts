/*
 * 模型 manifest 单源 —— packages/audio-engine/src/manifest.ts
 *
 * 角色：两站可装载模型的**唯一清单**。文件 bytes/sha256 与 .models-cache 实测
 * 对表（deploy/models-fetch.sh 同一份数据）；sources 按 spec「国内默认序」：
 * 自托管同源（默认与最终兜底）→ ModelScope 解析直链（国内第一外源）→
 * HF 官方直链（海外可选）。ghproxy 族禁入运行时（spec Scenario）。
 *
 * sha256 权威性分级：
 *  - sherpa 系模型文件：来自上游 .tar.bz2 解包实测（kokoro 包 sha256 与 GH
 *    Release digest 259c9c8b… 对上）；同包内文件随包 pin。
 *  - whisper-base q8：ModelScope repo files API 的官方 Sha256 字段逐字抄录。
 *
 * supports 面（单源多投影，spec「模型能力面 supports」Requirement）：UI 显隐 /
 * WebMCP schema / URL 参数 / 运行时 reconcile 四投影全部由它派生。
 */

/** 下载源能力标记（manifest sources 逐源声明，下载器按它择路） */
export interface ModelSource {
  /** 源 id（自托管/modelscope/hf） */
  id: string;
  /** URL 模板：{model} = modelId，{path} = 文件相对路径；自托管用 {base} 前缀 */
  urlTemplate: string;
  /** CORS 可用（浏览器 fetch 直取）——全部运行时源必须 true（spec 红线） */
  cors: true;
  /** 支持 Range（断点续传前提）；false＝单请求全量（下载器 noRange 降级） */
  range: boolean;
  /** 角色标记：primary＝默认源与最终兜底；fallback＝备选 */
  role: "primary" | "fallback";
}

/** manifest 每文件条目：路径 + 钉定指纹（bytes/sha256 双门） */
export interface ModelFile {
  /** 相对模型根的路径（如 onnx/model.int8.onnx） */
  path: string;
  bytes: number;
  sha256: string;
}

/** 模型能力面（supports 单源多投影）——Kokoro 无情绪标签等如实声明 */
export interface ModelSupports {
  /** 语速可调范围；缺省＝不支持语速参数 */
  speed?: { min: number; max: number; default: number };
  /** 内联标签句法（如 [laugh]）——Kokoro 全系无，禁假控件 */
  inlineTags?: never;
  /** 词级时间戳（Whisper return_timestamps:"word" / SenseVoice token timestamps） */
  wordTimestamps?: boolean;
  /** 音色数（TTS） */
  numSpeakers?: number;
  /** 支持语言集（BCP-47 或引擎内码） */
  languages?: string[];
  /** 情绪/事件标签（SenseVoice 独有） */
  emotionTags?: boolean;
}

/** 设备档位（minDeviceTier 门；能力探测在 capabilities.ts） */
export type DeviceTier = "small" | "mid" | "large";

/** 引擎轨（双引擎装配的装载路） */
export type EngineKind = "transformers" | "sherpa";

/** 模型用途域 */
export type ModelUse = "stt" | "tts";

/** 模型许可标签（许可白名单硬门；notice 与页内 ai-guide 单源） */
export type LicenseTag =
  | "apache-2.0"
  | "mit"
  | "funasr-dual" // FunASR 系双声明（Apache-2.0 模型卡 + MODEL_LICENSE 链接）
  | "cc-by-4.0-notice"; // CC-BY-4.0 附加署名义务

export interface ModelManifest {
  /** 短 id（页面/工具参数用，如 kokoro-v1_1-zh-int8） */
  modelId: string;
  use: ModelUse;
  engine: EngineKind;
  /** 展示名与一句话 */
  name: string;
  description: string;
  /** 上游 modelId（ModelScope/HF 仓库全名） */
  upstreamId: string;
  /** 许可标签 + 页内可见声明文本（与 NOTICE 单源） */
  licenseTag: LicenseTag;
  notice: string;
  /** 设备档位门：低于该档不呈现此模型（iOS 小模型兜底语义） */
  minDeviceTier: DeviceTier;
  /** 模型根目录名（.models-cache 与自托管 /models/ 下同名） */
  root: string;
  files: ModelFile[];
  sources: ModelSource[];
  supports: ModelSupports;
}

/** 源池模板（按模型 root 拼 URL；部署后自托管路径为 /models/<root>/<path>） */
function sourcesFor(root: string, opts: { modelscopeRepo: string; hfRepo?: string }): ModelSource[] {
  const list: ModelSource[] = [
    {
      id: "selfhost",
      urlTemplate: `/models/${root}/{path}`,
      cors: true,
      range: true,
      role: "primary",
    },
    {
      id: "modelscope",
      urlTemplate: `https://modelscope.cn/api/v1/models/${opts.modelscopeRepo}/repo?FilePath={pathEnc}`,
      cors: true,
      range: true,
      role: "fallback",
    },
  ];
  if (opts.hfRepo) {
    list.push({
      id: "hf",
      urlTemplate: `https://huggingface.co/${opts.hfRepo}/resolve/main/{path}`,
      cors: true,
      range: true,
      role: "fallback",
    });
  }
  return list;
}

/* ── TTS：Kokoro v1.1-zh int8（sherpa 包形态，espeak-ng-data 整目录剔除） ── */
export const KOKORO_V1_1_ZH_INT8: ModelManifest = {
  modelId: "kokoro-v1_1-zh-int8",
  use: "tts",
  engine: "sherpa",
  name: "Kokoro v1.1 中文（int8）",
  description: "100 中文音色 + 3 英音色，24kHz，中英混说；约 188MB 首载",
  upstreamId: "k2-fsa/sherpa-onnx (tts-models: kokoro-int8-multi-lang-v1_1.tar.bz2)",
  licenseTag: "apache-2.0",
  notice: "Kokoro-82M v1.1-zh，Apache-2.0（上游模型卡 hexgrad/Kokoro-82M-v1.1-zh；sherpa-onnx 重打包同许可）。本模型不支持情绪/语气标签。",
  minDeviceTier: "mid",
  root: "kokoro-int8-multi-lang-v1_1",
  files: [
    { path: "model.int8.onnx", bytes: 114203914, sha256: "05d793700b0b507f760c183c0e39bdd6a97b43d32fdc7bf7b54a5179f1b11222" },
    { path: "voices.bin", bytes: 53790720, sha256: "e64a5a581d8c2a350d848f51c3121657cd83aa07ed6109172177345874a7244c" },
    { path: "tokens.txt", bytes: 1111, sha256: "931ab2df2400cd65d580a22402024c2347ced8ae9ea300e545144b1aacc48e14" },
    { path: "lexicon-zh.txt", bytes: 2120131, sha256: "fea060803db3e59193987f1a3436f56917bda09f3b3595b6588e46ae60cebf93" },
    { path: "lexicon-us-en.txt", bytes: 5956885, sha256: "7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14" },
    { path: "lexicon-gb-en.txt", bytes: 6366635, sha256: "c4cbb37316f62210dff52718a7afcaae24f50c032cc75ab47ae67b831d1049e7" },
    { path: "date-zh.fst", bytes: 59154, sha256: "eb8aa079ae3cb81d8f4404992f39d61a0cb990947512b5b8d1e54d1f6980e718" },
    { path: "number-zh.fst", bytes: 64482, sha256: "743f402181fcfebf76cc2f0546b71fa26476e626fbe4e460fb7b4c3a7a8bd5bd" },
    { path: "phone-zh.fst", bytes: 88630, sha256: "1ac2b6fa56b1442320c4de7db08353bab8963a2b57f365eebcdd3a2d3562f8d7" },
    // jieba dict（ sherpa 中文数字/人名规整用；14MB 全量）
    { path: "dict/hmm_model.utf8", bytes: 519739, sha256: "f17790586ac86dd048c8adffed052c4bd2b28ed0682972c1275e59040c0589a7" },
    { path: "dict/idf.utf8", bytes: 5998717, sha256: "dbd1e03d72b2263cc8d84a4304ed77677eed9e7deaf43a1a5133bbba9733b535" },
    { path: "dict/jieba.dict.utf8", bytes: 5071204, sha256: "3043b77068e09c9904f27cad82f12b6ebe9dbdb5aeff3b25e45ab7f9c1122b55" },
    { path: "dict/pos_dict/char_state_tab.utf8", bytes: 327139, sha256: "28b7be1dd7369766a51445af4d42e9a2ba4bf374c13be5bc1ca7721e27271dbb" },
    { path: "dict/pos_dict/prob_emit.utf8", bytes: 1687686, sha256: "c33c4cb7edf3b3a5947df7209b6e9f267eae1f21335d9e2bd2521ea07105457a" },
    { path: "dict/pos_dict/prob_start.utf8", bytes: 4347, sha256: "13623ea0e9300bdb597cb2da28770b7b385d6c0098d66e516083fb01b6bd5d96" },
    { path: "dict/pos_dict/prob_trans.utf8", bytes: 124159, sha256: "f22363e2307408293d180c6f9f6b5cb75879d52f722f7764fa2d3d0ae2400236" },
    { path: "dict/stop_words.utf8", bytes: 8974, sha256: "b788b8a939d2e2fe079abd579ea98f12f9fb84370bfd0dddd81bb9381f7ab42c" },
    { path: "dict/user.dict.utf8", bytes: 829194, sha256: "5faabcd0c52adf512de77fd7eee3d556da8c98b50f493b47c66a981b3a24959c" },
  ],
  sources: sourcesFor("kokoro-int8-multi-lang-v1_1", {
    modelscopeRepo: "journey0ad/kokoro-multi-lang-v1_1", // 解包形态直供（含 lexicon/fst/dict，无 espeak 依赖）
  }),
  supports: {
    speed: { min: 0.5, max: 2.0, default: 1.0 },
    numSpeakers: 103,
    languages: ["zh", "en"],
    // 无 inlineTags、无 emotionTags —— Kokoro 全系无情绪标签（DECISIONS：假控件禁令）
  },
};

/* ── TTS 英文档：Kokoro v1.0 q8f16（transformers.js 路线；54 音色） ── */
export const KOKORO_V1_0_EN_Q8F16: ModelManifest = {
  modelId: "kokoro-v1_0-en-q8f16",
  use: "tts",
  engine: "transformers",
  name: "Kokoro v1.0 英文（q8f16）",
  description: "英文 54 音色，24kHz，约 86MB；transformers.js TTS 路线",
  upstreamId: "onnx-community/kokoro-82M-v1.0-ONNX",
  licenseTag: "apache-2.0",
  notice: "Kokoro-82M v1.0，Apache-2.0（onnx-community 量化镜像；voices 为 256 维 style vector，无情绪标签）",
  minDeviceTier: "mid",
  root: "kokoro-v1_0-en-q8f16",
  files: [
    { path: "onnx/model_q8f16.onnx", bytes: 86033585, sha256: "04c658aec1b6008857c2ad10f8c589d4180d0ec427e7e6118ceb487e215c3cd0" },
    { path: "config.json", bytes: 44, sha256: "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f" },
    { path: "tokenizer.json", bytes: 3497, sha256: "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34" },
    { path: "tokenizer_config.json", bytes: 113, sha256: "be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20" },
  ],
  sources: sourcesFor("kokoro-v1_0-en-q8f16", {
    modelscopeRepo: "onnx-community/kokoro-82M-v1.0-ONNX",
    hfRepo: "onnx-community/kokoro-82M-v1.0-ONNX",
  }),
  supports: {
    speed: { min: 0.5, max: 2.0, default: 1.0 },
    numSpeakers: 54,
    languages: ["en"],
    // 无 inlineTags / emotionTags（Kokoro 全系无情绪标签）
  },
};

/* ── STT：whisper-base q8（transformers.js 默认档，WASM 兜底） ── */
export const WHISPER_BASE_Q8: ModelManifest = {
  modelId: "whisper-base-q8",
  use: "stt",
  engine: "transformers",
  name: "Whisper Base（q8）",
  description: "多语转写兜底档，约 77MB，CPU/WASM 可跑",
  upstreamId: "onnx-community/whisper-base",
  licenseTag: "mit",
  notice: "OpenAI Whisper base，MIT（onnx-community 量化镜像）",
  minDeviceTier: "small",
  root: "whisper-base-q8",
  files: [
    { path: "onnx/encoder_model_quantized.onnx", bytes: 23201314, sha256: "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46" },
    { path: "onnx/decoder_model_merged_quantized.onnx", bytes: 53693315, sha256: "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b" },
    { path: "config.json", bytes: 2243, sha256: "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b" },
    { path: "generation_config.json", bytes: 3832, sha256: "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0" },
    { path: "preprocessor_config.json", bytes: 339, sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d" },
    { path: "quantize_config.json", bytes: 10126, sha256: "6e0e27f293a5c17ff2ca8046f06079c0120aa2ede6456faac8ec4b3203471a55" },
    { path: "tokenizer.json", bytes: 2480466, sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566" },
    { path: "tokenizer_config.json", bytes: 282682, sha256: "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573" },
    { path: "vocab.json", bytes: 1036584, sha256: "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a" },
    { path: "merges.txt", bytes: 493869, sha256: "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6" },
    { path: "normalizer.json", bytes: 52666, sha256: "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd" },
    { path: "added_tokens.json", bytes: 34604, sha256: "9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1" },
    { path: "special_tokens_map.json", bytes: 2194, sha256: "e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691" },
  ],
  sources: sourcesFor("whisper-base-q8", {
    modelscopeRepo: "onnx-community/whisper-base",
    hfRepo: "onnx-community/whisper-base",
  }),
  // 实测（2026-11-03）：onnx-community q8 量化未导出 output_attentions——
  // word-level timestamps 不可用（transformers.js 报 cross attentions 缺失）。
  // 段级时间戳可用。词级档由 WebGPU 大模型（fp16 导出）承担——如启用时修正此门。
  supports: {
    wordTimestamps: false,
    languages: ["multilingual"],
  },
};

/* ── STT：SenseVoice-Small int8（sherpa 中文优先档；FunASR 双声明） ── */
export const SENSEVOICE_SMALL_INT8: ModelManifest = {
  modelId: "sensevoice-small-int8",
  use: "stt",
  engine: "sherpa",
  name: "SenseVoice Small（int8）",
  description: "中粤英日韩＋情绪/事件标签，约 228MB，中文优先档",
  upstreamId: "iic/SenseVoiceSmall (sherpa-onnx asr-models: 2024-07-17 int8)",
  licenseTag: "funasr-dual",
  notice: "SenseVoice-Small：模型卡声明 Apache-2.0（ModelScope iic/SenseVoiceSmall）；FunASR 仓库另有 MODEL_LICENSE v1.1 双声明——两者链接并列展示，如被否决回落 Dolphin（Apache-2.0）。",
  minDeviceTier: "mid",
  root: "sense-voice-int8-2024-07-17",
  files: [
    { path: "model.int8.onnx", bytes: 239233841, sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51" },
    { path: "tokens.txt", bytes: 315894, sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc" },
  ],
  sources: sourcesFor("sense-voice-int8-2024-07-17", {
    // ModelScope 无同文件直链（上游是 .tar.bz2）——运维 seed 经自托管落地；
    // modelscope 条目留空不注册，自托管即唯一运行时源（spec：自托管兜底是底线）
    modelscopeRepo: "", // 空 repo 不入源池（见 sourcePoolOf 过滤）
  }),
  supports: {
    wordTimestamps: true,
    languages: ["zh", "en", "yue", "ja", "ko"],
    emotionTags: true,
  },
};

/* ── STT：Zipformer 流式 bilingual（麦克风实时档；真流式） ── */
export const ZIPFORMER_BILINGUAL_STREAMING: ModelManifest = {
  modelId: "zipformer-bilingual-streaming",
  use: "stt",
  engine: "sherpa",
  name: "Zipformer 流式中英（int8）",
  description: "真流式转写（麦克风实时），中+英，约 191MB",
  upstreamId: "k2-fsa/sherpa-onnx (asr-models: streaming-zipformer-bilingual-zh-en-2023-02-20)",
  licenseTag: "apache-2.0",
  notice: "SherpaNCNN Zipformer streaming bilingual zh-en，Apache-2.0（k2-fsa/icefall 训练框架同许可）",
  minDeviceTier: "mid",
  root: "streaming-zipformer-bilingual-zh-en-2023-02-20",
  files: [
    { path: "encoder-epoch-99-avg-1.int8.onnx", bytes: 181895032, sha256: "8fa764187a261844f859d7143ebaa563af5d10adfece4c18a8f414c88cba2a9b" },
    { path: "decoder-epoch-99-avg-1.onnx", bytes: 13876452, sha256: "2e3b5ec371f8899ee6acd829fd753ba45772df57a91bdf37cde3136354e7db7d" },
    { path: "joiner-epoch-99-avg-1.int8.onnx", bytes: 3228404, sha256: "1ed689c5ed19dbaa725d9d191bb4822b5f4855a39e1ffd28cbc1f340d25b2ee0" },
    { path: "tokens.txt", bytes: 56317, sha256: "a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3" },
  ],
  sources: sourcesFor("streaming-zipformer-bilingual-zh-en-2023-02-20", {
    modelscopeRepo: "", // 同上：tar.bz2 形态无浏览器直链，自托管唯一源
  }),
  supports: {
    languages: ["zh", "en"],
    wordTimestamps: false,
  },
};

/* ── VAD：Silero（麦克风实时切句；0.64MB MIT） ── */
export const SILERO_VAD: ModelManifest = {
  modelId: "silero-vad",
  use: "stt",
  engine: "sherpa",
  name: "Silero VAD",
  description: "语音活动检测（麦克风实时切句），0.6MB",
  upstreamId: "k2-fsa/sherpa-onnx (asr-models: silero_vad.onnx)",
  licenseTag: "mit",
  notice: "Silero VAD，MIT（snakers4/silero-vad；sherpa-onnx 重打包 ONNX 形态）",
  minDeviceTier: "small",
  root: "silero-vad",
  files: [
    { path: "silero_vad.onnx", bytes: 643854, sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6" },
  ],
  sources: sourcesFor("silero-vad", {
    modelscopeRepo: "", // tar/直链无仓——自托管唯一源（同 sherpa 系）
  }),
  supports: {},
};

/** 全量清单（两站按 use 过滤） */
export const AUDIO_MODELS: ModelManifest[] = [
  KOKORO_V1_1_ZH_INT8,
  KOKORO_V1_0_EN_Q8F16,
  WHISPER_BASE_Q8,
  SENSEVOICE_SMALL_INT8,
  ZIPFORMER_BILINGUAL_STREAMING,
  SILERO_VAD,
];

export function modelById(modelId: string): ModelManifest | undefined {
  return AUDIO_MODELS.find((m) => m.modelId === modelId);
}

export function modelsFor(use: ModelUse): ModelManifest[] {
  return AUDIO_MODELS.filter((m) => m.use === use);
}

/** 模型首载体积合计（页内展示/ai-guide 与 manifest 三面对表的口径） */
export function totalBytes(m: ModelManifest): number {
  return m.files.reduce((a, f) => a + f.bytes, 0);
}

/** 运行时源池（过滤空 repo 占位：modelscopeRepo="" 时 urlTemplate 带双斜杠） */
export function sourcePoolOf(m: ModelManifest): ModelSource[] {
  return m.sources.filter((s) => !s.urlTemplate.includes("models//"));
}