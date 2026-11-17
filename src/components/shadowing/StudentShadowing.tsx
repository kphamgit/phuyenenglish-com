import { useCallback, useEffect, useRef, useState } from "react";
import chimeSound from "../../assets/chime.mp3";
import api from "../../api";
import { useWebSocket } from "../context/WebSocketContext";
import type { WebSocketMessageProps } from "../shared/types";
import { toWav16kMono } from "../shared/wav";
import type { EvaluationResult, ShadowingPrompt } from "./evaluation";

// Student side of Shadowing: when the teacher sends a reference ("shadowing_prompt" ws message),
// show the sentence and the reference to play, let the student record themselves repeating it,
// send the recording to Django (/api/shadowing/assess/, scored by VoiceAnalyzer_Claude with the
// teacher's options), and show the scores. The teacher gets the same result separately.
// Recording adapted from p2p-voice-chat-admin (ReferenceRecorder.tsx).

const pct = (n: number | null | undefined) => (n == null ? "–" : `${n}%`);

export default function StudentShadowing({ hidden = false }: { hidden?: boolean }) {
    const { eventEmitter } = useWebSocket();
    const [prompt, setPrompt] = useState<ShadowingPrompt | null>(null);

    const [recording, setRecording] = useState(false);
    const [converting, setConverting] = useState(false);
    const [take, setTake] = useState<{ wav: Blob; url: string } | null>(null);
    const [assessing, setAssessing] = useState(false);
    const [result, setResult] = useState<EvaluationResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Let go of the microphone (the browser's "recording" indicator goes away).
    const releaseMic = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    }, []);

    // Stop a recording in progress without keeping it.
    const discardRecording = useCallback(() => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") {
            recorder.onstop = null;
            recorder.stop();
        }
        releaseMic();
        setRecording(false);
    }, [releaseMic]);

    useEffect(() => {
        const handleMessage = (data: WebSocketMessageProps) => {
            if (data.message_type !== "shadowing_prompt") return;
            discardRecording();
            setPrompt(data.content as ShadowingPrompt);
            setTake(null);
            setResult(null);
            setError(null);
            new Audio(chimeSound).play().catch(() => {});
        };
        eventEmitter?.on("message", handleMessage);
        return () => {
            eventEmitter?.off("message", handleMessage);
        };
    }, [eventEmitter, discardRecording]);

    // Leaving the page mid-recording: stop without keeping anything.
    useEffect(() => () => discardRecording(), [discardRecording]);

    const record = async () => {
        setError(null);
        let stream: MediaStream;
        try {
            // The raw microphone sound, without the browser's voice-call processing (it flattens
            // the loudness differences word stress is judged by, and can clip consonants).
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
            });
        } catch (err) {
            setError(
                err instanceof DOMException && err.name === "NotAllowedError"
                    ? "Microphone access was blocked. Allow it in the browser (the icon in the address bar) and try again."
                    : `Couldn't use the microphone: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
        }
        streamRef.current = stream;
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = async () => {
            releaseMic();
            setRecording(false);
            setConverting(true);
            try {
                const wav = await toWav16kMono(new Blob(chunks, { type: recorder.mimeType }));
                setTake({ wav, url: URL.createObjectURL(wav) });
                setResult(null);
            } catch (err) {
                setError(`Converting the recording failed: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                setConverting(false);
            }
        };
        recorderRef.current = recorder;
        recorder.start();
        setRecording(true);
    };

    const stop = () => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") recorder.stop(); // onstop converts it
    };

    const submit = async () => {
        if (!prompt || !take || assessing) return;
        setAssessing(true);
        setError(null);
        try {
            const form = new FormData();
            form.append("shadowing_id", prompt.shadowing_id);
            form.append("recorded_file", take.wav, "recording.wav");
            const res = await api.post("/api/shadowing/assess/", form);
            setResult(res.data as EvaluationResult);
        } catch (err) {
            console.error("StudentShadowing: assessment failed:", err);
            const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            setError(message ?? "Scoring your recording failed. Please try again.");
        } finally {
            setAssessing(false);
        }
    };

    const dismiss = () => {
        discardRecording();
        setPrompt(null);
        setTake(null);
        setResult(null);
        setError(null);
    };

    if (!prompt || hidden) return null;

    return (
        <div className="flex flex-col items-center my-4">
            <div className="w-full max-w-2xl bg-teal-50 border-2 border-teal-400 rounded-lg shadow-lg p-6 flex flex-col gap-3">
                <p className="text-xs uppercase tracking-wide text-teal-700 font-semibold text-center">
                    Shadowing: listen, then repeat
                </p>
                <p className="text-2xl font-bold text-teal-900 leading-snug text-center">{prompt.sentence}</p>
                <audio src={prompt.audio_url} controls className="w-full" />

                <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                        onClick={() => void record()}
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

// The scores in a student-friendly form: the main scores, the sentence with each word green
// (clear) or red, tips for the words to work on, and the rising-tone advice when it applies.
function StudentResult({ result: r }: { result: EvaluationResult }) {
    const s = r.summary;
    const words = r.stage4_pronunciation?.word_pronunciations ?? [];
    const toWorkOn = words.filter((w) => w.status !== "Clear");
    const into = r.intonation?.applicable ? r.intonation : undefined;
    const scores: [string, number | null | undefined][] = [
        ["Pronunciation", s.pronunciation_score_pct],
        ["Stress", s.stress_match_pct],
        ...(into ? [["Intonation", into.score_pct] as [string, number | null]] : []),
    ];

    return (
        <div className="flex flex-col gap-3 bg-white rounded-md border border-teal-300 p-4">
            <div className="flex flex-wrap items-baseline justify-center gap-x-6 gap-y-1">
                <span className="text-lg">
                    Overall: <strong className="text-3xl text-teal-800">{pct(s.overall_score_pct)}</strong>
                </span>
                {scores.map(([label, value]) => (
                    <span key={label}>
                        {label}: <strong>{pct(value)}</strong>
                    </span>
                ))}
            </div>
            <p className="text-xl leading-relaxed text-center">
                {words.map((w, i) => (
                    <span key={i}>
                        {i > 0 && " "}
                        <span
                            title={w.feedback}
                            className={`rounded px-1 font-semibold ${w.status === "Clear" ? "text-green-700" : "bg-red-50 text-red-600"}`}
                        >
                            {w.word}
                        </span>
                    </span>
                ))}
            </p>
            {into && (
                <p className={`rounded px-2 py-1 text-sm ${into.action === "match" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                    <strong>{into.badge}</strong> {into.message}
                </p>
            )}
            {toWorkOn.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                    {toWorkOn.map((w, i) => (
                        <li key={i}>
                            <strong className="text-red-600">{w.word}</strong>: {w.feedback}
                        </li>
                    ))}
                </ul>
            )}
            <p className="text-sm text-gray-600">
                We heard: <span className="italic">{s.heard_transcript}</span>
            </p>
        </div>
    );
}
