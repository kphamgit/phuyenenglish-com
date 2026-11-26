import { Fragment } from 'react';
import type React from 'react';
import {
  LEGACY_STRESS_ENABLED,
  RISING_TONE_ENABLED,
  type EvaluationResult,
  type EvaluationWord,
  type PitchDirection,
  type StressComparison,
  chartLabels,
  fitParts,
  type Syllabified,
  type SyllableCoaching,
  type WordStress,
} from './evaluation';

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

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

// A passing word's contrast (the weakest unstressed syllable, % of the reference's) as a sentence.
// The syllable is named by its spelling (“dad”) when the dictionary's syllables are known.
// Teacher: "The student stresses …"; student: "You stress …".
function contrastInWords(
  pct: number,
  stressed: number | null | undefined,
  parts: string[] | null,
  teacher: boolean,
): string {
  const who = teacher ? 'The student stresses' : 'You stress';
  const syl =
    stressed == null
      ? 'the stressed syllable'
      : parts && parts[stressed - 1]
        ? `“${parts[stressed - 1]}”`
        : `the ${ordinal(stressed)} syllable`;
  if (pct >= 150) return `${who} ${syl} much more strongly than the reference voice.`;
  if (pct >= 110) return `${who} ${syl} a bit more strongly than the reference voice.`;
  if (pct >= 90) return `${who} ${syl} about as strongly as the reference voice.`;
  return `${who} ${syl} a little less strongly than the reference voice, but enough to pass.`;
}

// Word Syllables Stress Check: each of the teacher's stress words, the stressed syllable in
// the reference vs. the recording (● = stressed), the verdict and what to do.
// teacher: the notes speak about "the student" (otherwise "you"). On a pass, the Notes column
// describes only how strong the stress is (the badge already says it's on the right syllable).
function WordStressTable({ words, teacher = false }: { words: WordStress[]; teacher?: boolean }) {
  const tone = (status: string) =>
    status === 'pass'
      ? 'bg-green-100 text-green-800'
      : status === 'weak_contrast'
        ? 'bg-amber-100 text-amber-800'
        : status === 'wrong_syllable' || status === 'not_heard'
          ? 'bg-red-100 text-red-800'
          : 'bg-gray-100 text-gray-700';
  const which = (n: number | null | undefined) => (n == null ? '' : ` (syllable ${n})`);
  // Word stress isn't scored any more (the analyzer sends the patterns only, status "measured");
  // results scored before that keep their Result and Score columns.
  const scored = words.some((w) => w.score_pct != null || ['pass', 'weak_contrast', 'wrong_syllable'].includes(w.status));
  const notes = scored || words.some((w) => w.message);
  const columns = 4 + (scored ? 2 : 0) + (notes ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <div className="font-semibold text-gray-700">Word Syllables Stress Check</div>
      <table className="border-collapse text-left">
        <thead>
          <tr className="text-gray-500">
            <th className={cell}>Word</th>
            <th className={cell}>Expected</th>
            <th className={cell}>Reference</th>
            <th className={cell}>Yours</th>
            {scored && <th className={cell}>Result</th>}
            {scored && <th className={cell}>Score</th>}
            {notes && <th className={cell}>Notes</th>}
          </tr>
        </thead>
        <tbody>
          {words.map((w, i) => {
            // The syllable to stress (results scored before the stress source option: the reference's).
            const expectedPattern = w.expected_pattern ?? w.reference_pattern;
            const expected = w.expected_stressed_syllable ?? w.reference_stressed_syllable;
            const source = w.stress_source ?? (w.reference_pattern ? 'reference' : null);
            // Same stress pattern: both stressed circles green; different: yours amber.
            const same = w.right_syllable ?? (expectedPattern != null && expectedPattern === w.recorded_pattern);
            // The syllables as spelled (from the dictionary), if they fit the analyzer's count.
            const parts = fitParts(w.hyphenated, expectedPattern);
            // The melody row when at least one syllable has a pitch curve (a word whose last syllable
            // trails off into creak or whisper still shows the fall within its stressed syllable).
            const melody = (w.pitch_direction?.contour_syllables?.length ?? 0) >= 1 ? w.pitch_direction : undefined;
            const rowCell = melody ? cell.replace('border-b border-gray-200', '') : cell;
            return (
              <Fragment key={i}>
                <tr>
                  <td className={`${rowCell} font-semibold`}>{w.word}</td>
                  <td className={`${rowCell} whitespace-nowrap`}>
                    <StressPattern pattern={expectedPattern} tone="green" />
                    <span className="text-gray-500 text-xs">{which(expected)}</span>
                    {parts && <Spelled parts={parts} stressed={expected} />}
                    {teacher && w.syllabified && <IpaSyllables syllabified={w.syllabified} compact />}
                    {source && (
                      <div className="text-[11px] text-gray-500 whitespace-normal">
                        {source === 'dictionary' ? 'from the dictionary' : 'from the reference voice'}
                        {w.stress_source_reason && <> ({w.stress_source_reason})</>}
                      </div>
                    )}
                  </td>
                  <td className={`${rowCell} whitespace-nowrap`}>
                    {/* What the reference voice stressed (measured): amber when it isn't the expected syllable. */}
                    <StressPattern
                      pattern={w.reference_pattern}
                      tone={w.reference_stressed_syllable != null && w.reference_stressed_syllable !== expected ? 'amber' : 'green'}
                    />
                    <span className="text-gray-500 text-xs">{which(w.reference_stressed_syllable)}</span>
                    {parts && <Spelled parts={parts} stressed={w.reference_stressed_syllable} />}
                  </td>
                  <td className={`${rowCell} whitespace-nowrap`}>
                    <StressPattern pattern={w.recorded_pattern} tone={same ? 'green' : 'amber'} />
                    <span className="text-gray-500 text-xs">{which(w.recorded_stressed_syllable)}</span>
                    {parts && <Spelled parts={parts} stressed={w.recorded_stressed_syllable} />}
                  </td>
                  {scored && (
                    <td className={rowCell}>
                      <span className={`inline-block rounded px-1.5 text-xs whitespace-nowrap ${tone(w.status)}`}>{w.badge}</span>
                    </td>
                  )}
                  {scored && <td className={rowCell}>{pct(w.score_pct)}</td>}
                  {notes && (
                  <td className={rowCell}>
                    {w.status === 'pass' ? (
                      w.weakest_contrast_pct != null ? (
                        <span title={teacher ? `Contrast ${w.weakest_contrast_pct}% of the reference's` : undefined}>
                          {contrastInWords(w.weakest_contrast_pct, expected, parts, teacher)}
                        </span>
                      ) : (
                        '–'
                      )
                    ) : (
                      w.message
                    )}
                  </td>
                  )}
                </tr>
                {/* The word's melody, in its own row under its stress result. */}
                {melody && (
                  <tr>
                    <td className={`${cell} text-xs text-gray-500`}>Melody</td>
                    <td className={cell} colSpan={columns - 1}>
                      <PitchDirectionCell d={melody} parts={parts} chart={chartLabels(w.syllabified, w.hyphenated, expectedPattern)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// The student's screen: whether each targeted word was linked to the next word (make‿it), from
// VoiceAnalyzer's linking_to_next_word: "Linked (...)", or "Missed Link" / "Unlinked" / "Separated"
// when the student said the two words apart. Only the targeted pairs: they're the links the student
// was asked for (the sentence shows them with arches).
function LinkingList({ words, targeted }: { words: EvaluationWord[]; targeted: string[] }) {
  const bareWord = (w: string) => w.replace(/[^A-Za-z']/g, '').toLowerCase();
  const targetedSet = new Set(targeted.map(bareWord));
  const pairs = words.flatMap((w, i) => {
    if (!targetedSet.has(bareWord(w.word)) || i + 1 >= words.length) return [];
    const status = w.linking_to_next_word ?? '';
    const ok = /^Linked/.test(status) ? true : /^(Missed Link|Unlinked|Separated)/.test(status) ? false : undefined;
    return [{ first: w.word, second: words[i + 1].word, ok }];
  });
  if (pairs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="font-semibold text-gray-700">Linking</div>
      {pairs.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="rounded bg-sky-100 px-1 font-semibold">
            {p.first}‿{p.second}
          </span>
          <Verdict ok={p.ok} />
          <span className={p.ok === false ? 'text-red-600' : 'text-gray-600'}>
            {p.ok === true
              ? 'Linked smoothly'
              : p.ok === false
                ? 'Not linked: say the two words together, as one word'
                : 'Not checked'}
          </span>
        </div>
      ))}
    </div>
  );
}

// The student's screen: only the melody of each stress word (the badge and both pitch curves, no
// advice text), without the stress check (stressed syllable, contrast, score), which the teacher sees.
function WordMelodyList({ words }: { words: WordStress[] }) {
  const shown = words.filter((w) => w.word_index != null && (w.syllable_count ?? 0) >= 2);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="font-semibold text-gray-700">
        Melody{' '}
        <span className="font-normal text-xs text-gray-500">
          (reference: grey dashed line · yours: blue line)
        </span>
      </div>
      {shown.map((w, i) => {
        const melody = (w.pitch_direction?.contour_syllables?.length ?? 0) >= 1 ? w.pitch_direction : undefined;
        const parts = fitParts(w.hyphenated, w.expected_pattern ?? w.reference_pattern);
        return (
          <div key={i} className="flex flex-col gap-1 border-b border-gray-200 pb-2">
            <span className="font-semibold">{w.word}</span>
            {melody ? (
              <PitchDirectionCell
                d={melody}
                parts={parts}
                advice={false}
                chart={chartLabels(w.syllabified, w.hyphenated, w.expected_pattern ?? w.reference_pattern)}
              />
            ) : (
              <span className="text-xs text-gray-600">{w.pitch_direction?.message || w.message || 'The melody could not be measured.'}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}


// The word as spelled syllables, e.g. bas-ket-ball, with the stressed one in bold.
export function Spelled({ parts, stressed }: { parts: string[]; stressed: number | null | undefined }) {
  return (
    <div className="text-xs text-gray-700">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && '-'}
          {i + 1 === stressed ? <strong className="text-gray-900">{p}</strong> : p}
        </Fragment>
      ))}
    </div>
  );
}

// A stress word's IPA in syllables, e.g. /ə-ˈpɒ-lə-dʒi/ with the primary-stressed syllable in bold,
// and where it came from: the IPA the teacher typed, or made from the CMU dictionary (US). Warns
// when its syllables don't match the count the analyzer measured. The Vietnamese code (ơ-pô-lơ-di:
// the teacher's, or made from the CMU dictionary) goes on top, dark, with the IPA lighter under
// it. Compact: smaller, for a table cell.
export function IpaSyllables({ syllabified: s, compact = false }: { syllabified: Syllabified; compact?: boolean }) {
  if (!s.syllables?.length) {
    return s.ipa ? (
      <div className={`${compact ? 'text-[11px]' : 'text-xs'} text-amber-700 whitespace-normal`}>
        IPA /{s.ipa}/ couldn't be split into syllables.
      </div>
    ) : null;
  }
  const mark = (stress: string | null) => (stress === 'primary' ? 'ˈ' : stress === 'secondary' ? 'ˌ' : '');
  const vietParts = s.viet_syllables ?? [];
  return (
    <div className={`${compact ? 'text-[11px]' : 'text-xs'} whitespace-normal`}>
      {s.viet && (
        <div className="text-gray-900" lang="vi">
          {!compact && (
            <span className="text-gray-600">
              Vietnamese ({s.viet_source === 'client' ? 'yours' : 'made from the CMU dictionary'}):{' '}
            </span>
          )}
          {s.viet_matches_ipa ? (
            vietParts.map((p, i) => (
              <Fragment key={i}>
                {i > 0 && '-'}
                {s.syllables[i]?.stress === 'primary' ? <strong>{p}</strong> : p}
              </Fragment>
            ))
          ) : (
            <>
              {s.viet}{' '}
              <span className="text-amber-700">
                (its parts don't line up with the {s.syllables.length} IPA syllable
                {s.syllables.length === 1 ? '' : 's'}
                {s.viet_source === 'client' ? ': use one part per syllable, separated by hyphens' : ''})
              </span>
            </>
          )}
        </div>
      )}
      <div className="text-gray-500">
      {!compact && <span>IPA: </span>}
      <span className="font-mono">
        /
        {s.syllables.map((x, i) => (
          <Fragment key={i}>
            {i > 0 && '-'}
            {x.stress === 'primary' ? (
              <strong className="text-gray-700">{mark(x.stress) + x.text}</strong>
            ) : (
              mark(x.stress) + x.text
            )}
          </Fragment>
        ))}
        /
      </span>{' '}
      <span>
        ({s.source === 'ipa' ? 'your IPA' : compact ? 'dictionary, US' : 'made from the CMU dictionary, US: type one to replace it'})
      </span>
      </div>
      {s.matches_cmu === false && (
        <div className="text-amber-700">
          {s.source === 'ipa' ? 'Your IPA has' : 'This IPA has'} {s.syllable_count} syllable
          {s.syllable_count === 1 ? '' : 's'}, but the analyzer splits this word into {s.cmu_syllable_count} (the CMU
          dictionary's count), so the labels won't line up with the melody chart and students won't see them there.
        </div>
      )}
    </div>
  );
}

// A stress pattern such as "○ ● ○" as numbered circles: the stressed syllable filled, in green
// (matches the reference) or amber (doesn't).
export function StressPattern({ pattern, tone }: { pattern?: string | null; tone: 'green' | 'amber' }) {
  const marks = (pattern ?? '').trim().split(/\s+/).filter(Boolean);
  if (marks.length === 0) return <span>–</span>;
  return (
    <span className="inline-flex gap-0.5 align-middle mr-1">
      {marks.map((m, i) => (
        <span
          key={i}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold leading-none ${
            m !== '●'
              ? 'border-gray-500 bg-white text-gray-700'
              : tone === 'green'
                ? 'border-green-700 bg-green-600 text-white'
                : 'border-amber-600 bg-amber-500 text-white'
          }`}
          title={`Syllable ${i + 1}${m === '●' ? ' (stressed)' : ''}`}
        >
          {i + 1}
        </span>
      ))}
    </span>
  );
}

// The similarity (-1 to 1) as a percentage, e.g. 0.81 -> "81%".
const similarityPct = (r: number) => `${Math.round(r * 100)}%`;

type MelodySyllable = PitchDirection['syllables'][number];
// How a syllable is named in the coaching: “dy” (its spelling) or "syllable 2".
const syllableName = (parts: string[] | null) => (n: number) =>
  parts && parts[n - 1] ? `“${parts[n - 1]}”` : `syllable ${n}`;
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const STRESSED_WHERE: Record<string, string> = {
  rise: 'rise from start to end',
  fall: 'fall from start to end',
  level: 'stay steady from start to end',
};
const DID: Record<string, string> = { rise: 'yours goes up', fall: 'yours goes down', level: 'yours stays flat' };

// What to do with the voice on one syllable, in words (no numbers): relative to the stressed
// syllable `st` for the syllables before or after it, or through it for the stressed one.
function syllableAdvice(sy: MelodySyllable, st: number | undefined, name: (n: number) => string): string | null {
  const dir = sy.reference_direction;
  if (!dir || !sy.measured) return null;
  const S = st != null ? name(st) : 'the stressed syllable';
  if (sy.measured.startsWith('within')) return STRESSED_WHERE[dir] ?? null;
  if (sy.measured.startsWith('into')) {
    return dir === 'rise'
      ? `start lower, then rise into ${S}`
      : dir === 'fall'
        ? `start higher, then come down into ${S}`
        : `keep about the same pitch going into ${S}`;
  }
  return dir === 'rise'
    ? `go higher than ${S}`
    : dir === 'fall'
      ? `drop lower than ${S}`
      : `stay at about the same pitch as ${S}`;
}

// The melody coaching: a headline with the similarity, one line per measured syllable (what to
// do, ✓ when you already do it), and the "make it bigger" tip if there is one, without semitones.
// parts: the syllables as spelled; when given, syllables are named by them ("dy") instead of
// by number ("syllable 2").
function MelodyCoaching({ d, parts }: { d: PitchDirection; parts: string[] | null }) {
  const st = d.syllables.find((sy) => sy.stressed)?.syllable_index;
  const name = syllableName(parts);
  const lines = d.syllables
    .map((sy) => ({ sy, advice: syllableAdvice(sy, st, name) }))
    .filter((x): x is { sy: MelodySyllable; advice: string } => x.advice !== null);
  const sim = d.correlation != null
    ? ` (similarity ${similarityPct(d.correlation)}${d.correlation < 0 ? ', the opposite shape' : ''})`
    : '';
  const tipAt = d.message.indexOf('Tip:');
  const tip = tipAt >= 0 ? d.message.slice(tipAt).replace(/\s*\([^)]*semitones[^)]*\)/g, '') : null;
  // Results without per-syllable details: the analyzer's message, made number-free.
  if (lines.length === 0) {
    const plain = d.message
      .replace(/similarity (-?\d+(?:\.\d+)?)/g, (_, r: string) => `similarity ${similarityPct(Number(r))}`)
      .replace(/\s*\([^)]*semitones[^)]*\)/g, '');
    return <span className="text-xs text-gray-600">{plain}</span>;
  }
  return (
    <div className="text-xs text-gray-700">
      <div>
        {d.status === 'match' ? 'Your melody follows the reference' : <strong>Try to follow the reference's melody</strong>}
        {sim}:
      </div>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {lines.map(({ sy, advice }) => {
          const wrong = sy.matched === false;
          const did = sy.recorded_direction ? DID[sy.recorded_direction] : undefined;
          return (
            <li key={sy.syllable_index} className={wrong ? 'text-amber-800' : ''}>
              <span className="font-semibold">
                {capitalize(name(sy.syllable_index))}
                {sy.stressed ? ' (stressed)' : ''}
              </span>{' '}
              should {advice}
              {sy.matched === true && <span className="text-green-700"> ✓</span>}
              {wrong && did && <span> ({did})</span>}
            </li>
          );
        })}
      </ul>
      {tip && <div className="mt-0.5">{tip}</div>}
    </div>
  );
}

// The melody of one stress word: its badge, both pitch curves drawn together (reference grey,
// yours blue, syllables separated), the syllables left out and why, and the advice
// (advice=false: the curves without the advice, as on the student's screen).
function PitchDirectionCell({
  d,
  parts = null,
  advice = true,
  chart,
}: {
  d: PitchDirection;
  parts?: string[] | null; // the spelled syllables, for the text (“pol” left out: …)
  advice?: boolean;
  chart?: { parts: string[] | null; sub: string[] | null }; // the chart's labels (chartLabels); default: parts
}) {
  const tone =
    d.status === 'match'
      ? 'bg-green-100 text-green-800'
      : d.status === 'mismatch'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-gray-100 text-gray-700';
  const left = d.syllables.filter((sy) => !sy.judged && sy.reason);
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
      <div className="flex flex-col gap-1">
        <span className={`self-start inline-block rounded px-1.5 text-xs whitespace-nowrap ${tone}`}>
          {d.badge}
          {d.correlation != null && ` (similarity ${similarityPct(d.correlation)})`}
        </span>
        {d.reference_contour && d.recorded_contour && d.reference_contour.length > 1 && (
          <ContourChart
            // Every syllable (gaps where there's no pitch) when the analyzer sends it; older
            // results have only the measured syllables.
            reference={d.full_reference_contour?.length ? d.full_reference_contour : d.reference_contour}
            recorded={d.full_recorded_contour?.length ? d.full_recorded_contour : d.recorded_contour}
            perSyllable={d.points_per_syllable ?? 10}
            syllables={(d.full_reference_contour?.length ? d.full_contour_syllables : d.contour_syllables) ?? []}
            parts={chart ? chart.parts : parts}
            subParts={chart?.sub}
          />
        )}
        {left.map((sy) => (
          <span key={sy.syllable_index} className="text-xs text-gray-500">
            {capitalize(syllableName(parts)(sy.syllable_index))} left out: {sy.reason}
          </span>
        ))}
      </div>
      {advice && (
        <div className="min-w-48 flex-1">
          {d.status !== 'not_judged' ? <MelodyCoaching d={d} parts={parts} /> : <span className="text-xs text-gray-600">{d.message}</span>}
        </div>
      )}
    </div>
  );
}

// Two pitch curves (semitones) on one small chart: reference dashed grey, yours solid blue,
// with a light line between syllables and each syllable underneath (its IPA or spelling, or its
// number; with subParts, the Vietnamese code on top, dark, and the IPA under it, light).
// Without `recorded` it draws the reference alone (the teacher's "Analyze reference audio").
// null points = no reliable pitch there: the curve has a gap, and a syllable whose reference has
// no pitch at all keeps its place, its label greyed with "no pitch" in it.
export function ContourChart({
  reference,
  recorded,
  perSyllable,
  syllables,
  parts = null,
  subParts = null,
}: {
  reference: (number | null)[];
  recorded?: (number | null)[];
  perSyllable: number;
  syllables: number[];
  parts?: string[] | null; // the syllables (IPA or spelled); labels the chart instead of the numbers
  subParts?: string[] | null; // the Vietnamese code's parts, one per syllable: a line above `parts`
}) {
  const W = 180;
  const sub = subParts && subParts.length > 0 ? subParts : null;
  const labels = sub ? 22 : 12; // the label lines' height under the curves
  const H = 52 + labels;
  const pad = 4;
  const all = [...reference, ...(recorded ?? [])].filter((v): v is number => v != null);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const span = Math.max(hi - lo, 1);
  const n = Math.max(reference.length, recorded?.length ?? 0);
  const x = (i: number) => pad + (i / Math.max(n - 1, 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - labels - 2 * pad + 2);
  // One path, lifted over the gaps (null points).
  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={recorded ? 'Pitch curves: reference and yours' : 'Pitch curve of the reference'}
    >
      {syllables.map((num, k) => {
        const x0 = x(k * perSyllable);
        const x1 = x(Math.min((k + 1) * perSyllable, n) - 1);
        const noPitch = reference.slice(k * perSyllable, (k + 1) * perSyllable).every((v) => v == null);
        return (
          <g key={k}>
            {k > 0 && <line x1={x0} x2={x0} y1={pad} y2={H - labels} stroke="#e5e7eb" />}
            {noPitch && (
              <text x={(x0 + x1) / 2} y={(H - labels) / 2 + 3} fontSize="8" textAnchor="middle" fill="#9ca3af" fontStyle="italic">
                no pitch
              </text>
            )}
            {sub ? (
              <>
                {/* The Vietnamese code on top (dark), the IPA under it (light). */}
                <text
                  x={(x0 + x1) / 2}
                  y={H - 12}
                  fontSize="10"
                  fontWeight="600"
                  textAnchor="middle"
                  fill={noPitch ? '#9ca3af' : '#1f2937'}
                >
                  {sub[num - 1] ?? ''}
                </text>
                <text x={(x0 + x1) / 2} y={H - 2} fontSize="9" textAnchor="middle" fill="#6b7280">
                  {parts?.[num - 1] ?? num}
                </text>
              </>
            ) : (
              <text
                x={(x0 + x1) / 2}
                y={H - 2}
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
                fill={noPitch ? '#9ca3af' : '#1f2937'}
              >
                {parts?.[num - 1] ?? num}
              </text>
            )}
          </g>
        );
      })}
      <path d={path(reference)} fill="none" stroke="#9ca3af" strokeWidth="2" strokeDasharray="4 3" />
      {recorded && <path d={path(recorded)} fill="none" stroke="#2563eb" strokeWidth="2" />}
    </svg>
  );
}

// A VoiceAnalyzer_Claude reply, readable: the scores, then the reference and the recording
// compared item by item (the whole sentence, then each word), and the full reply.
// teacher: the teacher's view (Test it yourself, the students' results), with teacher-only wording.
// hideOverall: leave out the overall score (the students' results, which show the melody score instead).
// student: the student's screen, only the whole-sentence table (words, without the ARPAbet / IPA
// sounds), the linking of each targeted pair (LinkingList) and the melody of each stress word
// (WordMelodyList); the stress check is teacher-only.
export function EvaluationView({
  result: r,
  teacher = false,
  student = false,
  hideOverall = false,
}: {
  result: EvaluationResult;
  teacher?: boolean;
  student?: boolean;
  hideOverall?: boolean;
}) {
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
  ];
  // The sounds as ARPAbet / IPA codes: teacher only, for the stress words, one per line: the
  // CMU dictionary's ARPAbet with its stress digits, and what was heard in the recording.
  const stressWordSet = new Set((r.word_stress_check?.enabled ? r.word_stress_check.stress_words : []).map((w) => w.toLowerCase()));
  const isStressWord = (word: string) => stressWordSet.has(word.replace(/[^A-Za-z']/g, '').toLowerCase());
  if (!student) {
    const cmuWords = (r.cmu_arpabet ?? []).filter((w) => isStressWord(w.word));
    const heardWords = words.filter((w) => isStressWord(w.word));
    if (stressWordSet.size > 0 && (cmuWords.length > 0 || heardWords.length > 0)) {
      sentenceRows.push([
        'Sounds',
        <div className="flex flex-col font-mono">
          {cmuWords.length > 0
            ? cmuWords.map((w, i) => (
                <span key={i}>
                  <span className="font-sans text-gray-500">{w.word}:</span>{' '}
                  {w.arpabet ? <ArpabetStress arpabet={w.arpabet} /> : '(not in the dictionary)'}
                </span>
              ))
            : heardWords.map((w, i) => (
                <span key={i}>
                  <span className="font-sans text-gray-500">{w.word}:</span>{' '}
                  <span className={ARPABET_LETTERS}>{w.expected_phonemes}</span>
                </span>
              ))}
        </div>,
        <div className="flex flex-col font-mono">
          {heardWords.map((w, i) => (
            <span key={i}>
              <span className="font-sans text-gray-500">{w.word}:</span>{' '}
              <span className={ARPABET_LETTERS}>{w.heard_phonemes}</span> {w.heard_ipa}
            </span>
          ))}
        </div>,
        heardWords.length ? heardWords.every((w) => w.status === 'Clear') : undefined,
      ]);
    }
  }
  // The earlier sentence-wide stress and pitch rows, replaced by the Word Syllables Stress Check.
  if (LEGACY_STRESS_ENABLED) {
    sentenceRows.push([
      'Stress pattern',
      <span className="font-mono">{s.benchmark_stress_pattern}</span>,
      <span className="font-mono">{s.recorded_stress_pattern}</span>,
      (s.stress_match_pct ?? 0) >= 100,
    ]);
  }
  if (LEGACY_STRESS_ENABLED && (s.reference_coaching_summary || s.recorded_coaching_summary)) {
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

  // Linking is only checked (and shown) when strict connected speech was on.
  const linking = s.strict_connected_speech !== false;
  // Word Syllables Stress Check: only when the teacher gave stress words.
  const ws = r.word_stress_check?.enabled ? r.word_stress_check : undefined;

  const sentenceTable = (
    <div className="overflow-x-auto">
      <div className="font-semibold text-gray-700">
        Whole sentence: reference vs. your recording{' '}
        <span className="font-normal text-[#8B5E3C]" lang="vi">
          (Reference voice: giọng mẫu)
        </span>
      </div>
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
  );

  if (student) {
    return (
      <div className="flex flex-col gap-3">
        {sentenceTable}
        {linking && <LinkingList words={words} targeted={s.targeted_words ?? []} />}
        {ws && <WordMelodyList words={ws.words} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {!hideOverall && (
          <span>
            Overall: <strong className="text-base text-gray-900">{pct(s.overall_score_pct)}</strong>
          </span>
        )}
        <span>Pronunciation: {pct(s.pronunciation_score_pct)}</span>
        {/* Word stress is no longer scored (null); older results still have a score. */}
        {ws && s.stress_match_pct != null && <span>Word stress: {pct(s.stress_match_pct)}</span>}
        {ws && ws.pitch_direction_score_pct != null && <span>Melody: {pct(ws.pitch_direction_score_pct)}</span>}
        {into && <span>Intonation: {pct(into.score_pct)}</span>}
        {linking && <span>Linking: {s.connected_speech_summary}</span>}
      </div>
      {(s.targeted_word_warnings ?? []).map((w) => (
        <div key={w.word} className="rounded px-2 py-1 bg-amber-100 text-amber-800">
          ⚠️ Targeted word: {w.message}
        </div>
      ))}
      {into && (
        <div
          className={`rounded px-2 py-1 ${
            into.action === 'match' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          <strong>{into.badge}</strong> {into.message}
        </div>
      )}

      {sentenceTable}

      {ws && <WordStressTable words={ws.words} teacher={teacher} />}

      {words.length > 0 && (
        <div className="overflow-x-auto">
          <div className="font-semibold text-gray-700">Word by word: reference vs. your recording</div>
          <table className="border-collapse text-left">
            <thead>
              <tr className="text-gray-500">
                <th className={cell} rowSpan={2}>Word</th>
                <th className={`${cell} text-center`} colSpan={2}>Sounds</th>
                {LEGACY_STRESS_ENABLED && (
                  <>
                    <th className={`${cell} text-center`} colSpan={2}>Stress</th>
                    <th className={`${cell} text-center`} colSpan={2}>Pitch</th>
                  </>
                )}
                {linking && <th className={cell} rowSpan={2}>Linking</th>}
                <th className={cell} rowSpan={2}>Score</th>
                <th className={cell} rowSpan={2}>Feedback</th>
              </tr>
              <tr className="text-gray-500 text-xs">
                <th className={cell}>Reference</th>
                <th className={cell}>Yours</th>
                {LEGACY_STRESS_ENABLED && (
                  <>
                    <th className={cell}>Reference</th>
                    <th className={cell}>Yours</th>
                    <th className={cell}>Reference</th>
                    <th className={cell}>Yours</th>
                  </>
                )}
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
                    {LEGACY_STRESS_ENABLED && (
                      <>
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
                      </>
                    )}
                    {linking && <td className={cell}>{w.linking_to_next_word ?? '–'}</td>}
                    <td className={cell}>{pct(w.pronunciation_score_pct)}</td>
                    <td className={cell}>
                      {w.feedback}
                      {LEGACY_STRESS_ENABLED &&
                        st?.diagnostic_feedback?.map((m, j) => (
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
          Settings:{' '}
          {ws ? (
            <>
              stress words: {ws.stress_words.join(', ')}
              {s.stress_match_pct != null && <> · stress contrast {ratio(ws.contrast_ratio)}</>}
              {ws.melody_min_similarity != null && <> · melody match {ratio(ws.melody_min_similarity)}</>}
              {ws.stress_source && <> · stress pattern from {ws.stress_source === 'dictionary' ? 'CMU dictionary' : 'reference audio'}</>}
            </>
          ) : (
            'word stress not checked'
          )}{' '}
          ·{' '}
          {LEGACY_STRESS_ENABLED && <>falling {ratio(s.fall_match_ratio)} · </>}
          {RISING_TONE_ENABLED && <>rising {ratio(s.rise_match_ratio)} · </>}
          {linking ? (
            <>
              strict linking{s.strict_connected_speech == null ? ' –' : ' on'} · linking tolerance{' '}
              {s.link_tolerance == null ? '–' : `${s.link_tolerance}×`}
            </>
          ) : (
            'linking not checked'
          )}
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

// ARPAbet letters in dark brown (the teacher's Sounds row).
const ARPABET_LETTERS = 'text-[#5C3A1E]';

// ARPAbet such as "B AE1 S K AH0 T B AO2 L": the letters dark brown, the primary-stress digit 1
// in bold dark green, the other digits as they are.
function ArpabetStress({ arpabet }: { arpabet: string }) {
  return (
    <>
      {arpabet.split(' ').map((ph, i) => {
        const m = ph.match(/^(.*?)(\d?)$/);
        const letters = m?.[1] ?? ph;
        const digit = m?.[2] ?? '';
        return (
          <Fragment key={i}>
            {i > 0 && ' '}
            <span className={ARPABET_LETTERS}>{letters}</span>
            {digit === '1' ? (
              <strong className="relative -top-0.5 ml-px inline-flex h-4 w-4 items-center justify-center rounded-full border border-green-700 bg-green-100 align-baseline text-[11px] leading-none text-green-800">
                1
              </strong>
            ) : (
              digit
            )}
          </Fragment>
        );
      })}
    </>
  );
}

// ✓ when the recording matches the reference on this item, ✗ when it doesn't.
function Verdict({ ok }: { ok: boolean | undefined }) {
  if (ok == null) return null;
  return ok ? <span className="text-green-700">✓</span> : <span className="text-red-600">✗</span>;
}

const cell = 'border-b border-gray-200 px-2 py-1 align-top';
