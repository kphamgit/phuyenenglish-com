import api from '../../api';

// The 9 Neural2 en-US voices; a recording prompt is spoken in a random one each
// time (variety), at 0.75x speed.
const NEURAL2_VOICES = [
  'en-US-Neural2-A', 'en-US-Neural2-C', 'en-US-Neural2-D', 'en-US-Neural2-E',
  'en-US-Neural2-F', 'en-US-Neural2-G', 'en-US-Neural2-H', 'en-US-Neural2-I',
  'en-US-Neural2-J',
];
const randomNeural2Voice = (): string =>
  NEURAL2_VOICES[Math.floor(Math.random() * NEURAL2_VOICES.length)];

// The spoken content of an "SR" recording prompt: strip the "SR" marker and,
// if the text is "English — Vietnamese", keep only the English part.
export const ttsTextOf = (raw?: string): string => {
  const t = (raw ?? '').trim();
  const noSR = t.startsWith('SR') ? t.replace(/^SR\s*/, '') : t;
  const sep = noSR.indexOf(' — ');
  return (sep >= 0 ? noSR.slice(0, sep) : noSR).trim();
};

// Speak a recording prompt via Google TTS (a random Neural2 voice, 0.75x speed).
// Returns the Promise so callers can react to autoplay being blocked, if needed.
export const playPromptTts = (text: string): Promise<void> => {
  const clean = (text ?? '').trim();
  if (!clean) return Promise.resolve();
  return api
    .get('/english/google_tts/', {
      params: { text: clean, voice: randomNeural2Voice(), rate: 0.75 },
      responseType: 'blob',
    })
    .then((res) => {
      const url = URL.createObjectURL(res.data);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      return audio.play().catch(() => URL.revokeObjectURL(url));
    })
    .catch((err) => {
      console.error('Google TTS failed:', err);
    });
};
