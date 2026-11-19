import { useEffect, useState } from "react";
import api from "../api";
import {
    DEFAULT_FALL_MATCH_RATIO,
    DEFAULT_LINK_TOLERANCE,
    DEFAULT_RISE_MATCH_RATIO,
    DEFAULT_MELODY_MIN_SIMILARITY,
    DEFAULT_STRESS_CONTRAST_RATIO,
    LEGACY_STRESS_ENABLED,
    LINK_PAUSE_MARGIN_MS,
    RISING_TONE_ENABLED,
    type EvaluationResult,
} from "./shadowing/evaluation";
import { EvaluationView } from "./shadowing/EvaluationView";
import ShadowingResults from "./shadowing/ShadowingResults";
import { useRecorder } from "./shadowing/useRecorder";

// Teacher-only "Shadowing": generate a reference recording of a sentence with ElevenLabs
// (/api/eleven_lab_tts/), Google TTS (/english/google_tts/) or Amazon Polly, replay it, and keep
// it with "Save Sentence to S3" (/api/shadowing/save_sentence/). Adapted from the reference part
// of the VoiceAnalyzer1 tab in p2p-voice-chat-admin (VoiceAnalyzerPanel.tsx).
// "Send to Students" (/api/shadowing/send/) shares the reference with the scoring options set
// here; each student records themselves repeating it and VoiceAnalyzer_Claude scores them.
// "Test it yourself" (/api/shadowing/test/) lets the teacher record and be scored the same way,
// with the same options, without sending anything to the students.

// "google_neural": Google's Neural2 voices, which (unlike Chirp 3 HD) accept SSML, e.g. exact
// pauses with <break time="400ms"/>. Same /english/google_tts/ endpoint, which sends text that
// starts with "<speak" as SSML.
// "polly": Amazon Polly's neural voices (/api/polly_tts/), which also accept SSML.
type Provider = "elevenlabs" | "google" | "google_neural" | "polly";
// Providers whose reference can be made from SSML (the SSML box is shown for these).
const SSML_PROVIDERS: Provider[] = ["google_neural", "polly"];
const PROVIDER_TAG: Record<Provider, string> = { elevenlabs: "11L", google: "GG", google_neural: "GN", polly: "AP" };
// Full provider names, saved with the reference (tts_provider).
const PROVIDER_NAME: Record<Provider, string> = {
    elevenlabs: "ElevenLabs", google: "Google Chirp 3 HD", google_neural: "Google Neural2", polly: "Amazon Polly",
};
// How a reference was made, sent with it (saved in test.json / the exercise as "tts"):
// speed = the speed actually sent (null when the SSML's <prosody rate> set it; see ssmlRate).
interface TtsInfo { provider: string; voice: string; speed: number | null; ssmlRate: string | null }
const appendTts = (form: FormData, tts: TtsInfo) => {
    form.append("tts_provider", tts.provider);
    form.append("tts_voice", tts.voice);
    form.append("tts_speed", tts.speed == null ? "" : String(tts.speed));
    form.append("tts_ssml_rate", tts.ssmlRate ?? "");
};
// Amazon Polly's adult en-US neural voices.
const POLLY_VOICES: { name: string; gender: "female" | "male" }[] = [
    { name: "Danielle", gender: "female" }, { name: "Gregory", gender: "male" },
    { name: "Joanna", gender: "female" }, { name: "Joey", gender: "male" },
    { name: "Kendra", gender: "female" }, { name: "Kimberly", gender: "female" },
    { name: "Matthew", gender: "male" }, { name: "Ruth", gender: "female" },
    { name: "Salli", gender: "female" }, { name: "Stephen", gender: "male" },
];

// Speeds offered (1 is normal). Learners need slower speech, never faster; ElevenLabs only
// accepts 0.7 and up.
const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
const MIN_RATE: Record<Provider, number> = { elevenlabs: 0.7, google: 0.5, google_neural: 0.5, polly: 0.5 };
// Google's Neural2 en-US voices.
const NEURAL2_VOICES: { name: string; gender: "female" | "male" }[] = [
    { name: "A", gender: "male" }, { name: "C", gender: "female" }, { name: "D", gender: "male" },
    { name: "E", gender: "female" }, { name: "F", gender: "female" }, { name: "G", gender: "female" },
    { name: "H", gender: "female" }, { name: "I", gender: "male" }, { name: "J", gender: "male" },
];
const neural2Id = (name: string) => `en-US-Neural2-${name}`;
// The SSML as sent to Google: wrapped in <speak> if the teacher left it out.
const wrapSsml = (ssml: string) => (/^<speak[\s>]/i.test(ssml) ? ssml : `<speak>${ssml}</speak>`);
// The words only (markup removed), lower-cased, to check the SSML says the reference sentence.
const wordsOf = (text: string) =>
    text.replace(/<[^>]*>/g, " ").toLowerCase().match(/[a-z']+/g)?.join(" ") ?? "";
const DEFAULT_PAUSE = '<break time="400ms"/>';
// SSML helper buttons: prosody rates and pause lengths offered.
const PROSODY_RATES = ["slow", "x-slow"] as const;
const PAUSE_MS = [100, 200, 300, 400, 500, 750, 1000];
// SSML that is entirely one <prosody rate="..."> wrapper: [whole, rate, inner].
const PROSODY_WRAP = /^<prosody rate="([^"]*)">([\s\S]*)<\/prosody>$/;
// The first <prosody ... rate="..."> in the SSML (a <prosody> with only pitch or volume doesn't count).
const PROSODY_RATE = /<prosody\b[^>]*\brate\s*=\s*["']([^"']*)["']/i;
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
// A reference sentence saved with "Save Sentence to S3" (/api/shadowing/sentences/).
interface SavedSentence {
    id: number; sentence: string; tts_text: string; keywords: string[]; voice: string;
    tts: { provider: string | null; voice: string | null; speed: number | null; ssml_rate: string | null };
    created_by: string | null; created_at: string; audio_url: string;
}
// The reference in use: generated now ("tts") or a saved sentence from S3 ("s3", savedId = its id).
// `ssml`: the SSML it was generated from ("" if none, and always "" for a saved one).
interface Reference {
    blob: Blob; url: string; sentence: string; ssml: string; voice: string; tts: TtsInfo;
    source: "tts" | "s3"; savedId?: number;
}

const DEFAULT_VOICE: Record<Provider, string> = {
    elevenlabs: "River", google: chirp3Id("Charon"), google_neural: neural2Id("D"), polly: "Matthew",
};

export default function Shadowing() {
    const [sentence, setSentence] = useState("");
    // Google Neural / Amazon Polly only: optional SSML for the reference audio (blank = speak the sentence).
    // Students still see, and are scored on, the reference sentence.
    const [ssml, setSsml] = useState("");
    const [prosodyRate, setProsodyRate] = useState<(typeof PROSODY_RATES)[number]>("slow");
    const [pauseMs, setPauseMs] = useState(100);
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

    // The reference audio. Its object URL is replaced (and revoked) when another one is made or picked.
    const [reference, setReference] = useState<Reference | null>(null);
    // "Use audio from": a sentence saved in S3, or a new one generated with a TTS provider.
    const [audioSource, setAudioSource] = useState<"s3" | "tts">("tts");
    // From S3 Storage: the keyword search and its results.
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SavedSentence[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [loadingSavedId, setLoadingSavedId] = useState<number | null>(null);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Scoring options, sent with the exercise (students can't change them).
    // Targeted words: word(s) that should link to the next word (e.g. "is" -> "is_a").
    const [targetedWords, setTargetedWords] = useState("");
    // Linking check (the service turns it on anyway when targeted words are given).
    const [strictConnectedSpeech, setStrictConnectedSpeech] = useState(false);
    // How much of the reference's falling / rising pitch the student must reach. Lower = more lenient.
    const [fallMatchRatio, setFallMatchRatio] = useState(DEFAULT_FALL_MATCH_RATIO);
    const [riseMatchRatio, setRiseMatchRatio] = useState(DEFAULT_RISE_MATCH_RATIO);
    // How much longer a pause between linked words may be than the reference's. Higher = more lenient.
    const [linkTolerance, setLinkTolerance] = useState(DEFAULT_LINK_TOLERANCE);
    // Word Syllables Stress Check: the multi-syllable words to check (blank = no stress check),
    // and how much of the reference's stressed/unstressed contrast the student must reach.
    const [stressWords, setStressWords] = useState("");
    const [stressContrastRatio, setStressContrastRatio] = useState(DEFAULT_STRESS_CONTRAST_RATIO);
    // How closely each stress word's melody (pitch shape) must follow the reference's. Higher = stricter.
    const [melodyMinSimilarity, setMelodyMinSimilarity] = useState(DEFAULT_MELODY_MIN_SIMILARITY);
    // The scoring options' help (opened with the Help button next to the stress options).
    const [showHelp, setShowHelp] = useState(false);

    // The exercise last sent from this page (reloads the results list).
    const [sentId, setSentId] = useState<string | undefined>(undefined);
    const [sending, setSending] = useState(false);

    // Teacher's own test take and its scores.
    const recorder = useRecorder();
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<EvaluationResult | null>(null);
    const [testError, setTestError] = useState<string | null>(null);
    // What the last score was made from (the files and the options as sent), so "Save to S3"
    // keeps exactly that even if the sliders are moved afterwards.
    const [scoredWith, setScoredWith] = useState<{
        reference: Blob; recording: Blob; sentence: string; voice: string; tts: TtsInfo; options: [string, string][];
    } | null>(null);
    const [savingTest, setSavingTest] = useState(false);
    const [savedFolder, setSavedFolder] = useState<string | null>(null);
    // "Save sentence": keep a reference you like (S3 audio + searchable row, /api/shadowing/save_sentence/).
    // savedSentence remembers which reference (by its object URL) was saved, so it isn't saved twice.
    const [sentenceKeywords, setSentenceKeywords] = useState("");
    const [savingSentence, setSavingSentence] = useState(false);
    const [savedSentence, setSavedSentence] = useState<{ url: string; keywords: string[] } | null>(null);
    const [sentenceError, setSentenceError] = useState<string | null>(null);

    const text = sentence.trim();
    const ssmlText = SSML_PROVIDERS.includes(provider) ? ssml.trim() : "";
    // The SSML should say the same words as the sentence (students are scored on the sentence).
    const ssmlMismatch = ssmlText !== "" && text !== "" && wordsOf(ssmlText) !== wordsOf(text);
    // When the SSML sets a <prosody rate>, it decides the speed on every engine: the Speed menu is
    // ignored and 1× is sent (otherwise Polly and Google combine the two differently).
    const ssmlRate = ssmlText.match(PROSODY_RATE)?.[1] ?? null;
    const sentRate = ssmlRate ? 1 : rate;
    // The reference must say the sentence (and SSML, if it was made from one) that's typed now.
    // Stress words are required to send or score (the Word Syllables Stress Check always runs).
    const stressWordsMissing = stressWords.trim() === "";
    const referenceReady = reference !== null && reference.sentence === text
        && (reference.source === "s3" || reference.ssml === "" || reference.ssml === ssml.trim());
    // The SSML helper buttons work on what's in the SSML box (or the sentence if it's empty), so
    // they can be used in either order; pressing one again replaces what it added before.
    const ssmlBase = () => {
        const base = ssml.trim() || text;
        const m = base.match(PROSODY_WRAP);
        return m ? { rate: m[1], inner: m[2] } : { rate: null, inner: base };
    };
    // Wraps it all in <prosody rate="slow|x-slow"> (an existing wrapper's rate is replaced).
    const addProsody = () => setSsml(`<prosody rate="${prosodyRate}">${ssmlBase().inner}</prosody>`);
    // A pause between every word (earlier pauses are replaced), keeping a prosody wrapper.
    const addPauses = () => {
        const { rate, inner } = ssmlBase();
        const paused = inner
            .replace(/\s*<break\b[^>]*\/>\s*/g, " ")
            .trim()
            .replace(/\s+(?![^<]*>)/g, ` <break time="${pauseMs}ms"/> `); // not inside a tag
        setSsml(rate ? `<prosody rate="${rate}">${paused}</prosody>` : paused);
    };

    const generate = async () => {
        if (!text || generating) return;
        setGenerating(true);
        setError(null);
        try {
            const ttsText = ssmlText ? wrapSsml(ssmlText) : text;
            const res = provider === "elevenlabs"
                ? await api.post("/api/eleven_lab_tts/", { text, voice_name: voice, speed: rate }, { responseType: "blob" })
                : provider === "polly"
                ? await api.post("/api/polly_tts/", { text: ttsText, voice, rate: sentRate }, { responseType: "blob" })
                : await api.get("/english/google_tts/", { params: { text: ttsText, voice, rate: sentRate }, responseType: "blob" });
            const blob = res.data as Blob;
            if (reference) URL.revokeObjectURL(reference.url);
            const speedLabel = ssmlRate ? ` · SSML rate ${ssmlRate}` : `${ssmlText ? " · SSML" : ""} · ${rate}×`;
            const label = `${PROVIDER_TAG[provider]} ${voice.replace(/^en-US-(Chirp3-HD-)?/, "")}${speedLabel}`;
            const tts: TtsInfo = {
                provider: PROVIDER_NAME[provider],
                voice,
                speed: ssmlRate ? null : provider === "elevenlabs" ? rate : sentRate,
                ssmlRate,
            };
            setReference({ blob, url: URL.createObjectURL(blob), sentence: text, ssml: ssmlText, voice: label, tts, source: "tts" });
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

    // Switching "Use audio from" drops the current reference (it came from the other source).
    const changeAudioSource = (next: "s3" | "tts") => {
        if (next === audioSource) return;
        if (reference) URL.revokeObjectURL(reference.url);
        setReference(null);
        setError(null);
        setAudioSource(next);
        if (next === "s3" && searchResults === null) void searchSaved();
    };

    // Saved sentences whose words or keywords contain every word of the search (blank = the newest).
    const searchSaved = async () => {
        setSearching(true);
        setSearchError(null);
        try {
            const res = await api.get("/api/shadowing/sentences/", { params: { q: searchQuery.trim() } });
            setSearchResults(res.data.sentences as SavedSentence[]);
        } catch (err) {
            console.error("Shadowing: searching saved sentences failed:", err);
            const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            setSearchError(message ? `Search failed: ${message}` : "Searching the saved sentences failed.");
        } finally {
            setSearching(false);
        }
    };

    // Checking a saved sentence makes it the reference (its audio, and its words as the reference
    // sentence); unchecking it clears the reference. Only one can be checked.
    const toggleSaved = async (saved: SavedSentence) => {
        if (reference?.savedId === saved.id) {
            URL.revokeObjectURL(reference.url);
            setReference(null);
            return;
        }
        setLoadingSavedId(saved.id);
        setSearchError(null);
        try {
            const res = await api.get(`/api/shadowing/sentence_audio/${saved.id}/`, { responseType: "blob" });
            const blob = res.data as Blob;
            if (reference) URL.revokeObjectURL(reference.url);
            setSentence(saved.sentence);
            setReference({
                blob,
                url: URL.createObjectURL(blob),
                sentence: saved.sentence,
                ssml: "",
                voice: saved.voice,
                tts: {
                    provider: saved.tts.provider ?? "",
                    voice: saved.tts.voice ?? "",
                    speed: saved.tts.speed,
                    ssmlRate: saved.tts.ssml_rate,
                },
                source: "s3",
                savedId: saved.id,
            });
        } catch (err) {
            console.error("Shadowing: loading the saved audio failed:", err);
            setSearchError("Loading that audio from S3 failed.");
        } finally {
            setLoadingSavedId(null);
        }
    };

    // The scoring options as form fields (sent with the exercise, or with a test).
    const appendOptions = (form: FormData) => {
        const strict = strictConnectedSpeech || targetedWords.trim() !== "";
        form.append("targeted_words", targetedWords.trim());
        form.append("strict_connected_speech", String(strict));
        // Hidden (paused) sliders send their defaults.
        form.append("fall_match_ratio", String(LEGACY_STRESS_ENABLED ? fallMatchRatio : DEFAULT_FALL_MATCH_RATIO));
        form.append("rise_match_ratio", String(RISING_TONE_ENABLED ? riseMatchRatio : DEFAULT_RISE_MATCH_RATIO));
        // The slider is hidden when strict is off (linking isn't checked then), so its value isn't sent.
        form.append("link_tolerance", String(strict ? linkTolerance : DEFAULT_LINK_TOLERANCE));
        const words = stressWords.trim();
        form.append("stress_words", words);
        form.append("stress_contrast_ratio", String(words ? stressContrastRatio : DEFAULT_STRESS_CONTRAST_RATIO));
        form.append("melody_min_similarity", String(words ? melodyMinSimilarity : DEFAULT_MELODY_MIN_SIMILARITY));
    };

    const recordTest = () => {
        setTestResult(null);
        setScoredWith(null);
        setSavedFolder(null);
        setTestError(null);
        void recorder.record();
    };

    const scoreTest = async () => {
        if (!reference || !referenceReady || !recorder.take || testing || stressWordsMissing) return;
        setTesting(true);
        setTestError(null);
        try {
            const form = new FormData();
            form.append("reference_file", reference.blob, "reference.mp3");
            form.append("recorded_file", recorder.take.wav, "recording.wav");
            form.append("sentence", reference.sentence);
            const options = new FormData();
            appendOptions(options);
            for (const [k, v] of options) form.append(k, v);
            const res = await api.post("/api/shadowing/test/", form);
            setTestResult(res.data as EvaluationResult);
            setScoredWith({
                reference: reference.blob,
                recording: recorder.take.wav,
                sentence: reference.sentence,
                voice: reference.voice,
                tts: reference.tts,
                options: [...options].map(([k, v]) => [k, String(v)]),
            });
            setSavedFolder(null);
        } catch (err) {
            console.error("Shadowing: test scoring failed:", err);
            const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            setTestError(message ?? "Scoring the recording failed.");
        } finally {
            setTesting(false);
        }
    };

    // Keeps the scored test (reference, recording, options, result) in its own new S3 folder,
    // to re-run later (/api/shadowing/save_test/).
    const saveTest = async () => {
        if (!scoredWith || !testResult || savingTest) return;
        setSavingTest(true);
        setTestError(null);
        try {
            const form = new FormData();
            form.append("reference_file", scoredWith.reference, "reference.mp3");
            form.append("recorded_file", scoredWith.recording, "recording.wav");
            form.append("sentence", scoredWith.sentence);
            form.append("voice", scoredWith.voice);
            appendTts(form, scoredWith.tts);
            for (const [k, v] of scoredWith.options) form.append(k, v);
            form.append("evaluation", JSON.stringify(testResult));
            const res = await api.post("/api/shadowing/save_test/", form);
            setSavedFolder(res.data.folder as string);
        } catch (err) {
            console.error("Shadowing: saving the test failed:", err);
            const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            setTestError(message ? `Saving failed: ${message}` : "Saving the test to S3 failed.");
        } finally {
            setSavingTest(false);
        }
    };

    // Keeps this reference sentence and its audio, searchable by its words and the keywords
    // (audio in S3 under audios/shadowing_sentences/, details in the database).
    const saveSentence = async () => {
        if (!reference || !referenceReady || savingSentence) return;
        setSavingSentence(true);
        setSentenceError(null);
        try {
            const form = new FormData();
            form.append("reference_file", reference.blob, "reference.mp3");
            form.append("sentence", reference.sentence);
            form.append("tts_text", reference.ssml);
            form.append("keywords", sentenceKeywords);
            form.append("voice", reference.voice);
            appendTts(form, reference.tts);
            appendOptions(form);
            const res = await api.post("/api/shadowing/save_sentence/", form);
            setSavedSentence({ url: reference.url, keywords: res.data.keywords as string[] });
        } catch (err) {
            console.error("Shadowing: saving the sentence failed:", err);
            const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            setSentenceError(message ? `Saving failed: ${message}` : "Saving the sentence failed.");
        } finally {
            setSavingSentence(false);
        }
    };

    const sendToStudents = async () => {
        if (!reference || !referenceReady || sending || stressWordsMissing) return;
        setSending(true);
        setError(null);
        try {
            const form = new FormData();
            form.append("reference_file", reference.blob, "reference.mp3");
            form.append("sentence", reference.sentence);
            form.append("voice", reference.voice);
            appendTts(form, reference.tts);
            appendOptions(form);
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
            {/* Reference Audio: a sentence saved in S3, or a new one made with a TTS provider. */}
            <fieldset className="flex flex-col gap-3 rounded-md border border-gray-400 p-3">
                <legend className="px-1 text-sm font-semibold">Reference Audio</legend>
                <label className="flex flex-wrap items-center gap-2">
                    <span>Use audio from</span>
                    <select
                        value={audioSource}
                        onChange={(e) => changeAudioSource(e.target.value as "s3" | "tts")}
                        className="bg-white border border-gray-400 rounded-md p-2"
                    >
                        <option value="s3">From S3 Storage</option>
                        <option value="tts">Generate from a TTS Provider</option>
                    </select>
                </label>
                {audioSource === "s3" ? (
                    <div className="flex flex-col gap-2">
                        <form
                            onSubmit={(e) => { e.preventDefault(); void searchSaved(); }}
                            className="flex flex-wrap items-center gap-2"
                        >
                            <input
                                type="search"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Keyword, e.g. apology"
                                aria-label="Search saved sentences"
                                className="min-w-0 flex-1 bg-white border border-gray-400 rounded-md p-2"
                            />
                            <button
                                type="submit"
                                disabled={searching}
                                className="text-white bg-blue-600 p-2 rounded-md hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {searching ? "Searching…" : "Search"}
                            </button>
                        </form>
                        <p className="text-xs text-gray-600">
                            Finds the saved sentences that contain every word you type, in the sentence or its
                            keywords. Leave it blank to list the newest. Check one to use it as the reference.
                        </p>
                        {searchError && <p className="text-sm text-red-700" role="alert">{searchError}</p>}
                        {searchResults && (searchResults.length === 0 ? (
                            <p className="text-sm text-gray-700">No saved sentences match.</p>
                        ) : (
                            <ul className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                                {searchResults.map((saved) => {
                                    const checked = reference?.savedId === saved.id;
                                    const details = [
                                        saved.voice,
                                        new Date(saved.created_at).toLocaleDateString(),
                                        saved.keywords.length > 0 ? `keywords: ${saved.keywords.join(", ")}` : "",
                                    ].filter(Boolean).join(" · ");
                                    return (
                                        <li
                                            key={saved.id}
                                            className={`rounded-md border bg-white p-2 ${checked ? "border-blue-600 ring-1 ring-blue-600" : "border-gray-300"}`}
                                        >
                                            <label className="flex items-start gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={loadingSavedId !== null}
                                                    onChange={() => void toggleSaved(saved)}
                                                    className="mt-1"
                                                />
                                                <span className="flex flex-col">
                                                    <span className="font-medium">{saved.sentence}</span>
                                                    <span className="text-xs text-gray-600">
                                                        {details}
                                                        {loadingSavedId === saved.id && " · Loading…"}
                                                    </span>
                                                </span>
                                            </label>
                                            <audio src={saved.audio_url} controls preload="none" className="mt-1 w-full" />
                                        </li>
                                    );
                                })}
                            </ul>
                        ))}
                        {reference?.source === "s3" && text && !referenceReady && (
                            <p className="text-sm text-amber-700">
                                The reference sentence has been changed, so it no longer matches the selected audio.
                                Change it back, or pick another audio.
                            </p>
                        )}
                    </div>
                ) : (
                    <>
                    {SSML_PROVIDERS.includes(provider) && (
                        <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span id="ssml-label">SSML (optional, Google Neural and Amazon Polly only)</span>
                                <button
                                    type="button"
                                    onClick={addProsody}
                                    disabled={!text}
                                    className={`${ssmlButton} ${!text ? "opacity-50 cursor-not-allowed" : ""}`}
                                    title={`Wrap the SSML (or the sentence) in <prosody rate="${prosodyRate}">`}
                                >
                                    Add prosody
                                </button>
                                <select
                                    value={prosodyRate}
                                    onChange={(e) => setProsodyRate(e.target.value as (typeof PROSODY_RATES)[number])}
                                    aria-label="Prosody rate"
                                    className="text-sm bg-white border border-gray-400 rounded-md px-1 py-0.5"
                                >
                                    {PROSODY_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                                <button
                                    type="button"
                                    onClick={addPauses}
                                    disabled={!text}
                                    className={`${ssmlButton} ${!text ? "opacity-50 cursor-not-allowed" : ""}`}
                                    title={`Put a ${pauseMs} ms pause between every word of the SSML (or the sentence)`}
                                >
                                    Add pauses between words
                                </button>
                                <select
                                    value={pauseMs}
                                    onChange={(e) => setPauseMs(Number(e.target.value))}
                                    aria-label="Pause between words"
                                    className="text-sm bg-white border border-gray-400 rounded-md px-1 py-0.5"
                                >
                                    {PAUSE_MS.map((ms) => <option key={ms} value={ms}>{ms} ms</option>)}
                                </select>
                            </div>
                            <textarea
                                aria-labelledby="ssml-label"
                                value={ssml}
                                onChange={(e) => setSsml(e.target.value)}
                                rows={2}
                                placeholder={`e.g. I ${DEFAULT_PAUSE} accept ${DEFAULT_PAUSE} your apology.`}
                                className="bg-white border border-gray-400 rounded-md p-2 font-mono text-sm"
                            />
                            <span className="text-xs text-gray-600">
                                Used only to make the reference audio (blank = speak the sentence). Students see, and are
                                scored on, the reference sentence. Tags: <code>{DEFAULT_PAUSE}</code>,{" "}
                                <code>{'<prosody rate="slow">…</prosody>'}</code>, <code>{"<emphasis>…</emphasis>"}</code>.
                                The <code>{"<speak>"}</code> wrapper is added for you.
                            </span>
                            {ssmlMismatch && (
                                <span className="text-sm text-amber-700">
                                    The SSML doesn't say the same words as the reference sentence. Students are scored on the
                                    sentence, so make them match.
                                </span>
                            )}
                        </div>
                    )}
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
                                <option value="google_neural">Google Neural (SSML)</option>
                                <option value="polly">Amazon Polly (SSML)</option>
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
                                ) : provider === "google" ? (
                                    CHIRP3_VOICES.map((v) => (
                                        <option key={v.name} value={chirp3Id(v.name)}>{v.name} ({v.gender})</option>
                                    ))
                                ) : provider === "google_neural" ? (
                                    NEURAL2_VOICES.map((v) => (
                                        <option key={v.name} value={neural2Id(v.name)}>Neural2-{v.name} ({v.gender})</option>
                                    ))
                                ) : (
                                    POLLY_VOICES.map((v) => (
                                        <option key={v.name} value={v.name}>{v.name} ({v.gender})</option>
                                    ))
                                )}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-sm">Speed</span>
                            <select
                                value={rate}
                                onChange={(e) => setRate(Number(e.target.value))}
                                disabled={ssmlRate !== null}
                                title={ssmlRate ? `Speed is set by the SSML's <prosody rate="${ssmlRate}">` : undefined}
                                className="bg-white border border-gray-400 rounded-md p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {speeds.map((s) => (
                                    <option key={s} value={s}>{s === 1 ? "1× (normal)" : `${s}×`}</option>
                                ))}
                            </select>
                            {ssmlRate && (
                                <span className="text-xs text-gray-600 max-w-48">
                                    Speed is set by the SSML's <code>{`<prosody rate="${ssmlRate}">`}</code>.
                                </span>
                            )}
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
                    </div>
                    {!text && <p className="text-sm text-gray-600">Type the sentence above first.</p>}
                    {reference && text && !referenceReady && (
                        <p className="text-sm text-amber-700">
                            The sentence or SSML has changed since this reference was made. Generate it again.
                        </p>
                    )}
                    {referenceReady && <p className="text-xs text-gray-600">{reference.voice}</p>}
                    {referenceReady && (
                        <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    value={sentenceKeywords}
                                    onChange={(e) => setSentenceKeywords(e.target.value)}
                                    placeholder="Keywords, e.g. apology, question intonation"
                                    className="min-w-0 flex-1 bg-white border border-gray-400 rounded-md p-2 text-sm"
                                />
                                <button
                                    onClick={() => void saveSentence()}
                                    disabled={savingSentence || savedSentence?.url === reference.url}
                                    className={`text-white bg-green-700 p-2 rounded-md hover:bg-green-900 text-sm ${
                                        savingSentence || savedSentence?.url === reference.url ? "opacity-50 cursor-not-allowed" : ""
                                    }`}
                                    title="Keep this reference audio to find and reuse later"
                                >
                                    {savingSentence ? "Saving…" : savedSentence?.url === reference.url ? "Sentence saved" : "Save Sentence to S3"}
                                </button>
                            </div>
                            <p className="text-xs text-gray-600">
                                Like this reference? Save it to find it later by any word of the sentence or by its keywords
                                (separate keywords with commas). The audio, voice, speed and scoring options are kept.
                            </p>
                            {savedSentence?.url === reference.url && (
                                <p className="text-sm text-green-800">
                                    Saved “{reference.sentence}”
                                    {savedSentence.keywords.length > 0 && <> · keywords: {savedSentence.keywords.join(", ")}</>}
                                </p>
                            )}
                            {sentenceError && <p className="text-sm text-red-700">{sentenceError}</p>}
                        </div>
                    )}
                    </>
                )}
            </fieldset>

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
                    {/* Only matters when missed links are penalised (strict on, or targeted words given). */}
                    {(strictConnectedSpeech || targetedWords.trim() !== "") && (
                        <LinkToleranceSlider value={linkTolerance} onChange={setLinkTolerance} />
                    )}
                </div>
                <div className="flex flex-wrap items-end gap-4">
                    {/* Word Syllables Stress Check: which syllable is stressed inside each word given here. */}
                    <label className="flex flex-col gap-1">
                        <span className="text-sm">
                            Stress words <span className="text-red-700">(required)</span>{" "}
                            <span className="text-gray-600">The multi-syllable words checked for syllable stress pattern.</span>
                        </span>
                        <input
                            value={stressWords}
                            onChange={(e) => setStressWords(e.target.value)}
                            placeholder="e.g. accept, apology"
                            title="Multi-syllable words whose syllable stress is checked against the reference (Word Syllables Stress Check)."
                            required
                            aria-required="true"
                            className={`bg-white border rounded-md p-2 w-56 ${stressWordsMissing ? "border-red-600" : "border-gray-400"}`}
                        />
                    </label>
                    {stressWords.trim() !== "" && (
                        <RatioSlider
                            label="Stress contrast"
                            hint="How much of the reference's contrast between the stressed syllable and the others (within the word) the student must reach. Lower = more lenient."
                            value={stressContrastRatio}
                            defaultValue={DEFAULT_STRESS_CONTRAST_RATIO}
                            onChange={setStressContrastRatio}
                        />
                    )}
                    {stressWords.trim() !== "" && (
                        <p className="text-sm text-gray-600 self-center">
                            Suggestion: 50–60% for beginners, 75% for most classes, 90–100% for advanced students.
                        </p>
                    )}
                    {stressWords.trim() !== "" && (
                        <RatioSlider
                            label="Melody match"
                            suffix="similarity"
                            min={0.1}
                            max={0.9}
                            hint="How closely the student's pitch shape through each stress word must follow the reference's to count as 'Same melody'. Higher = stricter. Shown with the results, not counted in the score."
                            value={melodyMinSimilarity}
                            defaultValue={DEFAULT_MELODY_MIN_SIMILARITY}
                            onChange={setMelodyMinSimilarity}
                        />
                    )}
                    {stressWords.trim() !== "" && (
                        <p className="text-sm text-gray-600 self-center">
                            Lenient 30–40%, moderate 50%, strict 70% or more.
                        </p>
                    )}
                    {/* Paused: replaced by the Word Syllables Stress Check (code kept). */}
                    {LEGACY_STRESS_ENABLED && (
                        <RatioSlider
                            label="Falling tone"
                            hint="How far an unstressed syllable must drop compared with the reference (e.g. “-ther” in “mother”). Lower = more lenient."
                            value={fallMatchRatio}
                            defaultValue={DEFAULT_FALL_MATCH_RATIO}
                            onChange={setFallMatchRatio}
                        />
                    )}
                    {/* Paused: sentence-level intonation that spans words (code kept). */}
                    {RISING_TONE_ENABLED && (
                        <RatioSlider
                            label="Rising tone"
                            hint="How far the voice must rise at the end of a Yes/No question compared with the reference. Lower = more lenient."
                            value={riseMatchRatio}
                            defaultValue={DEFAULT_RISE_MATCH_RATIO}
                            onChange={setRiseMatchRatio}
                        />
                    )}
                    <button
                        type="button"
                        onClick={() => setShowHelp((v) => !v)}
                        aria-expanded={showHelp}
                        aria-controls="scoring-help"
                        className="px-3 py-1.5 rounded-md border border-blue-600 text-blue-700 hover:bg-blue-50 text-sm"
                    >
                        {showHelp ? "Hide help" : "Help"}
                    </button>
                </div>
                {showHelp && <ScoringHelp onClose={() => setShowHelp(false)} />}
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={() => void sendToStudents()}
                        disabled={!referenceReady || sending || stressWordsMissing}
                        className={`text-white bg-green-600 p-2 rounded-md hover:bg-green-800 ${
                            !referenceReady || sending || stressWordsMissing ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                    >
                        {sending ? "Sending…" : "Send to Students"}
                    </button>
                    {stressWordsMissing && <span className="text-sm text-red-700">Type the stress words first.</span>}
                    {!referenceReady && <span className="text-sm text-gray-600">Choose or generate the reference first.</span>}
                </div>
            </fieldset>

            {/* The teacher records the sentence and is scored against the reference with the
                options above. Nothing goes to the students. */}
            <fieldset className="flex flex-col gap-3 rounded-md border border-gray-400 p-3">
                <legend className="px-1 text-sm font-semibold">Test it yourself</legend>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={recordTest}
                        disabled={!referenceReady || recorder.recording || recorder.converting || testing}
                        className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {recorder.take ? "Record again" : "Record"}
                    </button>
                    <button
                        onClick={recorder.stop}
                        disabled={!recorder.recording}
                        className="px-4 py-2 rounded-md bg-gray-300 hover:bg-gray-400 text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Stop
                    </button>
                    {recorder.recording && (
                        <span className="flex items-center gap-2 text-sm text-red-600" role="status">
                            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
                            Recording… say the sentence, then click Stop.
                        </span>
                    )}
                    {recorder.converting && <span className="text-sm text-gray-600">Preparing the recording…</span>}
                    {!referenceReady && <span className="text-sm text-gray-600">Choose or generate the reference first.</span>}
                </div>
                {recorder.take && !recorder.recording && (
                    <div className="flex flex-wrap items-center gap-3">
                        <audio key={recorder.take.url} src={recorder.take.url} controls className="min-w-0 flex-1" />
                        <button
                            onClick={() => void scoreTest()}
                            disabled={!referenceReady || testing || stressWordsMissing}
                            className="px-4 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {testing ? "Scoring…" : "Score my recording"}
                        </button>
                        {stressWordsMissing && <span className="text-sm text-red-700">Type the stress words first (Scoring options).</span>}
                    </div>
                )}
                {(recorder.error ?? testError) && (
                    <p className="text-sm text-red-600" role="alert">⚠️ {recorder.error ?? testError}</p>
                )}
                {testResult && scoredWith && (
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={() => void saveTest()}
                            disabled={savingTest || savedFolder !== null}
                            title="Keep the reference, your recording, the scoring options and this result in S3, to re-run the test later"
                            className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {savingTest ? "Saving…" : savedFolder ? "Saved" : "Save to S3"}
                        </button>
                        {savedFolder ? (
                            <span className="text-sm text-gray-700">
                                Saved as <code className="bg-white px-1 rounded select-all">{savedFolder}</code>
                                {scoredWith && <> · “{scoredWith.sentence}”</>}
                            </span>
                        ) : (
                            <span className="text-sm text-gray-600">
                                Saves both the <strong>reference audio</strong> and <strong>your recording</strong>, plus the sentence, scoring
                                options and this result, in a new folder (nothing is overwritten).
                            </span>
                        )}
                    </div>
                )}
                {testResult && (
                    <div className="bg-white rounded-md p-3">
                        <EvaluationView result={testResult} teacher />
                    </div>
                )}
            </fieldset>

            {provider === "elevenlabs" && voicesError && <p className="text-sm text-red-600">⚠️ {voicesError}</p>}
            {error && <p className="text-red-600" role="alert">⚠️ {error}</p>}

            {/* Where the scores are listed for now (the section is self-contained, so it can move). */}
            <ShadowingResults shadowingId={sentId} />
        </div>
    );
}

// How to adjust the scoring options: what each slider checks, which way is more lenient,
// worked examples and suggested values. Opened by the Help button next to the stress options.
function ScoringHelp({ onClose }: { onClose: () => void }) {
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const h = "font-semibold text-gray-900";
    return (
        <section
            id="scoring-help"
            aria-label="How to adjust the scoring options"
            className="flex flex-col gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-gray-800"
        >
            <div className="flex items-start justify-between gap-3">
                <p>
                    These settings decide how close a recording must come to the reference. They apply in two
                    places: when you score your own recording with <strong>Test it yourself</strong>, and when you
                    click <strong>Send to Students</strong>. So a test shows you exactly how your students will be
                    scored with the same settings. When you send, the settings are saved with that exercise.
                    Changing them afterwards affects your next test and your next exercise, but not an exercise
                    that's already been sent.
                </p>
                <button type="button" onClick={onClose} className="text-blue-700 hover:underline whitespace-nowrap">
                    Close
                </button>
            </div>

            <p className="rounded bg-white px-2 py-1">
                <strong>Which way is easier?</strong> Stress contrast and Melody match: <strong>lower = more lenient</strong>.
                Linking tolerance: <strong>higher = more lenient</strong>.
            </p>

            <div>
                <h5 className={h}>
                    Word Syllables Stress Check: Stress words and Stress contrast (default{" "}
                    {pct(DEFAULT_STRESS_CONTRAST_RATIO)})
                </h5>
                <p>
                    Type the multi-syllable words you want checked in <strong>Stress words</strong>, separated by
                    commas (for example “accept, apology”). Each word is checked <strong>on its own</strong>: the
                    syllables of the word are compared with each other, not with the rest of the sentence. This field
                    is required: you can't send or score until it has at least one word. The <strong>Stress contrast</strong>{" "}
                    slider appears once you type a word.
                </p>
                <p className="mt-1">Each word is judged in two steps, against the reference recording:</p>
                <ol className="ml-5 list-decimal">
                    <li>
                        <strong>Right syllable:</strong> the student must stress the same syllable as the reference
                        (ac-<strong>CEPT</strong>, a-<strong>POL</strong>-o-gy). If not, the word gets{" "}
                        <em>✗ Wrong syllable</em> and 0%, with a hint like “Stress the 2nd syllable (○ ●), not the
                        1st (● ○)”.
                    </li>
                    <li>
                        <strong>Enough contrast:</strong> the other syllables must be lower and softer than the
                        stressed one, by at least the <strong>Stress contrast</strong> percentage of the reference's
                        difference. This covers both directions: the voice rising into the stress (“ac-” before
                        “-CEPT”) and falling after it (“-ther” after “MO-”). If the contrast is too small, the word
                        gets <em>↕ More contrast</em> and 50–99%, depending on how close the student came.
                    </li>
                </ol>
                <p className="mt-1">Example: in the reference, “ac-” is clearly lower and softer than “-CEPT”.</p>
                <ul className="ml-5 list-disc">
                    <li>At 75%, the student's “ac-” must stand out from “-CEPT” at least 75% as much as the reference's does.</li>
                    <li>At 50%, half the reference's contrast is enough.</li>
                    <li>At 100%, the student must match the reference's contrast.</li>
                </ul>
                <p className="mt-1">
                    Suggested: <strong>50–60%</strong> for beginners, <strong>75%</strong> for most classes,{" "}
                    <strong>90–100%</strong> for advanced students. Choose words with a clear stress, and listen to
                    the reference first: the reference decides which syllable is “right”. The word stress score
                    counts for 45% of the overall score (pronunciation 55%). With no stress words, the overall
                    score is pronunciation only.
                </p>
            </div>

            <div>
                <h5 className={h}>Melody match (default {pct(DEFAULT_MELODY_MIN_SIMILARITY)})</h5>
                <p>
                    For each stress word, the student's pitch curve (the melody) is compared with the reference's
                    by its <strong>shape</strong>: where the voice goes up and down through the word. The result is a
                    similarity from −100% (the opposite shape) to 100% (the same shape). At or above the{" "}
                    <strong>Melody match</strong> percentage the word gets <em>✓ Same melody</em>; below it, the
                    student gets coaching for each syllable (“dy” should go higher than “dad”).
                </p>
                <ul className="ml-5 list-disc">
                    <li><strong>30–40%:</strong> lenient. Only a clearly different shape fails.</li>
                    <li><strong>50%:</strong> moderate.</li>
                    <li><strong>70% or more:</strong> strict. The shape must follow the reference closely.</li>
                </ul>
                <p className="mt-1">
                    Shape only: a student with the right shape but a smaller voice movement still passes (with a
                    tip to make the rises and falls bigger). Short words where a syllable is too weak to measure
                    are compared on less, so a strict setting can fail them on very little. The melody is shown
                    with the results but <strong>not counted</strong> in the score.
                </p>
            </div>

            {LEGACY_STRESS_ENABLED && (
            <div>
                <h5 className={h}>Falling tone (default {pct(DEFAULT_FALL_MATCH_RATIO)})</h5>
                <p>
                    Checks that the unstressed syllables of a word drop in pitch and loudness, like the reference.
                    In “MOther”, the voice should fall on “-ther”. The drop is measured from the word's stressed
                    syllable. If it isn't low enough, the student sees <em>↓ Lower pitch</em> on that syllable.
                </p>
                <p className="mt-1">
                    The percentage is how much of the reference speaker's drop the student must reach. Example: the
                    reference drops 20% in pitch on “-ther”.
                </p>
                <ul className="ml-5 list-disc">
                    <li>At 75%, the student must drop about 15–16%.</li>
                    <li>At 55%, about 11% is enough.</li>
                    <li>At 100%, they must match the reference's drop.</li>
                </ul>
                <p className="mt-1">
                    Suggested: <strong>55–65%</strong> for beginners, <strong>75%</strong> for most classes,{" "}
                    <strong>85–100%</strong> for advanced students. It only affects words of two or more syllables.
                </p>
            </div>
            )}

            {RISING_TONE_ENABLED && (
            <div>
                <h5 className={h}>Rising tone (default {pct(DEFAULT_RISE_MATCH_RATIO)})</h5>
                <p>
                    Checks that the voice goes <strong>up</strong> at the end of a Yes/No question (“Is she a
                    teacher↗?”), from the last important word to the end of the sentence. It is only checked when
                    the reference itself rises clearly. Statements and Wh-questions are skipped. A student who stays
                    flat or falls sees <em>↑ Raise your voice at the end</em>. A small rise gets{" "}
                    <em>↑ Rise higher at the end</em>.
                </p>
                <p className="mt-1">
                    The percentage is how much of the reference's rise the student must reach (there's also a small
                    minimum: 2 semitones at {pct(DEFAULT_RISE_MATCH_RATIO)}). Example: the reference rises 6
                    semitones.
                </p>
                <ul className="ml-5 list-disc">
                    <li>At 50%, the student needs a 3-semitone rise.</li>
                    <li>At 35%, about 2 semitones is enough.</li>
                </ul>
                <p className="mt-1">
                    Suggested: start at <strong>35–40%</strong> for students who rarely raise their voice in
                    questions, and move toward 50% as they improve. When this check applies, it counts for 15% of
                    the overall score.
                </p>
            </div>
            )}

            <div>
                <h5 className={h}>Linking tolerance (default {DEFAULT_LINK_TOLERANCE}×, shown when Strict connected speech is on)</h5>
                <p>
                    Checks that words the reference speaker joins smoothly (“is_a”, “mother_is”) are joined by the
                    student too, without a pause. With targeted words, only those words and the next word are
                    checked. Otherwise every pair the reference links is checked.
                </p>
                <p className="mt-1">The number is how much longer a pause between linked words may be than the reference's:</p>
                <ul className="ml-5 list-disc">
                    <li>1×: up to {LINK_PAUSE_MARGIN_MS} ms extra pause (very strict, a tiny hesitation counts).</li>
                    <li>2×: up to {LINK_PAUSE_MARGIN_MS * 2} ms.</li>
                    <li>3×: up to {LINK_PAUSE_MARGIN_MS * 3} ms.</li>
                </ul>
                <p className="mt-1">
                    Higher values also accept a slightly larger gap and dip in loudness between the words. A missed
                    link costs 25 points on the first word and 20 on the next. Suggested: <strong>1.5–2×</strong> for
                    most classes. With Strict connected speech off, linking isn't checked or shown at all.
                </p>
            </div>

            <p>
                <strong>Tips:</strong> change one setting at a time, test it on yourself, and use <em>reset</em> to
                go back to the default.
            </p>
        </section>
    );
}

// The linking tolerance: how much longer a pause between linked words (e.g. "is_a") may be than
// the reference's, as a multiplier, with the pause it allows, its default and a reset.
function LinkToleranceSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const pauseMs = (v: number) => Math.round(LINK_PAUSE_MARGIN_MS * v);
    return (
        <label
            className="flex flex-col gap-1"
            title="How much longer a pause (or a dip in loudness) between linked words may be than in the reference before it counts as not linked. Higher = more lenient."
        >
            <span className="text-sm">
                Linking tolerance: <strong>{value}×</strong> (extra pause up to {pauseMs(value)} ms){" "}
                <span className="text-gray-600">
                    (default {DEFAULT_LINK_TOLERANCE}× / {pauseMs(DEFAULT_LINK_TOLERANCE)} ms)
                </span>
                {value !== DEFAULT_LINK_TOLERANCE && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            onChange(DEFAULT_LINK_TOLERANCE);
                        }}
                        className="ml-1 text-xs text-blue-600 underline"
                    >
                        reset
                    </button>
                )}
            </span>
            <input
                type="range"
                min={0.5}
                max={3}
                step={0.25}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-48"
            />
        </label>
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
    suffix = "of reference",
    min = 0.1,
    max = 1,
}: {
    label: string;
    hint: string;
    value: number;
    defaultValue: number;
    onChange: (v: number) => void;
    suffix?: string; // after the percentage, e.g. "of reference" or "similarity"
    min?: number;
    max?: number;
}) {
    const pctText = (v: number) => `${Math.round(v * 100)}%`;
    return (
        <label className="flex flex-col gap-1" title={hint}>
            <span className="text-sm">
                {label}: <strong>{pctText(value)}</strong> {suffix}{" "}
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
                min={min}
                max={max}
                step={0.05}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-48"
            />
        </label>
    );
}

// The small SSML helper buttons.
const ssmlButton = "text-sm text-gray-700 bg-gray-300 px-2 py-0.5 rounded-md hover:bg-gray-400";
