import { useState, useEffect, useRef, type ReactNode } from "react";
import api from "../api";
import chimeSound from "../assets/chime.mp3";
import { type LevelProps} from "../components/Level";
import "../styles/Home.css"
import Navbar from "../components/Navbar";
//import { type RootState } from "../redux/store";
import TakeQuizLive from "../components/TakeQuizLive";
import { useSelector } from 'react-redux';
import type { RootState } from '../redux/store';
//import type { WebSocketMessageProps } from "../components/shared/types";
//import ScoreBoard from "./ScoreBoard";
//import { clearLiveQuestionInfo} from "../redux/connectedUsersSlice";
//import type { AppDispatch } from "../redux/store";
import { useWebSocket } from "../components/context/WebSocketContext";
import type { WebSocketMessageProps, VideoSegment, MarkedWord } from "../components/shared/types";
import { useUserConnections } from "../components/context/UserConnectionsContext";
import { Outlet, useLocation } from "react-router-dom";

export type HomeStudentOutletContext = {
    setFinishedQuizPath: (path: string) => void;
    // Lets quiz pages (e.g. a reading passage) handle clicks on sense-tagged words the same way
    // as the teacher's pushed text: play the audio and add the sense's card to review.
    onMarkedWordClick: (word: Pick<MarkedWord, "text" | "sense_id">) => void;
};
import AssignmentModal from "../components/AssignmentModal";
import CardReview from "../components/CardReview";
import TakeVideoQuizLive from "../components/TakeVideoQuizLive";
import StudentLiveVideo from "../components/StudentLiveVideo";
import SingleCardReview, { type ReviewCard } from "../components/SingleCardReview";
import DefinitionPopup from "../components/DefinitionPopup";
import DictionaryLookup from "../components/DictionaryLookup";
// import TranslationBox from "../components/TranslationBox";  // hidden for now (it was in the removed bottom bar)
import VoiceAnswerRecorder from "../components/chat/VoiceAnswerRecorder";
import StudentShadowing from "../components/shadowing/StudentShadowing";
import type { ShadowingPrompt } from "../components/shadowing/evaluation";
import { ttsTextOf, playPromptTts, stripSsml, shouldSkipTts } from "../components/chat/tts";
import { renderVietPron } from "../components/vietPron";

type HomeTab = "playground" | "quizzes";

// The teacher's live activities that are shown in Playground.
type ActivityKind = "image" | "video" | "text" | "recording" | "shadowing";
const ACTIVITY_NAMES: Record<ActivityKind, string> = {
    image: "an image",
    video: "a video",
    text: "a message",
    recording: "a recording prompt",
    shadowing: "a shadowing exercise",
};
type Unseen = { kind: ActivityKind; toast: boolean };
// What the current activity is called in the Accept toast ("…in place of the image").
const CURRENT_NAMES: Record<ActivityKind, string> = {
    image: "the image",
    video: "the video",
    text: "the message",
    recording: "the recording prompt",
    shadowing: "your shadowing exercise",
};
// The content of live activities, by kind: what an arriving message brings.
interface ActivityContent {
    image?: string;
    video?: string;
    text?: { content: string; marked: MarkedWord[] };
    recording?: { prompt: string; raw: string; voice?: string; skipTts: boolean };
    shadowing?: ShadowingPrompt;
}
// Activities held back while Playground shows another one, until the student accepts: the newest
// one's kind (shown in the toast, opened on Accept) and the content of each held kind (all applied
// on Accept, so none is lost).
type Incoming = { kind: ActivityKind; content: ActivityContent };

// What's kept in sessionStorage (per browser tab, per student) so a reload doesn't lose the
// live activities.
interface SavedLiveActivities {
    image: string | null;
    video: string | null;
    text: string | null;
    markedWords: MarkedWord[];
    sr: {
        prompt: string; raw: string | null; voice?: string; skipTts: boolean; micDisabled: boolean;
        answer: { english: string; vietnamese: string | null } | null;
    } | null;
    shadowing: ShadowingPrompt | null;
    active: ActivityKind | null; // the activity Playground shows
    incoming: Incoming | null;
    unseen: Unseen[];
}
const NO_LIVE_ACTIVITIES: SavedLiveActivities = {
    image: null, video: null, text: null, markedWords: [], sr: null, shadowing: null, active: null, incoming: null, unseen: [],
};
const liveActivitiesKey = (name: string) => `live_activities:${name}`;

function loadLiveActivities(name: string): SavedLiveActivities {
    try {
        const raw = sessionStorage.getItem(liveActivitiesKey(name));
        return raw ? { ...NO_LIVE_ACTIVITIES, ...(JSON.parse(raw) as Partial<SavedLiveActivities>) } : NO_LIVE_ACTIVITIES;
    } catch {
        return NO_LIVE_ACTIVITIES;
    }
}

function saveLiveActivities(name: string, value: SavedLiveActivities) {
    try {
        sessionStorage.setItem(liveActivitiesKey(name), JSON.stringify(value));
    } catch {
        // Storage blocked or full: the activities just won't survive a reload.
    }
}
const HOME_TABS: [HomeTab, string][] = [["playground", "Playground"], ["quizzes", "Quizzes"]];

function HomeStudent() {
    const [levels, setLevels] = useState<LevelProps[]>([]);
    const pendingAssignments = useSelector((state: RootState) => state.pendingAssignments.assignments);
    const [showAssignmentModal, setShowAssignmentModal] = useState(false);
    const [showVocabReview, setShowVocabReview] = useState(false);
    // Latest image the teacher pushed to students (presigned S3 url), shown outside a live quiz.
    const { name } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);
    // The live activities as saved in this browser tab, so a reload doesn't lose them.
    const [saved] = useState(() => loadLiveActivities(name));
    const [liveImageUrl, setLiveImageUrl] = useState<string | null>(saved.image);
    // Latest YouTube url the teacher pushed to students, shown outside a live quiz.
    const [liveVideoUrl, setLiveVideoUrl] = useState<string | null>(saved.video);
    // Latest free-form text the teacher pushed to students, shown outside a live quiz.
    const [liveTextContent, setLiveTextContent] = useState<string | null>(saved.text);
    // Card shown for immediate review when the student clicks a marked (sense-tagged) word.
    // `autoPlay` = whether the panel should autoplay its audio (only when lemma differs from surface).
    const [reviewCard, setReviewCard] = useState<{ card: ReviewCard; autoPlay: boolean; audioMissing: boolean; surfaceWord: string } | null>(null);
    // Card whose definition is shown on a repeat click of a marked word (read-only, no rating).
    const [definitionCard, setDefinitionCard] = useState<{ card: ReviewCard; autoPlay: boolean; audioMissing: boolean; surfaceWord: string } | null>(null);
    // Words the teacher marked "to learn" in the pushed text; shown to the student as buttons.
    const [liveTextMarkedWords, setLiveTextMarkedWords] = useState<MarkedWord[]>(saved.markedWords);

    // Recording / speech-recognition (SR), moved out of the chat box. The teacher sends an
    // "SR ..." chat message; the student answers by voice using the fixed bottom mic, and both
    // the prompt and the student's own transcript are shown centered here (not in the chat box).
    const [srPrompt, setSrPrompt] = useState<string | null>(saved.sr?.prompt ?? null);         // SSML-stripped text, for display
    const [srPromptRaw, setSrPromptRaw] = useState<string | null>(saved.sr?.raw ?? null);   // original (may contain SSML), for TTS
    const [srAnswer, setSrAnswer] = useState<{ english: string; vietnamese: string | null; audioUrl?: string } | null>(saved.sr?.answer ?? null);
    const [srMicDisabled, setSrMicDisabled] = useState<boolean>(saved.sr?.micDisabled ?? false);
    // true when the prompt carries a "/.../" pronunciation help or a "(...)" note,
    // in which case we do NOT speak it (no auto-play, no Play button).
    const [srSkipTts, setSrSkipTts] = useState<boolean>(saved.sr?.skipTts ?? false);
    // The Neural2 voice the teacher chose for this prompt; used for every playback (auto-play
    // and the Play button) so the student hears the same voice each time.
    const [srVoice, setSrVoice] = useState<string | undefined>(saved.sr?.voice);

    const {liveQuizId, liveQuestionNumber, setLiveQuizId} = useUserConnections();

    // While the student is on a take-quiz route, disable the Navbar so they leave via "Terminate Quiz".
    // TakeQuiz reports the path of a quiz it finished (via Outlet context), so the Navbar is
    // re-enabled on the "Quiz Completed" screen. Starting another quiz is a new path, so it's
    // disabled again. Any navigation also clears it, so retaking the same quiz (same path) is disabled too.
    const location = useLocation();
    const [finishedQuizPath, setFinishedQuizPath] = useState<string | null>(null);
    const [prevPathname, setPrevPathname] = useState(location.pathname);
    if (prevPathname !== location.pathname) {
        setPrevPathname(location.pathname);
        setFinishedQuizPath(null);
    }
    const inQuiz = /\/take_(video_|reading_)?quiz\//.test(location.pathname) && finishedQuizPath !== location.pathname;

    // The top-level tabs. Playground is shown on login (at "/"); the units and quizzes pages
    // (/categories/...) are in Quizzes, so opening one (a reload, a pending assignment's link)
    // switches to Quizzes.
    const [homeTab, setHomeTab] = useState<HomeTab>(location.pathname === "/" ? "playground" : "quizzes");
    const [tabPath, setTabPath] = useState(location.pathname);
    if (location.pathname !== tabPath) {
        setTabPath(location.pathname);
        if (location.pathname !== "/") setHomeTab("quizzes");
    }

    // Live activities that arrived while the student wasn't on Playground: the tab's badge, and a
    // toast each (toast: false once closed). One per kind; opening Playground clears them.
    const [unseen, setUnseen] = useState<Unseen[]>(saved.unseen);
    if (homeTab === "playground" && unseen.length > 0) setUnseen([]);
    // Called by the message handler, which can't see the current tab: noted as unseen, and
    // cleared above at once if Playground is open.
    const noteArrival = (kind: ActivityKind) =>
        setUnseen((all) => [...all.filter((u) => u.kind !== kind), { kind, toast: true }]);

    // Playground shows one activity at a time: the latest. Its Shadowing exercise is kept here
    // (StudentShadowing shows it).
    const [shadowingPrompt, setShadowingPrompt] = useState<ShadowingPrompt | null>(saved.shadowing);
    const [activeKind, setActiveKind] = useState<ActivityKind | null>(saved.active);
    const [incoming, setIncoming] = useState<Incoming | null>(saved.incoming);
    // What Playground is showing (the active activity, if it's still there: image, video, text
    // and recording prompt can be dismissed).
    const srActive = activeKind === "recording" && !!srPrompt;
    const showingActivity =
        (activeKind === "image" && !!liveImageUrl) ||
        (activeKind === "video" && !!liveVideoUrl) ||
        (activeKind === "text" && !!liveTextContent) ||
        srActive ||
        (activeKind === "shadowing" && !!shadowingPrompt);

    // What the message handler (subscribed once) needs to see of the current view.
    const viewRef = useRef({ homeTab, showingActivity, incoming });
    useEffect(() => {
        viewRef.current = { homeTab, showingActivity, incoming };
    }, [homeTab, showingActivity, incoming]);

    // Puts activities' content in place (a new recording prompt starts unanswered).
    const applyContent = (c: ActivityContent) => {
        if (c.image !== undefined) setLiveImageUrl(c.image);
        if (c.video !== undefined) setLiveVideoUrl(c.video);
        if (c.text) {
            setLiveTextContent(c.text.content);
            setLiveTextMarkedWords(c.text.marked);
        }
        if (c.recording) {
            setSrPrompt(c.recording.prompt);
            setSrPromptRaw(c.recording.raw);
            setSrVoice(c.recording.voice);
            setSrSkipTts(c.recording.skipTts);
            setSrAnswer(null);
            setSrMicDisabled(false);
        }
        if (c.shadowing) setShadowingPrompt(c.shadowing);
    };

    // A recording prompt is spoken when it's shown (unless it has a pronunciation help or no audio).
    const speakPrompt = (r: ActivityContent["recording"]) => {
        if (r && !r.skipTts) playPromptTts(ttsTextOf(r.raw), r.voice);
    };

    // A live activity arrived with its content. While Playground (the open tab) shows an activity,
    // it's held for the student to accept, and what they're on isn't touched; otherwise it's put in
    // place and shown now (on Quizzes, with a toast and the badge).
    const arrive = (kind: ActivityKind, content: ActivityContent) => {
        const view = viewRef.current;
        const all = { ...view.incoming?.content, ...content };
        if (view.homeTab === "playground" && view.showingActivity) {
            const held = { kind, content: all };
            viewRef.current = { ...view, incoming: held };
            setIncoming(held);
            return;
        }
        applyContent(all);
        viewRef.current = { ...view, incoming: null };
        setIncoming(null);
        setActiveKind(kind);
        noteArrival(kind);
        if (kind === "recording") speakPrompt(content.recording);
    };

    // The student accepted the held activities: their content goes in place, and the newest one
    // replaces what Playground shows.
    const acceptIncoming = () => {
        if (!incoming) return;
        applyContent(incoming.content);
        setActiveKind(incoming.kind);
        setIncoming(null);
        if (incoming.kind === "recording") speakPrompt(incoming.content.recording);
    };

    // Saves the live activities in this browser tab (sessionStorage) whenever they change.
    useEffect(() => {
        saveLiveActivities(name, {
            image: liveImageUrl,
            video: liveVideoUrl,
            text: liveTextContent,
            markedWords: liveTextMarkedWords,
            // The recording's audio is a blob url that doesn't outlive the page: not kept.
            sr: srPrompt
                ? {
                      prompt: srPrompt, raw: srPromptRaw, voice: srVoice, skipTts: srSkipTts, micDisabled: srMicDisabled,
                      answer: srAnswer ? { english: srAnswer.english, vietnamese: srAnswer.vietnamese } : null,
                  }
                : null,
            shadowing: shadowingPrompt,
            active: activeKind,
            incoming,
            unseen,
        });
    }, [name, liveImageUrl, liveVideoUrl, liveTextContent, liveTextMarkedWords, srPrompt, srPromptRaw, srVoice, srSkipTts, srMicDisabled, srAnswer, shadowingPrompt, activeKind, incoming, unseen]);

    const {eventEmitter, websocketRef} = useWebSocket();

    // true of live quiz is a video quiz
    const [isLiveVideoQuiz, setIsLiveVideoQuiz] = useState(false);
    const [liveQuizVideoUrl, setLiveQuizVideoUrl] = useState<string | null>(null);
    const [liveQuizVideoSegments, setLiveQuizVideoSegments] = useState<VideoSegment[]>([]);

    // Chime played when the teacher pushes an image or video to the student.
    const chimeAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        chimeAudioRef.current = new Audio(chimeSound);
    }, []);

 useEffect(() => {
      const handleMessage = (data: WebSocketMessageProps) => {
        //console.log("HomeStudent: handleMessage called with data:", data);
    
        if (data.message_type === "live_quiz_id") {
            console.log("HomeStudent: received live_quiz_id message from server, quiz id:", data.content);
            setLiveQuizId(data.content);
            // send acknowledgement back to server that student received the quiz id
            if (!websocketRef.current) {
                alert("WebSocket is not connected.");
                return;
            }
            // if there's no quiz id passed in from props, alert and return
            websocketRef.current.send(JSON.stringify({
                message_type: "student_acknowleged_live_quiz_id",
                message: data.content,  // should contain quiz id
                user_name: name,    // identify sender, which is teacher
            }));
        }
        else if (data.message_type === "live_image") {
            // Teacher pushed an image to students; show the latest one.
            arrive("image", { image: data.content });
            chimeAudioRef.current?.play().catch((error) => {
                console.error("Error playing chime sound:", error);
            });
        }
        else if (data.message_type === "live_video") {
            // Teacher pushed a YouTube video to students; show the latest one (student presses Play).
            arrive("video", { video: data.content });
            chimeAudioRef.current?.play().catch((error) => {
                console.error("Error playing chime sound:", error);
            });
        }
        else if (data.message_type === "live_text") {
            // Teacher pushed a text message to students; show the latest one, plus any marked words.
            const marked = data.marked_words ?? [];
            arrive("text", { text: { content: data.content, marked } });
            chimeAudioRef.current?.play().catch((error) => {
                console.error("Error playing chime sound:", error);
            });
        }
        else if (data.message_type === "shadowing_prompt") {
            // A new Shadowing exercise (shown by StudentShadowing in Playground).
            arrive("shadowing", { shadowing: data.content as ShadowingPrompt });
            chimeAudioRef.current?.play().catch(() => {});
        }
        else if (data.message_type === "live_quiz_terminated") {
            //console.log("HomeStudent: Received terminate_live_quiz message from server.");
             setLiveQuizId(null);
             setIsLiveVideoQuiz(false);
             //setLiveQuestionNumber(undefined);
        }
        else if (data.message_type === "chat") {
            // SR (speech-recognition) prompt from the teacher: show it centered and enable the
            // fixed bottom mic. Ignore our own echo and ordinary (non-SR) chat (the chat box
            // handles that). Auto-play the prompt (Google TTS, random Neural2 voice, 0.75x).
            const text = (data.content ?? '').toString();
            if (data.user_name !== name && text.trim().startsWith("SR")) {
                const withoutSR = text.trim().replace(/^SR\s*/, '');
                const display = stripSsml(withoutSR);
                // A "/.../" pronunciation help means this isn't a plain sentence to speak; an
                // "SR No Audio" prompt (no_audio) is never spoken either. The mic is enabled regardless.
                const skipTts = shouldSkipTts(display) || !!data.no_audio;
                // prompt: SSML tags stripped, for display; raw: kept for TTS (Google TTS reads the
                // SSML). Spoken when shown: now, or when the student accepts it.
                arrive("recording", { recording: { prompt: display, raw: withoutSR, voice: data.voice, skipTts } });
                chimeAudioRef.current?.play().catch(() => {});
            }
        }
      }
      // Subscribe to the "message" event
      eventEmitter?.on("message", handleMessage);
      // Cleanup the event listener on unmount
      return () => {
        eventEmitter?.off("message", handleMessage);
      };
    }, [eventEmitter]); // Only include eventEmitter in the dependency array

    // Student clicked a marked word: play its Azure TTS audio, and — if it's tied to a dictionary
    // sense — add that card to the review queue. First click: show the review flashcard. Repeat
    // clicks (already in review): just show the definition once the audio finishes.
    const handleMarkedWordClick = (word: Pick<MarkedWord, "text" | "sense_id">) => {
        const audioUrl = `https://kphamazureblobstore.blob.core.windows.net/tts-audio/${word.text}.mp3`;
        const audio = new Audio(audioUrl);
        audio.playbackRate = 0.85; // 1 = normal, < 1 = slower

        // The panel opens once we have BOTH the card (from the API) and the surface audio's outcome
        // (finished playing, or no file). With no audio the panel STILL opens, just with a warning.
        let card: (ReviewCard & { created: boolean }) | null = null;
        let audioOutcome: "ended" | "missing" | null = null;
        let shown = false;
        const maybeShow = () => {
            if (shown || card === null || audioOutcome === null) return;
            shown = true;
            const audioMissing = audioOutcome === "missing";
            // Autoplay the panel's (lemma) audio only when it differs from the surface form.
            const autoPlay = card.text.trim().toLowerCase() !== word.text.trim().toLowerCase();
            const payload = { card, autoPlay, audioMissing, surfaceWord: word.text };
            if (card.created) setReviewCard(payload);
            else setDefinitionCard(payload);
        };

        audio.onended = () => { audioOutcome = "ended"; maybeShow(); };
        audio.onerror = () => { if (audioOutcome === null) { audioOutcome = "missing"; maybeShow(); } };
        audio.play().catch(() => { if (audioOutcome === null) { audioOutcome = "missing"; maybeShow(); } });

        if (word.sense_id != null) {
            api.post<ReviewCard & { created: boolean }>(`/api/cards/from-sense/${word.sense_id}/add-to-review/`)
                .then((res) => { card = res.data; maybeShow(); })
                .catch((err) => console.error("Error adding sense card to review:", err));
        }
    };

    // A recorded SR answer: send it to the teacher over the WebSocket (so it appears in the
    // teacher's chat box), show the student's own transcript centered under the prompt, and lock
    // the mic (one attempt per prompt).
    const handleSrTranscribed = (transcript: string, audioUrl?: string, translation?: string) => {
        if (!transcript || transcript.trim().length === 0) return;
        const text = translation && translation.trim()
            ? `${transcript.trim()} — ${translation.trim()}`
            : transcript.trim();
        const ws = websocketRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                message_type: 'chat',
                content: text,
                user_name: name,
                audio_url: audioUrl,
            }));
        } else {
            console.error('HomeStudent: WebSocket not connected; cannot send answer.');
        }
        setSrAnswer({ english: transcript.trim(), vietnamese: translation?.trim() || null, audioUrl });
        setSrMicDisabled(true);
    };

    // Render the pushed text, turning each marked occurrence (located by its character offset)
    // into an inline button and leaving the rest as plain text.
    const renderTextWithButtons = (text: string, marked: MarkedWord[]): ReactNode => {
        if (marked.length === 0) return text;
        const sorted = [...marked].sort((a, b) => a.start - b.start);
        const parts: ReactNode[] = [];
        let cursor = 0;
        sorted.forEach((word) => {
            const end = word.start + word.text.length;
            if (word.start < cursor) return; // skip overlaps (shouldn't happen)
            if (word.start > cursor) parts.push(text.slice(cursor, word.start));
            parts.push(
                <button
                    key={`w-${word.index}`}
                    onClick={() => handleMarkedWordClick(word)}
                    className="inline bg-white underline px-1 cursor-pointer"
                >
                    {text.slice(word.start, end)}
                </button>
            );
            cursor = end;
        });
        if (cursor < text.length) parts.push(text.slice(cursor));
        return parts;
    };

    useEffect(() => {
        //console.log("Home component mounted, fetching levels...");
        getLevels();
    }, []);  // empty dependency array to run only once on mount

    // The vocabulary review opens only from the "Vocabulary Review" button (no longer on login).
    // If a live quiz becomes active while it's open, close it.
    useEffect(() => {
        if (liveQuizId) setShowVocabReview(false);
    }, [liveQuizId]);

    const getLevels = () => {
        //console.log("Fetching categories...");
        api
            .get("/api/levels/")
            .then((res) => res.data)
            .then((data) => {
                setLevels(data as LevelProps[]);
                //console.log("categories", data);
            })
            .catch((err) => alert(err));
    };

    // Listen for user logging out in other tabs. If that happends, reload this tab to reflect the logout state
    // which effectively logs out this tab as well and redirects to login page

    // KPHAM: this logic works in conjunction with ProtecedRoute component
    // in which, upon component mount, the loggedin state of the use is checked before 
    // attempting to authorize access to protected routes
    const live_question_attempt_finished = () => {
       //console.log("HomeStudent: ****************** live_question_attempt_finished called, clearing liveQuestionNumber");
       // setLiveQuestionNumber(undefined);  // reset this so that the next time a new question is received, 
        // the liveQuestionNumber prop will be refreshed and TakeQuizLive) will be rendered with new question
    }
//https://www.youtube.com/watch?v=ivg_Yc-YDYo
// const wsUrl = `${import.meta.env.VITE_WS_PROTOCOL}://${import.meta.env.VITE_WS_URL}/`;
   
    useEffect(() => {
        // call api to retrieve the current live quiz
        if (liveQuizId) {
            api.get(`/api/quizzes/${liveQuizId}/`)
            .then((res) => res.data)
            .then((data) => {
                console.log("in HomeStudent: Quiz  Data:", data);
                if (data.video_url && data.video_segments) {
                    console.log("TakeQuizLive: Quiz has video segments, video url:", data.video_url);
                    setIsLiveVideoQuiz(true);
                    setLiveQuizVideoUrl(data.video_url);
                    setLiveQuizVideoSegments(data.video_segments);
                }
            })
        }   
    }, [liveQuizId]);  // empty dependency array to run only once on mount
   
    return (
        <div className="bg-amber-300 h-full w-full">       
            <div>
                {liveQuizId ?
                    <div>
                        { (isLiveVideoQuiz && liveQuizVideoUrl) ?
                            <div>{isLiveVideoQuiz.toString()}
                                <TakeVideoQuizLive 
                                    user_name={name} 
                                    live_quiz_id={liveQuizId} 
                                    video_url={liveQuizVideoUrl} 
                                    video_segments={liveQuizVideoSegments} 
                                    playKey={1} 
                                    parent_callback={live_question_attempt_finished}
                                    />
                            </div>
                        :
                        <div className="bg-amber-200 py-2 min-h-screen">
                            <TakeQuizLive
                                parent_callback={live_question_attempt_finished}
                                live_quiz_id={liveQuizId}
                                live_question_number={liveQuestionNumber?.toString()}
                            />
                        </div>
                        }
                    </div>
                    :
                    <>
                    {/* Top-level tabs (locked while taking a quiz, so it isn't left half done). */}
                    <div role="tablist" aria-label="Home" className="flex gap-1 bg-cyan-300 px-10 pt-2">
                        {HOME_TABS.map(([tab, label]) => (
                            <button
                                key={tab}
                                role="tab"
                                aria-selected={homeTab === tab}
                                onClick={() => setHomeTab(tab)}
                                disabled={inQuiz && homeTab !== tab}
                                title={inQuiz && homeTab !== tab ? "Finish or use “Terminate Quiz” to leave the quiz first." : undefined}
                                className={`px-5 py-2 rounded-t-md text-base font-semibold ${
                                    homeTab === tab
                                        ? "bg-cyan-200 text-cyan-900"
                                        : "bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                }`}
                            >
                                {label}
                                {tab === "playground" && unseen.length > 0 && (
                                    <span
                                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-600 px-2 text-xs text-white animate-pulse"
                                        title="New from your teacher"
                                    >
                                        ● {unseen.length}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                    {homeTab === "quizzes" && (
                    <div className="flex flex-col bg-cyan-200 py-2 px-10">
                        <div className='col-span-9 text-lg m-1 flex items-start justify-between gap-4'>
                            <Navbar
                                role="student"
                                levels={levels}
                                onShowAssignments={() => setShowAssignmentModal(true)}
                                disabled={inQuiz}
                            />
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowVocabReview(true)}
                                    disabled={inQuiz}
                                    className={`text-white bg-green-600 text-sm px-3 py-1 rounded-md hover:bg-green-800 whitespace-nowrap ${
                                        inQuiz ? "opacity-50 cursor-not-allowed" : ""
                                    }`}
                                >
                                    Vocabulary Review
                                </button>
                                <DictionaryLookup />
                            </div>
                        </div>
                    </div>
                    )}
                    {showAssignmentModal && pendingAssignments.length > 0 && (
                        <AssignmentModal
                            assignments={pendingAssignments}
                            onClose={() => setShowAssignmentModal(false)}
                        />
                    )}
                    {/* Playground: the teacher's live activities (image, video, text, recording prompt,
                        Shadowing). They arrive in any tab; while the student is on Quizzes they wait
                        here, and a toast and the tab's badge say so. */}
                    <div role="tabpanel" aria-label="Playground" hidden={homeTab !== "playground"} className="bg-cyan-200 px-10 py-6 min-h-[50vh]">
                        <p className="text-2xl font-bold text-cyan-900">Play Ground</p>
                        {!showingActivity && (
                            <p className="mt-2 text-gray-700">What your teacher sends during class (images, videos, recordings, shadowing) appears here.</p>
                        )}
                        {activeKind === "image" && liveImageUrl && (
                            <div className="flex flex-col items-center my-4">
                                <img
                                    src={liveImageUrl}
                                    alt="Image from teacher"
                                    className="max-h-[70vh] max-w-full rounded-lg border-2 border-gray-400 shadow-lg"
                                />
                                <button
                                    onClick={() => setLiveImageUrl(null)}
                                    className="mt-2 px-4 py-1 rounded-md bg-gray-600 hover:bg-gray-800 text-white text-sm"
                                >
                                    Dismiss
                                </button>
                            </div>
                        )}
                        {activeKind === "video" && liveVideoUrl && (
                            <StudentLiveVideo
                                videoUrl={liveVideoUrl}
                                onDismiss={() => setLiveVideoUrl(null)}
                            />
                        )}
                        {activeKind === "text" && liveTextContent && (
                            <div className="flex flex-col items-center my-4">
                                {/* The text, with each teacher-marked word turned into an inline button. */}
                                <div className="max-w-2xl w-full bg-white border-2 border-gray-400 rounded-lg shadow-lg p-5 text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                    {renderTextWithButtons(liveTextContent, liveTextMarkedWords)}
                                </div>
                                <button
                                    onClick={() => { setLiveTextContent(null); setLiveTextMarkedWords([]); }}
                                    className="mt-2 px-4 py-1 rounded-md bg-gray-600 hover:bg-gray-800 text-white text-sm"
                                >
                                    Dismiss
                                </button>
                            </div>
                        )}
                        {/* Recording / speech-recognition prompt from the teacher, shown centered.
                            The student answers with the mic in the card (one try per prompt); the
                            transcript appears below it. */}
                        {srActive && (
                            <div className="flex flex-col items-center my-4">
                                <div className="w-full max-w-2xl bg-purple-50 border-2 border-purple-400 rounded-lg shadow-lg p-6 text-center">
                                    <p className="text-xs uppercase tracking-wide text-purple-700 font-semibold mb-2">
                                        Record your answer
                                    </p>
                                    <p className="text-2xl font-bold text-purple-800 leading-snug">{renderVietPron(srPrompt)}</p>
                                    {/* No TTS when the prompt carries a "/.../" pronunciation help. */}
                                    {!srSkipTts && (
                                        <button
                                            onClick={() => playPromptTts(ttsTextOf(srPromptRaw ?? srPrompt), srVoice)}
                                            className="mt-3 text-sm px-3 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white"
                                            title="Play this prompt"
                                        >
                                            ▶ Play
                                        </button>
                                    )}
                                    {/* The mic: hidden during a live quiz, which takes the screen. */}
                                    {!liveQuizId && (
                                        <div className="mt-4 flex items-center justify-center gap-3">
                                            <span className="text-sm text-gray-600">
                                                {srMicDisabled ? 'Answer sent' : 'Tap the mic to record'}
                                            </span>
                                            <VoiceAnswerRecorder
                                                onTranscribed={handleSrTranscribed}
                                                userName={name}
                                                disabled={srMicDisabled}
                                                highlight={!srMicDisabled}
                                            />
                                        </div>
                                    )}
                                    {srAnswer && (
                                        <div className="mt-4 pt-4 border-t border-purple-200">
                                            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Your answer</p>
                                            <p className="text-lg text-gray-800">{srAnswer.english}</p>
                                            {srAnswer.vietnamese && (
                                                <p className="text-sm" style={{ color: '#5C4033' }}>{srAnswer.vietnamese}</p>
                                            )}
                                            {srAnswer.audioUrl && (
                                                <audio controls src={srAnswer.audioUrl} className="mt-2 w-full h-8" />
                                            )}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => { setSrPrompt(null); setSrPromptRaw(null); setSrAnswer(null); }}
                                    className="mt-2 px-4 py-1 rounded-md bg-gray-600 hover:bg-gray-800 text-white text-sm"
                                >
                                    Dismiss
                                </button>
                            </div>
                        )}
                        {/* Keyed by the exercise, so a new one starts clean (no old take or result). */}
                        <StudentShadowing
                            key={shadowingPrompt?.shadowing_id ?? "none"}
                            prompt={shadowingPrompt}
                            hidden={activeKind !== "shadowing"}
                        />
                    </div>
                    {/* The units and quizzes pages; kept mounted (hidden) on Playground. */}
                    <div hidden={homeTab !== "quizzes"}>
                        <Outlet context={{ setFinishedQuizPath, onMarkedWordClick: handleMarkedWordClick } satisfies HomeStudentOutletContext} />
                    </div>
                    </>
                }

            </div>

            {/* An activity held while Playground shows another: Accept swaps it in. A newer one takes
                its place in the toast. */}
            {!liveQuizId && homeTab === "playground" && incoming && (
                <div className="fixed top-4 right-4 z-40 w-80 rounded-lg border-2 border-cyan-500 bg-white p-3 shadow-xl" role="status">
                    <p className="text-sm text-gray-800">
                        🔔 Your teacher sent {ACTIVITY_NAMES[incoming.kind]}
                        {incoming.kind === "shadowing" ? " (a new sentence)" : ""}. Accept it to open it in place of
                        {activeKind ? ` ${CURRENT_NAMES[activeKind]}` : " what you're on"}.
                    </p>
                    <button
                        onClick={acceptIncoming}
                        className="mt-2 rounded-md bg-cyan-600 px-3 py-1 text-sm font-semibold text-white hover:bg-cyan-700"
                    >
                        Accept
                    </button>
                </div>
            )}

            {/* Toasts for live activities that arrived while the student was on Quizzes. They stay
                until the student goes to Playground or closes them (the tab's badge stays then). */}
            {!liveQuizId && homeTab !== "playground" && unseen.some((u) => u.toast) && (
                <div className="fixed top-4 right-4 z-40 flex w-80 flex-col gap-2">
                    {unseen.filter((u) => u.toast).map((u) => (
                        <div key={u.kind} role="status" className="rounded-lg border-2 border-cyan-500 bg-white p-3 shadow-xl">
                            <div className="flex items-start gap-2">
                                <p className="flex-1 text-sm text-gray-800">
                                    🔔 Your teacher sent {ACTIVITY_NAMES[u.kind]}
                                    {u.kind === "shadowing" ? " (a new sentence)" : ""}. Accept it to open it in Playground
                                    {inQuiz ? " once you finish this quiz" : ""}.
                                </p>
                                <button
                                    onClick={() => setUnseen((all) => all.map((x) => (x.kind === u.kind ? { ...x, toast: false } : x)))}
                                    aria-label="Close"
                                    className="text-gray-500 hover:text-gray-800"
                                >
                                    ✕
                                </button>
                            </div>
                            {/* Opens this activity (another may have come after it) in Playground. The
                                tabs are locked during a quiz, so it waits until the quiz is done. */}
                            <button
                                onClick={() => { setActiveKind(u.kind); setHomeTab("playground"); }}
                                disabled={inQuiz}
                                title={inQuiz ? "Finish or use “Terminate Quiz” to leave the quiz first." : undefined}
                                className="mt-2 rounded-md bg-cyan-600 px-3 py-1 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Accept
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Vocabulary review, opened from the "Vocabulary Review" button (not during a live quiz). */}
            {showVocabReview && !liveQuizId && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8">
                        <CardReview
                            onComplete={() => setShowVocabReview(false)}
                        />
                    </div>
                </div>
            )}

            {reviewCard && (
                <SingleCardReview
                    card={reviewCard.card}
                    autoPlay={reviewCard.autoPlay}
                    audioMissing={reviewCard.audioMissing}
                    surfaceWord={reviewCard.surfaceWord}
                    onClose={() => setReviewCard(null)}
                />
            )}

            {definitionCard && (
                <DefinitionPopup
                    card={definitionCard.card}
                    autoPlay={definitionCard.autoPlay}
                    audioMissing={definitionCard.audioMissing}
                    surfaceWord={definitionCard.surfaceWord}
                    onClose={() => setDefinitionCard(null)}
                />
            )}

        </div>

    );
}

export default HomeStudent;

/*
return (
       
            <div className="grid grid-cols-[2fr_1fr] bg-gray-100 mx-10 my-0 h-screen">
                <div>
   
                    <div className="flex flex-col bg-amber-200 py-2 px-10">
                        <div className='col-span-9 bg-bgColor2 text-textColor2 text-lg m-1'>
                            <Navbar role="student" levels={levels} />
                        </div>
                    </div>
                    <VidStack />

            
                    {liveQuizId &&
                        <TakeQuizLive parent_callback={live_question_attempt_finished} quiz_id={liveQuizId} question_number={liveQuestionNumber} />
                    }
                    <Outlet context={{ setFinishedQuizPath, onMarkedWordClick: handleMarkedWordClick } satisfies HomeStudentOutletContext} />
                </div>
                <div className="flex flex-col">
                    <div className="bg-blue-200">
                        <ScoreBoard  />
                        <MessageControlStudent parent_callback={handle_callback} />

                    </div>
     
                </div>
            </div>

    );
*/
