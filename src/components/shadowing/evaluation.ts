// The reply of VoiceAnalyzer_Claude's POST /api/evaluate (relayed by Django's
// /api/shadowing/assess/), and the defaults of its pitch thresholds.
// Copied from p2p-voice-chat-admin (src/evaluator1.ts).

// How close to the reference the student's pitch must come, as a fraction of
// the reference's movement. Lower = more lenient. The service's defaults:
// falling = how far an unstressed syllable drops (e.g. "-ther" in "mother"),
// rising = how far the voice rises at the end of a Yes/No question.
export const DEFAULT_FALL_MATCH_RATIO = 0.75;
export const DEFAULT_RISE_MATCH_RATIO = 0.5;

// Linking (connected speech) has no tolerance setting any more: the analyzer's link checker uses
// its own fixed limits, on the student's recording only (link_tolerance in older results is shown
// as it was).

// Word Syllables Stress Check: how much of the reference's contrast between the stressed
// syllable and the unstressed ones (within the word) the student must reach. Lower = more lenient.
export const DEFAULT_STRESS_CONTRAST_RATIO = 0.6;
// Melody of each stress word: the shape similarity needed for "Same melody" (0.1-0.9; higher = stricter).
export const DEFAULT_MELODY_MIN_SIMILARITY = 0.35;
// Which syllable should be stressed: from the CMU dictionary (the reference audio as fallback) or
// from the reference audio.
export type StressSource = 'dictionary' | 'reference';
export const DEFAULT_STRESS_SOURCE: StressSource = 'dictionary';

// Checks that are paused in the service (their code is kept). The sentence-level rising
// tone (end of a Yes/No question) spans words; the older Falling tone and the sentence-wide
// stress display are replaced by the Word Syllables Stress Check.
export const RISING_TONE_ENABLED = false;
export const LEGACY_STRESS_ENABLED = false;

// The parts of the reply shown here (the full reply is kept as is).
export interface EvaluationWord {
  word: string;
  expected_phonemes: string;
  heard_phonemes: string;
  heard_ipa: string;
  linking_to_next_word: string | null; // e.g. "Linked (is_a)"
  pronunciation_score_pct: number;
  status: string; // e.g. "Clear"
  feedback: string;
}
// Pitch coaching for one syllable of a word.
export interface SyllableCoaching {
  syllable_index: number;
  action: string; // "match", "lower_pitch", "raise_pitch"
  badge: string; // e.g. "✓ Good", "↓ Lower pitch", "↑ Raise pitch"
  message: string;
}
export interface StressComparison {
  word: string;
  reference_pitch_contour?: string; // e.g. "High → Low"
  recorded_pitch_coaching?: string; // e.g. "S1: ✓ Good | S2: ↓ Lower pitch"
  syllable_coaching?: SyllableCoaching[];
  benchmark_stress: string; // per syllable, e.g. "3-0"
  recorded_stress: string;
  stress_matched: boolean;
  diagnostic_feedback?: string[];
}
// Rising intonation at the end of the sentence (Yes/No questions). Checked only
// when the reference rises; otherwise applicable is false.
export interface IntonationEvaluation {
  applicable: boolean;
  action: string; // "match", "raise_pitch", "raise_more", "not_applicable"
  badge: string; // e.g. "✓ Rising", "↑ Raise your voice at the end"
  message: string;
  score_pct: number | null;
  reference_rise_semitones: number | null;
  recorded_rise_semitones: number | null;
  required_rise_semitones: number | null;
}
// Pitch melody of a stress word (every syllable whose pitch can be trusted): the reference's and
// the student's pitch curves (semitones from each speaker's own stressed syllable, so voice range
// doesn't matter) compared by shape. Reported next to the stress result, not scored into it.
// Syllables whose pitch can't be trusted (too short, too little voicing, too quiet) are left out.
export interface PitchDirection {
  method?: string; // "contour"
  status: string; // "match", "mismatch", "not_judged"
  badge: string; // e.g. "✓ Same melody", "↑ Let it rise", "↓ Let it fall", "〰 Follow the melody"
  message: string;
  score_pct: number | null; // the similarity as a percentage (0 when the shapes go opposite ways)
  correlation?: number | null; // shape similarity, -1 to 1 (passes at the teacher's Melody match, default 0.35)
  reference_range_st?: number | null;
  recorded_range_st?: number | null;
  points_per_syllable?: number;
  reference_contour?: number[]; // semitones, points_per_syllable points per kept syllable
  recorded_contour?: number[];
  contour_syllables?: number[]; // the syllable number of each block of points
  // For the chart: every syllable in order, points_per_syllable points each, null where that side
  // has no reliable pitch (display only; the score uses the fields above).
  full_reference_contour?: (number | null)[];
  full_recorded_contour?: (number | null)[];
  full_contour_syllables?: number[];
  syllables: {
    syllable_index: number; // 1-based
    stressed?: boolean;
    judged: boolean; // false = left out (see reason)
    reason?: string | null; // e.g. "your recording: too little voicing (26%)"
    measured?: string; // "within the stressed syllable", "compared with the stressed syllable" (after it) or "into the stressed syllable" (before it)
    reference_semitones?: number; // signed: + = up, - = down
    recorded_semitones?: number;
    reference_direction?: string; // "rise", "fall", "level"
    recorded_direction?: string;
    matched?: boolean | null;
  }[];
}
// A stress word's IPA split into syllables, display only (added by the analyzer to every stress
// word, see its stress_word_syllables): from the IPA the teacher typed (source "ipa"), else the
// CMU dictionary in US IPA ("cmu"), else nothing (source null). matches_cmu false: the analyzer
// measured cmu_syllable_count syllables, so these don't line up with the stress pattern.
export interface Syllabified {
  source: 'ipa' | 'cmu' | null;
  ipa: string | null; // the IPA the teacher typed for the word
  syllabified: string | null; // e.g. "ə-ˈpɒ-lə-dʒi"
  syllable_count: number | null;
  // viet: the syllable's part of the Vietnamese code (only when viet_matches_ipa)
  syllables: { text: string; stress: 'primary' | 'secondary' | null; viet?: string }[];
  cmu_syllable_count: number | null;
  matches_cmu: boolean | null;
  // The Vietnamese pronunciation code (e.g. "ơ-pô-lơ-di"): the one the teacher typed (viet_source
  // "client"), else made from the CMU dictionary ("cmu"); its parts one per IPA syllable when
  // viet_matches_ipa, else split at every hyphen (null: no code or no syllables). Missing on
  // results from before the field existed.
  viet?: string | null;
  viet_source?: 'client' | 'cmu' | null;
  viet_syllables?: string[];
  viet_matches_ipa?: boolean | null;
}
// Word Syllables Stress Check: one checked word (see the service's evaluate_word_syllable_stress).
export interface WordStress {
  word: string;
  word_index?: number | null; // position in the sentence; null when the word isn't in it
  syllable_count?: number;
  // The syllable the student should stress (1-based) and its pattern, and where that came from:
  // "dictionary" (CMU) or "reference" (the reference audio; in dictionary mode, see the reason).
  // Missing on results scored before the stress source option (the reference decided then).
  expected_stressed_syllable?: number | null;
  expected_pattern?: string | null;
  stress_source?: 'dictionary' | 'reference' | null;
  stress_source_reason?: string | null; // e.g. "end of a Yes/No question"
  reference_stressed_syllable?: number | null; // 1-based, what the reference audio stressed (measured)
  recorded_stressed_syllable?: number | null;
  reference_pattern?: string | null; // e.g. "○ ●" (● = stressed)
  recorded_pattern?: string | null;
  right_syllable?: boolean | null;
  // The syllables as spelled, from the dictionary (added by Django), e.g. ["bas", "ket", "ball"];
  // null when the dictionary's split doesn't have as many syllables as the analyzer found.
  hyphenated?: string[] | null;
  syllabified?: Syllabified; // the word's IPA in syllables (missing on older results)
  weakest_contrast_pct?: number | null; // the student's weakest unstressed syllable, % of the reference's contrast
  // "measured" (stress isn't scored any more: no verdict, badge "—", score_pct null), "not_heard",
  // "not_measured", "single_syllable", "not_in_sentence"; older results: "pass", "weak_contrast", "wrong_syllable"
  status: string;
  badge: string; // e.g. "✓ Good stress", "↕ More contrast", "✗ Wrong syllable"
  message: string;
  score_pct: number | null;
  pitch_direction?: PitchDirection; // only for words that were measured
}
export interface WordStressCheck {
  enabled: boolean; // false when no stress words were given
  stress_words: string[];
  contrast_ratio: number;
  melody_min_similarity?: number; // the similarity needed for "Same melody" (missing on older results)
  stress_source?: 'dictionary' | 'reference'; // the teacher's choice (missing on older results)
  score_pct: number | null;
  pitch_direction_score_pct?: number | null; // not part of score_pct or the overall score
  words: WordStress[];
}
export interface EvaluationResult {
  status: string;
  summary: {
    spoken_text: string;
    targeted_words: string[];
    strict_connected_speech?: boolean;
    fall_match_ratio?: number;
    rise_match_ratio?: number;
    link_tolerance?: number;
    stress_words?: string[];
    stress_contrast_ratio?: number;
    melody_min_similarity?: number; // the similarity needed for "Same melody"
    stress_source?: 'dictionary' | 'reference';
    overall_score_pct: number;
    pronunciation_score_pct: number;
    stress_match_pct: number | null; // the Word Syllables Stress Check score (null when no stress words)
    intonation_score_pct?: number | null; // null when the check doesn't apply
    connected_speech_summary: string; // e.g. "1 / 1 targeted links linked"
    // Targeted words whose link can't be checked (missing on older results).
    targeted_word_warnings?: { word: string; problem: 'not_in_sentence' | 'last_word'; message: string }[];
    heard_transcript: string;
    reference_coaching_summary?: string; // e.g. "MY[Low] MOTHER[High → Low] …"
    recorded_coaching_summary?: string; // e.g. "MY[✓ Good] MOTHER[S1: ✓ Good | S2: ↓ Lower pitch] …"
    benchmark_stress_pattern: string; // e.g. "MY[0] MOTHER[3-0] IS[0]"
    recorded_stress_pattern: string;
    recorded_timit_ipa: string;
  };
  stage2_alignment?: {
    word_match_vs_target_pct?: number;
    acoustic_confidence_pct?: number;
  };
  stage3_stress?: { stress_evaluation?: { word_comparisons?: StressComparison[] } };
  stage4_pronunciation?: { word_pronunciations?: EvaluationWord[] };
  word_stress_check?: WordStressCheck;
  // Added by Django: each word with its CMU dictionary ARPAbet and the dictionary's own stress
  // digits (1 = primary, 2 = secondary, 0 = unstressed); arpabet null if not in the dictionary.
  cmu_arpabet?: { word: string; arpabet: string | null }[];
  intonation?: IntonationEvaluation;
}


// A student's latest attempt, as Django keeps it for the teacher (and relays it in a
// "shadowing_result" ws message).
export interface ShadowingResult {
  user_name: string;
  shadowing_id: string;
  attempt: number; // 1 for the first try, then counts up
  take_id?: number | null; // the saved take (students_shadowing), to play the recording; missing on older results
  at: string; // ISO time
  evaluation: EvaluationResult;
}

// The "shadowing_prompt" ws message's content: what the students are asked to repeat.
export interface ShadowingPrompt {
  shadowing_id: string;
  sentence: string;
  // presigned S3 url of the reference (valid for an hour); null for a connected-speech-only
  // exercise sent without a reference voice (nothing to listen to)
  audio_url: string | null;
  stress_words?: string[]; // lower case: the words whose melody is checked
  connected_words?: string[]; // lower case: the targeted words, each should link to the next word
  helper_words?: Record<string, string>; // the teacher's Helper Words by targeted word, e.g. {have: "vờ"}
  // The Vietnamese pronunciation code of every word of the sentence, by word in lower case
  // (e.g. {turn: "t(h)ơ(r)n", it: "ít"}); words not in the CMU dictionary are missing.
  sentence_viet?: Record<string, string>;
  // The same codes ONE PER WORD POSITION, in sentence order (words are runs of letters and
  // apostrophes), with spaCy's part of speech: the same spelling can get two codes, e.g. "They
  // record (verb) the record (noun)". Preferred over sentence_viet when present.
  sentence_viet_words?: VietWord[];
}

// One word of sentence_viet_words: the word as written, spaCy's tag (e.g. "VERB"), its
// Vietnamese code (null when there's none), and where the code came from: the word's saved
// viet_pron_code in the dictionary, or made on the fly (not in the dictionary).
export interface VietWord {
  word: string;
  pos: string | null;
  code: string | null;
  from?: 'dictionary' | 'generated';
}

// The melody chart's syllable labels: the IPA syllables with their stress marks ("ə", "ˈpɒ",
// "lə", "dʒi") when there's one per syllable of `pattern`, else the spelled syllables (or the
// chart's numbers); and the Vietnamese code's parts to go on top of them (sub), when the analyzer
// matched them to the IPA syllables.
export function chartLabels(
  syllabified: Syllabified | undefined,
  hyphenated: string[] | null | undefined,
  pattern: string | null | undefined,
): { parts: string[] | null; sub: string[] | null } {
  const n = (pattern ?? '').trim().split(/\s+/).filter(Boolean).length;
  const mark = (stress: string | null) => (stress === 'primary' ? 'ˈ' : stress === 'secondary' ? 'ˌ' : '');
  const ipa = (syllabified?.syllables ?? []).map((x) => mark(x.stress) + x.text);
  const ipaFits = ipa.length > 1 && ipa.length === n;
  const viet = syllabified?.viet_syllables ?? [];
  return {
    parts: ipaFits ? ipa : fitParts(hyphenated, pattern),
    sub: ipaFits && syllabified?.viet_matches_ipa && viet.length === ipa.length ? viet : null,
  };
}

// The dictionary's syllables, used only when there's one per circle of the pattern.
export function fitParts(parts: string[] | null | undefined, pattern: string | null | undefined): string[] | null {
  const n = (pattern ?? '').trim().split(/\s+/).filter(Boolean).length;
  return parts && parts.length > 1 && parts.length === n ? parts : null;
}
