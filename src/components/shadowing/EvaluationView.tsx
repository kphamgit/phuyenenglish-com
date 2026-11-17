import type { EvaluationResult, StressComparison, SyllableCoaching } from './evaluation';

// Shows a full VoiceAnalyzer_Claude reply (see evaluation.ts), for the teacher.
// Copied from p2p-voice-chat-admin (src/EvaluationView.tsx).

const pct = (n: number | null | undefined) => (n == null ? '–' : `${n}%`);

// Each pronunciation word's stress comparison, matched by word in order (the
// two lists normally line up one to one, but don't rely on it).
function matchComparisons(words: { word: string }[], comparisons: StressComparison[]): (StressComparison | undefined)[] {
  let next = 0;
  return words.map((w) => {
    const i = comparisons.findIndex((c, j) => j >= next && c.word.toLowerCase() === w.word.toLowerCase());
    if (i === -1) return undefined;
    next = i + 1;
    return comparisons[i];
  });
}

// A syllable's pitch badge: green when it matches the reference, amber when
// the voice should go lower or higher.
function Badge({ s, many }: { s: SyllableCoaching; many: boolean }) {
  const good = s.action === 'match';
  return (
    <span
      title={s.message}
      className={`inline-block rounded px-1.5 text-xs whitespace-nowrap ${
        good ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {many && `S${s.syllable_index}: `}
      {s.badge}
    </span>
  );
}

// A VoiceAnalyzer_Claude reply, readable: the scores, what was heard, pitch and
// stress, each word, and the full reply.
export function EvaluationView({ result: r }: { result: EvaluationResult }) {
  const s = r.summary;
  const words = r.stage4_pronunciation?.word_pronunciations ?? [];
  const comparisons = matchComparisons(words, r.stage3_stress?.stress_evaluation?.word_comparisons ?? []);
  const into = r.intonation?.applicable ? r.intonation : undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span>
          Overall: <strong className="text-base text-gray-900">{pct(s.overall_score_pct)}</strong>
        </span>
        <span>Pronunciation: {pct(s.pronunciation_score_pct)}</span>
        <span>Stress: {pct(s.stress_match_pct)}</span>
        {into && <span>Intonation: {pct(into.score_pct)}</span>}
        <span>
          Linking: {s.connected_speech_summary}
          {s.targeted_words.length > 0 && (
            <span className="text-gray-500"> (targeted: {s.targeted_words.join(', ')})</span>
          )}
        </span>
      </div>
      {into && (
        <div
          className={`rounded px-2 py-1 ${
            into.action === 'match' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          <strong>{into.badge}</strong> {into.message}
        </div>
      )}
      <div className="text-gray-600">
        Heard: <span className="font-mono">{s.heard_transcript}</span>{' '}
        <span className="font-mono">{s.recorded_timit_ipa}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-gray-600">
        {s.reference_coaching_summary && (
          <>
            <span>Reference pitch:</span>
            <span className="font-mono">{s.reference_coaching_summary}</span>
          </>
        )}
        {s.recorded_coaching_summary && (
          <>
            <span>Your pitch:</span>
            <span className="font-mono">{s.recorded_coaching_summary}</span>
          </>
        )}
        <span>Stress:</span>
        <span>
          <span className="font-mono">{s.benchmark_stress_pattern}</span> (reference) →{' '}
          <span className="font-mono">{s.recorded_stress_pattern}</span> (yours)
        </span>
      </div>

      {words.length > 0 && (
        <table className="border-collapse text-left">
          <thead>
            <tr className="text-gray-500">
              <th className={cell}>Word</th>
              <th className={cell}>Score</th>
              <th className={cell}>Expected</th>
              <th className={cell}>Heard</th>
              <th className={cell}>Pitch</th>
              <th className={cell}>Stress</th>
              <th className={cell}>Linking</th>
              <th className={cell}>Feedback</th>
            </tr>
          </thead>
          <tbody>
            {words.map((w, i) => {
              const st = comparisons[i];
              const syllables = st?.syllable_coaching ?? [];
              const ok = w.status === 'Clear';
              return (
                <tr key={i}>
                  <td className={`${cell} font-semibold ${ok ? 'text-green-700' : 'text-red-600'}`}>{w.word}</td>
                  <td className={cell}>{pct(w.pronunciation_score_pct)}</td>
                  <td className={`${cell} font-mono`}>{w.expected_phonemes}</td>
                  <td className={`${cell} font-mono`}>
                    {w.heard_phonemes} {w.heard_ipa}
                  </td>
                  <td className={cell}>
                    {st?.reference_pitch_contour && (
                      <div className="text-xs text-gray-500">ref: {st.reference_pitch_contour}</div>
                    )}
                    {syllables.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {syllables.map((sy) => (
                          <Badge key={sy.syllable_index} s={sy} many={syllables.length > 1} />
                        ))}
                      </div>
                    ) : (
                      (st?.recorded_pitch_coaching ?? '–')
                    )}
                  </td>
                  <td className={`${cell} font-mono ${st && !st.stress_matched ? 'text-amber-600' : ''}`}>
                    {st ? `${st.benchmark_stress} → ${st.recorded_stress}` : '–'}
                  </td>
                  <td className={cell}>{w.linking_to_next_word ?? '–'}</td>
                  <td className={cell}>
                    {w.feedback}
                    {st?.diagnostic_feedback?.map((m, j) => (
                      <div key={j} className="text-amber-700">
                        {m}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <details>
        <summary className="cursor-pointer text-gray-500">Full reply</summary>
        <pre className="max-h-96 overflow-auto rounded bg-gray-100 p-2 text-xs text-gray-800">
          {JSON.stringify(r, null, 2)}
        </pre>
      </details>
    </div>
  );
}

const cell = 'border-b border-gray-200 px-2 py-1 align-top';
