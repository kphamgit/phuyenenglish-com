// Turns audio the browser can play (e.g. the MP3 from /english/google_tts/) into a
// 16 kHz mono 16-bit WAV. Done in the browser (Web Audio), so the server needs no ffmpeg.
// Copied from p2p-voice-chat-admin (src/wav.ts).

const SAMPLE_RATE = 16000;
// Peak normalization (for microphone takes): the loudest sample is raised to about -1 dBFS.
const TARGET_PEAK = 0.9;
// At most 20× (+26 dB), so a take that is (almost) silence doesn't become loud noise.
const MAX_GAIN = 20;

// `normalize`: raise the whole take by one fixed gain so its peak is near full volume. Recordings
// are made with the browser's auto gain control off (it would flatten the loudness differences
// word stress is judged by), so they can be quiet; one fixed gain keeps those differences intact.
export async function toWav16kMono(audio: Blob, { normalize = false }: { normalize?: boolean } = {}): Promise<Blob> {
  const decoder = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decoder.decodeAudioData(await audio.arrayBuffer());
  } finally {
    void decoder.close();
  }
  // Rendering into a one-channel 16 kHz context mixes the channels down and resamples.
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  if (normalize) normalizePeak(samples);
  return encodeWav(samples, SAMPLE_RATE);
}

// Scales the samples in place so the loudest one reaches TARGET_PEAK (never more than MAX_GAIN,
// and never makes it quieter).
function normalizePeak(samples: Float32Array): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
  if (peak === 0) return;
  const gain = Math.min(MAX_GAIN, TARGET_PEAK / peak);
  if (gain <= 1) return;
  for (let i = 0; i < samples.length; i++) samples[i]! *= gain;
}

// A PCM WAV file (16-bit, one channel) of these samples (-1 to 1).
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataSize = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

// A file name from the sentence: "I am a student." → "i-am-a-student.wav".
export function wavFileName(sentence: string): string {
  const slug = sentence
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${slug || 'tts'}.wav`;
}
