import { useEffect, useRef, useState } from 'react';
import type { VietWord } from './evaluation';

// The sentence the students repeat, with the words the teacher checks marked: the stress words
// (their melody is checked) in amber, and each connected (targeted) word linked to the
// next word by an arch on a blue background (it should link to it, e.g. is‿a). Then a key that
// lists them. Words are matched as VoiceAnalyzer_Claude does: letters and apostrophes, any case.
//
// The arch goes from the last sounded letter of the word to the first letter of the next word. When
// the word ends in a silent e (make, have, one, table, we're), it starts from the letter before the
// e: make‿it links the k to the i.

const bare = (token: string) => token.replace(/[^A-Za-z']/g, '').toLowerCase();
const isLetter = (ch: string) => /[A-Za-z]/.test(ch);

// Words ending in a consonant + e whose e is said.
const SOUNDED_FINAL_E = new Set([
  'the', 'he', 'she', 'we', 'me', 'be', 'ye',
  'recipe', 'cafe', 'karate', 'apostrophe', 'catastrophe', 'acne', 'simile', 'coyote', 'sesame',
]);

// A final e after a consonant is silent (make, one, table, we're), except in SOUNDED_FINAL_E.
// After a vowel it's part of the sound (free, toe), so the link starts from it.
function hasSilentE(word: string): boolean {
  const w = bare(word);
  const letters = w.replace(/'/g, '');
  if (letters.length < 3 || !letters.endsWith('e') || SOUNDED_FINAL_E.has(w)) return false;
  return !/[aeiouy]/.test(letters[letters.length - 2]);
}

// The index (in the token) of the letter the arch starts from, or -1 if the token has no letters.
function linkStartIndex(token: string): number {
  const letters = [...token].flatMap((ch, i) => (isLetter(ch) ? [i] : []));
  if (letters.length === 0) return -1;
  return hasSilentE(token) && letters.length >= 2 ? letters[letters.length - 2] : letters[letters.length - 1];
}

const lastLetterIndex = (token: string) => {
  const chars = [...token];
  for (let i = chars.length - 1; i >= 0; i--) if (isLetter(chars[i])) return i;
  return -1;
};

const linkEndIndex = (token: string) => [...token].findIndex(isLetter);

// For the Vietnamese codes: any letter (ơ, ờ, í, ...), and no silent e, so the arch simply goes
// from the code's last letter to the next code's first letter ("t(h)ơ(r)n‿ít": the n to the í).
const isAnyLetter = (ch: string) => /\p{L}/u.test(ch);
const lastAnyLetterIndex = (token: string) => {
  const chars = [...token];
  for (let i = chars.length - 1; i >= 0; i--) if (isAnyLetter(chars[i])) return i;
  return -1;
};
const firstAnyLetterIndex = (token: string) => [...token].findIndex(isAnyLetter);

const stressClass = 'text-amber-600';

interface Arch {
  link: number; // the index of the token the link starts from
  left: number;
  top: number;
  width: number;
}

// Tokens (words with their punctuation) where linksNext[i] links token i to token i+1. Each run
// of linked tokens stays on one line (blue background); the arches are measured from the letters
// and drawn under them.
function LinkedText({
  tokens,
  linksNext,
  linkSounds = [],
  stress,
  viet = false,
  muted = [],
  className = '',
}: {
  tokens: string[];
  linksNext: boolean[];
  linkSounds?: (string | undefined)[]; // linkSounds[i]: shown under the arch from token i
  stress: Set<string>;
  viet?: boolean; // the tokens are Vietnamese codes: no silent e, any letter can carry an arch
  muted?: boolean[]; // muted[i]: token i is shown in grey italics (a word without a code)
  className?: string;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const [arches, setArches] = useState<Arch[]>([]);
  // Stable keys for the effect (the arrays are new on every render).
  const textKey = tokens.join(' ');
  const linkKey = linksNext.join(',');

  // Measures the arches now and whenever the text's size changes (layout, fonts loading). A
  // ResizeObserver reports once when it starts, so this also draws them the first time.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const found: Arch[] = [];
      el.querySelectorAll<HTMLElement>('[data-link-from]').forEach((from) => {
        from.dataset.linkFrom!.split(' ').forEach((k) => {
          const to = el.querySelector<HTMLElement>(`[data-link-to~="${k}"]`);
          if (!to) return;
          const a = from.getBoundingClientRect();
          const b = to.getBoundingClientRect();
          const left = a.left + a.width / 2 - box.left;
          found.push({ link: Number(k), left, top: Math.max(a.bottom, b.bottom) - box.top - 2, width: b.left + b.width / 2 - box.left - left });
        });
      });
      setArches(found);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [textKey, linkKey]);

  // Which links start / end at each letter of each token.
  const starts = new Map<string, number[]>();
  const ends = new Map<string, number[]>();
  const add = (m: Map<string, number[]>, key: string, k: number) => m.set(key, [...(m.get(key) ?? []), k]);
  tokens.forEach((t, i) => {
    if (!linksNext[i]) return;
    const from = viet ? lastAnyLetterIndex(t) : linkStartIndex(t);
    const to = viet ? firstAnyLetterIndex(tokens[i + 1]) : linkEndIndex(tokens[i + 1]);
    if (from < 0 || to < 0) return;
    add(starts, `${i}:${from}`, i);
    add(ends, `${i + 1}:${to}`, i);
  });

  // A token, with the letters an arch starts or ends at in their own spans, and the silent e of a
  // word linked to the next one dimmed (the arch skips it: make‿it).
  const renderToken = (t: string, i: number) => {
    const silentE = !viet && linksNext[i] && hasSilentE(t) ? lastLetterIndex(t) : -1;
    const content = [...t].map((ch, c) => {
      const from = starts.get(`${i}:${c}`);
      const to = ends.get(`${i}:${c}`);
      if (c === silentE) {
        return (
          <span key={c} className="opacity-30" title="silent e">
            {ch}
          </span>
        );
      }
      if (!from && !to) return ch;
      return (
        <span key={c} data-link-from={from?.join(' ')} data-link-to={to?.join(' ')}>
          {ch}
        </span>
      );
    });
    if (muted[i]) return <span className="text-gray-400 italic">{content}</span>;
    return stress.has(bare(t)) ? <span className={stressClass}>{content}</span> : <>{content}</>;
  };

  // Runs of tokens joined by links.
  const groups: number[][] = [];
  tokens.forEach((_, i) => {
    if (i > 0 && linksNext[i - 1]) groups[groups.length - 1].push(i);
    else groups.push([i]);
  });

  return (
    // Room under the last line for its arches' sounds.
    <span ref={container} className={`relative inline-block ${arches.length > 0 ? 'pb-[0.6em]' : ''} ${className}`}>
      {groups.map((g, gi) => (
        <span key={gi}>
          {gi > 0 && ' '}
          {g.length === 1 ? (
            renderToken(tokens[g[0]], g[0])
          ) : (
            <span className="whitespace-nowrap rounded bg-sky-100 px-1">
              {g.map((i, k) => (
                <span key={i}>
                  {k > 0 && ' '}
                  {renderToken(tokens[i], i)}
                </span>
              ))}
            </span>
          )}
        </span>
      ))}
      {/* Each arch, with the linking sound centred under it (it may be wider than the arch). */}
      {arches.map((a, k) => (
        <span
          key={k}
          aria-hidden
          className="pointer-events-none absolute flex flex-col items-center"
          style={{ left: a.left, top: a.top, width: a.width }}
        >
          <span className="h-[0.3em] w-full rounded-b-full border-2 border-t-0 border-sky-600" />
          {linkSounds[a.link] && (
            <span className="whitespace-nowrap pt-0.5 text-[max(0.5em,11px)] font-semibold leading-none text-sky-700">
              {linkSounds[a.link]}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

// The sentence in Vietnamese pronunciation codes, word for word: each word replaced by its code
// (punctuation kept), and a word without a code shown as it is, in grey. The linked words get the
// same arches (and blue background) as in the English sentence, from code to code, each with the
// teacher's Helper Word under it.
// `words` (one code per word position, in order) is used when given: the n-th word on screen
// takes the n-th entry, so "record" (verb) and "record" (noun) each show their own code. A word
// whose entry doesn't match (a different sentence) falls back to `codes`, by spelling.
function VietSentence({
  tokens,
  linksNext,
  linkSounds,
  codes,
  words,
}: {
  tokens: string[];
  linksNext: boolean[];
  linkSounds: (string | undefined)[];
  codes: Record<string, string>;
  words?: VietWord[];
}) {
  const key = (w: string) => w.toLowerCase().replace(/^'+|'+$/g, '');
  let position = 0; // the word's position in the sentence, counted across tokens
  const codeOf = (w: string) => {
    const entry = words?.[position++];
    if (entry && key(entry.word) === key(w)) return entry.code?.trim() || undefined;
    return codes[key(w)]?.trim() || undefined;
  };
  // Each token with its words replaced by their codes. NFC keeps each accented letter one
  // character, so an arch's letter span never splits a letter from its accent.
  const muted: boolean[] = [];
  const vietTokens = tokens.map((t, i) =>
    t
      .split(/([A-Za-z']+)/)
      .map((part, k) => {
        if (k % 2 === 0) return part; // the punctuation around the words
        const code = codeOf(part);
        if (!code) muted[i] = true;
        return code ? code.normalize('NFC') : part;
      })
      .join(''),
  );
  return (
    <p className="text-center text-lg leading-loose text-teal-700" title="Vietnamese pronunciation code">
      <LinkedText tokens={vietTokens} linksNext={linksNext} linkSounds={linkSounds} stress={new Set()} viet muted={muted} />
    </p>
  );
}

export function TargetedSentence({
  sentence,
  stressWords = [],
  connectedWords = [],
  helperWords = {},
  sentenceViet,
  sentenceVietWords,
  className = '',
}: {
  sentence: string;
  stressWords?: string[];
  connectedWords?: string[];
  // The teacher's Helper Words, by targeted word in lower case: each is shown under that word's
  // link (e.g. {have: "vờ"}). A link without one shows no word.
  helperWords?: Record<string, string>;
  // The Vietnamese pronunciation code of each word, by word in lower case: when given, the
  // sentence in codes is shown under it.
  sentenceViet?: Record<string, string>;
  // The same codes one per word position, in order (the part of speech from the context), so
  // the same spelling can show two codes. Preferred over sentenceViet when given.
  sentenceVietWords?: VietWord[];
  className?: string;
}) {
  const stress = new Set(stressWords.map((w) => w.toLowerCase()));
  const connected = new Set(connectedWords.map((w) => w.toLowerCase()));
  const tokens = sentence.split(/\s+/).filter(Boolean);

  // A targeted word links to the next word, so it can't be the last word.
  const linksNext = tokens.map((t, i) => connected.has(bare(t)) && i < tokens.length - 1);
  const word = (t: string) => t.replace(/[^A-Za-z']/g, '');
  const helperOf = (w: string) => helperWords[bare(w)]?.trim() || undefined;
  const linkSounds = tokens.map((t, i) => (linksNext[i] ? helperOf(t) : undefined));
  const linkPairs = tokens.flatMap((t, i) => (linksNext[i] ? [[word(t), word(tokens[i + 1])]] : []));
  const shownStress = stressWords.filter((w) => tokens.some((t) => bare(t) === w.toLowerCase()));

  return (
    <div className="flex flex-col gap-2">
      <p className={className}>
        <LinkedText tokens={tokens} linksNext={linksNext} linkSounds={linkSounds} stress={stress} />
      </p>
      {((sentenceVietWords?.some((w) => w.code)) || (sentenceViet && Object.keys(sentenceViet).length > 0)) && (
        <VietSentence tokens={tokens} linksNext={linksNext} linkSounds={linkSounds} codes={sentenceViet ?? {}} words={sentenceVietWords} />
      )}
      {(shownStress.length > 0 || linkPairs.length > 0) && (
        <div className="flex flex-col gap-1 text-sm text-gray-700">
          {shownStress.length > 0 && (
            <span>
              <span className={`${stressClass} font-semibold`}>Stress words</span>: focus on the melody of{' '}
              <strong className={stressClass}>{shownStress.join(', ')}</strong>
            </span>
          )}
          {linkPairs.length > 0 && (
            <span className="leading-loose">
              <span className="rounded bg-sky-100 px-1">Connected words</span>: link them smoothly:{' '}
              {linkPairs.map((pair, k) => (
                <span key={k}>
                  {k > 0 && ', '}
                  <strong>
                    <LinkedText tokens={pair} linksNext={[true, false]} linkSounds={[helperOf(pair[0])]} stress={new Set()} />
                  </strong>
                </span>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
