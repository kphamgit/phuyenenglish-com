import { useCallback, useEffect, useRef, useState } from "react";
import { toWav16kMono } from "../shared/wav";

// Records the microphone and turns each take into a 16 kHz mono WAV (what VoiceAnalyzer_Claude
// expects), raised to a normal loudness (see toWav16kMono's `normalize`).
// Shared by the student's Shadowing panel and the teacher's "test it yourself".
// Adapted from p2p-voice-chat-admin (ReferenceRecorder.tsx).
export function useRecorder() {
    const [recording, setRecording] = useState(false);
    const [converting, setConverting] = useState(false);
    const [take, setTake] = useState<{ wav: Blob; url: string } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Let go of the microphone (the browser's "recording" indicator goes away).
    const releaseMic = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    }, []);

    // Stop a recording in progress without keeping it.
    const discard = useCallback(() => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") {
            recorder.onstop = null;
            recorder.stop();
        }
        releaseMic();
        setRecording(false);
    }, [releaseMic]);

    // Discard any recording and forget the last take.
    const reset = useCallback(() => {
        discard();
        setTake(null);
        setError(null);
    }, [discard]);

    // Leaving the page mid-recording: stop without keeping anything.
    useEffect(() => () => discard(), [discard]);

    const record = useCallback(async () => {
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
                const wav = await toWav16kMono(new Blob(chunks, { type: recorder.mimeType }), { normalize: true });
                setTake((prev) => {
                    if (prev) URL.revokeObjectURL(prev.url);
                    return { wav, url: URL.createObjectURL(wav) };
                });
            } catch (err) {
                setError(`Converting the recording failed: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                setConverting(false);
            }
        };
        recorderRef.current = recorder;
        recorder.start();
        setRecording(true);
    }, [releaseMic]);

    const stop = useCallback(() => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") recorder.stop(); // onstop converts it
    }, []);

    return { recording, converting, take, error, record, stop, discard, reset };
}
