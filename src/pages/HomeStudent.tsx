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
// import TranslationBox from "../components/TranslationBox";  // hidden for now (see the bottom bar)
import VoiceAnswerRecorder from "../components/chat/VoiceAnswerRecorder";
import { ttsTextOf, playPromptTts, stripSsml, shouldSkipTts } from "../components/chat/tts";
import { renderVietPron } from "../components/vietPron";

function HomeStudent() {
    const [levels, setLevels] = useState<LevelProps[]>([]);
    const pendingAssignments = useSelector((state: RootState) => state.pendingAssignments.assignments);
    const [showAssignmentModal, setShowAssignmentModal] = useState(false);
    const [showVocabReview, setShowVocabReview] = useState(false);
    // Latest image the teacher pushed to students (presigned S3 url), shown outside a live quiz.
    const [liveImageUrl, setLiveImageUrl] = useState<string | null>(null);
    // Latest YouTube url the teacher pushed to students, shown outside a live quiz.
    const [liveVideoUrl, setLiveVideoUrl] = useState<string | null>(null);
    // Latest free-form text the teacher pushed to students, shown outside a live quiz.
    const [liveTextContent, setLiveTextContent] = useState<string | null>(null);
    // Card shown for immediate review when the student clicks a marked (sense-tagged) word.
    // `autoPlay` = whether the panel should autoplay its audio (only when lemma differs from surface).
    const [reviewCard, setReviewCard] = useState<{ card: ReviewCard; autoPlay: boolean; audioMissing: boolean; surfaceWord: string } | null>(null);
    // Card whose definition is shown on a repeat click of a marked word (read-only, no rating).
    const [definitionCard, setDefinitionCard] = useState<{ card: ReviewCard; autoPlay: boolean; audioMissing: boolean; surfaceWord: string } | null>(null);
    // Words the teacher marked "to learn" in the pushed text; shown to the student as buttons.
    const [liveTextMarkedWords, setLiveTextMarkedWords] = useState<MarkedWord[]>([]);

    // Recording / speech-recognition (SR), moved out of the chat box. The teacher sends an
    // "SR ..." chat message; the student answers by voice using the fixed bottom mic, and both
    // the prompt and the student's own transcript are shown centered here (not in the chat box).
    const [srPrompt, setSrPrompt] = useState<string | null>(null);         // SSML-stripped text, for display
    const [srPromptRaw, setSrPromptRaw] = useState<string | null>(null);   // original (may contain SSML), for TTS
    const [srAnswer, setSrAnswer] = useState<{ english: string; vietnamese: string | null; audioUrl?: string } | null>(null);
    const [srMicDisabled, setSrMicDisabled] = useState<boolean>(false);
    // true when the prompt carries a "/.../" pronunciation help or a "(...)" note,
    // in which case we do NOT speak it (no auto-play, no Play button).
    const [srSkipTts, setSrSkipTts] = useState<boolean>(false);
    // The Neural2 voice the teacher chose for this prompt; used for every playback (auto-play
    // and the Play button) so the student hears the same voice each time.
    const [srVoice, setSrVoice] = useState<string | undefined>(undefined);

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
    // Keep the latest live_quiz_id readable inside async callbacks (the welcome_message may set it
    // shortly after mount, e.g. when reconnecting into a live quiz already in progress).
    const liveQuizIdRef = useRef(liveQuizId);
    liveQuizIdRef.current = liveQuizId;

    const {eventEmitter, websocketRef} = useWebSocket();

    // true of live quiz is a video quiz
    const [isLiveVideoQuiz, setIsLiveVideoQuiz] = useState(false);
    const [liveQuizVideoUrl, setLiveQuizVideoUrl] = useState<string | null>(null);
    const [liveQuizVideoSegments, setLiveQuizVideoSegments] = useState<VideoSegment[]>([]);

    const { name } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);

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
            setLiveImageUrl(data.content);
            chimeAudioRef.current?.play().catch((error) => {
                console.error("Error playing chime sound:", error);
            });
        }
        else if (data.message_type === "live_video") {
            // Teacher pushed a YouTube video to students; show the latest one (student presses Play).
            setLiveVideoUrl(data.content);
            chimeAudioRef.current?.play().catch((error) => {
                console.error("Error playing chime sound:", error);
            });
        }
        else if (data.message_type === "live_text") {
            // Teacher pushed a text message to students; show the latest one, plus any marked words.
            const marked = data.marked_words ?? [];
            setLiveTextContent(data.content);
            setLiveTextMarkedWords(marked);
            chimeAudioRef.current?.play().catch((error) => {
                console.error("Error playing chime sound:", error);
            });
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
                setSrPrompt(display);              // strip SSML tags for display
                setSrPromptRaw(withoutSR);         // keep raw (SSML) for TTS playback
                setSrAnswer(null);
                setSrMicDisabled(false);
                setSrVoice(data.voice);
                setSrSkipTts(skipTts);
                chimeAudioRef.current?.play().catch(() => {});
                if (!skipTts) {
                    playPromptTts(ttsTextOf(text), data.voice); // pass raw SSML to Google TTS
                }
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

    // On login: pop up the vocabulary review if cards are due — but NOT if the student is resuming
    // a live quiz. Wait briefly so a reconnect's welcome_message can set live_quiz_id before we
    // decide, and re-check after the fetch in case it arrives meanwhile.
    useEffect(() => {
        const timer = setTimeout(() => {
            if (liveQuizIdRef.current) return; // resuming a live quiz -> skip auto review
            api.get('/api/cards/due/')
                .then((res) => {
                    if (liveQuizIdRef.current) return; // a live quiz arrived while fetching
                    const due = res.data.due_cards ?? [];
                    if (due.length > 0) setShowVocabReview(true);
                })
                .catch((err) => console.error('Error checking due cards:', err));
        }, 1200);
        return () => clearTimeout(timer);
    }, []);  // run once on mount

    // Backstop: if a live quiz becomes active at any point, cancel the auto vocabulary review
    // (covers a slow welcome_message that arrives after the review already popped up).
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
                    <div className="flex flex-col bg-cyan-200 py-2 px-10">
                        <div className='col-span-9 text-lg m-1 flex items-start justify-between gap-4'>
                            <Navbar
                                role="student"
                                levels={levels}
                                onShowAssignments={() => setShowAssignmentModal(true)}
                                disabled={inQuiz}
                            />
                            <DictionaryLookup />
                        </div>
                    </div>
                    {showAssignmentModal && pendingAssignments.length > 0 && (
                        <AssignmentModal
                            assignments={pendingAssignments}
                            onClose={() => setShowAssignmentModal(false)}
                        />
                    )}
                    {liveImageUrl && (
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
                    {liveVideoUrl && (
                        <StudentLiveVideo
                            videoUrl={liveVideoUrl}
                            onDismiss={() => setLiveVideoUrl(null)}
                        />
                    )}
                    {liveTextContent && (
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
                        The student answers with the fixed bottom mic; the transcript appears below. */}
                    {srPrompt && !inQuiz && (
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
                    <Outlet context={{ setFinishedQuizPath, onMarkedWordClick: handleMarkedWordClick } satisfies HomeStudentOutletContext} />
                    </>
                }

            </div>

            {/* Fixed bottom bar: TranslationBox on the left, mic button on the right.
                Hidden during a live quiz or while taking a quiz.
                The bar spans the full width, so its empty area is click-through (pointer-events-none)
                — otherwise it covers the chat box's Send button. Its children stay clickable. */}
            {!liveQuizId && !inQuiz && (
                <div className="fixed bottom-4 left-4 right-4 z-30 flex items-end justify-start gap-4 pointer-events-none *:pointer-events-auto">
                    {/* Viet/English translation box — hidden for now. To bring it back, uncomment this and its import. */}
                    {/* <TranslationBox /> */}
                    <div className="flex items-center gap-3 rounded-full border-2 border-purple-300 bg-white/95 px-4 py-2 shadow-lg shrink-0">
                        <span className="text-sm text-gray-600">
                            {srMicDisabled ? 'Answer sent' : srPrompt ? 'Tap the mic to record' : 'Waiting for a prompt…'}
                        </span>
                        <VoiceAnswerRecorder
                            onTranscribed={handleSrTranscribed}
                            userName={name}
                            disabled={!srPrompt || srMicDisabled}
                            highlight={!!srPrompt && !srMicDisabled}
                        />
                    </div>
                </div>
            )}

            {/* Vocabulary review pops up on login when cards are due (not during a live quiz). */}
            {showVocabReview && !liveQuizId && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8">
                        <CardReview
                            userName={name ?? ''}
                            onComplete={() => setShowVocabReview(false)}
                        />
                    </div>
                </div>
            )}

            {reviewCard && (
                <SingleCardReview
                    card={reviewCard.card}
                    userName={name ?? ''}
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
