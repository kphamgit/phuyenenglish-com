import { useImperativeHandle, useState } from 'react';
import api from '../../api';
import type { ChildRef } from '../TakeQuiz';
import type { QuestionProps, ShadowingQuestionTake } from '../shared/types';
import { EvaluationView } from '../shadowing/EvaluationView';
import { TargetedSentence } from '../shadowing/TargetedSentence';
import type { EvaluationResult } from '../shadowing/evaluation';
import { useRecorder } from '../shadowing/useRecorder';

// A Shadowing question (format 9): the student listens to the question's audio, records
// themselves repeating the sentence (the question's content), and checks the take: Django
// (/api/shadowing/assess_question/) scores it with VoiceAnalyzer_Claude and the question's scoring
// options, and keeps the points under a one-time token. getAnswer() gives that token, so the
// quiz's Submit counts the last checked take. With hide_text the sentence stays hidden until the
// first take is checked.

type Assessed = EvaluationResult & { question_take: ShadowingQuestionTake };

// What the sentence shows from the question's scoring options (set in the teacher app): the
// stress words in amber, and each targeted word's link to the next word as an arch with its
// helper word under it.
const wordsOf = (text: unknown) => [...new Set((typeof text === 'string' ? text.toLowerCase().match(/[a-z']+/g) : null) ?? [])];
function helperWordsOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      typeof v === 'string' && v.trim() ? [[k.toLowerCase(), v.trim()]] : [],
    ),
  );
}

export default function ShadowingQuestion({ question, ref }: { question: QuestionProps; ref: React.Ref<ChildRef> }) {
  const { recording, converting, take, error: recorderError, record: startRecording, stop } = useRecorder();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Assessed | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const error = recorderError ?? checkError;

  useImperativeHandle(ref, () => ({ getAnswer: () => result?.question_take.token ?? '' }), [result]);

  // A new take replaces the result of the previous one.
  const record = () => {
    setResult(null);
    setCheckError(null);
    void startRecording();
  };

  const check = async () => {
    if (!take || checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      const form = new FormData();
      form.append('question_id', String(question.id));
      form.append('recorded_file', take.wav, 'recording.wav');
      const res = await api.post('/api/shadowing/assess_question/', form);
      setResult(res.data as Assessed);
    } catch (err) {
      console.error('ShadowingQuestion: scoring failed:', err);
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setCheckError(message ?? 'Scoring your recording failed. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const showText = !question.hide_text || result !== null;
  const options = question.scoring_options ?? {};
  const t = result?.question_take;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wide text-teal-700 font-semibold">Listen, then repeat</p>
      {showText ? (
        <TargetedSentence
          sentence={question.content}
          stressWords={wordsOf(options.stress_words)}
          connectedWords={wordsOf(options.targeted_words)}
          helperWords={helperWordsOf(options.helper_words)}
          className="text-2xl font-bold text-teal-900 leading-loose"
        />
      ) : (
        <p className="text-sm italic text-gray-600">The sentence appears after your first try. Listen carefully.</p>
      )}
      {question.audio?.url ? (
        <audio src={question.audio.url} controls className="w-full max-w-xl" />
      ) : (
        <p className="text-red-600">This question has no audio.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={record}
          disabled={recording || converting || checking}
          className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
        >
          {take ? 'Record again' : 'Record'}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!recording}
          className="px-4 py-2 rounded-md bg-gray-300 hover:bg-gray-400 text-gray-800 disabled:opacity-50"
        >
          Stop
        </button>
        {recording && (
          <span className="flex items-center gap-2 text-sm text-red-600" role="status">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
            Recording… say the sentence, then click Stop.
          </span>
        )}
        {converting && <span className="text-sm text-gray-600">Preparing your recording…</span>}
      </div>

      {take && !recording && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-3 text-sm text-gray-700">
            Your recording
            <audio key={take.url} src={take.url} controls />
          </label>
          {!result && (
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking}
              className="px-4 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
            >
              {checking ? 'Checking… (a few seconds)' : 'Check my recording'}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-red-600" role="alert">⚠️ {error}</p>}

      {t && result && (
        <>
          <p className={`font-semibold ${t.passed ? 'text-green-700' : 'text-amber-700'}`}>
            {t.basis === 'melody' ? 'Melody' : 'Overall'}: {Math.round(t.pct)}% → {t.points} / {t.max_points} points.{' '}
            <span className="font-normal text-gray-700">
              {t.passed ? 'Click Submit, or record again to try for more.' : 'Record again to try for more, or click Submit.'}
            </span>
          </p>
          <div className="overflow-x-auto rounded-md border border-teal-300 bg-white p-4 text-sm">
            <EvaluationView result={result} student />
          </div>
        </>
      )}
    </div>
  );
}
