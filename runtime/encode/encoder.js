// @ts-check
// Encodes a movie frame by frame with WebCodecs and muxes it into an MP4.
// Frame i is drawn at t = i / fps, so the result never depends on how fast
// this machine renders.

import { muxMp4 } from './mp4.js';

/** The lowest H.264 High profile level whose macroblock rate fits the movie. */
export function avcCodec(width, height, fps) {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = mbs * fps;
  const levels = [[30, 40500, 1620], [31, 108000, 3600], [32, 216000, 5120], [40, 245760, 8192], [42, 522240, 8704], [50, 589824, 22080], [51, 983040, 36864], [52, 2073600, 36864]];
  const hit = levels.find(([, maxRate, maxFs]) => rate <= maxRate && mbs <= maxFs);
  if (!hit) throw new Error(`${width}x${height}@${fps} is beyond H.264 level 5.2`);
  return `avc1.6400${hit[0].toString(16).padStart(2, '0')}`;
}

const waitDequeue = (enc) => new Promise((r) => enc.addEventListener('dequeue', r, { once: true }));

/**
 * Draw every frame, encode it as H.264 with the soundtrack as Opus, and return the MP4 bytes with the chapters.
 * @param {{ canvas: HTMLCanvasElement, draw: (t: number) => void, width: number, height: number, fps: number,
 *   frames: number, audio: AudioBuffer | null, chapters?: import('./mp4.js').ChapterMark[], bitrate?: number,
 *   onProgress?: (done: number, total: number) => void }} o
 * @returns {Promise<Uint8Array>}
 */
export async function encodeMovie(o) {
  const { width, height, fps } = o;
  if (width % 2 || height % 2) throw new Error('width and height must be even for H.264');

  /** @type {import('./mp4.js').Sample[]} */
  const vSamples = [];
  let avcC = null;
  let color;
  let failure = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      vSamples.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? Math.round(1e6 / fps), key: chunk.type === 'key' });
      const dc = meta?.decoderConfig;
      if (dc?.description && !avcC) avcC = new Uint8Array(/** @type {ArrayBuffer} */ (dc.description instanceof ArrayBuffer ? dc.description : dc.description.buffer)).slice();
      if (dc?.colorSpace && !color) color = colorCodes(dc.colorSpace);
    },
    error: (e) => { failure = e; },
  });
  const codec = avcCodec(width, height, fps);
  const config = {
    codec, width, height, framerate: fps,
    bitrate: o.bitrate ?? Math.round(width * height * fps * 0.08),
    bitrateMode: /** @type {const} */ ('variable'), latencyMode: /** @type {const} */ ('quality'),
    avc: { format: /** @type {const} */ ('avc') },
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error(`this browser cannot encode ${codec} at ${width}x${height}`);
  venc.configure(config);

  // Ask for a key frame every two seconds; rounding keeps it working at fractional rates such as 29.97.
  const keyEvery = Math.max(1, Math.round(fps * 2));
  for (let i = 0; i < o.frames; i++) {
    if (failure) throw failure;
    o.draw(i / fps);
    const ts = Math.round((i * 1e6) / fps);
    const frame = new VideoFrame(o.canvas, { timestamp: ts, duration: Math.round(((i + 1) * 1e6) / fps) - ts });
    venc.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    while (venc.encodeQueueSize > 3) await waitDequeue(venc);
    o.onProgress?.(i + 1, o.frames);
  }
  await venc.flush();
  venc.close();
  if (failure) throw failure;
  if (!avcC) throw new Error('the encoder gave no avcC decoder configuration');

  const audio = o.audio ? await encodeOpus(o.audio) : null;
  return muxMp4({ video: { width, height, fps, avcC, samples: vSamples, color }, audio, chapters: o.chapters });
}

/** VideoColorSpace → ISO/IEC 23091-2 code points for the colr box. */
function colorCodes(cs) {
  const P = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
  const T = { bt709: 1, smpte170m: 6, iec61966_2_1: 13, linear: 8, pq: 16, hlg: 18 };
  const M = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, bt2020_ncl: 9 };
  return { primaries: P[cs.primaries] ?? 1, transfer: T[cs.transfer] ?? 1, matrix: M[cs.matrix] ?? 1, fullRange: !!cs.fullRange };
}

/**
 * @param {AudioBuffer} buf 48 kHz
 * @returns {Promise<import('./mp4.js').AudioTrack>}
 */
async function encodeOpus(buf) {
  const sampleRate = buf.sampleRate;
  const channels = Math.min(2, buf.numberOfChannels);
  /** @type {import('./mp4.js').Sample[]} */
  const samples = [];
  let preSkip = 312;
  let failure = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 20000, key: true });
      const d = meta?.decoderConfig?.description;
      if (d) {
        // An OpusHead: "OpusHead", version, channels, then pre-skip (little-endian) at byte 10.
        const b = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer);
        if (b.length >= 12 && String.fromCharCode(...b.slice(0, 8)) === 'OpusHead') preSkip = b[10] | (b[11] << 8);
      }
    },
    error: (e) => { failure = e; },
  });
  const config = { codec: 'opus', sampleRate, numberOfChannels: channels, bitrate: 160000 };
  if (!(await AudioEncoder.isConfigSupported(config)).supported) throw new Error('this browser cannot encode Opus');
  enc.configure(config);
  const block = sampleRate; // one second per AudioData
  for (let off = 0; off < buf.length; off += block) {
    if (failure) throw failure;
    const n = Math.min(block, buf.length - off);
    const planes = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) planes.set(buf.getChannelData(c).subarray(off, off + n), c * n);
    const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((off * 1e6) / sampleRate), data: planes });
    enc.encode(data);
    data.close();
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  return { sampleRate, channels, preSkip, samples };
}
