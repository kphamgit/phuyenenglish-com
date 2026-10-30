import React, { useImperativeHandle, useMemo, useState } from 'react';
import type { ChildRef } from '../TakeQuiz';

type SentenceToken =
  | { type: 'text'; content: string }
  | { type: 'blank'; blankIndex: number };

interface Props {
  content: string | undefined;
  content_language: string;
  choices?: string;
  submitted?: boolean;
  ref: React.Ref<ChildRef>;
}

// Split "I [am] a [student]." into text and blank tokens.
const parseSentence = (content: string | undefined): SentenceToken[] => {
  if (!content) return [];
  const tokens: SentenceToken[] = [];
  const regex = /\[([^\]]+)\]/g;
  let lastIndex = 0;
  let blankIndex = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) tokens.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    tokens.push({ type: 'blank', blankIndex: blankIndex++ });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < content.length) tokens.push({ type: 'text', content: content.slice(lastIndex) });
  return tokens;
};

const playWordAudio = (text: string, content_language: string) => {
  const prefix = content_language === 'fr' ? 'fr_' : '';
  const audio = new Audio(`https://kphamazureblobstore.blob.core.windows.net/tts-audio/${prefix}${text}.mp3`);
  audio.playbackRate = 0.85; // 1 = normal, < 1 = slower, > 1 = faster
  audio.play().catch(() => {});
};

// Button-select cloze (format 2): each blank is a plain underline
// (at least 70px wide). Clicking a word button drops its text into the first empty blank (or, when
// all are filled, swaps out the most recently placed word), and since the sentence is ordinary
// inline text, the rest of it re-flows around the inserted word. Click a placed word to send it
// back to the word bank.
export const ButtonSelectCloze = ({ content, content_language, choices, submitted = false, ref }: Props) => {
  const sentence = useMemo(() => parseSentence(content), [content]);
  const blankCount = sentence.filter((t) => t.type === 'blank').length;
  const wordBank = useMemo(() => (choices ? choices.split('/').map((c) => c.trim()) : []), [choices]);

  // blank index -> index of the word-bank choice placed in it
  const [placed, setPlaced] = useState<Record<number, number>>({});
  // the blank filled most recently — replaced by the next chip once every blank is filled
  const [lastFilled, setLastFilled] = useState<number | null>(null);
  const [localSubmitted, setLocalSubmitted] = useState(false);

  // New question: clear the placed words and the submitted lock (adjusting state during render,
  // instead of in an effect).
  const questionKey = `${content}|${choices}`;
  const [prevQuestionKey, setPrevQuestionKey] = useState(questionKey);
  if (prevQuestionKey !== questionKey) {
    setPrevQuestionKey(questionKey);
    setPlaced({});
    setLastFilled(null);
    setLocalSubmitted(false);
  }
  // Once submitted, stay locked until the next question.
  if (submitted && !localSubmitted) setLocalSubmitted(true);

  const usedChoices = new Set(Object.values(placed));

  // A chip fills the first empty blank. Once every blank is filled, it replaces the most recently
  // filled one instead; the replaced word goes back to the bank (usedChoices is derived from `placed`).
  const handleWordSelect = (choiceIndex: number) => {
    if (localSubmitted || usedChoices.has(choiceIndex) || blankCount === 0) return;
    let target = -1;
    for (let i = 0; i < blankCount; i++) {
      if (placed[i] === undefined) { target = i; break; }
    }
    if (target === -1) target = lastFilled ?? blankCount - 1;
    playWordAudio(wordBank[choiceIndex], content_language);
    setPlaced((prev) => ({ ...prev, [target]: choiceIndex }));
    setLastFilled(target);
  };

  const handleReturnWord = (blankIndex: number) => {
    if (localSubmitted) return;
    setPlaced((prev) => {
      const next = { ...prev };
      delete next[blankIndex];
      return next;
    });
    if (lastFilled === blankIndex) setLastFilled(null);
  };

  // Answers in blank order, joined by "/", "" for an empty blank;
  // undefined until a word has been placed.
  const getAnswer = () => {
    if (Object.keys(placed).length === 0) return undefined;
    return Array.from({ length: blankCount }, (_, i) =>
      placed[i] === undefined ? '' : wordBank[placed[i]]
    ).join('/');
  };

  useImperativeHandle(ref, () => ({ getAnswer }));

  return (
    <div className="p-8 space-y-10 bg-white rounded-xl shadow-lg border border-gray-500 w-full max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-green-800 text-center">Complete the Sentence</h2>

      {/* Sentence Area — plain inline text, so it re-flows as blanks are filled */}
      <p className="text-lg font-medium text-red-600 leading-loose min-h-16">
        {sentence.map((token, index) => {
          if (token.type === 'text') {
            return <span key={index} className="whitespace-pre-wrap">{token.content}</span>;
          }
          const choiceIndex = placed[token.blankIndex];
          const word = choiceIndex === undefined ? null : wordBank[choiceIndex];
          return (
            <span
              key={`blank-${token.blankIndex}`}
              onClick={word && !localSubmitted ? () => handleReturnWord(token.blankIndex) : undefined}
              title={word && !localSubmitted ? 'Click to remove' : undefined}
              // empty: a 70px line; filled: shrinks to the word's own width so the sentence reads naturally.
              // leading: 10px shorter than the sentence's line height (leading-loose = 2em), so the underline
              // sits 5px higher; the text itself stays on the baseline.
              className={`inline-block leading-[calc(2em-10px)] text-center border-b-2 border-gray-500 font-semibold text-blue-800 ${
                word ? 'px-0.5' : 'min-w-[70px] px-1'
              } ${word && !localSubmitted ? 'cursor-pointer hover:bg-blue-50' : ''}`}
            >
              {word ?? ' '}
            </span>
          );
        })}
      </p>

      {/* Word Bank Area */}
      <div className="pt-8 border-t border-gray-100">
        <div className="flex flex-wrap gap-4 min-h-14 items-center">
          {wordBank.map((text, choiceIndex) => {
            const used = usedChoices.has(choiceIndex);
            return (
              <button
                key={`${choiceIndex}-${text}`}
                onClick={() => handleWordSelect(choiceIndex)}
                disabled={used || localSubmitted}
                className={`px-6 py-3 text-lg font-semibold bg-green-300 text-gray-800 rounded-md shadow transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 ${
                  used ? 'opacity-30 cursor-default' : 'hover:bg-gray-200'
                }`}
              >
                {text}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
