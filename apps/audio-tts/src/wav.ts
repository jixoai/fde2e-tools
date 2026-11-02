/**
 * WAV 编码 —— apps/audio-tts/src/wav.ts
 *
 * Float32 PCM → 16-bit WAV（44 字节头）。TTS 中间态禁有损格式（research §3：
 * decodeAudioData 重采样/encoder-delay 坑）——产物直接拿合成 PCM 封 WAV，
 * 播放与下载同一条字节源。
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = Math.round(v * 32767);
  }
  const header = new ArrayBuffer(44);
  const h = new DataView(header);
  h.setUint8(0, 0x52); h.setUint8(1, 0x49); h.setUint8(2, 0x46); h.setUint8(3, 0x46); // RIFF
  h.setUint32(4, 36 + pcm.length * 2, true);
  h.setUint8(8, 0x57); h.setUint8(9, 0x41); h.setUint8(10, 0x56); h.setUint8(11, 0x45); // WAVE
  h.setUint8(12, 0x66); h.setUint8(13, 0x6d); h.setUint8(14, 0x74); h.setUint8(15, 0x20); // fmt
  h.setUint32(16, 16, true);          // PCM chunk size
  h.setUint16(20, 1, true);           // PCM
  h.setUint16(22, 1, true);           // mono
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * 2, true); // byte rate
  h.setUint16(32, 2, true);           // block align
  h.setUint16(34, 16, true);          // bits
  h.setUint8(36, 0x64); h.setUint8(37, 0x61); h.setUint8(38, 0x74); h.setUint8(39, 0x61); // data
  h.setUint32(40, pcm.length * 2, true);
  return new Blob([header, pcm.buffer as ArrayBuffer], { type: "audio/wav" });
}
