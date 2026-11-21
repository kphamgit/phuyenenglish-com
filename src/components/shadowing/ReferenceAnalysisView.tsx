// What VoiceAnalyzer_Claude measures in the reference audio alone for one stress word
// (POST /api/analyze-reference, through Django's /api/shadowing/analyze_reference/), shown
// under the word's field in the teacher's Scoring options ("Analyze reference audio").

import { ContourChart, Spelled, StressPattern } from "./EvaluationView";

export interface ReferenceSyllable {
    syllable_index: number;
    pitch_hz: number;
    intensity_db: number;
    duration_sec: number;
    prominence: number;
    level: string; // "High" / "Low"
    contrast: number | null; // from the expected stressed syllable (null for that syllable)
}

export interface ReferenceMelody {
    status: "measured" | "flat" | "not_measured";
    anchor_syllable: number;
    range_st: number | null;
    contour: number[]; // semitones from the stressed syllable, points_per_syllable per kept syllable
    contour_syllables: number[]; // the syllable number of each block of points
    full_contour?: (number | null)[]; // every syllable, null where it has no reliable pitch (chart only)
    full_contour_syllables?: number[];
    points_per_syllable: number;
    message: string;
}

export interface ReferenceWordAnalysis {
    word: string;
    status: "measured" | "single_syllable" | "not_measured" | "not_in_sentence";
    message: string;
    syllable_count?: number;
    reference_stressed_syllable?: number | null;
    reference_pattern?: string | null; // e.g. "○ ●"
    dictionary_stressed_syllable?: number | null;
    dictionary_pattern?: string | null;
    dictionary_reason?: string | null; // why the reference decides in dictionary mode
    stress_source?: "dictionary" | "reference" | null; // what an assessment would use
    expected_stressed_syllable?: number | null;
    expected_pattern?: string | null;
    syllables?: ReferenceSyllable[];
    melody?: ReferenceMelody | null;
    hyphenated?: string[] | null; // the syllables as spelled (added by Django), e.g. ["a", "pol", "o", "gy"]
}

export interface ReferenceAnalysis {
    status: string;
    reference_stress_pattern: string;
    stress_source: "dictionary" | "reference";
    words: ReferenceWordAnalysis[];
}

export function ReferenceAnalysisView({ analysis: a }: { analysis: ReferenceWordAnalysis }) {
    if (a.status !== "measured") {
        return <p className="text-sm text-amber-700">{a.message}</p>;
    }
    const disagree =
        a.dictionary_stressed_syllable != null && a.dictionary_stressed_syllable !== a.reference_stressed_syllable;
    const used = a.stress_source === "dictionary" ? "the dictionary's" : "the reference audio's";
    // Syllables are named by their spelling (“pol”), as in the students' results; by number
    // only when the dictionary's split doesn't fit.
    const parts = a.hyphenated && a.hyphenated.length === a.syllable_count ? a.hyphenated : null;
    const name = (n: number | null | undefined) =>
        n != null && parts?.[n - 1] ? `“${parts[n - 1]}”` : `the ${_ordinal(n)} syllable`;
    return (
        <div className="flex flex-col gap-1 rounded-md border border-gray-300 bg-white p-2 text-sm">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
                <div>
                    <span className="text-gray-600">Reference audio:</span>{" "}
                    <StressPattern pattern={a.reference_pattern} tone={disagree ? "amber" : "green"} />
                    {parts && <Spelled parts={parts} stressed={a.reference_stressed_syllable} />}
                </div>
                <div>
                    <span className="text-gray-600">Dictionary:</span>{" "}
                    {a.dictionary_stressed_syllable != null ? (
                        <>
                            <StressPattern pattern={a.dictionary_pattern} tone="green" />
                            {parts && <Spelled parts={parts} stressed={a.dictionary_stressed_syllable} />}
                        </>
                    ) : (
                        <span className="text-gray-600">can't decide ({a.dictionary_reason})</span>
                    )}
                </div>
            </div>
            {disagree && (
                <p className="text-amber-700">
                    The reference audio stresses {name(a.reference_stressed_syllable)}, but the dictionary stresses{" "}
                    {name(a.dictionary_stressed_syllable)}. With the current option, students are expected to stress{" "}
                    {used} choice: {name(a.expected_stressed_syllable)}.
                </p>
            )}
            {a.syllables && a.syllables.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs">
                    {a.syllables.map((s) => (
                        <span
                            key={s.syllable_index}
                            title={`${Math.round(s.pitch_hz)} Hz · ${s.intensity_db} dB · ${s.duration_sec} s · prominence ${s.prominence}`}
                            className={`rounded px-1.5 py-0.5 ${
                                s.syllable_index === a.reference_stressed_syllable
                                    ? "bg-blue-100 text-blue-900"
                                    : "bg-gray-100 text-gray-700"
                            }`}
                        >
                            {parts ? parts[s.syllable_index - 1] : _ordinal(s.syllable_index)}: {s.level}
                        </span>
                    ))}
                </div>
            )}
            {a.melody && (
                <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                    {/* The same chart as the students' results, with the reference's curve only. */}
                    {a.melody.contour.length > 1 && (
                        <ContourChart
                            reference={a.melody.full_contour?.length ? a.melody.full_contour : a.melody.contour}
                            perSyllable={a.melody.points_per_syllable}
                            syllables={a.melody.full_contour?.length ? a.melody.full_contour_syllables ?? [] : a.melody.contour_syllables}
                            parts={parts}
                        />
                    )}
                    <div className="min-w-48 flex-1">
                        <span className="text-gray-600">Melody{a.melody.status === "flat" ? " (flat)" : ""}:</span>{" "}
                        {parts ? spellSyllables(a.melody.message, parts) : a.melody.message}
                        {a.melody.status === "measured" && a.melody.contour.length > 1 && (
                            <div className="text-xs text-gray-500">
                                Pitch of the reference, from the stressed{" "}
                                {parts ? name(a.melody.anchor_syllable) : `${_ordinal(a.melody.anchor_syllable)} syllable`}
                                (dashed line, as in the students' results).
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function _ordinal(n: number | null | undefined): string {
    if (n == null) return "?";
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
    return `${n}${suffix}`;
}

// The analyzer's melody message names syllables by number ("from the 1st syllable"); this puts
// their spelling in instead ("from “a”").
function spellSyllables(message: string, parts: string[]): string {
    return message.replace(/\bthe (\d+)(?:st|nd|rd|th) syllable\b/g, (whole, n: string) => {
        const part = parts[Number(n) - 1];
        return part ? `“${part}”` : whole;
    });
}
