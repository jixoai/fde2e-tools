/**
 * 音色表 —— apps/audio-tts/src/voices.ts
 *
 * Kokoro v1.1 sherpa sid 映射（上游官方文档逐字对表：
 * k2-fsa.github.io sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_1）：
 * af_maple=0 / af_sol=1 / bf_vale=2 / zf_001..=3-57（55 音色）/ zm_009..=58-102（45 音色）。
 * supports.numSpeakers=103 的 reconcile 数据源；运行时实测不符即 degraded（spec）。
 */
export interface Voice {
  sid: number;
  name: string;
  group: "zh-f" | "zh-m" | "en-f" | "en-m";
}

export const VOICES: Voice[] = [
  { sid: 0, name: "af_maple", group: "en-f" },
  { sid: 1, name: "af_sol", group: "en-f" },
  { sid: 2, name: "bf_vale", group: "en-f" },
  { sid: 3, name: "zf_001", group: "zh-f" },
  { sid: 4, name: "zf_002", group: "zh-f" },
  { sid: 5, name: "zf_003", group: "zh-f" },
  { sid: 6, name: "zf_004", group: "zh-f" },
  { sid: 7, name: "zf_005", group: "zh-f" },
  { sid: 8, name: "zf_006", group: "zh-f" },
  { sid: 9, name: "zf_007", group: "zh-f" },
  { sid: 10, name: "zf_008", group: "zh-f" },
  { sid: 11, name: "zf_017", group: "zh-f" },
  { sid: 12, name: "zf_018", group: "zh-f" },
  { sid: 13, name: "zf_019", group: "zh-f" },
  { sid: 14, name: "zf_021", group: "zh-f" },
  { sid: 15, name: "zf_022", group: "zh-f" },
  { sid: 16, name: "zf_023", group: "zh-f" },
  { sid: 17, name: "zf_024", group: "zh-f" },
  { sid: 18, name: "zf_026", group: "zh-f" },
  { sid: 19, name: "zf_027", group: "zh-f" },
  { sid: 20, name: "zf_028", group: "zh-f" },
  { sid: 21, name: "zf_032", group: "zh-f" },
  { sid: 22, name: "zf_036", group: "zh-f" },
  { sid: 23, name: "zf_038", group: "zh-f" },
  { sid: 24, name: "zf_039", group: "zh-f" },
  { sid: 25, name: "zf_040", group: "zh-f" },
  { sid: 26, name: "zf_042", group: "zh-f" },
  { sid: 27, name: "zf_043", group: "zh-f" },
  { sid: 28, name: "zf_044", group: "zh-f" },
  { sid: 29, name: "zf_046", group: "zh-f" },
  { sid: 30, name: "zf_047", group: "zh-f" },
  { sid: 31, name: "zf_048", group: "zh-f" },
  { sid: 32, name: "zf_049", group: "zh-f" },
  { sid: 33, name: "zf_051", group: "zh-f" },
  { sid: 34, name: "zf_059", group: "zh-f" },
  { sid: 35, name: "zf_060", group: "zh-f" },
  { sid: 36, name: "zf_067", group: "zh-f" },
  { sid: 37, name: "zf_070", group: "zh-f" },
  { sid: 38, name: "zf_071", group: "zh-f" },
  { sid: 39, name: "zf_072", group: "zh-f" },
  { sid: 40, name: "zf_073", group: "zh-f" },
  { sid: 41, name: "zf_074", group: "zh-f" },
  { sid: 42, name: "zf_075", group: "zh-f" },
  { sid: 43, name: "zf_076", group: "zh-f" },
  { sid: 44, name: "zf_077", group: "zh-f" },
  { sid: 45, name: "zf_078", group: "zh-f" },
  { sid: 46, name: "zf_079", group: "zh-f" },
  { sid: 47, name: "zf_083", group: "zh-f" },
  { sid: 48, name: "zf_084", group: "zh-f" },
  { sid: 49, name: "zf_085", group: "zh-f" },
  { sid: 50, name: "zf_086", group: "zh-f" },
  { sid: 51, name: "zf_087", group: "zh-f" },
  { sid: 52, name: "zf_088", group: "zh-f" },
  { sid: 53, name: "zf_090", group: "zh-f" },
  { sid: 54, name: "zf_092", group: "zh-f" },
  { sid: 55, name: "zf_093", group: "zh-f" },
  { sid: 56, name: "zf_094", group: "zh-f" },
  { sid: 57, name: "zf_099", group: "zh-f" },
  { sid: 58, name: "zm_009", group: "zh-m" },
  { sid: 59, name: "zm_010", group: "zh-m" },
  { sid: 60, name: "zm_011", group: "zh-m" },
  { sid: 61, name: "zm_012", group: "zh-m" },
  { sid: 62, name: "zm_013", group: "zh-m" },
  { sid: 63, name: "zm_014", group: "zh-m" },
  { sid: 64, name: "zm_015", group: "zh-m" },
  { sid: 65, name: "zm_016", group: "zh-m" },
  { sid: 66, name: "zm_020", group: "zh-m" },
  { sid: 67, name: "zm_025", group: "zh-m" },
  { sid: 68, name: "zm_029", group: "zh-m" },
  { sid: 69, name: "zm_030", group: "zh-m" },
  { sid: 70, name: "zm_031", group: "zh-m" },
  { sid: 71, name: "zm_033", group: "zh-m" },
  { sid: 72, name: "zm_034", group: "zh-m" },
  { sid: 73, name: "zm_035", group: "zh-m" },
  { sid: 74, name: "zm_037", group: "zh-m" },
  { sid: 75, name: "zm_041", group: "zh-m" },
  { sid: 76, name: "zm_045", group: "zh-m" },
  { sid: 77, name: "zm_050", group: "zh-m" },
  { sid: 78, name: "zm_052", group: "zh-m" },
  { sid: 79, name: "zm_053", group: "zh-m" },
  { sid: 80, name: "zm_054", group: "zh-m" },
  { sid: 81, name: "zm_055", group: "zh-m" },
  { sid: 82, name: "zm_056", group: "zh-m" },
  { sid: 83, name: "zm_057", group: "zh-m" },
  { sid: 84, name: "zm_058", group: "zh-m" },
  { sid: 85, name: "zm_061", group: "zh-m" },
  { sid: 86, name: "zm_062", group: "zh-m" },
  { sid: 87, name: "zm_063", group: "zh-m" },
  { sid: 88, name: "zm_064", group: "zh-m" },
  { sid: 89, name: "zm_065", group: "zh-m" },
  { sid: 90, name: "zm_066", group: "zh-m" },
  { sid: 91, name: "zm_068", group: "zh-m" },
  { sid: 92, name: "zm_069", group: "zh-m" },
  { sid: 93, name: "zm_080", group: "zh-m" },
  { sid: 94, name: "zm_081", group: "zh-m" },
  { sid: 95, name: "zm_082", group: "zh-m" },
  { sid: 96, name: "zm_089", group: "zh-m" },
  { sid: 97, name: "zm_091", group: "zh-m" },
  { sid: 98, name: "zm_095", group: "zh-m" },
  { sid: 99, name: "zm_096", group: "zh-m" },
  { sid: 100, name: "zm_097", group: "zh-m" },
  { sid: 101, name: "zm_098", group: "zh-m" },
  { sid: 102, name: "zm_100", group: "zh-m" },
];

export const VOICE_GROUPS: Array<{ id: Voice["group"]; label: string }> = [
  { id: "zh-f", label: "中文·女声" },
  { id: "zh-m", label: "中文·男声" },
  { id: "en-f", label: "英文·女声" },
];

/** sid 反查（agent 按名传参时用） */
export function voiceByName(name: string): Voice | undefined {
  return VOICES.find((v) => v.name === name.toLowerCase());
}

export function voiceBySid(sid: number): Voice | undefined {
  return VOICES.find((v) => v.sid === sid);
}
