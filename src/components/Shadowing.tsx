import { useEffect, useState } from "react";
import api from "../api";
import { toWav16kMono, wavFileName } from "./shared/wav";
import { DEFAULT_FALL_MATCH_RATIO, DEFAULT_RISE_MATCH_RATIO } from "./shadowing/evaluation";
import ShadowingResults from "./shadowing/ShadowingResults";

// Teacher-only "Shadowing": generate a reference recording of a sentence with ElevenLabs
// (/api/eleven_lab_tts/) or Google TTS (/english/google_tts/), replay it, and save it as a
// 16 kHz mono WAV. Adapted from the reference part of the VoiceAnalyzer1 tab in
// p2p-voice-chat-admin (VoiceAnalyzerPanel.tsx).
// "Send to Students" (/api/shadowing/send/) shares the reference with the scoring options set
// here; each student records themselves repeating it and VoiceAnalyzer_Claude scores them.

type Provider = "elevenlabs" | "google";

// Speeds offered (1 is normal). Learners need slower speech, never faster; ElevenLabs only
// accepts 0.7 and up.
const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
const MIN_RATE: Record<Provider, number> = { elevenlabs: 0.7, google: 0.5 };
// Google's Chirp 3 HD en-US voices (as listed by the Google TTS API), sent as en-US-Chirp3-HD-<name>.
const CHIRP3_VOICES: { name: string; gender: "female" | "male" }[] = [
    { name: "Achernar", gender: "female" }, { name: "Achird", gender: "male" },
    { name: "Algenib", gender: "male" }, { name: "Algieba", gender: "male" },
    { name: "Alnilam", gender: "male" }, { name: "Aoede", gender: "female" },
    { name: "Autonoe", gender: "female" }, { name: "Callirrhoe", gender: "female" },
    { name: "Charon", gender: "male" }, { name: "Despina", gender: "female" },
    { name: "Enceladus", gender: "male" }, { name: "Erinome", gender: "female" },
    { name: "Fenrir", gender: "male" }, { name: "Gacrux", gender: "female" },
    { name: "Iapetus", gender: "male" }, { name: "Kore", gender: "female" },
    { name: "Laomedeia", gender: "female" }, { name: "Leda", gender: "female" },
    { name: "Orus", gender: "male" }, { name: "Puck", gender: "male" },
    { name: "Pulcherrima", gender: "female" }, { name: "Rasalgethi", gender: "male" },
    { name: "Sadachbia", gender: "male" }, { name: "Sadaltager", gender: "male" },
    { name: "Schedar", gender: "male" }, { name: "Sulafat", gender: "female" },
    { name: "Umbriel", gender: "male" }, { name: "Vindemiatrix", gender: "female" },
    { name: "Zephyr", gender: "female" }, { name: "Zubenelgenubi", gender: "male" },
];
const chirp3Id = (name: string) => `en-US-Chirp3-HD-${name}`;
const DEFAULT_VOICE: Record<Provider, string> = { elevenlabs: "River", google: chirp3Id("Charon") };

export default function Shadowing() {
    const [sentence, setSentence] = useState("");
    const [provider, setProvider] = useState<Provider>("elevenlabs");
    // Voice picked per provider, so switching back keeps the earlier choice.
    const [voices, setVoices] = useState<Record<Provider, string>>(DEFAULT_VOICE);
    const voice = voices[provider];
    const [chosenRate, setRate] = useState(0.8);
    const speeds = SPEEDS.filter((s) => s >= MIN_RATE[provider]);
    // A speed the provider doesn't offer (0.5 on ElevenLabs) becomes its slowest one.
    const rate = speeds.includes(chosenRate) ? chosenRate : speeds[0];

    // ElevenLabs voices (name + description) come from the backend's VOICES list.
    const [elevenVoices, setElevenVoices] = useState<{ name: string; description: string }[]>([]);
    const [voicesError, setVoicesError] = useState<string | null>(null);
    useEffect(() => {
        api.get("/api/eleven_lab_voices/")
            .then((res) => setElevenVoices(res.data.voices ?? []))
            .catch((err) => {
                console.error("Shadowing: loading ElevenLabs voices failed:", err);
                setVoicesError("Couldn't load the ElevenLabs voices.");
            });
    }, []);

    // The generated reference. Its object URL is replaced (and revoked) on the next generate.
    const [reference, setReference] = useState<{ blob: Blob; url: string; sentence: string; voice: string } | null>(null);
    const [generating, setGenerating] = useState(false);
    const [converting, setConverting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Scoring options, sent with the exercise (students can't change them).
    // Targeted words: word(s) that should link to the next word (e.g. "is" -> "is_a").
    const [targetedWords, setTargetedWords] = useState("");
    // Linking check (the service turns it on anyway when targeted words are given).
    const [strictConnectedSpeech, setStrictConnectedSpeech] = useState(true);
    // How much of the reference's falling / rising pitch the student must reach. Lower = more lenient.
    const [fallMatchRatio, setFallMatchRatio] = useState(DEFAULT_FALL_MATCH_RATIO);
    const [riseMatchRatio, setRiseMatchRatio] = useState(DEFAULT_RISE_MATCH_RATIO);

    // The exercise last sent from this page (reloads the results list).
    const [sentId, setSentId] = useState<string | undefined>(undefined);
    const [sending, setSending] = useState(false);

    const text = sentence.trim();
    // The reference must say the sentence that's typed now.
    const referenceReady = reference !== null && reference.sentence === text;

    const generate = async () => {
        if (!text || generating) return;
        setGenerating(true);
        setError(null);
        try {
            const res = provider === "elevenlabs"
                ? await api.post("/api/eleven_lab_tts/", { text, voice_name: voice, speed: rate }, { responseType: "blob" })
                : await api.get("/english/google_tts/", { params: { text, voice, rate }, responseType: "blob" });
            const blob = res.data as Blob;
            if (reference) URL.revokeObjectURL(reference.url);
            const tag = provider === "elevenlabs" ? "11L" : "GG";
            setReference({ blob, url: URL.createObjectURL(blob), sentence: text, voice: `${tag} ${voice.replace(/^en-US-Chirp3-HD-/, "")} · ${rate}×` });
        } catch (err) {
            console.error("Shadowing: text-to-speech failed:", err);
            // Errors come back as a JSON blob {error: "..."} (responseType is blob).
            const data = (err as { response?: { data?: unknown } }).response?.data;
            const message = data instanceof Blob
                ? await data.text().then((t) => { try { return JSON.parse(t).error as string | undefined; } catch { return undefined; } })
                : undefined;
            setError(message ? `Text-to-speech failed: ${message}` : "Text-to-speech failed.");
        } finally {
            setGenerating(false);
        }
    };

    // Saves the reference as a 16 kHz mono WAV (converted in the browser), named after its sentence.
    const downloadWav = async () => {
        if (!reference) return;
        setConverting(true);
        setError(null);
        try {
            const url = URL.createObjectURL(await toWav16kMono(reference.blob));
            const link = document.createElement("a");
            link.href = url;
            link.download = wavFileName(reference.sentence);
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            setError(`Converting to WAV failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setConverting(false);
        }
    };

    const sendToStudents = async () => {
        if (!reference || !referenceReady || sending) return;
        setSending(true);
        setError(null);
        try {
            const form = new FormData();
            form.append("reference_file", reference.blob, "reference.mp3");
            form.append("sentence", reference.sentence);
            form.append("voice", reference.voice);
            form.append("targeted_words", targetedWords.trim());
            form.append("strict_connected_speech", String(strictConnectedSpeech || targetedWords.trim() !== ""));
            form.append("fall_match_ratio", String(fallMatchRatio));
            form.append("rise_match_ratio", String(riseMatchRatio));
            const res = await api.post("/api/shadowing/send/", form);
            setSentId(res.data.shadowing_id);
        } catch (err) {
            console.error("Shadowing: sending to students failed:", err);
            const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            setError(message ? `Sending failed: ${message}` : "Sending to students failed.");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="mt-10 bg-gray-200 p-3 rounded-md flex flex-col gap-3">
            <h3 className="text-lg font-bold">Shadowing</h3>
            <label className="flex flex-col gap-1">
                Reference sentence
                <input
                    value={sentence}
                    onChange={(e) => setSentence(e.target.value)}
                    placeholder="e.g. I think this is a very good idea."
                    className="bg-white border border-gray-400 rounded-md p-2"
                />
            </label>
            <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-1">
                    <span className="text-sm">Provider</span>
                    <select
                        value={provider}
                        onChange={(e) => setProvider(e.target.value as Provider)}
                        className="bg-white border border-gray-400 rounded-md p-2"
                    >
                        <option value="elevenlabs">ElevenLabs</option>
                        <option value="google">Google (Chirp 3 HD)</option>
                    </select>
                </label>
                <label className="flex flex-col gap-1 flex-1 min-w-48">
                    <span className="text-sm">Voice</span>
                    <select
                        value={voice}
                        onChange={(e) => setVoices((v) => ({ ...v, [provider]: e.target.value }))}
                        disabled={provider === "elevenlabs" && elevenVoices.length === 0}
                        className="bg-white border border-gray-400 rounded-md p-2"
                    >
                        {provider === "elevenlabs" ? (
                            elevenVoices.length === 0 ? (
                                <option value={voice}>{voicesError ? "Voices unavailable" : "Loading voices…"}</option>
                            ) : (
                                elevenVoices.map((v) => (
                                    <option key={v.name} value={v.name}>{v.name} - {v.description}</option>
                                ))
                            )
                        ) : (
                            CHIRP3_VOICES.map((v) => (
                                <option key={v.name} value={chirp3Id(v.name)}>{v.name} ({v.gender})</option>
                            ))
                        )}
                    </select>
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-sm">Speed</span>
                    <select
                        value={rate}
                        onChange={(e) => setRate(Number(e.target.value))}
                        className="bg-white border border-gray-400 rounded-md p-2"
                    >
                        {speeds.map((s) => (
                            <option key={s} value={s}>{s === 1 ? "1× (normal)" : `${s}×`}</option>
                        ))}
                    </select>
                </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={() => void generate()}
                    disabled={!text || generating || (provider === "elevenlabs" && elevenVoices.length === 0)}
                    className={`text-white bg-blue-600 p-2 rounded-md hover:bg-blue-800 ${
                        !text || generating || (provider === "elevenlabs" && elevenVoices.length === 0) ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                >
                    {generating ? "Generating…" : reference ? "Generate again" : "Generate reference"}
                </button>
                {reference && <audio key={reference.url} src={reference.url} controls className="min-w-0 flex-1" />}
                {reference && (
                    <button
                        onClick={() => void downloadWav()}
                        disabled={converting}
                        className="text-gray-700 bg-gray-300 p-2 rounded-md hover:bg-gray-400"
                        title="Save this reference as a 16 kHz mono WAV"
                    >
                        {converting ? "Converting…" : "Download WAV"}
                    </button>
                )}
            </div>
            {!text && <p className="text-sm text-gray-600">Type the sentence above first.</p>}
            {reference && text && !referenceReady && (
                <p className="text-sm text-amber-700">
                    The sentence has changed since this reference was made. Generate it again.
                </p>
            )}
            {referenceReady && <p className="text-xs text-gray-600">{reference.voice}</p>}

            {/* Scoring options, then send the reference to the students */}
            <fieldset className="flex flex-col gap-3 rounded-md border border-gray-400 p-3">
                <legend className="px-1 text-sm font-semibold">Scoring options</legend>
                <div className="flex flex-wrap items-end gap-4">
                    <label className="flex flex-col gap-1">
                        <span className="text-sm">Targeted words (optional)</span>
                        <input
                            value={targetedWords}
                            onChange={(e) => setTargetedWords(e.target.value)}
                            placeholder="e.g. is"
                            title="Word(s) that should link to the next word, e.g. is → is_a"
                            className="bg-white border border-gray-400 rounded-md p-2 w-48"
                        />
                    </label>
                    <label
                        className="flex items-center gap-2 self-center"
                        title={targetedWords.trim()
                            ? "Linking is always checked when targeted words are given"
                            : "Check that words link to the next word (connected speech)"}
                    >
                        <input
                            type="checkbox"
                            checked={strictConnectedSpeech || targetedWords.trim() !== ""}
                            disabled={targetedWords.trim() !== ""}
                            onChange={(e) => setStrictConnectedSpeech(e.target.checked)}
                        />
                        Strict connected speech
                    </label>
                    <RatioSlider
                        label="Falling tone"
                        hint="How far an unstressed syllable must drop compared with the reference (e.g. “-ther” in “mother”). Lower = more lenient."
                        value={fallMatchRatio}
                        defaultValue={DEFAULT_FALL_MATCH_RATIO}
                        onChange={setFallMatchRatio}
                    />
                    <RatioSlider
                        label="Rising tone"
                        hint="How far the voice must rise at the end of a Yes/No question compared with the reference. Lower = more lenient."
                        value={riseMatchRatio}
                        defaultValue={DEFAULT_RISE_MATCH_RATIO}
                        onChange={setRiseMatchRatio}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={() => void sendToStudents()}
                        disabled={!referenceReady || sending}
                        className={`text-white bg-green-600 p-2 rounded-md hover:bg-green-800 ${
                            !referenceReady || sending ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                    >
                        {sending ? "Sending…" : "Send to Students"}
                    </button>
                    {!referenceReady && <span className="text-sm text-gray-600">Generate the reference first.</span>}
                </div>
            </fieldset>

            {provider === "elevenlabs" && voicesError && <p className="text-sm text-red-600">⚠️ {voicesError}</p>}
            {error && <p className="text-red-600" role="alert">⚠️ {error}</p>}

            {/* Where the scores are listed for now (the section is self-contained, so it can move). */}
            <ShadowingResults shadowingId={sentId} />
        </div>
    );
}

// A pitch threshold: the share of the reference's pitch movement the student must reach, with
// its default shown and a reset. Copied from p2p-voice-chat-admin (VoiceAnalyzerPanel.tsx).
function RatioSlider({
    label,
    hint,
    value,
    defaultValue,
    onChange,
}: {
    label: string;
    hint: string;
    value: number;
    defaultValue: number;
    onChange: (v: number) => void;
}) {
    const pctText = (v: number) => `${Math.round(v * 100)}%`;
    return (
        <label className="flex flex-col gap-1" title={hint}>
            <span className="text-sm">
                {label}: <strong>{pctText(value)}</strong> of reference{" "}
                <span className="text-gray-600">(default {pctText(defaultValue)})</span>
                {value !== defaultValue && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            onChange(defaultValue);
                        }}
                        className="ml-1 text-xs text-blue-600 underline"
                    >
                        reset
                    </button>
                )}
            </span>
            <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-48"
            />
        </label>
    );
}
