// ★★★ POC ① 完整链路：fetch→MEMFS 动态装载＋kokoro 合成 ★★★
const fs = require('fs');
const vm = require('vm');
const W = '/tmp/sherpa-build/sherpa-onnx/build-wasm-simd-tts/install/bin/wasm/tts';
const MODELS = '/tmp/seed-kokoro/kokoro-int8-multi-lang-v1_1';
const code = fs.readFileSync(W + '/sherpa-onnx-wasm-main-tts.js', 'utf8');

const sandbox = {
  console, process, setTimeout, clearTimeout, WebAssembly, performance,
  TextEncoder, TextDecoder, URL, Blob, fetch, AbortSignal, AbortController, crypto,
  require, module: { exports: {} }, __filename: W + '/sherpa-onnx-wasm-main-tts.js', __dirname: W,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.Module = {
  locateFile: (p) => W + '/' + p,
  print: (t) => console.log('[sherpa]', t),
  printErr: (t) => console.error('[sherpa:err]', t),
  onRuntimeInitialized: () => { console.log('★ runtime ready'); sandbox.__ready = true; },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: W + '/sherpa-main.js' });

// 等 runtime
const waitReady = new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (sandbox.__ready) { clearInterval(iv); res(); }
    else if (Date.now() - t0 > 60000) { clearInterval(iv); rej(new Error('runtime 超时')); }
  }, 100);
});
(async () => {
  await waitReady;
  console.log('✓ runtime 就绪（calledRun=true）');
  const Module = sandbox.Module;
  const FS = Module.FS;

  // ── fetch→MEMFS：8 件模型写入 ──
  const files = ["model.onnx","tokens.txt","lexicon-us-en.txt","lexicon-gb-en.txt","lexicon-zh.txt","date-zh.fst","number-zh.fst","phone-zh.fst"];
  const t0 = Date.now();
  for (const f of files) {
    const src = f === "model.onnx" ? "model.int8.onnx" : f;
    const bytes = fs.readFileSync(`${MODELS}/${src}`);
    FS.writeFile(f, bytes);
    console.log(`  FS.writeFile ${f} (${(bytes.length/1048576).toFixed(1)}MB) → stat=${FS.stat(f).size}`);
  }
  console.log(`✓ 8 文件入 MEMFS（${((Date.now()-t0)/1000).toFixed(1)}s）`);

  // ── 加载 sherpa-onnx-tts.js（包装层）──
  const ttsWrapper = fs.readFileSync(W + '/sherpa-onnx-tts.js', 'utf8');
  // 它是经典 script（无 export）——vm 同沙箱执行
  vm.runInContext(ttsWrapper, sandbox, { filename: W + '/sherpa-onnx-tts.js' });
  const createOfflineTts = sandbox.createOfflineTts;
  if (!createOfflineTts) throw new Error('createOfflineTts 未挂到沙箱');

  // kokoro case 8（lexicon 前端）
  const config = {
    offlineTtsModelConfig: {
      offlineTtsKokoroModelConfig: {
        model: './model.onnx',
        voices: './voices.bin',  // v1_1 需要 voices.bin（103 音色 style vectors）
        tokens: './tokens.txt',
        dataDir: '',
        lexicon: './lexicon-us-en.txt,./lexicon-zh.txt',
        lang: '',
        lengthScale: 1.0,
      },
      numThreads: 1,
      debug: 0,
      provider: 'cpu',
    },
    ruleFsts: './date-zh.fst,./number-zh.fst,./phone-zh.fst',
    maxNumSentences: 1,
  };

  console.log('创建 OfflineTts…');
  const t1 = Date.now();
  // voices.bin 也写入（ kokoro v1_1 sherpa 包形态必需）
  FS.writeFile('voices.bin', fs.readFileSync(`${MODELS}/voices.bin`));
  const tts = createOfflineTts(Module, config);
  console.log(`✓ Tts 创建（${((Date.now()-t1)/1000).toFixed(1)}s） speakers=${tts.numSpeakers} sr=${tts.sampleRate} lang="${tts.lang}"`);

  const t2 = Date.now();
  const audio = tts.generate({ text: '你好，本地语音测试。', sid: 3, speed: 1.0 });
  const elapsed = (Date.now() - t2) / 1000;
  const dur = audio.samples.length / audio.sampleRate;
  const nonSilent = audio.samples.filter(x => Math.abs(x) > 0.01).length / audio.samples.length;
  console.log(`✓ 合成：${audio.samples.length} samples @${audio.sampleRate}Hz = ${dur.toFixed(2)}s | 耗时 ${elapsed.toFixed(2)}s | RTF=${(elapsed/dur).toFixed(2)} | 非静音 ${(nonSilent*100).toFixed(1)}%`);

  // 落 wav 供人耳验收
  const pcm16 = Buffer.alloc(audio.samples.length * 2);
  for (let i = 0; i < audio.samples.length; i++) {
    const v = Math.max(-1, Math.min(1, audio.samples[i]));
    pcm16.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm16.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(audio.sampleRate, 24); header.writeUInt32LE(audio.sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm16.length, 40);
  fs.writeFileSync('/tmp/sherpa-build/poc-out.wav', Buffer.concat([header, pcm16]));
  console.log('✓ wav 落盘 /tmp/sherpa-build/poc-out.wav');

  // 第二句：RTF 稳定性
  const t3 = Date.now();
  const a2 = tts.generate({ text: '今天天气不错，我们出去走走吧。', sid: 3, speed: 1.0 });
  const e2 = (Date.now() - t3) / 1000;
  const d2 = a2.samples.length / a2.sampleRate;
  console.log(`✓ 第二句：${d2.toFixed(2)}s 音频 | ${e2.toFixed(2)}s | RTF=${(e2/d2).toFixed(2)}`);
  console.log('\n★★★ POC ① 结论：fetch→MEMFS 动态装载可行（无需 preload .data）★★★');
  process.exit(0);
})().catch(e => { console.error('POC FAIL:', e.message); process.exit(1); });
