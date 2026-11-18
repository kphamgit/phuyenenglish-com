import type React from 'react';
import type { EvaluationResult, StressComparison, SyllableCoaching } from './evaluation';

// Shows a full VoiceAnalyzer_Claude reply (see evaluation.ts), for the teacher and (for now) the student.
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

// A VoiceAnalyzer_Claude reply, readable: the scores, then the reference and the recording
// compared item by item (the whole sentence, then each word), and the full reply.
export function EvaluationView({ result: r }: { result: EvaluationResult }) {
  const s = r.summary;
  const words = r.stage4_pronunciation?.word_pronunciations ?? [];
  const comparisons = matchComparisons(words, r.stage3_stress?.stress_evaluation?.word_comparisons ?? []);
  const into = r.intonation?.applicable ? r.intonation : undefined;
  const a = r.stage2_alignment;
  const ratio = (n: number | undefined) => (n == null ? '–' : `${Math.round(n * 100)}%`);
  const semis = (n: number | null) => (n == null ? '–' : `${n.toFixed(1)} semitones`);

  // The whole sentence: [item, reference, yours, matched? (undefined = no verdict)].
  const sentenceRows: [string, React.ReactNode, React.ReactNode, boolean | undefined][] = [
    ['Words', s.spoken_text, s.heard_transcript, a?.word_match_vs_target_pct == null ? undefined : a.word_match_vs_target_pct >= 100],
    [
      'Sounds',
      <span className="font-mono">{words.map((w) => w.expected_phonemes).join(' | ')}</span>,
      <span className="font-mono">{s.recorded_timit_ipa}</span>,
      words.length ? words.every((w) => w.status === 'Clear') : undefined,
    ],
    [
      'Stress pattern',
      <span className="font-mono">{s.benchmark_stress_pattern}</span>,
      <span className="font-mono">{s.recorded_stress_pattern}</span>,
      s.stress_match_pct >= 100,
    ],
  ];
  if (s.reference_coaching_summary || s.recorded_coaching_summary) {
    sentenceRows.push([
      'Pitch',
      <span className="font-mono">{s.reference_coaching_summary ?? '–'}</span>,
      <span className="font-mono">{s.recorded_coaching_summary ?? '–'}</span>,
      comparisons.every((c) => !c?.syllable_coaching || c.syllable_coaching.every((sy) => sy.action === 'match')),
    ]);
  }
  if (into) {
    sentenceRows.push([
      'Rise at the end',
      semis(into.reference_rise_semitones),
      <>
        {semis(into.recorded_rise_semitones)}{' '}
        <span className="text-gray-500">(needed {semis(into.required_rise_semitones)})</span>
      </>,
      into.action === 'match',
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span>
          Overall: <strong className="text-base text-gray-900">{pct(s.overall_score_pct)}</strong>
        </span>
        <span>Pronunciation: {pct(s.pronunciation_score_pct)}</span>
        <span>Stress: {pct(s.stress_match_pct)}</span>
        {into && <span>Intonation: {pct(into.score_pct)}</span>}
        <span>Linking: {s.connected_speech_summary}</span>
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

      <div className="overflow-x-auto">
        <div className="font-semibold text-gray-700">Whole sentence: reference vs. your recording</div>
        <table className="border-collapse text-left">
          <thead>
            <tr className="text-gray-500">
              <th className={cell}></th>
              <th className={cell}>Reference</th>
              <th className={cell}>Your recording</th>
              <th className={cell}></th>
            </tr>
          </thead>
          <tbody>
            {sentenceRows.map(([item, ref, yours, ok]) => (
              <tr key={item}>
                <th className={`${cell} text-gray-600 whitespace-nowrap`}>{item}</th>
                <td className={cell}>{ref}</td>
                <td className={cell}>{yours}</td>
                <td className={cell}><Verdict ok={ok} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {words.length > 0 && (
        <div className="overflow-x-auto">
          <div className="font-semibold text-gray-700">Word by word: reference vs. your recording</div>
          <table className="border-collapse text-left">
            <thead>
              <tr className="text-gray-500">
                <th className={cell} rowSpan={2}>Word</th>
                <th className={`${cell} text-center`} colSpan={2}>Sounds</th>
                <th className={`${cell} text-center`} colSpan={2}>Stress</th>
                <th className={`${cell} text-center`} colSpan={2}>Pitch</th>
                <th className={cell} rowSpan={2}>Linking</th>
                <th className={cell} rowSpan={2}>Score</th>
                <th className={cell} rowSpan={2}>Feedback</th>
              </tr>
              <tr className="text-gray-500 text-xs">
                <th className={cell}>Reference</th>
                <th className={cell}>Yours</th>
                <th className={cell}>Reference</th>
                <th className={cell}>Yours</th>
                <th className={cell}>Reference</th>
                <th className={cell}>Yours</th>
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
                    <td className={`${cell} font-mono`}>{w.expected_phonemes}</td>
                    <td className={`${cell} font-mono ${ok ? '' : 'text-red-600'}`}>
                      {w.heard_phonemes} {w.heard_ipa}
                    </td>
                    <td className={`${cell} font-mono`}>{st?.benchmark_stress ?? '–'}</td>
                    <td className={`${cell} font-mono ${st && !st.stress_matched ? 'text-amber-600' : ''}`}>
                      {st?.recorded_stress ?? '–'}
                    </td>
                    <td className={cell}>{st?.reference_pitch_contour ?? '–'}</td>
                    <td className={cell}>
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
                    <td className={cell}>{w.linking_to_next_word ?? '–'}</td>
                    <td className={cell}>{pct(w.pronunciation_score_pct)}</td>
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
        </div>
      )}

      <div className="text-gray-600">
        {a && (
          <div>
            Recognition: words matched {pct(a.word_match_vs_target_pct)} · confidence {pct(a.acoustic_confidence_pct)}
          </div>
        )}
        <div>
          Settings: falling {ratio(s.fall_match_ratio)} · rising {ratio(s.rise_match_ratio)} · strict linking{' '}
          {s.strict_connected_speech == null ? '–' : s.strict_connected_speech ? 'on' : 'off'}
          {s.targeted_words.length > 0 && <> · targeted: {s.targeted_words.join(', ')}</>}
        </div>
      </div>

      <details>
        <summary className="cursor-pointer text-gray-500">Full reply</summary>
        <pre className="max-h-96 overflow-auto rounded bg-gray-100 p-2 text-xs text-gray-800">
          {JSON.stringify(r, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ✓ when the recording matches the reference on this item, ✗ when it doesn't.
function Verdict({ ok }: { ok: boolean | undefined }) {
  if (ok == null) return null;
  return ok ? <span className="text-green-700">✓</span> : <span className="text-red-600">✗</span>;
}

const cell = 'border-b border-gray-200 px-2 py-1 align-top';
