// ★ POC ②（本机段）：SenseVoice int8 @ sherpa WASM 单线程 RTF 实测（M 系）
const fs = require('fs');
const vm = require('vm');
const W = '/tmp/sherpa-build/sherpa-onnx/build-wasm-simd-asr/install/bin/wasm/asr';
const SV = '/tmp/seed-sensevoice/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';
const code = fs.readFileSync(W + '/sherpa-onnx-wasm-main-asr.js', 'utf8');

const sandbox = {
  console, process, setTimeout, clearTimeout, WebAssembly, performance,
  TextEncoder, TextDecoder, URL, Blob, fetch, AbortSignal, AbortController, crypto,
  require, module: { exports: {} }, __filename: W + '/sherpa-main.js', __dirname: W,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.Module = {
  locateFile: (p) => W + '/' + p,
  print: (t) => console.log('[sherpa]', t),
  printErr: (t) => console.error('[sherpa:err]', t),
  onRuntimeInitialized: () => { sandbox.__ready = true; },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: W + '/sherpa-main.js' });

const waitReady = new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (sandbox.__ready) { clearInterval(iv); res(); }
    else if (Date.now() - t0 > 60000) { clearInterval(iv); rej(new Error('runtime 超时')); }
  }, 100);
});

(async () => {
  await waitReady;
  const Module = sandbox.Module;
  const FS = Module.FS;

  // SenseVoice 三件入 MEMFS
  const t0 = Date.now();
  FS.writeFile('model.onnx', fs.readFileSync(`${SV}/model.int8.onnx`));
  FS.writeFile('tokens.txt', fs.readFileSync(`${SV}/tokens.txt`));
  console.log(`✓ 模型入 MEMFS（${((Date.now()-t0)/1000).toFixed(1)}s）`);

  // 包装层
  vm.runInContext(fs.readFileSync(W + '/sherpa-onnx-asr.js', 'utf8'), sandbox, { filename: W + '/asr.js' });
  const OfflineRecognizer = sandbox.module.exports.OfflineRecognizer;
  if (!OfflineRecognizer) throw new Error('OfflineRecognizer 未挂载（module.exports 面）');

  // SenseVoice 配置（feature_config 与 model_config 的面以 wrapper 为准）
  const config = {
    modelConfig: {
      senseVoice: {
        model: './model.onnx',
        language: '',        // 空＝auto
        useInverseTextNormalization: 1,
      },
      tokens: './tokens.txt',
      numThreads: 1,
      debug: 0,
      provider: 'cpu',
    },
    decodingMethod: 'greedy_search',
  };
  // wrapper 的 config 顶层字段名核对（initSherpaOnnxOfflineRecognizerConfig）
  const src = fs.readFileSync(W + '/sherpa-onnx-asr.js', 'utf8');
  const m = src.match(/function initSherpaOnnxOfflineRecognizerConfig[\s\S]{0,400}/);
  if (m) console.log('[cfg-probe]', m[0].slice(0, 300));

  console.log('创建 OfflineRecognizer…');
  const t1 = Date.now();
  const rec = new OfflineRecognizer(config, Module);
  console.log(`✓ Recognizer 创建（${((Date.now()-t1)/1000).toFixed(1)}s）`);

  // 读 wav → Float32
  function readWav(path) {
    const buf = fs.readFileSync(path);
    // PCM16 单声道——跳过头部（data chunk 定位）
    let pos = 12;
    while (pos < buf.length) {
      const id = buf.toString('ascii', pos, pos+4);
      const size = buf.readUInt32LE(pos+4);
      if (id === 'data') { const start = pos+8; const n = (size)/2; const out = new Float32Array(n); for (let i=0;i<n;i++) out[i]=buf.readInt16LE(start+i*2)/32768; return { samples: out, sampleRate: buf.readUInt32LE(24) }; }
      pos += 8 + size;
    }
    throw new Error('data chunk 未找到');
  }

  for (const wav of ['zh.wav','en.wav']) {
    const { samples, sampleRate } = readWav(`${SV}/test_wavs/${wav}`);
    const dur = samples.length / sampleRate;
    const t2 = Date.now();
    const stream = rec.createStream();
    stream.acceptWaveform(sampleRate, samples);
    rec.decode(stream);
    const rRaw = rec.getResult(stream);
    const r = typeof rRaw === "string" ? JSON.parse(rRaw) : rRaw;
    const elapsed = (Date.now()-t2)/1000;
    console.log(`✓ ${wav}: ${dur.toFixed(2)}s 音频 | ${elapsed.toFixed(2)}s | RTF=${(elapsed/dur).toFixed(2)} | text="${(r.text||'').slice(0,60)}"`);
  }
  console.log('\n★★ POC ②（本机段）结论：SenseVoice int8 sherpa WASM 单线程 RTF 见上 ★★');
  process.exit(0);
})().catch(e => { console.error('POC FAIL:', e.message); if(e.stack) console.error(e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); });
