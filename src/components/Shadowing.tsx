import { useEffect, useState } from "react";
import api from "../api";
import { toast } from "react-toastify";
import {
    DEFAULT_FALL_MATCH_RATIO,
    DEFAULT_LINK_TOLERANCE,
    DEFAULT_RISE_MATCH_RATIO,
    DEFAULT_MELODY_MIN_SIMILARITY,
    DEFAULT_STRESS_SOURCE,
    LEGACY_STRESS_ENABLED,
    LINK_PAUSE_MARGIN_MS,
    RISING_TONE_ENABLED,
    type EvaluationResult,
    type StressSource,
} from "./shadowing/evaluation";
import { EvaluationView } from "./shadowing/EvaluationView";
import { ReferenceAnalysisView, type ReferenceAnalysis, type ReferenceWordAnalysis } from "./shadowing/ReferenceAnalysisView";
import ShadowingResults from "./shadowing/ShadowingResults";
import { PlayButton } from "./shadowing/PlayButton";
import { useRecorder } from "./shadowing/useRecorder";
import { toWav16kMono, wavFileName } from "./shared/wav";

// Teacher-only "Shadowing": generate a reference recording of a sentence with ElevenLabs
// (/api/eleven_lab_tts/), Google TTS (/english/google_tts/) or Amazon Polly, replay it, and keep
// it with "Save Sentence" (/api/shadowing/save_sentence/: a kept audio in the library, see
// english/audio.py in Django), or pick a kept one from the audio library (/english/audios/). Adapted from the reference part
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
// A kept audio in the audio library (/english/audios/): a sentence saved here with "Save Sentence"
// (made_for "shadowing"), or one saved from a question form (made_for "question").
interface SavedSentence {
    id: number; text: string; tts_text: string; keywords: string[];
    provider: string; voice: string; speed: number | null; made_for: "question" | "shadowing";
    created_by: string | null; created_at: string; url: string;
}
// The SSML's <prosody rate="slow">, if it was made from SSML with one.
const ssmlRateOf = (saved: SavedSentence) => saved.tts_text.match(/rate="([^"]+)"/)?.[1] ?? null;
// The panel's Provider for a library audio (Audio keeps "google" for both Google voice kinds).
const providerOf = (saved: SavedSentence): Provider =>
    saved.provider === "google" ? (saved.voice.includes("Chirp3") ? "google" : "google_neural")
    : saved.provider === "polly" ? "polly" : "elevenlabs";
// How it was made, as the reference's TtsInfo (sent with it) and its label (as generateReference makes it).
const savedTts = (saved: SavedSentence): TtsInfo => ({
    provider: PROVIDER_NAME[providerOf(saved)], voice: saved.voice, speed: saved.speed, ssmlRate: ssmlRateOf(saved),
});
const savedLabel = (saved: SavedSentence) => {
    const rate = ssmlRateOf(saved);
    const speed = rate ? ` · SSML rate ${rate}` : `${saved.tts_text ? " · SSML" : ""} · ${saved.speed ?? 1}×`;
    return `${PROVIDER_TAG[providerOf(saved)]} ${saved.voice.replace(/^en-US-(Chirp3-HD-)?/, "")}${speed}`;
};
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
    // From Database (pointing to S3 storage): the keyword search and its results.
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
    // Shown to the students under each targeted word's link (e.g. "vờ" under have‿to), by the
    // word in lower case. Kept for words removed from Targeted words, in case they come back.
    const [helperWords, setHelperWords] = useState<Record<string, string>>({});
    // The targeted words, each once, parsed as the analyzer does (letters and apostrophes).
    const targetedWordList = [...new Set(targetedWords.toLowerCase().match(/[a-z']+/g) ?? [])];
    // The word after `word`'s first use in the sentence (lower case), for showing its connected
    // pair ("is" → "is_a"); null when it isn't there or is the last word.
    const nextWordAfter = (word: string) => {
        const words = (sentence.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).map((w) =>
            w.toLowerCase().replace(/’/g, "'"),
        );
        const i = words.indexOf(word);
        return i >= 0 && i + 1 < words.length ? words[i + 1]! : null;
    };
    // Linking check (the service turns it on anyway when targeted words are given).
    const [strictConnectedSpeech, setStrictConnectedSpeech] = useState(false);
    // The linking check judges the targeted words' links, so with the box ticked it needs at least
    // one (as in the p2p admin and phuyenenglish.net): Send and Score wait for it.
    const targetedMissing = strictConnectedSpeech && targetedWords.trim() === "";
    // How much of the reference's falling / rising pitch the student must reach. Lower = more lenient.
    const [fallMatchRatio, setFallMatchRatio] = useState(DEFAULT_FALL_MATCH_RATIO);
    const [riseMatchRatio, setRiseMatchRatio] = useState(DEFAULT_RISE_MATCH_RATIO);
    // How much longer a pause between linked words may be than the reference's. Higher = more lenient.
    const [linkTolerance, setLinkTolerance] = useState(DEFAULT_LINK_TOLERANCE);
    // Word Syllables Stress Check: the multi-syllable words to check (blank = no stress check),
    // and how much of the reference's stressed/unstressed contrast the student must reach.
    // One field per stress word; sent to the analyzer as "accept, apology".
    const [stressWordList, setStressWordList] = useState<string[]>([""]);
    const stressWords = stressWordList.map((w) => w.trim()).filter(Boolean).join(", ");
    // A sentence sent to students must check something: connected speech (the box, with targeted
    // words) or stress words. With neither, Send waits.
    const nothingChecked = !strictConnectedSpeech && targetedWords.trim() === "" && stressWords === "";
    // Each stress word's IPA (optional, display only), in the field after the word: same order as
    // stressWordList. Sent as stress_words_ipa, {"apology": "əˈpɒlədʒi"}; it replaces the IPA the
    // analyzer makes from the CMU dictionary, which splits it into syllables (each word's
    // "syllabified") and doesn't use it for scoring.
    const [stressIpaList, setStressIpaList] = useState<string[]>([""]);
    // Each stress word's Vietnamese pronunciation code (optional, display only), in the field after
    // its IPA, syllables separated by hyphens ("ơ-pô-lơ-di"): same order as stressWordList. Sent as
    // stress_words_viet; it replaces the code the analyzer makes from the CMU dictionary, and the
    // analyzer matches its parts to the IPA syllables.
    const [stressVietList, setStressVietList] = useState<string[]>([""]);
    // {word: value} as JSON text for the words at `indexes` with a value in `values`, or "".
    const wordMapFor = (values: string[], indexes: number[]) => {
        const pairs = indexes
            .map((i) => [stressWordList[i]?.trim() ?? "", values[i]?.trim() ?? ""] as const)
            .filter(([w, v]) => w && v);
        return pairs.length > 0 ? JSON.stringify(Object.fromEntries(pairs)) : "";
    };
    // How closely each stress word's melody (pitch shape) must follow the reference's. Higher = stricter.
    const [melodyMinSimilarity, setMelodyMinSimilarity] = useState(DEFAULT_MELODY_MIN_SIMILARITY);
    // Which syllable of each stress word should be stressed: the CMU dictionary's (the reference
    // audio as fallback, e.g. at the end of a Yes/No question) or the reference audio's.
    const [stressSource, setStressSource] = useState<StressSource>(DEFAULT_STRESS_SOURCE);
    // "Analyze reference audio" next to each stress word: what VoiceAnalyzer measures in the
    // reference alone, per word (lower-cased). Kept with the reference it was made from, and only
    // shown while that reference is the current one.
    const [refAnalyses, setRefAnalyses] = useState<Record<string, {
        refUrl: string; loading: boolean; result?: ReferenceWordAnalysis; error?: string;
    }>>({});
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
    // "Save sentence": keep a reference you like in the audio library (/api/shadowing/save_sentence/).
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
    // The reference sentence's words, each once ("I'm", "well-known" kept whole), as pick buttons.
    const sentenceWords = Array.from(
        new Map(
            (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).map((w) => [w.toLowerCase(), w] as const),
        ).values(),
    );
    const sameWord = (a: string, b: string) => a.trim().toLowerCase() === b.toLowerCase();
    const isStressWord = (word: string) => stressWordList.some((w) => sameWord(w, word));
    // Keeps the stress words whose index passes `keep`, with their IPA; never leaves the list
    // without a field to type in.
    const keepStressFields = (keep: (i: number) => boolean) => {
        const indexes = stressWordList.map((_, i) => i).filter(keep);
        setStressWordList(indexes.length > 0 ? indexes.map((i) => stressWordList[i]!) : [""]);
        setStressIpaList(indexes.length > 0 ? indexes.map((i) => stressIpaList[i] ?? "") : [""]);
        setStressVietList(indexes.length > 0 ? indexes.map((i) => stressVietList[i] ?? "") : [""]);
    };
    // A word button puts the word in the first empty field (or a new one), or takes its field out
    // if it's already there.
    const toggleStressWord = (word: string) => {
        if (isStressWord(word)) {
            keepStressFields((i) => !sameWord(stressWordList[i]!, word));
            return;
        }
        const blank = stressWordList.findIndex((w) => w.trim() === "");
        if (blank >= 0) {
            setStressWordList(stressWordList.map((w, i) => (i === blank ? word : w)));
        } else {
            setStressWordList([...stressWordList, word]);
            setStressIpaList([...stressWordList.map((_, i) => stressIpaList[i] ?? ""), ""]);
            setStressVietList([...stressWordList.map((_, i) => stressVietList[i] ?? ""), ""]);
        }
    };
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

    // Library audios whose words or keywords contain every word of the search (blank = the newest),
    // the ones saved here (made_for "shadowing") first.
    const searchSaved = async () => {
        setSearching(true);
        setSearchError(null);
        try {
            const res = await api.get("/english/audios/", { params: { q: searchQuery.trim(), prefer: "shadowing" } });
            setSearchResults(res.data as SavedSentence[]);
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
            const res = await api.get(`/english/audios/${saved.id}/file/`, { responseType: "blob" });
            const blob = res.data as Blob;
            if (reference) URL.revokeObjectURL(reference.url);
            setSentence(saved.text);
            setReference({
                blob,
                url: URL.createObjectURL(blob),
                sentence: saved.text,
                ssml: "",
                voice: savedLabel(saved),
                tts: savedTts(saved),
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

    // Sends the reference and one stress word to VoiceAnalyzer (through Django) and keeps what it
    // measures in the reference alone: the stressed syllable, the dictionary's, and the melody.
    const analyzeReference = async (word: string, index: number) => {
        const key = word.trim().toLowerCase();
        if (!key || !reference || !referenceReady || refAnalyses[key]?.loading) return;
        const refUrl = reference.url;
        setRefAnalyses((all) => ({ ...all, [key]: { refUrl, loading: true } }));
        try {
            const form = new FormData();
            form.append("reference_file", reference.blob, "reference.mp3");
            form.append("sentence", reference.sentence);
            form.append("stress_words", word.trim());
            form.append("stress_source", stressSource);
            form.append("stress_words_ipa", wordMapFor(stressIpaList, [index]));
            form.append("stress_words_viet", wordMapFor(stressVietList, [index]));
            const res = await api.post("/api/shadowing/analyze_reference/", form);
            const data = res.data as ReferenceAnalysis;
            const result = data.words.find((w) => sameWord(w.word, word)) ?? data.words[0];
            setRefAnalyses((all) => ({ ...all, [key]: { refUrl, loading: false, result } }));
        } catch (err) {
            console.error("Shadowing: analyzing the reference failed:", err);
            const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            setRefAnalyses((all) => ({
                ...all, [key]: { refUrl, loading: false, error: message ?? "Analyzing the reference audio failed." },
            }));
        }
    };

    // The scoring options as form fields (sent with the exercise, or with a test).
    const appendOptions = (form: FormData) => {
        const strict = strictConnectedSpeech || targetedWords.trim() !== "";
        form.append("targeted_words", targetedWords.trim());
        // {word: helper word} for the current targeted words that have one.
        form.append("helper_words", JSON.stringify(Object.fromEntries(
            targetedWordList.flatMap((w) => (helperWords[w]?.trim() ? [[w, helperWords[w].trim()]] : [])),
        )));
        form.append("strict_connected_speech", String(strict));
        // Hidden (paused) sliders send their defaults.
        form.append("fall_match_ratio", String(LEGACY_STRESS_ENABLED ? fallMatchRatio : DEFAULT_FALL_MATCH_RATIO));
        form.append("rise_match_ratio", String(RISING_TONE_ENABLED ? riseMatchRatio : DEFAULT_RISE_MATCH_RATIO));
        // The slider is hidden when strict is off (linking isn't checked then), so its value isn't sent.
        form.append("link_tolerance", String(strict ? linkTolerance : DEFAULT_LINK_TOLERANCE));
        const words = stressWords.trim();
        form.append("stress_words", words);
        form.append("melody_min_similarity", String(words ? melodyMinSimilarity : DEFAULT_MELODY_MIN_SIMILARITY));
        form.append("stress_source", stressSource);
        const all = stressWordList.map((_, i) => i);
        form.append("stress_words_ipa", words ? wordMapFor(stressIpaList, all) : "");
        form.append("stress_words_viet", words ? wordMapFor(stressVietList, all) : "");
    };

    const recordTest = () => {
        setTestResult(null);
        setScoredWith(null);
        setSavedFolder(null);
        setTestError(null);
        void recorder.record();
    };

    const scoreTest = async () => {
        if (!reference || !referenceReady || !recorder.take || testing || targetedMissing) return;
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
    // (an Audio row in the database, its MP3 in S3 under audios/library/).
    // Downloads the reference as a 16 kHz mono WAV (converted in the browser), named after its sentence.
    const [convertingWav, setConvertingWav] = useState(false);
    // Converts an audio blob to a 16 kHz mono WAV and hands it to the browser as a download.
    const saveAsWav = async (blob: Blob, sentenceText: string) => {
        const url = URL.createObjectURL(await toWav16kMono(blob));
        const link = document.createElement("a");
        link.href = url;
        link.download = wavFileName(sentenceText);
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const downloadWav = async () => {
        if (!reference || convertingWav) return;
        setConvertingWav(true);
        setError(null);
        try {
            await saveAsWav(reference.blob, reference.sentence);
        } catch (err) {
            setError(`Converting to WAV failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setConvertingWav(false);
        }
    };

    // Downloads a saved sentence's audio (From Database / S3 list) as WAV, for testing later.
    const [downloadingSavedId, setDownloadingSavedId] = useState<SavedSentence["id"] | null>(null);
    const downloadSavedWav = async (saved: SavedSentence) => {
        if (downloadingSavedId !== null) return;
        setDownloadingSavedId(saved.id);
        setSearchError(null);
        try {
            const blob = reference?.savedId === saved.id
                ? reference.blob
                : ((await api.get(`/english/audios/${saved.id}/file/`, { responseType: "blob" })).data as Blob);
            await saveAsWav(blob, saved.text);
        } catch (err) {
            console.error("Shadowing: downloading the saved audio as WAV failed:", err);
            setSearchError("Downloading that audio as WAV failed.");
        } finally {
            setDownloadingSavedId(null);
        }
    };

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
            const s3Path = ((res.data.url as string | undefined) ?? "").replace(/^https:\/\/[^/]+\//, "");
            toast.success(
                <div className="flex flex-col gap-1 text-sm">
                    <span>Saved to the audio library (ID {res.data.id}). Audio file in S3:</span>
                    <code className="break-all">{s3Path}</code>
                    <span>The sentence, keywords, voice and scoring options were saved to the database.</span>
                </div>,
                { autoClose: 8000 },
            );
        } catch (err) {
            console.error("Shadowing: saving the sentence failed:", err);
            const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
            setSentenceError(message ? `Saving failed: ${message}` : "Saving the sentence failed.");
        } finally {
            setSavingSentence(false);
        }
    };

    const sendToStudents = async () => {
        if (!reference || !referenceReady || sending || targetedMissing || nothingChecked) return;
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
                        <option value="s3">From Database (pointing to S3 storage)</option>
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
                                {searching ? "Searching…" : "Search Database"}
                            </button>
                        </form>
                        <p className="text-xs text-gray-600">
                            Searches the audio library: the sentences saved here (listed first) and the audio saved
                            from question forms. Finds the ones that contain every word you type, in the sentence or
                            its keywords. Leave it blank to list the newest. Check one to use it as the reference.
                        </p>
                        {searchError && <p className="text-sm text-red-700" role="alert">{searchError}</p>}
                        {searchResults && (searchResults.length === 0 ? (
                            <p className="text-sm text-gray-700">No audio in the library matches.</p>
                        ) : (
                            <ul className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                                {searchResults.map((saved) => {
                                    const checked = reference?.savedId === saved.id;
                                    const details = [
                                        savedLabel(saved),
                                        new Date(saved.created_at).toLocaleDateString(),
                                        saved.made_for === "question" ? "saved from a question" : "",
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
                                                    <span className="flex flex-wrap items-center gap-2">
                                                        <span className="font-medium">{saved.text}</span>
                                                        <PlayButton src={saved.url} label={saved.text} />
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                // Keep the click from toggling the row's checkbox.
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                void downloadSavedWav(saved);
                                                            }}
                                                            disabled={downloadingSavedId !== null}
                                                            className="text-xs text-gray-800 bg-gray-300 px-2 py-0.5 rounded-md hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                                            title="Save this audio as a 16 kHz mono WAV"
                                                        >
                                                            {downloadingSavedId === saved.id ? "Converting…" : "Download"}
                                                        </button>
                                                    </span>
                                                    <span className="text-xs text-gray-600">
                                                        {details}
                                                        {loadingSavedId === saved.id && " · Loading…"}
                                                    </span>
                                                </span>
                                            </label>
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
                    {/* The sentence is typed only for a new TTS reference; a saved one brings its own. */}
                    <label className="flex flex-col gap-1">
                        Reference sentence
                        <input
                            value={sentence}
                            onChange={(e) => setSentence(e.target.value)}
                            placeholder="e.g. I think this is a very good idea."
                            className="bg-white border border-gray-400 rounded-md p-2"
                        />
                    </label>
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
                        {reference && <PlayButton key={reference.url} src={reference.url} label="reference audio" showTime />}
                        {reference && (
                            <button
                                type="button"
                                onClick={() => void downloadWav()}
                                disabled={convertingWav}
                                className="text-gray-800 bg-gray-300 p-2 rounded-md hover:bg-gray-400 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Save this reference as a 16 kHz mono WAV"
                            >
                                {convertingWav ? "Converting…" : "Download WAV"}
                            </button>
                        )}
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
                                    {savingSentence ? "Saving…" : savedSentence?.url === reference.url ? "Sentence saved" : "Save Sentence"}
                                </button>
                            </div>
                            <p className="text-xs text-gray-900">
                                Like this reference? Save it to find it later by any word of the sentence or by its keywords
                                (separate keywords with commas). It goes into the audio library, shared with the question
                                forms: the audio file is stored in S3 under{" "}
                                <code><strong className="text-blue-700">audios/library</strong>/ (or <strong className="text-blue-700">dev/audios/library</strong>/</code> if in dev), and a database row (Audio) keeps everything
                                else: the sentence, keywords, voice, speed, scoring options and the S3 location of the audio.
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

            {/* Scoring options (used by Send to Students and Test it yourself) */}
            <fieldset className="flex flex-col gap-3 rounded-md border border-gray-400 p-3">
                <legend className="px-1 text-sm font-semibold">Scoring options</legend>
                <div className="flex flex-wrap items-end gap-4">
                    <div className="flex flex-col gap-2">
                        <label className="flex flex-col gap-1">
                            <span className="text-sm">
                                Targeted words{" "}
                                {strictConnectedSpeech || targetedWords.trim() !== "" ? (
                                    <span className="text-red-700">(required)</span>
                                ) : (
                                    "(optional)"
                                )}
                            </span>
                            <input
                                value={targetedWords}
                                onChange={(e) => setTargetedWords(e.target.value)}
                                placeholder="e.g. is"
                                title="Word(s) that should link to the next word, e.g. is → is_a. Required when Evaluate Connected Speech is ticked."
                                aria-required={strictConnectedSpeech}
                                className={`bg-white border rounded-md p-2 w-48 ${targetedMissing ? "border-red-600" : "border-gray-400"}`}
                            />
                        </label>
                        <p className="m-0 max-w-xs text-xs text-gray-500">
                            Type only the <strong>first word</strong> of each connected word pair: “is” for “is_a”.
                            Separate several with commas (is, have).
                        </p>
                        {/* One line per connected word pair: the pair, then its Helper Word (optional), which
                            the students see under that link. */}
                        {targetedWordList.map((w) => {
                            const next = nextWordAfter(w);
                            return (
                                <div key={w} className="flex flex-wrap items-center gap-2">
                                    <span
                                        className="min-w-24 font-mono text-sm"
                                        title={next ? undefined : `“${w}” isn't followed by another word in the sentence`}
                                    >
                                        {w}_{next ?? <span className="text-gray-400">?</span>}
                                    </span>
                                    <label className="flex items-center gap-1">
                                        <span className="text-sm">Helper Word</span>
                                        <input
                                            value={helperWords[w] ?? ""}
                                            onChange={(e) => setHelperWords((all) => ({ ...all, [w]: e.target.value }))}
                                            placeholder="e.g. vờ"
                                            aria-label={`Helper Word for ${w}`}
                                            title={`Optional: shown to the students under the link from “${w}” to the next word`}
                                            className="bg-white border border-gray-400 rounded-md p-2 w-40"
                                        />
                                    </label>
                                </div>
                            );
                        })}
                    </div>
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
                {/* Where the right stressed syllable of each stress word comes from. */}
                <div role="radiogroup" aria-label="Stress pattern source" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                    {([
                        ["dictionary", "Use stress pattern from CMU dictionary"],
                        ["reference", "Use stress pattern from reference audio"],
                    ] as const).map(([value, label]) => (
                        <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                                type="radio"
                                name="stress-source"
                                value={value}
                                checked={stressSource === value}
                                onChange={() => setStressSource(value)}
                            />
                            {label}
                            {value === DEFAULT_STRESS_SOURCE && <span className="text-gray-600">(default)</span>}
                        </label>
                    ))}
                </div>
                {stressSource === "dictionary" && (
                    <p className="-mt-1 text-xs text-gray-600">
                        The reference audio decides only when the dictionary can't: the last word of a Yes/No question,
                        a word that isn't in the dictionary, or a word with two stress patterns (record, present).
                    </p>
                )}
                {sentenceWords.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <span className="text-sm text-gray-700">Click the words to stress-check (click again to remove):</span>
                        <div className="flex flex-wrap gap-1.5">
                            {sentenceWords.map((word) => {
                                const on = isStressWord(word);
                                return (
                                    <button
                                        key={word.toLowerCase()}
                                        type="button"
                                        onClick={() => toggleStressWord(word)}
                                        aria-pressed={on}
                                        className={`rounded-md border px-2 py-1 text-sm ${
                                            on
                                                ? "border-blue-700 bg-blue-600 text-white hover:bg-blue-800"
                                                : "border-gray-400 bg-white text-gray-900 hover:bg-gray-100"
                                        }`}
                                    >
                                        {word}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className="flex flex-wrap items-end gap-4">
                    {/* Word Syllables Stress Check: which syllable is stressed inside each word given here. */}
                    <fieldset className="flex flex-col gap-1">
                        <legend className="mb-1 text-sm">
                            Stress words (optional){" "}
                            <span className="text-gray-600">
                                The multi-syllable words checked for syllable stress pattern. Leave empty to test
                                linking only.
                            </span>
                        </legend>
                        {stressWordList.map((word, i) => {
                            const analysis = refAnalyses[word.trim().toLowerCase()];
                            const shown = analysis && reference && analysis.refUrl === reference.url ? analysis : null;
                            return (
                            <div key={i} className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-1">
                                <input
                                    value={word}
                                    onChange={(e) => setStressWordList(stressWordList.map((w, j) => (j === i ? e.target.value : w)))}
                                    placeholder={i === 0 ? "e.g. apology" : "another word"}
                                    aria-label={`Stress word ${i + 1}`}
                                    title="A multi-syllable word whose syllable stress is checked against the reference (Word Syllables Stress Check)."
                                    className="bg-white border border-gray-400 rounded-md p-2 w-56"
                                />
                                <input
                                    value={stressIpaList[i] ?? ""}
                                    onChange={(e) => setStressIpaList(stressWordList.map((_, j) => (j === i ? e.target.value : stressIpaList[j] ?? "")))}
                                    placeholder={i === 0 ? "IPA (auto), e.g. əˈpɒlədʒi" : "IPA (auto)"}
                                    aria-label={`IPA of stress word ${i + 1}`}
                                    title="Optional: leave empty to use the American IPA made from the CMU dictionary (click Analyze reference audio to see it). Type one here to replace it, with ˈ before the stressed syllable, e.g. əˈpɒlədʒi. Shown split into syllables in the results; it isn't used for scoring."
                                    spellCheck={false}
                                    className="bg-white border border-gray-400 rounded-md p-2 w-44"
                                />
                                <input
                                    value={stressVietList[i] ?? ""}
                                    onChange={(e) => setStressVietList(stressWordList.map((_, j) => (j === i ? e.target.value : stressVietList[j] ?? "")))}
                                    placeholder={i === 0 ? "Vietnamese (auto), e.g. ơ-pô-lơ-di" : "Vietnamese (auto)"}
                                    aria-label={`Vietnamese pronunciation code of stress word ${i + 1}`}
                                    title="Optional: leave empty to use the Vietnamese pronunciation code made from the CMU dictionary (click Analyze reference audio to see it). Type one here to replace it: one part per syllable, separated by hyphens (ơ-pô-lơ-di). Shown with the IPA syllables in the results; it isn't used for scoring."
                                    lang="vi"
                                    spellCheck={false}
                                    className="bg-white border border-gray-400 rounded-md p-2 w-44"
                                />
                                {(stressWordList.length > 1 || word !== "" || (stressIpaList[i] ?? "") !== "" || (stressVietList[i] ?? "") !== "") && (
                                    <button
                                        type="button"
                                        onClick={() => keepStressFields((j) => j !== i)}
                                        aria-label={`Remove stress word ${i + 1}`}
                                        title="Remove"
                                        className="h-8 w-8 rounded-md text-lg leading-none text-gray-600 hover:bg-gray-300 hover:text-gray-900"
                                    >
                                        ×
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => void analyzeReference(word, i)}
                                    disabled={!word.trim() || !reference || !referenceReady || shown?.loading}
                                    title={!reference || !referenceReady
                                        ? "Generate (or load) the reference audio for this sentence first"
                                        : "Measure this word's stressed syllable and melody in the reference audio"}
                                    className="rounded-md border border-gray-400 bg-white px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-50"
                                >
                                    {shown?.loading ? "Analyzing…" : "Analyze reference audio"}
                                </button>
                            </div>
                            {shown?.result && <ReferenceAnalysisView analysis={shown.result} />}
                            {shown?.error && <p className="text-sm text-red-700">{shown.error}</p>}
                            </div>
                            );
                        })}
                        <button
                            type="button"
                            onClick={() => {
                                setStressWordList([...stressWordList, ""]);
                                setStressIpaList([...stressWordList.map((_, i) => stressIpaList[i] ?? ""), ""]);
                                setStressVietList([...stressWordList.map((_, i) => stressVietList[i] ?? ""), ""]);
                            }}
                            className="self-start text-sm text-blue-700 hover:underline"
                        >
                            + Add a word
                        </button>
                    </fieldset>
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
            </fieldset>

            {/* Send the reference, with the scoring options above, to the students. */}
            <fieldset className="flex flex-col gap-3 rounded-md border border-gray-400 p-3">
                <legend className="px-1 text-sm font-semibold">Send to Students</legend>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={() => void sendToStudents()}
                        disabled={!referenceReady || sending || targetedMissing || nothingChecked}
                        className={`text-white bg-green-600 p-2 rounded-md hover:bg-green-800 ${
                            !referenceReady || sending || targetedMissing || nothingChecked ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                    >
                        {sending ? "Sending…" : "Send to Students"}
                    </button>
                    {!referenceReady && <span className="text-sm text-gray-600">Choose or generate the reference first.</span>}
                    {targetedMissing && (
                        <span className="text-sm text-red-700">
                            Evaluate Connected Speech is on: type at least one targeted word, or untick it.
                        </span>
                    )}
                    {nothingChecked && (
                        <span className="text-sm text-red-700">
                            Nothing to check yet: type targeted words (Connected Speech) or stress words (Scoring options).
                        </span>
                    )}
                </div>
                <p className="text-xs text-[#5C3A1E]">
                    Reference audio will be sent to S3 directory:{" "}
                    <code><strong className="text-blue-700">/audios/temp_shadowing_sentences</strong></code> (or{" "}
                    <code><strong className="text-blue-700">dev/audios/temp_shadowing_sentences</strong></code> if in dev) for students to pick up
                    (via Redis signal). Files will be auto-deleted after 2 days according to rule set in S3.
                </p>
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
                            disabled={!referenceReady || testing || targetedMissing}
                            className="px-4 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {testing ? "Scoring…" : "Score my recording"}
                        </button>
                        {targetedMissing && (
                            <span className="text-sm text-red-700">
                                Type at least one targeted word (Scoring options), or untick Evaluate Connected Speech.
                            </span>
                        )}
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
                        <button
                            onClick={() => downloadRecording(scoredWith.recording, scoredWith.sentence)}
                            title="Download the recording you scored, as a WAV file"
                            className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-700 text-white"
                        >
                            Download WAV
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
                <strong>Which way is easier?</strong> Melody match: <strong>lower = more lenient</strong>.
                Linking tolerance: <strong>higher = more lenient</strong>.
            </p>

            <div>
                <h5 className={h}>
                    Word Syllables Stress Check: Stress words
                </h5>
                <p>
                    Type the multi-syllable words you want checked in <strong>Stress words</strong>, separated by
                    commas (for example “accept, apology”). Each word is checked <strong>on its own</strong>: the
                    syllables of the word are compared with each other, not with the rest of the sentence. This field
                    is optional: leave it empty when the sentence only tests linking (no stress check is made then).
                </p>
                <p className="mt-1">
                    <strong>Which syllable is right?</strong> With <strong>Use stress pattern from CMU dictionary</strong>{" "}
                    (the default), the dictionary decides (ac-<strong>CEPT</strong>, a-<strong>POL</strong>-o-gy). The
                    reference audio decides only when the dictionary can't: the last word of a Yes/No question (“Do
                    you play basket<strong>BALL</strong>?”, where the rising voice often moves the stress), a word
                    that isn't in the dictionary, or a word with two stress patterns (<strong>REC</strong>-ord /
                    re-<strong>CORD</strong>). With <strong>Use stress pattern from reference audio</strong>, the
                    syllable the reference voice made strongest is always the right one. The results table shows,
                    under <em>Expected</em>, which one decided.
                </p>
                <p className="mt-1">
                    <strong>Stress isn't scored.</strong> For each word, the results show the expected stress pattern,
                    the one the reference voice used and the one the student used (in green when it's the expected
                    one, amber otherwise), so you can compare them. There's no verdict and no word stress score: the
                    overall score is the pronunciation score. Choose words with a clear stress, and listen to the
                    reference first, especially when it decides the stress (Yes/No questions).
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
                    student too, without a pause. Only the targeted words and the word after each are checked, so
                    with Evaluate Connected Speech ticked you need at least one targeted word: Send and Score wait
                    until there is one.
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

// Saves the teacher's scored test recording (already a 16 kHz mono WAV) to the computer, named
// after the sentence with "-my-recording" (e.g. "turn-it-off-my-recording.wav"), so it isn't
// mistaken for the reference's WAV.
function downloadRecording(wav: Blob, sentence: string) {
    const url = URL.createObjectURL(wav);
    const link = document.createElement("a");
    link.href = url;
    link.download = wavFileName(sentence).replace(/\.wav$/, "-my-recording.wav");
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
