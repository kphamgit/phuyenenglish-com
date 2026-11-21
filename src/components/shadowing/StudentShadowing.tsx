import { useEffect, useState } from "react";
import chimeSound from "../../assets/chime.mp3";
import api from "../../api";
import { useWebSocket } from "../context/WebSocketContext";
import type { WebSocketMessageProps } from "../shared/types";
import { EvaluationView } from "./EvaluationView";
import type { EvaluationResult, ShadowingPrompt } from "./evaluation";
import { useRecorder } from "./useRecorder";

// Student side of Shadowing: when the teacher sends a reference ("shadowing_prompt" ws message),
// show the sentence and the reference to play, let the student record themselves repeating it,
// send the recording to Django (/api/shadowing/assess/, scored by VoiceAnalyzer_Claude with the
// teacher's options), and show the result. The teacher gets the same result separately.

export default function StudentShadowing({ hidden = false }: { hidden?: boolean }) {
    const { eventEmitter } = useWebSocket();
    const [prompt, setPrompt] = useState<ShadowingPrompt | null>(null);

    const { recording, converting, take, error: recorderError, record: startRecording, stop, reset } = useRecorder();
    const [assessing, setAssessing] = useState(false);
    const [result, setResult] = useState<EvaluationResult | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const error = recorderError ?? submitError;

    useEffect(() => {
        const handleMessage = (data: WebSocketMessageProps) => {
            if (data.message_type !== "shadowing_prompt") return;
            reset();
            setPrompt(data.content as ShadowingPrompt);
            setResult(null);
            setSubmitError(null);
            new Audio(chimeSound).play().catch(() => {});
        };
        eventEmitter?.on("message", handleMessage);
        return () => {
            eventEmitter?.off("message", handleMessage);
        };
    }, [eventEmitter, reset]);

    // A new take replaces the scores of the previous one.
    const record = () => {
        setResult(null);
        setSubmitError(null);
        void startRecording();
    };

    const submit = async () => {
        if (!prompt || !take || assessing) return;
        setAssessing(true);
        setSubmitError(null);
        try {
            const form = new FormData();
            form.append("shadowing_id", prompt.shadowing_id);
            form.append("recorded_file", take.wav, "recording.wav");
            const res = await api.post("/api/shadowing/assess/", form);
            setResult(res.data as EvaluationResult);
        } catch (err) {
            console.error("StudentShadowing: assessment failed:", err);
            const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            setSubmitError(message ?? "Scoring your recording failed. Please try again.");
        } finally {
            setAssessing(false);
        }
    };

    const dismiss = () => {
        reset();
        setPrompt(null);
        setResult(null);
        setSubmitError(null);
    };

    if (!prompt || hidden) return null;

    return (
        <div className="flex flex-col items-center my-4">
            <div className="w-full max-w-4xl bg-teal-50 border-2 border-teal-400 rounded-lg shadow-lg p-6 flex flex-col gap-3">
                <p className="text-xs uppercase tracking-wide text-teal-700 font-semibold text-center">
                    Shadowing: listen, then repeat
                </p>
                <p className="text-2xl font-bold text-teal-900 leading-snug text-center">{prompt.sentence}</p>
                <audio src={prompt.audio_url} controls className="w-full" />

                <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                        onClick={record}
                        disabled={recording || converting || assessing}
                        className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                    >
                        {take ? "Record again" : "Record"}
                    </button>
                    <button
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
                    <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-3 text-sm text-gray-700">
                            Your recording
                            <audio key={take.url} src={take.url} controls className="min-w-0 flex-1" />
                        </label>
                        <button
                            onClick={() => void submit()}
                            disabled={assessing}
                            className="self-center px-5 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
                        >
                            {assessing ? "Scoring… (this can take a few seconds)" : "Submit"}
                        </button>
                    </div>
                )}

                {error && <p className="text-red-600 text-center" role="alert">⚠️ {error}</p>}
                {result && <StudentResult result={result} />}

                <button
                    onClick={dismiss}
                    className="self-center mt-1 px-4 py-1 rounded-md bg-gray-600 hover:bg-gray-800 text-white text-sm"
                >
                    Dismiss
                </button>
            </div>
        </div>
    );
}

// The student's result: the whole sentence (reference vs. the recording) and the melody of each
// stress word (EvaluationView's student mode; the stress check is shown to the teacher only).
function StudentResult({ result: r }: { result: EvaluationResult }) {
    return (
        <div className="overflow-x-auto rounded-md border border-teal-300 bg-white p-4 text-sm">
            <EvaluationView result={r} student />
        </div>
    );
}
