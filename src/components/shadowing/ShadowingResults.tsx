import { Fragment, useEffect, useState } from "react";
import api from "../../api";
import { useWebSocket } from "../context/WebSocketContext";
import type { WebSocketMessageProps } from "../shared/types";
import { EvaluationView } from "./EvaluationView";
import type { ShadowingResult } from "./evaluation";

// Teacher-only: each student's latest score for the current shadowing exercise. Loads the latest
// exercise and its results from Django (so a page refresh keeps them), then adds results live as
// "shadowing_result" ws messages arrive. Self-contained, so it can move elsewhere in the panel.

interface Exercise {
    shadowing_id: string;
    sentence: string;
    voice: string;
    sent_at: string;
    options: {
        targeted_words: string;
        strict_connected_speech: boolean;
        fall_match_ratio: number;
        rise_match_ratio: number;
    };
}

const pct = (n: number | null | undefined) => (n == null ? "–" : `${n}%`);

// `shadowingId`: the exercise just sent from this page; a new one reloads the list.
export default function ShadowingResults({ shadowingId }: { shadowingId?: string }) {
    const { eventEmitter } = useWebSocket();
    const [exercise, setExercise] = useState<Exercise | null>(null);
    // Latest result per student (any exercise; only the current exercise's are shown).
    const [results, setResults] = useState<Record<string, ShadowingResult>>({});
    const [openUser, setOpenUser] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.get("/api/shadowing/results/", { params: shadowingId ? { shadowing_id: shadowingId } : {} })
            .then((res) => {
                setExercise(res.data.exercise);
                setResults(Object.fromEntries((res.data.results as ShadowingResult[]).map((r) => [r.user_name, r])));
                setError(null);
            })
            .catch((err) => {
                console.error("ShadowingResults: loading results failed:", err);
                setError("Couldn't load the shadowing results.");
            });
    }, [shadowingId]);

    useEffect(() => {
        const handleMessage = (data: WebSocketMessageProps) => {
            if (data.message_type !== "shadowing_result") return;
            const result = data.content as ShadowingResult;
            setResults((prev) => ({ ...prev, [result.user_name]: result }));
        };
        eventEmitter?.on("message", handleMessage);
        return () => {
            eventEmitter?.off("message", handleMessage);
        };
    }, [eventEmitter]);

    const rows = Object.values(results)
        .filter((r) => r.shadowing_id === exercise?.shadowing_id)
        .sort((a, b) => a.user_name.localeCompare(b.user_name));

    return (
        <div className="flex flex-col gap-2 bg-white rounded-md p-3 border border-gray-300">
            <h4 className="font-bold">Student results</h4>
            {error && <p className="text-sm text-red-600">⚠️ {error}</p>}
            {!exercise ? (
                <p className="text-sm text-gray-600">No shadowing exercise sent yet (in the last 24 hours).</p>
            ) : (
                <>
                    <p className="text-sm text-gray-700">
                        “{exercise.sentence}” · sent {new Date(exercise.sent_at).toLocaleTimeString()}
                        {exercise.voice && <> · {exercise.voice}</>}
                        {exercise.options.targeted_words && <> · targeted: {exercise.options.targeted_words}</>}
                    </p>
                    {rows.length === 0 ? (
                        <p className="text-sm text-gray-600">No student has submitted yet.</p>
                    ) : (
                        <table className="w-full border-collapse text-sm text-left">
                            <thead>
                                <tr className="text-gray-500">
                                    <th className={cell}>Student</th>
                                    <th className={cell}>Overall</th>
                                    <th className={cell}>Pronunciation</th>
                                    <th className={cell}>Stress</th>
                                    <th className={cell}>Intonation</th>
                                    <th className={cell}>Linking</th>
                                    <th className={cell}>Heard</th>
                                    <th className={cell}>Attempts</th>
                                    <th className={cell}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const s = r.evaluation.summary;
                                    const open = openUser === r.user_name;
                                    return (
                                        <Fragment key={r.user_name}>
                                            <tr>
                                                <td className={`${cell} font-semibold`}>{r.user_name}</td>
                                                <td className={`${cell} font-bold`}>{pct(s.overall_score_pct)}</td>
                                                <td className={cell}>{pct(s.pronunciation_score_pct)}</td>
                                                <td className={cell}>{pct(s.stress_match_pct)}</td>
                                                <td className={cell}>{pct(s.intonation_score_pct)}</td>
                                                <td className={cell}>{s.connected_speech_summary}</td>
                                                <td className={`${cell} font-mono`}>{s.heard_transcript}</td>
                                                <td className={cell} title={`Last: ${new Date(r.at).toLocaleTimeString()}`}>{r.attempt}</td>
                                                <td className={cell}>
                                                    <button
                                                        onClick={() => setOpenUser(open ? null : r.user_name)}
                                                        className="text-blue-700 hover:underline whitespace-nowrap"
                                                    >
                                                        {open ? "Hide" : "Details"}
                                                    </button>
                                                </td>
                                            </tr>
                                            {open && (
                                                <tr>
                                                    <td colSpan={9} className="p-2 bg-gray-50">
                                                        <EvaluationView result={r.evaluation} />
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </>
            )}
        </div>
    );
}

const cell = "border-b border-gray-200 px-2 py-1 align-top";
