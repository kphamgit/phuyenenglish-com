import { useState } from 'react';
import { createPortal } from 'react-dom';
import { NEURAL2_VOICES, playPromptTts } from './tts';

type Tab = 'sentence' | 'words';

// SSML relative pitch: "+1st" = up one semitone. A bare "+1" has no unit and isn't valid SSML;
// "+1Hz" or "+1%" would also work.
const DEFAULT_PITCH = '+1st';

// One whitespace-separated chunk of the sentence, split into the word itself (`core`) and the
// punctuation around it, so tags wrap only the word: "(fact)," -> lead "(", core "fact", trail "),".
// Inner apostrophes/hyphens stay in the core ("don't", "well-known"); a punctuation-only
// chunk ("—") has an empty core and gets no button.
interface Token {
  lead: string;
  core: string;
  trail: string;
}

const tokenize = (sentence: string): Token[] =>
  sentence.trim().split(/\s+/).filter(Boolean).map((chunk) => {
    const [, lead, core, trail] = chunk.match(/^([\p{P}\p{S}]*)(.*?)([\p{P}\p{S}]*)$/u)!;
    return { lead, core, trail };
  });

// Text inside SSML must be XML-escaped (e.g. "R&D").
const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface SsmlConvertModalProps {
  onClose: () => void;
}

// Teacher-only SSML Convert modal. Tab 1: type a sentence and convert it; tab 2: one button per word,
// and the SSML built from the sentence. Portaled to <body> so the chat window can't clip it.
const SsmlConvertModal = ({ onClose }: SsmlConvertModalProps) => {
  const [tab, setTab] = useState<Tab>('sentence');
  const [sentence, setSentence] = useState('');
  const [tokens, setTokens] = useState<Token[]>([]);
  // token index -> prosody pitch, for words wrapped in a <prosody> tag
  const [pitches, setPitches] = useState<Record<number, string>>({});
  const [hasSpeakTag, setHasSpeakTag] = useState(false);

  const body = tokens.map(({ lead, core, trail }, i) => {
    const word = escapeXml(core);
    const wrapped = pitches[i] ? `<prosody pitch="${pitches[i]}">${word}</prosody>` : word;
    return escapeXml(lead) + wrapped + escapeXml(trail);
  }).join(' ');
  const generatedSsml = hasSpeakTag ? `<speak>${body}</speak>` : body;
  // Hand edits to the SSML (Word Buttons tab). null = show the generated SSML. Clicking a word button
  // regenerates it, but pitch values typed here are kept (see handleSsmlEdit).
  const [editedSsml, setEditedSsml] = useState<string | null>(null);
  const ssml = editedSsml ?? generatedSsml;

  const handleSsmlEdit = (text: string) => {
    setEditedSsml(text);
    // Read the pitch values back, in order, onto the wrapped words. Only when the number of
    // <prosody> tags still matches the wrapped words — otherwise we can't tell which is which.
    const typed = [...text.matchAll(/<prosody\b[^>]*\bpitch="([^"]*)"/g)].map((m) => m[1]);
    const wrapped = Object.keys(pitches).map(Number).sort((a, b) => a - b);
    if (typed.length === wrapped.length) {
      setPitches(Object.fromEntries(wrapped.map((index, i) => [index, typed[i]])));
    }
  };

  const convertToButtons = () => {
    setTokens(tokenize(sentence));
    setPitches({});
    setHasSpeakTag(false);
    setEditedSsml(null);
    setTab('words');
  };

  // Listen: speak the SSML with Google TTS (playPromptTts plays at 0.75x speed)
  const [voice, setVoice] = useState<string>('en-US-Neural2-F');
  const [loadingAudio, setLoadingAudio] = useState(false);

  const listen = () => {
    setLoadingAudio(true);
    playPromptTts(ssml, voice).finally(() => setLoadingAudio(false));
  };

  // "Copied!" / "Copy failed" feedback on the Copy button, cleared after a moment
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copySsml = async () => {
    try {
      await navigator.clipboard.writeText(ssml);
      setCopyStatus('copied');
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
      setCopyStatus('failed');
    }
    setTimeout(() => setCopyStatus('idle'), 1500);
  };

  // Click a word to wrap it in <prosody pitch>; click again to unwrap.
  // Wrapping a word also adds the <speak> tags if they aren't there yet (prosody needs them).
  const handleWordClick = (index: number) => {
    setEditedSsml(null);
    const wrapping = !pitches[index];
    if (wrapping) setHasSpeakTag(true);
    setPitches((prev) => {
      const next = { ...prev };
      if (wrapping) next[index] = DEFAULT_PITCH;
      else delete next[index];
      return next;
    });
  };

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 ${tab === t
      ? 'border-teal-600 text-teal-700'
      : 'border-transparent text-gray-500 hover:text-gray-700'}`;

  const hasWords = tokens.some((t) => t.core);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-2">SSML Convert</h2>

        <div className="flex border-b border-gray-200 mb-4" role="tablist">
          <button role="tab" aria-selected={tab === 'sentence'} className={tabClass('sentence')} onClick={() => setTab('sentence')}>
            Sentence
          </button>
          <button role="tab" aria-selected={tab === 'words'} className={tabClass('words')} onClick={() => setTab('words')}>
            Word Buttons
          </button>
        </div>

        {tab === 'sentence' && (
          <div role="tabpanel">
            <textarea
              className="w-full h-28 bg-gray-100 text-black p-2 rounded-md border border-gray-300"
              placeholder="Type a sentence…"
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
            />
            <button
              className="mt-2 bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={convertToButtons}
              disabled={!sentence.trim()}
            >
              Convert to Buttons
            </button>
          </div>
        )}

        {tab === 'words' && (
          <div role="tabpanel" className="min-h-28">
            {!hasWords ? (
              <p className="text-gray-500 italic">No words yet. Enter a sentence in the first tab.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tokens.map((token, index) => token.core && (
                  <button
                    key={index}
                    className={`px-3 py-1 rounded-md ${pitches[index]
                      ? 'bg-teal-600 text-white hover:bg-teal-700'
                      : 'bg-gray-200 text-gray-900 hover:bg-gray-300'}`}
                    title={pitches[index] ? `pitch ${pitches[index]} (click to remove)` : `Raise pitch (${DEFAULT_PITCH})`}
                    onClick={() => handleWordClick(index)}
                  >
                    {token.core}
                  </button>
                ))}
              </div>
            )}
            {ssml && (
              <>
                <label className="block mt-4 mb-1 text-sm font-medium text-gray-700" htmlFor="ssml-edit">
                  SSML (editable)
                </label>
                <textarea
                  id="ssml-edit"
                  className="w-full h-28 bg-gray-100 text-black p-2 rounded-md border border-gray-300 font-mono text-sm"
                  value={ssml}
                  onChange={(e) => handleSsmlEdit(e.target.value)}
                  spellCheck={false}
                />
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 mt-6">
          {tab === 'words' && (
            <>
              <button
                className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={listen}
                disabled={!ssml || loadingAudio}
              >
                {loadingAudio ? 'Loading…' : 'Listen'}
              </button>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                title="Neural2 voice"
                className="bg-gray-200 text-black text-sm px-2 rounded-md"
              >
                {NEURAL2_VOICES.map((v) => (
                  <option key={v} value={v}>{v.replace('en-US-Neural2-', 'Voice ')}</option>
                ))}
              </select>
              <button
                className="bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={copySsml}
                disabled={!ssml}
              >
                {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'failed' ? 'Copy failed' : 'Copy'}
              </button>
            </>
          )}
          <button
            className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SsmlConvertModal;
