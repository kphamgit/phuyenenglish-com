// The reply of VoiceAnalyzer_Claude's POST /api/evaluate (relayed by Django's
// /api/shadowing/assess/), and the defaults of its pitch thresholds.
// Copied from p2p-voice-chat-admin (src/evaluator1.ts).

// How close to the reference the student's pitch must come, as a fraction of
// the reference's movement. Lower = more lenient. The service's defaults:
// falling = how far an unstressed syllable drops (e.g. "-ther" in "mother"),
// rising = how far the voice rises at the end of a Yes/No question.
export const DEFAULT_FALL_MATCH_RATIO = 0.75;
export const DEFAULT_RISE_MATCH_RATIO = 0.5;

// Linking (connected speech) tolerance: a multiplier on how much longer a pause or gap
// between two linked words may be than in the reference (and how much deeper the dip in
// loudness). Higher = more lenient; 1 = the service's original limits.
export const DEFAULT_LINK_TOLERANCE = 1;
export const LINK_PAUSE_MARGIN_MS = 25; // the extra pause allowed at 1×

// Word Syllables Stress Check: how much of the reference's contrast between the stressed
// syllable and the unstressed ones (within the word) the student must reach. Lower = more lenient.
export const DEFAULT_STRESS_CONTRAST_RATIO = 0.6;
// Melody of each stress word: the shape similarity needed for "Same melody" (0.1-0.9; higher = stricter).
export const DEFAULT_MELODY_MIN_SIMILARITY = 0.35;

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
// Word Syllables Stress Check: one checked word (see the service's evaluate_word_syllable_stress).
export interface WordStress {
  word: string;
  syllable_count?: number;
  reference_stressed_syllable?: number | null; // 1-based
  recorded_stressed_syllable?: number | null;
  reference_pattern?: string | null; // e.g. "○ ●" (● = stressed)
  recorded_pattern?: string | null;
  right_syllable?: boolean | null;
  // The syllables as spelled, from the dictionary (added by Django), e.g. ["bas", "ket", "ball"];
  // null when the dictionary's split doesn't have as many syllables as the analyzer found.
  hyphenated?: string[] | null;
  weakest_contrast_pct?: number | null; // the student's weakest unstressed syllable, % of the reference's contrast
  // "pass", "weak_contrast", "wrong_syllable", "not_heard", "not_measured", "single_syllable", "not_in_sentence"
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
    overall_score_pct: number;
    pronunciation_score_pct: number;
    stress_match_pct: number | null; // the Word Syllables Stress Check score (null when no stress words)
    intonation_score_pct?: number | null; // null when the check doesn't apply
    connected_speech_summary: string; // e.g. "1 / 1 native links matched"
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
  intonation?: IntonationEvaluation;
}


// A student's latest attempt, as Django keeps it for the teacher (and relays it in a
// "shadowing_result" ws message).
export interface ShadowingResult {
  user_name: string;
  shadowing_id: string;
  attempt: number; // 1 for the first try, then counts up
  at: string; // ISO time
  evaluation: EvaluationResult;
}

// The "shadowing_prompt" ws message's content: what the students are asked to repeat.
export interface ShadowingPrompt {
  shadowing_id: string;
  sentence: string;
  audio_url: string; // presigned S3 url of the reference (valid for an hour)
}
