import { useRef, useState } from "react";
import api from "../../api";
import { EvaluationView } from "./EvaluationView";
import { TargetedSentence } from "./TargetedSentence";
import type { EvaluationResult, ShadowingPrompt } from "./evaluation";
import { useRecorder } from "./useRecorder";

// Student side of Shadowing: the exercise the teacher sent (HomeStudent receives the
// "shadowing_prompt" ws message, keeps it and passes it here, keyed by its shadowing_id so a new
// exercise starts clean). Shows the sentence and the reference to play, lets the student record
// themselves repeating it, sends the recording to Django (/api/shadowing/assess/, scored by
// VoiceAnalyzer_Claude with the teacher's options), and shows the result in the exercise's place.
// The teacher gets the same result separately.

// Shown under the sentence when it has links, in place of "Connected words: link them smoothly:" and
// the list of linked pairs (the arches in the sentence show them).
const CONNECTED_NOTE =
    "Các âm nối như : zờ, chờ, chìz, zìz, zo/za.., không phát âm rõ và mạnh như tiếng Việt mà phát âm nhẹ nhàng, lướt qua chữ sau.";

export default function StudentShadowing({ prompt, hidden = false }: { prompt: ShadowingPrompt | null; hidden?: boolean }) {
    const { recording, converting, take, error: recorderError, record: startRecording, stop, reset } = useRecorder();
    const [assessing, setAssessing] = useState(false);
    const [result, setResult] = useState<EvaluationResult | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const error = recorderError ?? submitError;

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

    // Retry: clears the recording and its score, so the student records a new take.
    const retry = () => {
        reset();
        setResult(null);
        setSubmitError(null);
    };

    if (!prompt || hidden) return null;

    // Once scored, the result takes the exercise's place; Retry brings the exercise back.
    if (result) {
        return (
            <div className="flex flex-col items-center my-4">
                <div className="w-full max-w-4xl bg-teal-50 border-2 border-teal-400 rounded-lg shadow-lg p-6 flex flex-col gap-3">
                    <p className="text-xs uppercase tracking-wide text-teal-700 font-semibold text-center">
                        Shadowing: your result
                    </p>
                    <StudentResult result={result} />
                    {take && (
                        <label className="flex items-center gap-3 text-sm text-gray-700">
                            Your recording
                            <audio key={take.url} src={take.url} controls className="min-w-0 flex-1" />
                        </label>
                    )}
                    <button
                        onClick={retry}
                        className="self-center px-5 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center my-4">
            <div className="w-full max-w-4xl bg-teal-50 border-2 border-teal-400 rounded-lg shadow-lg p-6 flex flex-col gap-3">
                <p className="text-xs uppercase tracking-wide text-teal-700 font-semibold text-center">
                    {prompt.audio_url ? "Shadowing: listen, then repeat" : "Shadowing: say the sentence"}
                </p>
                {/* No reference voice for a connected-speech-only exercise. */}
                {prompt.audio_url && <ReferencePlayButton src={prompt.audio_url} />}
                <TargetedSentence
                    sentence={prompt.sentence}
                    stressWords={prompt.stress_words}
                    connectedWords={prompt.connected_words}
                    helperWords={prompt.helper_words}
                    sentenceViet={prompt.sentence_viet}
                    sentenceVietWords={prompt.sentence_viet_words}
                    connectedNote={CONNECTED_NOTE}
                    className="text-xl font-bold text-teal-900 leading-loose text-center"
                />

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

            </div>
        </div>
    );
}

// The reference audio as a single round Play button (no control bar). Each click plays it from
// the start; while it plays, the button pulses.
function ReferencePlayButton({ src }: { src: string }) {
    const audio = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const play = () => {
        const el = audio.current;
        if (!el) return;
        el.currentTime = 0;
        el.play().catch((err) => console.error("StudentShadowing: playing the reference failed:", err));
    };
    return (
        <div className="flex justify-center">
            <audio
                ref={audio}
                src={src}
                preload="auto"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
            />
            <button
                onClick={play}
                aria-label="Play the sentence"
                title="Play the sentence"
                className={`flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-white shadow-md hover:bg-teal-700 ${playing ? "animate-pulse" : ""}`}
            >
                {/* A triangle, nudged right so it looks centred in the circle. */}
                <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5" fill="currentColor" aria-hidden>
                    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
                </svg>
            </button>
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
