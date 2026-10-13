import api from '../../api';

// The 9 Neural2 en-US voices. The teacher picks one when sending an SR prompt (so the
// student always hears the same voice); with none specified we fall back to a random one.
export const NEURAL2_VOICES = [
  'en-US-Neural2-A', 'en-US-Neural2-C', 'en-US-Neural2-D', 'en-US-Neural2-E',
  'en-US-Neural2-F', 'en-US-Neural2-G', 'en-US-Neural2-H', 'en-US-Neural2-I',
  'en-US-Neural2-J',
];
const randomNeural2Voice = (): string =>
  NEURAL2_VOICES[Math.floor(Math.random() * NEURAL2_VOICES.length)];

// Strip SSML tags for plain-text display (e.g. the SR prompt shown on screen).
// Each tag becomes a space (not ""), so a tag boundary with no surrounding space
// still separates words (e.g. "Have</prosody>you" -> "Have you"); the following
// collapse then removes any doubled-up spaces.
export const stripSsml = (text: string): string =>
  text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// A received prompt that carries a Vietnamese pronunciation help "/.../" is not a
// plain sentence to speak, so TTS is skipped for it. Detect on the SSML-STRIPPED
// text so a tag's "/" (e.g. "</prosody>") can't false-trigger.
export const shouldSkipTts = (text?: string): boolean =>
  /\/[^/]*\//.test(text ?? '');

// The spoken content of an "SR" recording prompt: strip the "SR" marker and,
// if the text is "English — Vietnamese", keep only the English part.
export const ttsTextOf = (raw?: string): string => {
  const t = (raw ?? '').trim();
  const noSR = t.startsWith('SR') ? t.replace(/^SR\s*/, '') : t;
  const sep = noSR.indexOf(' — ');
  return (sep >= 0 ? noSR.slice(0, sep) : noSR).trim();
};

// Speak a recording prompt via Google TTS at 0.75x speed. Pass `voice` to use a specific
// Neural2 voice (the one the teacher chose); omit it to fall back to a random voice.
// Returns the Promise so callers can react to autoplay being blocked, if needed.
export const playPromptTts = (text: string, voice?: string): Promise<void> => {
  const clean = (text ?? '').trim();
  if (!clean) return Promise.resolve();
  return api
    .get('/english/google_tts/', {
      params: { text: clean, voice: voice || randomNeural2Voice(), rate: 0.75 },
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
