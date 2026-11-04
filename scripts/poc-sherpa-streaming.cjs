// POC：Zipformer 流式 bilingual @ sherpa WASM——实时性定档（tasks 3.3 裁决数据）
const fs = require('fs');
const vm = require('vm');
const W = '/tmp/sherpa-build/sherpa-onnx/build-wasm-simd-asr/install/bin/wasm/asr';
const Z = '/Users/kingsword09/Documents/code/ai/fde2e/.worktrees/fde2e-tools-v0-task-audio-stt-tts/.models-cache/streaming-zipformer-bilingual-zh-en-2023-02-20';
const code = fs.readFileSync(W + '/sherpa-onnx-wasm-main-asr.js', 'utf8');

const sandbox = {
  console, process, setTimeout, clearTimeout, WebAssembly, performance,
  TextEncoder, TextDecoder, URL, Blob, fetch, AbortSignal, AbortController, crypto,
  require, module: { exports: {} }, __filename: W + '/m.js', __dirname: W,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.Module = {
  locateFile: (p) => W + '/' + p,
  print: (t) => console.log('[sherpa]', t),
  printErr: (t) => console.error('[err]', t),
  onRuntimeInitialized: () => { sandbox.__ready = true; },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: W + '/m.js' });

const waitReady = new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (sandbox.__ready) { clearInterval(iv); res(); }
    else if (Date.now() - t0 > 60000) { clearInterval(iv); rej(new Error('timeout')); }
  }, 100);
});

(async () => {
  await waitReady;
  const Module = sandbox.Module;
  const FS = Module.FS;
  const t0 = Date.now();
  FS.writeFile('encoder.onnx', fs.readFileSync(`${Z}/encoder-epoch-99-avg-1.int8.onnx`));
  FS.writeFile('decoder.onnx', fs.readFileSync(`${Z}/decoder-epoch-99-avg-1.onnx`));
  FS.writeFile('joiner.onnx', fs.readFileSync(`${Z}/joiner-epoch-99-avg-1.int8.onnx`));
  FS.writeFile('tokens.txt', fs.readFileSync(`${Z}/tokens.txt`));
  console.log(`✓ zipformer 三件套入 MEMFS（${((Date.now()-t0)/1000).toFixed(1)}s）`);

  vm.runInContext(fs.readFileSync(W + '/sherpa-onnx-asr.js', 'utf8'), sandbox, { filename: 'asr.js' });
  const createOnlineRecognizer = sandbox.module.exports.createOnlineRecognizer;
  if (!createOnlineRecognizer) throw new Error('createOnlineRecognizer 未导出');

  const rec = createOnlineRecognizer(Module, {
    modelConfig: {
      transducer: {
        encoder: './encoder.onnx',
        decoder: './decoder.onnx',
        joiner: './joiner.onnx',
      },
      tokens: './tokens.txt',
      numThreads: 1,
      debug: 0,
      provider: 'cpu',
    },
    decodingMethod: 'greedy_search',
  });
  console.log('✓ OnlineRecognizer 创建');

  // 流式喂入：zh.wav 按 100ms 块实时节奏喂——测 decode 吞吐（RTF 判据）
  function readWav(path) {
    const buf = fs.readFileSync(path);
    let pos = 12;
    while (pos < buf.length) {
      const id = buf.toString('ascii', pos, pos+4);
      const size = buf.readUInt32LE(pos+4);
      if (id === 'data') {
        const start = pos+8; const n = size/2;
        const out = new Float32Array(n);
        for (let i=0;i<n;i++) out[i]=buf.readInt16LE(start+i*2)/32768;
        return { samples: out, sampleRate: buf.readUInt32LE(24) };
      }
      pos += 8 + size;
    }
    throw new Error('no data');
  }
  const { samples, sampleRate } = readWav(`${Z}/test_wavs/1.wav`);
  const stream = rec.createStream();
  const CHUNK = Math.round(sampleRate * 0.1); // 100ms 喂入
  let decodeMs = 0, fed = 0, lastText = '';
  const t1 = Date.now();
  for (let off = 0; off < samples.length; off += CHUNK) {
    const slice = samples.subarray(off, Math.min(off + CHUNK, samples.length));
    const d0 = performance.now();
    stream.acceptWaveform(sampleRate, slice);
    fed += slice.length;
    while (rec.isReady(stream)) rec.decode(stream);
    decodeMs += performance.now() - d0;
    // 每 1s 音频打一次中间结果（真流式语义验证）
    if (fed % Math.round(sampleRate) < CHUNK) {
      const rRaw = rec.getResult(stream);
      const r = typeof rRaw === "string" ? JSON.parse(rRaw) : rRaw;
      if (r.text && r.text !== lastText) { lastText = r.text; console.log(`  [${(fed/sampleRate).toFixed(1)}s] ${lastText.slice(0,40)}`); }
    }
  }
  const audioDur = samples.length / sampleRate;
  const wallMs = Date.now() - t1;
  console.log(`✓ 音频 ${audioDur.toFixed(2)}s | decode 累计 ${decodeMs.toFixed(0)}ms | RTF(decode)=${(decodeMs/1000/audioDur).toFixed(3)} | 墙钟 RTF=${(wallMs/1000/audioDur).toFixed(3)}`);
  const fin = rec.getResult(stream); console.log('最终:', (typeof fin === 'string' ? JSON.parse(fin).text : fin.text)?.slice(0,60));
  console.log('\n★★ POC 3.3：RTF(decode) < 1 ⇒ 真流式可行（WASM 单线程）★★');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
