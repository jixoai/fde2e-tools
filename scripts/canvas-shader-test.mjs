/*
 * Canvas Paper Shaders 预设/校验单测 —— scripts/canvas-shader-test.mjs
 *
 * 运行：node --test scripts/canvas-shader-test.mjs
 * （Node 22+ 原生 type stripping 直接 import 纯数据/纯函数 presets.ts；
 *  DOM 相关的 render/chain 走 canvas-e2e 真浏览器链路。）
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SHADER_PRESETS,
  ShaderError,
  getShaderPreset,
  listShaderPresets,
  parseColorStrict,
  presetSummary,
  validateDimension,
  validateShaderParams,
} from "../apps/canvas/src/shaders/presets.ts";

test("预设目录：4 个预设覆盖 mesh/glass/paper", () => {
  assert.equal(SHADER_PRESETS.length, 4);
  assert.deepEqual(
    SHADER_PRESETS.map((p) => p.id),
    ["mesh-sunset", "mesh-aurora", "glass-prism", "paper-default"],
  );
  assert.deepEqual(
    SHADER_PRESETS.map((p) => p.kind),
    ["mesh", "mesh", "glass", "paper"],
  );
  assert.equal(SHADER_PRESETS.filter((p) => p.needsImage).length, 2);
  assert.equal(getShaderPreset("nope"), null);
});

test("预设摘要不含全量默认参数", () => {
  const summary = presetSummary(SHADER_PRESETS[0]);
  assert.deepEqual(Object.keys(summary).sort(), [
    "id",
    "name",
    "needsImage",
    "overridable",
    "recommendedSize",
    "tags",
  ]);
  assert.ok(!("defaults" in summary));
  assert.ok(summary.overridable.includes("colors"));
});

test("预设过滤：tag / needsImage", () => {
  assert.equal(listShaderPresets({ needsImage: false }).length, 2);
  assert.equal(listShaderPresets({ needsImage: true }).length, 2);
  assert.deepEqual(
    listShaderPresets({ tag: "glass" }).map((p) => p.id),
    ["glass-prism"],
  );
  assert.deepEqual(
    listShaderPresets({ tag: "aurora" }).map((p) => p.id),
    ["mesh-aurora"],
  );
});

test("默认参数可直接通过校验（颜色转 RGBA）", () => {
  for (const preset of SHADER_PRESETS) {
    const { values, warnings } = validateShaderParams(preset, undefined);
    assert.deepEqual(warnings, []);
    for (const key of preset.overridable) {
      assert.ok(key in values, `${preset.id} 缺默认值 ${key}`);
    }
    if (preset.kind === "mesh") {
      assert.equal(values.colors.length, 4);
      assert.ok(Array.isArray(values.colors[0]) && values.colors[0].length === 4);
    }
  }
});

test("白名单外参数忽略并 warning", () => {
  const preset = getShaderPreset("mesh-sunset");
  const { values, warnings } = validateShaderParams(preset, { hack: 1, mixing: 0.8 });
  assert.ok(!("hack" in values));
  assert.equal(values.mixing, 0.8);
  assert.ok(warnings.some((w) => w.includes("hack") && w.includes("忽略")));
});

test("数值 clamp：mesh mixing / paper crumpleCount", () => {
  const mesh = getShaderPreset("mesh-sunset");
  const clamped = validateShaderParams(mesh, { mixing: 9, positions: -3 });
  assert.equal(clamped.values.mixing, 1);
  assert.equal(clamped.values.positions, 0);
  assert.equal(clamped.warnings.filter((w) => w.includes("夹紧")).length, 2);

  const paper = getShaderPreset("paper-default");
  const low = validateShaderParams(paper, { crumpleCount: 1 });
  assert.equal(low.values.crumpleCount, 2);
  const high = validateShaderParams(paper, { crumpleCount: 99 });
  assert.equal(high.values.crumpleCount, 15);
});

test("colors ≤ 10：超出截断并 warning", () => {
  const preset = getShaderPreset("mesh-sunset");
  const colors = Array.from({ length: 13 }, () => "#112233");
  const { values, warnings } = validateShaderParams(preset, { colors });
  assert.equal(values.colors.length, 10);
  assert.ok(warnings.some((w) => w.includes("最多 10 项")));
});

test("非法颜色显式 E_SHADER_BAD_PARAM（不走官方灰色 fallback）", () => {
  const preset = getShaderPreset("mesh-sunset");
  assert.throws(
    () => validateShaderParams(preset, { colors: ["not-a-color"] }),
    (e) => e instanceof ShaderError && e.code === "E_SHADER_BAD_PARAM" && e.message.includes("颜色"),
  );
  assert.throws(
    () => validateShaderParams(getShaderPreset("glass-prism"), { colorBack: "rgb(999,0,0)" }),
    (e) => e instanceof ShaderError && e.code === "E_SHADER_BAD_PARAM",
  );
});

test("枚举校验：glass distortionShape/shape", () => {
  const glass = getShaderPreset("glass-prism");
  assert.throws(
    () => validateShaderParams(glass, { distortionShape: "bogus" }),
    (e) => e instanceof ShaderError && e.code === "E_SHADER_BAD_PARAM" && e.message.includes("prism"),
  );
  const ok = validateShaderParams(glass, { distortionShape: "lens", shape: "wave" });
  assert.equal(ok.values.distortionShape, "lens");
  assert.equal(ok.values.shape, "wave");
});

test("严格颜色解析：合法格式全收、非法全拒", () => {
  for (const color of [
    "#abc",
    "#abcd",
    "#aabbcc",
    "#aabbccdd",
    "rgb(255, 0, 128)",
    "rgba(255,0,128,0.5)",
    "hsl(300, 100%, 50%)",
    "hsla(120, 100%, 50%, 0.25)",
  ]) {
    assert.ok(parseColorStrict(color), `应接受 ${color}`);
  }
  for (const color of ["", "red", "#ab", "#gggggg", "rgb(1,2)", "hsl(1,2,3)", "rgb(300,0,0)", "rgba(0,0,0,2)"]) {
    assert.equal(parseColorStrict(color), null, `应拒绝 ${JSON.stringify(color)}`);
  }
  const hsl = parseColorStrict("hsl(120, 100%, 50%)");
  assert.ok(hsl[0] < 0.01 && hsl[1] > 0.99 && hsl[2] < 0.01);
});

test("维度校验：16–4096 整数，越界显式报错", () => {
  assert.equal(validateDimension(1080, "width"), 1080);
  assert.equal(validateDimension(15.6, "width"), 16);
  assert.equal(validateDimension(undefined, "width", 1080), 1080);
  for (const bad of [15, 4097, Number.NaN, "100"]) {
    assert.throws(
      () => validateDimension(bad, "width"),
      (e) => e instanceof ShaderError && e.code === "E_SHADER_BAD_PARAM",
    );
  }
});
