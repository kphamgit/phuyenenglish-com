import { useSelector } from "react-redux";
import { useWebSocket } from "../components/context/WebSocketContext";
import { useEffect, useImperativeHandle, useState } from "react";
//import useSendNotification from "../hooks/useSendNotification";
//import api from "../api";
//import type { RootState } from "../redux/store";
import type { WebSocketMessageProps } from "../components/shared/types";
import api from "../api";
import {toast, ToastContainer} from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useUserConnections } from "../components/context/UserConnectionsContext";
import ListUsers from "./ListUsers";
import DictionaryModal from "../components/DictionaryModal";

import { type QuizProps, type MarkedWord, type LiveTextMessage } from "../components/shared/types";



export interface TeacherControlRefProps {
    terminate_live_quiz: () => void;
    send_question_to_user: (userName: string, questionNumber: number) => void;
}

interface Props {
    live_quiz_id?: string | null; // Define the type of the liveQuizId prop
    ref: React.Ref<TeacherControlRefProps>;
}

// DEBUG: show each word button's spaCy root form (lemma) under the word, when it differs.
// Set to false to hide.
const SHOW_LEMMAS = true;

export const TeacherControlPanel = ({ref, live_quiz_id }: Props) => {
//function TeacherControlPanel() {
     
    //const user_name = useSelector((state: { name: string }) => state.name);
    const { name } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);
    
        const [questionNumber, setQuestionNumber] = useState("");

        const [targetUserName, setTargetUserName] = useState("");

        const {websocketRef, eventEmitter} = useWebSocket();

        const [inputLiveQuizId, setInputLiveQuizId] = useState("");

        // const [inputVideoSegmentNumber, setInputVideoSegmentNumber] = useState("");

        const [activeLiveQuizId, setActiveLiveQuizId] = useState<string | null>(null); 
        // track active live quiz id . Set after a live_quiz_id message is received from server,
        //  which indicates that the live quiz has been saved in the cache.
        const [showTerminateLiveQuizButton, setShowTerminateLiveQuizButton] = useState(false);

        const {userRows} = useUserConnections();

        const [liveQuiz, setLiveQuiz] = useState<QuizProps | null>(null);

        // this is used to store question numbers for all video segments of an active video quiz.
        const [allQuestionNumbers, setAllQuestionNumbers] = useState<string[]>([]); // store all question numbers for the active live quiz
         
        const [inputVideoSegmentNumber, setInputVideoSegmentNumber] = useState("");

        // A pasted image waiting to be sent to students, plus a local preview url and an in-flight flag.
        const [pastedImage, setPastedImage] = useState<File | null>(null);
        const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
        const [sendingImage, setSendingImage] = useState(false);

        // A YouTube link to push to students (they display it with a manual Play button).
        const [inputVideoLink, setInputVideoLink] = useState("");

        // Free-form text to push to students (shown in their non-live view).
        const [inputText, setInputText] = useState("");

        // The input text split into per-word tokens (spaCy: text + POS + lemma), shown as buttons.
        const [textButtons, setTextButtons] = useState<MarkedWord[] | null>(null);
        const [tokenizing, setTokenizing] = useState(false);
        // Tab for the Send-Text panel: "edit" the raw text, or view it as clickable word "buttons".
        const [textMode, setTextMode] = useState<"edit" | "buttons">("edit");
        // Token indices the teacher marked (clicked) as "to learn". Keyed by index (not word) so
        // repeated words with different meanings (e.g. "record" verb vs. noun) mark independently.
        const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
        // The marked token whose dictionary modal is open, or null when closed.
        const [dictToken, setDictToken] = useState<MarkedWord | null>(null);
        // Sense the teacher chose for each marked token: token index -> sense_id.
        const [senseByIndex, setSenseByIndex] = useState<Record<number, number>>({});

    useEffect(() => {
        if (live_quiz_id) {
            // console.log("TeacherControlPanel: Received live_quiz_id from parent component:", live_quiz_id);
            setActiveLiveQuizId(live_quiz_id || null);
            setShowTerminateLiveQuizButton(true);
        }
      
    }, [live_quiz_id]);

    useEffect(() => {
          const handleMessage = (data: WebSocketMessageProps) => {
            //console.log("TeacherControl: handleMessage called with data:", data);

            if (data.message_type === "live_quiz_terminated") {
                //console.log("TeacherControl: Received live_quiz_terminated message from server, data = :", data);
                setActiveLiveQuizId(null);
                setShowTerminateLiveQuizButton(false);
            }
          }
  
          // Subscribe to the "message" event
          eventEmitter?.on("message", handleMessage);
          // Cleanup the event listener on unmount
          return () => {
            eventEmitter?.off("message", handleMessage);
          };
        }, [eventEmitter]); // Only include eventEmitter in the dependency array

    useEffect(() => {
        // this useEffect only applies for video quiz
        if (liveQuiz) {
            const question_numbers: string[] = []
            let question_number = 1;
            //console.log("TeacherControlPanel: liveQuiz state updated:", liveQuiz);
            if (liveQuiz.video_segments.length > 0) {
                liveQuiz.video_segments.forEach(segment => {
                    console.log(`Segment ${segment.segment_number}: ${segment.start_time} - ${segment.end_time}, Questions: ${segment.question_ids}`);
                    segment.question_ids.split(",").forEach(() => {
                        question_numbers.push(question_number.toString());
                        question_number++;
                    });
                });
            }
            question_numbers.map(qn => console.log("Question number:", qn));
            setAllQuestionNumbers(question_numbers);
        }
    }, [liveQuiz]);

    useImperativeHandle(ref, () => ({
        terminate_live_quiz: () => {
            //console.log("terminateLiveQuiz: ");
            if (!websocketRef.current) {
                alert("WebSocket is not connected.");
                return;
            }
            websocketRef.current.send(JSON.stringify({
                message_type: "terminate_live_quiz",
                message: "terminate",
                user_name: name,    // identify sender, which is teacher
            }));
        },
        send_question_to_user: sendQuestionNumberToUser,
    }));

    const sendQuizId = () => {
        console.log("live quiz id: ");
        api.get(`/api/start_live_quiz/${inputLiveQuizId}`)
        .then(response => {
            // console.log("Response from server after starting live quiz:", response.data);
            setLiveQuiz(response.data.quiz as QuizProps);
            /*
{
    "id": 2,
    "name": "Video Quiz",
    "quiz_number": 3,
    "video_url": "https://www.youtube.com/watch?v=_hH1pzeIawc",
    "video_segments": [
        {
            "id": 1,
            "quiz_id": 2,
            "segment_number": 1,
            "start_time": "0:00:000",
            "end_time": "0:10:500",
            "question_ids": "2, 3, 136"
        },
        {
            "id": 2,
            "quiz_id": 2,
            "segment_number": 2,
            "start_time": "0:10:500",
            "end_time": "0:17:500",
            "question_ids": "137, 138"
        }
    ]
}
            */

            if (!response.data.quiz.id) {
                alert("Failed to start live quiz. Please check the quiz id and try again.");
                return;
            }
            setActiveLiveQuizId(response.data.quiz.id.toString());
            /*
            const liveQuizIdFromServer = response.data.live_quiz_id;
            if (!liveQuizIdFromServer) {
                alert("Failed to start live quiz. Please check the quiz id and try again.");
                return;
            }
                */

            setShowTerminateLiveQuizButton(true);
        }
        )
        .catch(error => {
            //console.error("Error starting live quiz:", error);
            alert("Error starting live quiz. " + error.response?.data.error);
            // clear the input field
            setInputLiveQuizId("");
        });   
    };

    const sendQuestionNumber = () => {
        console.log("Sending live question number: ");
        if (activeLiveQuizId === null) {
            alert("No active live quiz. Please start a live quiz first.");
            // clear the question number input field
            setQuestionNumber("");
            return;
        }
        // if question number is empty, alert and return
        if (questionNumber === "") {
            alert("Please enter question number.");
            return;
        }
        // if target user is empty, alert and return
        if (targetUserName === "") {
            alert("Please enter target user name.");
            return;
        }
   
        api.post(`/api/send_live_question_number/${questionNumber}/`, {
            live_quiz_id: activeLiveQuizId,
            target_user_name: targetUserName,
        })      
        .then(response => {
            console.log("Response from server after sending live question number:", response.data);
            console.log("Live question number sent successfully.");
            //alert("Live question number sent successfully.");
            if (targetUserName != 'everybody')
                setTargetUserName('everybody') // reset 
        })
        .catch(error => {
            alert("Error sending live question number. " + error.response?.data.error);
            //console.error("Error sending live question number:", error);
            //alert("Error sending live question number. " + error.response?.data.error);
        });
        setQuestionNumber("");
    };

    // Invoked when the teacher clicks a student's username in the scoreboard: send that
    // student the given question number (computed by the scoreboard as current + 1).
    const sendQuestionNumberToUser = (userName: string, questionNumber: number) => {
        if (activeLiveQuizId === null) {
            alert("No active live quiz. Please start a live quiz first.");
            return;
        }
        api.post(`/api/send_live_question_number/${questionNumber}/`, {
            live_quiz_id: activeLiveQuizId,
            target_user_name: userName,
        })
        .catch(error => {
            alert("Error sending live question number. " + error.response?.data.error);
        });
    };

    const handleTerminateLiveQuiz = () => {
        websocketRef.current?.send(JSON.stringify({
            message_type: "terminate_live_quiz",
            content: inputLiveQuizId,
            user_name: name,    // identify sender, which is teacher
        }));
    }
    
    const onUserNameClick = (userName: string) => {
        console.log("User name clicked:", userName);
        setTargetUserName(userName);
    }


    // Teacher pastes an image (Ctrl/Cmd+V) into the paste box: grab it from the clipboard,
    // keep the File for upload and show a local preview thumbnail.
    const handleImagePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith("image")) {
                const file = item.getAsFile();
                if (!file) continue;
                e.preventDefault();
                setPastedImage(file);
                // Replace any previous preview url and free its memory.
                setImagePreviewUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return URL.createObjectURL(file);
                });
                return;
            }
        }
    };

    const clearPastedImage = () => {
        setImagePreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        setPastedImage(null);
    };

    // Upload the pasted image to S3 (fixed per-teacher key) and broadcast its url to students.
    // Blocked while a live quiz is active so the image doesn't clobber the quiz view.
    const sendImageToStudents = async () => {
        if (!pastedImage) return;
        if (activeLiveQuizId !== null) {
            alert("Cannot send an image while a live quiz is in progress.");
            return;
        }
        if (!websocketRef.current) {
            alert("WebSocket is not connected.");
            return;
        }
        setSendingImage(true);
        try {
            const formData = new FormData();
            formData.append("image", pastedImage);
            formData.append("user_name", name);
            const res = await api.post("/api/upload-image/", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            const imageUrl = res.data.image_url as string;
            websocketRef.current.send(JSON.stringify({
                message_type: "live_image",
                content: imageUrl,      // students display this presigned S3 url
                user_name: name,        // identify sender, which is teacher
            }));
            toast.success("Image sent!", {
                position: "top-right",
                autoClose: 2000,
                hideProgressBar: true,
            });
            clearPastedImage();
        } catch (error) {
            console.error("Error sending image:", error);
            alert("Failed to send image.");
        } finally {
            setSendingImage(false);
        }
    };

    // Broadcast a YouTube link to students. Blocked during a live quiz (same as images),
    // since students display it in their non-live-quiz view.
    const sendVideoLink = () => {
        const url = inputVideoLink.trim();
        if (!url) return;
        if (activeLiveQuizId !== null) {
            alert("Cannot send a video while a live quiz is in progress.");
            return;
        }
        if (!websocketRef.current) {
            alert("WebSocket is not connected.");
            return;
        }
        websocketRef.current.send(JSON.stringify({
            message_type: "live_video",
            content: url,           // students extract the video id from this url
            user_name: name,        // identify sender, which is teacher
        }));
        toast.success("Video sent!", {
            position: "top-right",
            autoClose: 2000,
            hideProgressBar: true,
        });
        setInputVideoLink("");
    };

    // Broadcast free-form text to students. Blocked during a live quiz (same as images/videos),
    // since students display it in their non-live-quiz view.
    const sendTextToStudents = async () => {
        const text = inputText.trim();
        if (!text) return;
        if (activeLiveQuizId !== null) {
            alert("Cannot send text while a live quiz is in progress.");
            return;
        }
        if (!websocketRef.current) {
            alert("WebSocket is not connected.");
            return;
        }
        // Resolve the marked token indices into full MarkedWord objects, attaching the sense the
        // teacher chose for each (if any) so the student can create the card from it.
        const marked = (textButtons ?? [])
            .filter((t) => selectedIndices.has(t.index))
            .map((t) => ({ ...t, sense_id: senseByIndex[t.index] }));

        // Every marked word must have a sense chosen AND a card created for that sense. Verify
        // against the backend and stop (with a reminder) if any word isn't ready.
        console.log("[SendText] 4. Send clicked. Marked words (with chosen sense_id):");
        console.table(marked);
        const senseIds = marked
            .map((m) => m.sense_id)
            .filter((id): id is number => id != null);
        console.log("[SendText] 4. POST /api/cards/check-senses/ request:", { sense_ids: senseIds });
        let existingSenses = new Set<number>();
        try {
            const res = await api.post<{ existing_sense_ids: number[] }>(
                "/api/cards/check-senses/",
                { sense_ids: senseIds }
            );
            existingSenses = new Set(res.data.existing_sense_ids);
            console.log("[SendText] 4. check-senses response:", res.data);
        } catch (err) {
            console.error("Error checking cards for senses:", err);
            alert("Could not verify cards for the marked words. Please try again.");
            return;
        }
        const notReady = marked.filter((m) => m.sense_id == null || !existingSenses.has(m.sense_id));
        if (notReady.length > 0) {
            console.warn("[SendText] 4. NOT sent — these marked words have no sense/card yet:", notReady);
            alert(
                "No card has been created yet for these marked words:\n\n" +
                notReady.map((m) => `• ${m.text}`).join("\n") +
                "\n\nClick each one, choose a sense, and use \"+ Create Card\" before sending."
            );
            return;
        }

        // Ensure each marked word (surface form) has Azure audio so the student can hear it on
        // click. First ask the backend which words already have audio (one batch call), then only
        // synthesize the missing ones — in small batches with allSettled so we stay polite to
        // Azure/the server and one failure doesn't abort the rest.
        const uniqueWords = [...new Set(marked.map((m) => m.text))];
        if (uniqueWords.length > 0) {
            // Only create audio for words that don't already have it (skips redundant round-trips).
            let wordsToCreate = uniqueWords;
            try {
                const res = await api.post<{ existing: string[] }>(
                    "/api/audio/check-words/",
                    { words: uniqueWords }
                );
                const existing = new Set(res.data.existing);
                wordsToCreate = uniqueWords.filter((w) => !existing.has(w));
                console.log("[SendText] 5. POST /api/audio/check-words/", { words: uniqueWords }, "-> response:", res.data,
                    "-> will create audio for:", wordsToCreate);
            } catch (err) {
                console.error("Error checking existing audio:", err);
                // Fall back to trying all — the create endpoint is still idempotent.
            }

            if (wordsToCreate.length === 0) {
                toast.info("All marked words already have audio.", {
                    position: "top-right",
                    autoClose: 1500,
                    hideProgressBar: true,
                });
            } else {
                const BATCH_SIZE = 4; // max words synthesized at once
                const failedWords: string[] = [];
                // The normal clip is what the student hears on click (essential); slow is best-effort.
                const createForWord = async (w: string) => {
                    await api.post("/api/create-azure-audio/", { text: w, blob_name: w });
                    await api.post("/api/create-azure-audio/", { text: w, blob_name: w, slow: true }).catch(() => {});
                };
                for (let i = 0; i < wordsToCreate.length; i += BATCH_SIZE) {
                    const batch = wordsToCreate.slice(i, i + BATCH_SIZE);
                    const results = await Promise.allSettled(batch.map(createForWord));
                    results.forEach((r, j) => { if (r.status === "rejected") failedWords.push(batch[j]); });
                }
                const okCount = wordsToCreate.length - failedWords.length;
                if (failedWords.length === 0) {
                    toast.info(`Audio created for ${okCount} new word${okCount !== 1 ? "s" : ""}.`, {
                        position: "top-right",
                        autoClose: 2000,
                        hideProgressBar: true,
                    });
                } else {
                    toast.warn(
                        `Audio created for ${okCount}/${wordsToCreate.length} new words. Failed: ${failedWords.join(", ")}. Sending anyway.`,
                        { position: "top-right", autoClose: 4000 }
                    );
                }
            }
        }

        const payload: LiveTextMessage = {
            message_type: "live_text",
            content: text,          // students display this text
            user_name: name,        // identify sender, which is teacher
            marked_words: marked,   // words the teacher marked as "to learn", resolved in context
        };
        console.log("[SendText] 6. WebSocket send (live_text payload the students receive):", payload);
        websocketRef.current.send(JSON.stringify(payload));
        toast.success("Text sent!", {
            position: "top-right",
            autoClose: 2000,
            hideProgressBar: true,
        });
        // Reset the panel back to a clean edit state.
        setInputText("");
        setTextButtons(null);
        setSelectedIndices(new Set());
        setSenseByIndex({});
        setTextMode("edit");
    };

    // Split the input text into clean word tokens (via spaCy on the backend) and show them as buttons.
    const handleConvertToButtons = () => {
        const text = inputText.trim();
        if (!text) return;
        setTextMode("buttons"); // switch to the buttons tab
        setSelectedIndices(new Set()); // fresh token list -> clear any previous selection
        setSenseByIndex({});           // and any sense associations
        setTokenizing(true);
        // DEBUG [SendText]: data flow for the Send-Text panel (remove when done)
        console.log("[SendText] 1. Convert to Buttons -> POST /english/tokenize-text/ request:", { text });
        api.post<{ tokens: MarkedWord[] }>("/english/tokenize-text/", { text })
            .then((res) => {
                console.log("[SendText] 1. tokenize-text response (one token per word button):", res.data);
                console.table(res.data.tokens ?? []);
                setTextButtons(res.data.tokens ?? []);
            })
            .catch((err) => {
                console.error("[SendText] 1. tokenize-text failed:", err.response?.status, err.response?.data);
                console.error("Error tokenizing text:", err);
                alert("Could not convert the text to buttons.");
            })
            .finally(() => setTokenizing(false));
    };

    // Toggle a token's "selected" (to-learn) state. When it becomes selected, also look up its
    // lemma in the Viet dictionary and show the results in a modal.
    const handleWordButtonClick = (token: MarkedWord) => {
        const willSelect = !selectedIndices.has(token.index);
        console.log(
            `[SendText] 2. Word button clicked: "${token.text}" (index ${token.index}) ->`,
            willSelect ? "MARKED; opening DictionaryModal for lemma" : "UNMARKED (no request)",
            willSelect ? `"${token.lemma}"` : "",
            { token }
        );
        setSelectedIndices((prev) => {
            const next = new Set(prev);
            if (next.has(token.index)) next.delete(token.index);
            else next.add(token.index);
            return next;
        });
        if (willSelect) setDictToken(token);
    };

    // Free the preview object url when the panel unmounts.
    useEffect(() => {
        return () => {
            if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
        };
    }, [imagePreviewUrl]);

    const sendVideoSegmentNumber = () => {
        if (!websocketRef.current) {
            alert("WebSocket is not connected.");
            return;
        }
        websocketRef.current.send(JSON.stringify({
            message_type: "video_segment_number",
            content: inputVideoSegmentNumber,  // query key
            user_name: name,    // identify sender, which is teacher
        }));
          toast.success('Okay!', {
                position: 'top-right',
                autoClose: 2000, // Auto close after 2 seconds
                hideProgressBar: true,
                closeOnClick: true,
                pauseOnHover: true,
                draggable: true,
                progress: undefined,
              });
    };

    return (
        <div className="m-10">

            <div>TeacherControlPanel

            </div>
            <div className="mt-2 bg-green-200">
                <div>
                    Active Live Quiz Id: <span className={`text-red-700 text-md font-bold border-2 border-green-400 rounded-full px-2 py-0 inline-block`}>{activeLiveQuizId === null ? "X" : activeLiveQuizId}</span>
                    {showTerminateLiveQuizButton &&
                        <button className="text-white bg-red-600 ml-10 mb-2 p-2 rounded-md hover:bg-red-800" onClick={handleTerminateLiveQuiz}>Terminate Live Quiz</button>
                    }
                </div>
                <span>
                    <input className="bg-blue-200 text-black m-2 p-2" placeholder="quiz id..."
                        value={inputLiveQuizId || ""}
                        onChange={e => { setInputLiveQuizId(e.target.value) }}
                        readOnly={activeLiveQuizId !== null}
                    />

                    <button
                        className={`text-red bg-green-400 mb-2 p-2 rounded-md hover:bg-green-400 ${inputLiveQuizId ? "" : "opacity-50 cursor-not-allowed"
                            }`}
                        onClick={sendQuizId}
                        disabled={!inputLiveQuizId} // Disable the button if inputLiveQuizId is empty
                    >
                        Send Quiz id
                    </button>
                </span>


            </div>
            <div className="mt-10 bg-gray-200">
                <input className="bg-blue-200 text-black m-2 p-2 rounded-md" placeholder="question number..." value={questionNumber} onChange={(e) => setQuestionNumber(e.target.value)} />
                <button
                    className={`text-white bg-green-600 mb-2 p-1 rounded-md hover:bg-green-800 ${questionNumber ? "" : "opacity-50 cursor-not-allowed"
                        }`}
                    onClick={sendQuestionNumber}
                    disabled={!questionNumber} // Disable the button if questionNumber is empty
                >
                    Send Question Number
                </button>
                <span>
                    <input className="bg-blue-200 text-black m-2 p-1 rounded-md" placeholder="target user name..."
                        onChange={e => setTargetUserName(e.target.value)} value={targetUserName}
                    />
                </span>
                <div className='flex flex-row justify-end gap-2 mt-2'>
                </div>
            </div>


            <div>
                    <input className="bg-blue-200 text-black m-2 p-2" placeholder="video segment num (2...)"
                        value={inputVideoSegmentNumber || ""}
                        onChange={e => { setInputVideoSegmentNumber(e.target.value) }}
                        
                    />

                    <button
                        className={`text-red bg-green-400 mb-2 p-2 rounded-md hover:bg-green-400 ${inputVideoSegmentNumber ? "" : "opacity-50 cursor-not-allowed"
                            }`}
                        onClick={sendVideoSegmentNumber}
                        disabled={!inputVideoSegmentNumber} // Disable the button if inputLiveQuizId is empty
                    >
                        Send Video Segment Number
                    </button>
            </div>
            

            

            { allQuestionNumbers.length > 0 && (
                <div className="mt-10 bg-gray-200 p-2 rounded-md">
                    <h3 className="text-lg font-bold mb-2">All Question Numbers for Active Live Quiz</h3>
                    <ul className="list-disc list-inside">
                        {allQuestionNumbers.map((qn, index) => (
                            <li key={index}>
                                Question {qn}
                            </li>
                        ))}
                    </ul>
                </div>
            )
            }
            <ListUsers userRows={userRows} onUserNameClick={onUserNameClick} />
            {/* Send free-form text to all students; they display it in their non-live view. */}
            <div className="mt-10 bg-gray-200 p-3 rounded-md">
                <h3 className="text-lg font-bold mb-2">Send Text to Students</h3>
                <div className="text-sm mb-3">When you mark a word for sending to students, make sure you:
                     <div>1) have created the audio for it, (if no audio, when the student clicks on the word, NOTHING will happen) </div>
                     <div>2) and you have created a dictionary entry for its lemma, and </div>
                     <div>3) and you have selected a sense and created a card for the term.</div>
                </div>

                {/* Tabs: edit the raw text, or convert it to clickable word buttons. */}
                <div className="flex gap-1 ml-2">
                    <button
                        className={`px-3 py-1 rounded-t-md text-sm font-medium ${
                            textMode === "edit" ? "bg-purple-300 text-purple-900" : "bg-gray-300 text-gray-600 hover:bg-gray-400"
                        }`}
                        onClick={() => setTextMode("edit")}
                    >
                        Edit Text
                    </button>
                    <button
                        className={`px-3 py-1 rounded-t-md text-sm font-medium ${
                            textMode === "buttons" ? "bg-purple-300 text-purple-900" : "bg-gray-300 text-gray-600 hover:bg-gray-400"
                        } ${!inputText.trim() ? "opacity-50 cursor-not-allowed" : ""}`}
                        onClick={handleConvertToButtons}
                        disabled={!inputText.trim()}
                        title="Splits the text into words and finds each word's root form (lemma) with spaCy, via /english/tokenize-text/"
                    >
                        Convert to Buttons (and Lemmatize)
                    </button>
                </div>

                {/* Shared area: the textarea and the word buttons occupy the same region — only
                    the active tab's content is shown. */}
                <div className="mx-2">
                    {textMode === "edit" ? (
                        <textarea
                            className="bg-white text-black p-2 rounded-b-md rounded-tr-md w-full h-24 resize-y"
                            placeholder="Type a message to send to students..."
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                        />
                    ) : (
                        <div className="bg-gray-50 rounded-b-md rounded-tr-md p-3 min-h-24">
                            {tokenizing ? (
                                <p className="text-sm text-gray-500">Converting...</p>
                            ) : textButtons && textButtons.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {textButtons.map((token) => {
                                        const selected = selectedIndices.has(token.index);
                                        const showLemma = SHOW_LEMMAS && token.lemma.toLowerCase() !== token.text.toLowerCase();
                                        return (
                                        <button
                                            key={token.index}
                                            onClick={() => handleWordButtonClick(token)}
                                            title={SHOW_LEMMAS ? `lemma: ${token.lemma} · pos: ${token.pos}` : undefined}
                                            className={`px-2 py-1 rounded text-base flex flex-col items-center leading-tight ${
                                                selected
                                                    ? "bg-blue-500 hover:bg-blue-600 text-white"
                                                    : "bg-gray-100 hover:bg-blue-200 text-black"
                                            }`}
                                        >
                                            <span>{token.text}</span>
                                            {showLemma && (
                                                <span className={`text-xs italic ${selected ? "text-blue-100" : "text-gray-500"}`}>
                                                    {token.lemma}
                                                </span>
                                            )}
                                        </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">No words to show.</p>
                            )}
                        </div>
                    )}
                </div>

                {/* Send is enabled only once the words are visible (buttons tab, tokens present). */}
                <div className="mt-2 ml-2">
                    <button
                        className={`text-white bg-blue-600 mb-2 p-2 rounded-md hover:bg-blue-800 ${
                            textMode === "buttons" && textButtons && textButtons.length > 0 && activeLiveQuizId === null
                                ? "" : "opacity-50 cursor-not-allowed"
                        }`}
                        onClick={sendTextToStudents}
                        disabled={textMode !== "buttons" || !textButtons || textButtons.length === 0 || activeLiveQuizId !== null}
                    >
                        Send Text to Students
                    </button>
                    {activeLiveQuizId !== null && (
                        <span className="text-sm text-red-700 ml-2">
                            Cannot send text while a live quiz is in progress.
                        </span>
                    )}
                </div>
            </div>

            {/* Send a YouTube link to all students; they display it with a manual Play button. */}
            <div className="mt-10 bg-gray-200 p-3 rounded-md">
                <h3 className="text-lg font-bold mb-2">Send YouTube Video to Students</h3>
                <input
                    className="bg-blue-200 text-black m-2 p-2 rounded-md w-96"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={inputVideoLink}
                    onChange={(e) => setInputVideoLink(e.target.value)}
                />
                <button
                    className={`text-white bg-blue-600 mb-2 p-2 rounded-md hover:bg-blue-800 ${
                        inputVideoLink.trim() && activeLiveQuizId === null ? "" : "opacity-50 cursor-not-allowed"
                    }`}
                    onClick={sendVideoLink}
                    disabled={!inputVideoLink.trim() || activeLiveQuizId !== null}
                >
                    Send Video
                </button>
                {activeLiveQuizId !== null && (
                    <span className="text-sm text-red-700 ml-2">
                        Cannot send a video while a live quiz is in progress.
                    </span>
                )}
            </div>

            {/* Paste an image (from Google, etc.) and send it to all students over the WebSocket. */}
            <div className="mt-10 bg-gray-200 p-3 rounded-md">
                <h3 className="text-lg font-bold mb-2">Send Image to Students</h3>
                <div
                    onPaste={handleImagePaste}
                    tabIndex={0}
                    className="border-2 border-dashed border-gray-400 rounded-md p-4 text-center text-gray-600 bg-white cursor-text focus:outline-none focus:border-blue-500"
                >
                    Click here, then paste an image (Ctrl/Cmd+V)
                </div>

                {imagePreviewUrl && (
                    <div className="mt-3 flex flex-col items-start gap-2">
                        <img
                            src={imagePreviewUrl}
                            alt="Preview of image to send"
                            className="max-h-48 rounded border border-gray-400"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={sendImageToStudents}
                                disabled={sendingImage || activeLiveQuizId !== null}
                                className={`text-white bg-blue-600 p-2 rounded-md hover:bg-blue-800 ${
                                    sendingImage || activeLiveQuizId !== null ? "opacity-50 cursor-not-allowed" : ""
                                }`}
                            >
                                {sendingImage ? "Sending..." : "Send Image to Students"}
                            </button>
                            <button
                                onClick={clearPastedImage}
                                disabled={sendingImage}
                                className="text-gray-700 bg-gray-300 p-2 rounded-md hover:bg-gray-400"
                            >
                                Clear
                            </button>
                        </div>
                        {activeLiveQuizId !== null && (
                            <span className="text-sm text-red-700">
                                Cannot send an image while a live quiz is in progress.
                            </span>
                        )}
                    </div>
                )}
            </div>



            {dictToken && (
                <DictionaryModal
                    word={dictToken.lemma}
                    selectedSenseId={senseByIndex[dictToken.index] ?? null}
                    onSelectSense={(senseId) => {
                        console.log(
                            `[SendText] 3. Sense ${senseId === null ? "cleared" : `chosen: sense_id ${senseId}`} for "${dictToken.text}" (index ${dictToken.index})`
                        );
                        setSenseByIndex((prev) => {
                            const next = { ...prev };
                            if (senseId === null) delete next[dictToken.index];
                            else next[dictToken.index] = senseId;
                            return next;
                        });
                    }}
                    onClose={() => setDictToken(null)}
                />
            )}

            <ToastContainer />
        </div>
    )
}

export default TeacherControlPanel


