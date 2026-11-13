import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import api from '../api';

// Base url for the Azure TTS pronunciation clips ("<word>.mp3").
const TTS_BASE = 'https://kphamazureblobstore.blob.core.windows.net/tts-audio/';

// Longest we wait for the word's audio before showing the options anyway (e.g. a long clip
// or one that never fires "ended"). The answer clock only starts once the options appear.
const AUDIO_MAX_WAIT_MS = 5000;

// Special answer choices, matching DONT_KNOW / TIMEOUT in api/spaced_repetition.py.
const DONT_KNOW = 'dont_know';
const TIMEOUT = 'timeout';

interface Option {
  key: string;        // opaque: the server knows which key is correct, the client doesn't
  definition: string;
}

interface Question {
  nonce: string;
  options: Option[];
}

interface QueueCard {
  id: number;
  text: string;            // the word
  part_of_speech?: string; // e.g. "verb", "noun"
  nonce?: string;          // first showing: the question comes with the due card
  options?: Option[];
  retry?: boolean;         // shown again after a lapse: fetches a fresh question, practice only
}

interface AnswerResult {
  correct: boolean;
  correct_key: string;
  definition: string;
  quality: number;
  reason: string;          // explanation of the grade, e.g. "Correct in 3.2 s, under the 5 s ..."
  lapsed: boolean;         // quality < 4 -> show this card again at the end of the session
  graded: boolean;         // false = practice (card was already graded today)
}

interface Limits {
  timeLimitMs: number;
  fastAnswerMs: number;
}

interface CardReviewProps {
  onComplete: () => void;
}

// Vocabulary review: for each due card, play the word, then show 4 definitions with a countdown.
// The server checks the answer and grades it from correctness + response time (see grade_answer
// in api/spaced_repetition.py). A lapsed card (grade < 4) comes back at the end of the session
// with fresh options until it's answered well; those repeats are practice and aren't graded.
export default function CardReview({ onComplete }: CardReviewProps) {
  const [cards, setCards] = useState<QueueCard[]>([]);
  // Defaults until the server's values arrive; the server's are the ones it grades with.
  const [limits, setLimits] = useState<Limits>({ timeLimitMs: 12000, fastAnswerMs: 5000 });
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    api.get('/api/cards/due/')
      .then((res) => {
        setCards(res.data.due_cards ?? []);
        setLimits({ timeLimitMs: res.data.time_limit_ms, fastAnswerMs: res.data.fast_answer_ms });
        setLoading(false);
        // With no due cards we keep the view mounted to show a "nothing due" message.
      })
      .catch((err) => {
        console.error('Error fetching due cards:', err);
        setLoading(false);
      });
  }, []);

  const handleNext = (lapsed: boolean) => {
    const card = cards[index];
    const queue = lapsed
      ? [...cards, { id: card.id, text: card.text, part_of_speech: card.part_of_speech, retry: true }]
      : cards;
    if (index + 1 >= queue.length) {
      onComplete();
    } else {
      setCards(queue);
      setIndex((i) => i + 1);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-600 border-t-transparent"></div>
        <p className="mt-4 text-amber-800 font-medium">Loading cards...</p>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 p-6">
        <p className="text-lg text-gray-700">🎉 No vocabulary due for review right now.</p>
        <button
          onClick={onComplete}
          className="mt-6 px-6 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto p-6">
      <div className="w-full flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">CardReview: What does this word mean?</h2>
        <span className="text-sm text-gray-500">{index + 1} / {cards.length}</span>
      </div>

      <AnimatePresence mode="wait">
        {/* Keyed by position, not card id, so a re-queued card shown right after itself still remounts. */}
        <motion.div
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.4 } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          className="w-full flex flex-col items-center"
        >
          <CardQuestion card={cards[index]} limits={limits} onNext={handleNext} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// One card: audio first, then the timed multiple-choice question, then the result.
// Mounted fresh for every card (keyed by the parent), so all state starts clean.
function CardQuestion({ card, limits, onNext }: { card: QueueCard; limits: Limits; onNext: (lapsed: boolean) => void }) {
  const audioUrl = `${TTS_BASE}${card.text}.mp3`;
  const [question, setQuestion] = useState<Question | null>(
    card.nonce && card.options ? { nonce: card.nonce, options: card.options } : null
  );
  const [audioDone, setAudioDone] = useState(false);
  const [remainingMs, setRemainingMs] = useState(limits.timeLimitMs);
  const [chosen, setChosen] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [failed, setFailed] = useState(false);

  const startRef = useRef(0);          // when the options appeared (performance.now())
  const answeredRef = useRef(false);   // blocks a second answer (e.g. a click racing the timeout)

  // A repeat after a lapse gets a fresh question: new wrong answers, new order.
  useEffect(() => {
    if (!card.retry) return;
    let cancelled = false;
    api.get<Question>(`/api/cards/${card.id}/question/`)
      .then((res) => { if (!cancelled) setQuestion(res.data); })
      .catch((err) => {
        console.error('Error fetching card question:', err);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [card]);

  // Play the word; the options appear when it ends (or fails / is blocked / takes too long).
  useEffect(() => {
    let done = false;
    const finish = () => { if (!done) { done = true; setAudioDone(true); } };
    const audio = new Audio(audioUrl);
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(finish);
    const safety = setTimeout(finish, AUDIO_MAX_WAIT_MS);
    return () => {
      done = true;
      audio.pause();
      clearTimeout(safety);
    };
  }, [audioUrl]);

  const submit = async (choice: string) => {
    if (answeredRef.current || !question) return;
    answeredRef.current = true;
    const latencyMs = choice === TIMEOUT ? limits.timeLimitMs : Math.round(performance.now() - startRef.current);
    setChosen(choice);
    try {
      const res = await api.post<AnswerResult>(`/api/cards/${card.id}/answer/`, {
        nonce: question.nonce,
        choice,
        latency_ms: latencyMs,
        // Logged (for a wrong answer) so the teacher can see which meaning was picked.
        chosen_definition: question.options.find((o) => o.key === choice)?.definition ?? '',
      });
      setResult(res.data);
      new Audio(audioUrl).play().catch(() => {});   // hear the word again with its meaning
    } catch (err) {
      console.error('Error submitting card answer:', err);
      setFailed(true);
    }
  };

  const onTimeout = useEffectEvent(() => { submit(TIMEOUT); });

  // The countdown: starts when the options appear, auto-submits a timeout at the hard limit.
  const optionsShown = audioDone && question !== null;
  useEffect(() => {
    if (!optionsShown || chosen !== null) return;
    startRef.current = performance.now();
    const id = setInterval(() => {
      const left = limits.timeLimitMs - (performance.now() - startRef.current);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        onTimeout();
      }
    }, 100);
    return () => clearInterval(id);
  }, [optionsShown, chosen, limits.timeLimitMs]);

  const optionClass = (opt: Option) => {
    if (!result) {
      return chosen === opt.key
        ? 'bg-amber-50 border-amber-400'
        : 'bg-white border-gray-300 hover:border-amber-500 hover:bg-amber-50';
    }
    if (opt.key === result.correct_key) return 'bg-green-100 border-green-500 text-green-800';
    if (opt.key === chosen) return 'bg-red-100 border-red-500 text-red-800';
    return 'bg-white border-gray-200 text-gray-400';
  };

  const timeLimitS = limits.timeLimitMs / 1000;
  const fastS = limits.fastAnswerMs / 1000;
  const elapsedMs = limits.timeLimitMs - remainingMs;

  return (
    <>
      {card.retry && (
        <p className="w-full text-sm text-amber-700 mb-2">Let's try this one again (practice, not graded).</p>
      )}

      {/* The word (with its part of speech) */}
      <div className="w-full min-h-16 flex items-center justify-center gap-2 bg-white border-2 border-gray-300 rounded-xl shadow-lg p-3 mb-3">
        <span className="text-xl font-bold text-gray-800">{card.text}</span>
        {card.part_of_speech && (
          <span className="italic text-sm text-indigo-600">{card.part_of_speech}</span>
        )}
        <button
          onClick={() => new Audio(audioUrl).play().catch(() => {})}
          aria-label="Play pronunciation"
          className="ml-2 text-gray-500 hover:text-gray-800"
        >
          🔊
        </button>
      </div>

      {failed ? (
        <div className="w-full flex flex-col items-center">
          <p className="text-red-700 mb-3">Something went wrong with this card. It will come back next time.</p>
          <button
            onClick={() => onNext(false)}
            className="px-6 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium"
          >
            Next
          </button>
        </div>
      ) : !optionsShown ? (
        <p className="text-gray-500 my-6">Listen…</p>
      ) : (
        <>
          {/* Countdown. The bar turns from green to amber once the "fast" mark has passed. */}
          {!result && (
            <div className="w-full mb-3">
              <div className="w-full h-2 bg-gray-200 rounded">
                <div
                  className={`h-2 rounded ${elapsedMs < limits.fastAnswerMs ? 'bg-green-500' : 'bg-amber-500'}`}
                  style={{ width: `${(remainingMs / limits.timeLimitMs) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {Math.ceil(remainingMs / 1000)} s left · Answer within {fastS} s for top marks; after {timeLimitS} s it counts as not known.
              </p>
            </div>
          )}

          <div className="w-full flex flex-col gap-2 mb-3">
            {question!.options.map((opt) => (
              <button
                key={opt.key}
                disabled={chosen !== null}
                onClick={() => submit(opt.key)}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 ${optionClass(opt)}`}
              >
                {opt.definition}
              </button>
            ))}
          </div>

          {!result ? (
            <button
              disabled={chosen !== null}
              onClick={() => submit(DONT_KNOW)}
              className="px-4 py-2 rounded-lg bg-gray-500 hover:bg-gray-600 text-white text-sm disabled:opacity-50"
            >
              I don't know
            </button>
          ) : (
            <>
              <p className={`w-full text-sm mb-3 ${result.lapsed ? 'text-red-700' : 'text-green-700'}`}>
                {result.reason}
              </p>
              <button
                onClick={() => onNext(result.lapsed)}
                className="px-6 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium"
              >
                Next
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}
