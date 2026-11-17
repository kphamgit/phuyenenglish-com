// The reply of VoiceAnalyzer_Claude's POST /api/evaluate (relayed by Django's
// /api/shadowing/assess/), and the defaults of its pitch thresholds.
// Copied from p2p-voice-chat-admin (src/evaluator1.ts).

// How close to the reference the student's pitch must come, as a fraction of
// the reference's movement. Lower = more lenient. The service's defaults:
// falling = how far an unstressed syllable drops (e.g. "-ther" in "mother"),
// rising = how far the voice rises at the end of a Yes/No question.
export const DEFAULT_FALL_MATCH_RATIO = 0.75;
export const DEFAULT_RISE_MATCH_RATIO = 0.5;

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
export interface EvaluationResult {
  status: string;
  summary: {
    spoken_text: string;
    targeted_words: string[];
    overall_score_pct: number;
    pronunciation_score_pct: number;
    stress_match_pct: number;
    intonation_score_pct?: number | null; // null when the check doesn't apply
    connected_speech_summary: string; // e.g. "1 / 1 native links matched"
    heard_transcript: string;
    reference_coaching_summary?: string; // e.g. "MY[Low] MOTHER[High → Low] …"
    recorded_coaching_summary?: string; // e.g. "MY[✓ Good] MOTHER[S1: ✓ Good | S2: ↓ Lower pitch] …"
    benchmark_stress_pattern: string; // e.g. "MY[0] MOTHER[3-0] IS[0]"
    recorded_stress_pattern: string;
    recorded_timit_ipa: string;
  };
  stage3_stress?: { stress_evaluation?: { word_comparisons?: StressComparison[] } };
  stage4_pronunciation?: { word_pronunciations?: EvaluationWord[] };
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
