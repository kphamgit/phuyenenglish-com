import { useRef, useState } from "react";

// A round play button for an audio file, used in the teacher's Shadowing panel (saved sentences,
// the reference) and the students' results (their recordings).

// 3.4 → "0:03"
function formatTime(seconds: number): string {
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// The audio that a PlayButton is playing now, so that starting another one stops it.
let playingAudio: HTMLAudioElement | null = null;

// A round play button (a triangle in a circle) in place of the browser's audio controls; it shows
// a pause sign while playing, and a second click stops.
// With showTime it also shows "elapsed / length" (no progress bar), and a second click pauses
// rather than stops, so the next click carries on from there.
// With load (instead of src) the audio is fetched on the first click, e.g. a recording that
// needs the login to download; the button shows "…" meanwhile.
export function PlayButton({
    src,
    load,
    label,
    showTime = false,
}: {
    src?: string;
    load?: () => Promise<string>;
    label: string;
    showTime?: boolean;
}) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [length, setLength] = useState<number | null>(null);
    const toggle = async (e: React.MouseEvent) => {
        e.preventDefault(); // the button sits inside the row's label: don't tick the checkbox
        const audio = audioRef.current;
        if (!audio || loading) return;
        if (!audio.paused) {
            audio.pause();
            return;
        }
        if (!src && !loadedSrc && load) {
            setLoading(true);
            setFailed(false);
            try {
                const url = await load();
                // Set here only, never through the <audio> src prop: React writing it again on the
                // next render would restart loading and cancel the play() below (the button then
                // showed the pause sign but stayed silent until a second click).
                audio.src = url;
                setLoadedSrc(url);
            } catch (err) {
                console.error("PlayButton: loading the audio failed:", err);
                setFailed(true);
                return;
            } finally {
                setLoading(false);
            }
        }
        if (playingAudio && playingAudio !== audio) playingAudio.pause();
        playingAudio = audio;
        if (!showTime) audio.currentTime = 0;
        void audio.play().catch((err) => {
            console.error("PlayButton: can't play the audio:", err);
            setPlaying(!audio.paused); // don't leave the pause sign on a silent player
        });
    };
    return (
        <>
            <button
                type="button"
                onClick={(e) => void toggle(e)}
                aria-label={`${playing ? (showTime ? "Pause" : "Stop") : "Play"} “${label}”`}
                title={failed ? "Couldn't load the audio. Click to try again." : playing ? (showTime ? "Pause" : "Stop") : "Play"}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 hover:bg-blue-50 ${failed ? "border-red-600 text-red-600" : "border-blue-600 text-blue-600"}`}
            >
                {loading ? (
                    <span className="text-xs leading-none">…</span>
                ) : playing ? (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden="true">
                        <rect x="2" y="1.5" width="3" height="9" />
                        <rect x="7" y="1.5" width="3" height="9" />
                    </svg>
                ) : (
                    <svg viewBox="0 0 12 12" className="ml-0.5 h-3 w-3" fill="currentColor" aria-hidden="true">
                        <path d="M2.5 1.2v9.6L10.5 6z" />
                    </svg>
                )}
            </button>
            {showTime && (
                <span className="text-sm tabular-nums text-gray-700">
                    {formatTime(elapsed)} / {length === null ? "–:––" : formatTime(length)}
                </span>
            )}
            <audio
                ref={audioRef}
                src={src} // a loaded audio's (load) src is set in toggle instead, see there
                preload={showTime && src ? "metadata" : "none"}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration;
                    setLength(Number.isFinite(d) ? d : null);
                }}
                onDurationChange={(e) => {
                    const d = e.currentTarget.duration;
                    if (Number.isFinite(d)) setLength(d);
                }}
            />
        </>
    );
}

