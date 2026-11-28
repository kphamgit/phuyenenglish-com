import { useEffect, useEffectEvent, useRef, useState } from 'react'
import CustomYoutubePlayer from './shared/CustomYoutubePlayer'
import RewatchPromptModalLive from './RewatchPromptModalLive'
import type { ProcessQuestionAttemptResultsProps, QuestionAttemptAssesmentResultsProps, QuestionProps, VideoSegment, WebSocketMessageProps } from './shared/types';
import { useWebSocket } from './context/WebSocketContext';
import api from '../api';
import DOMPurify from 'dompurify';

import OpenAIStream from './shared/OpenAIStream';
import QuestionInput from './QuestionInput';
import { questionTypeName } from './shared/questionTypes';
import type { ChildRef } from './TakeQuiz';
import type { UserRowProps } from './context/UserConnectionsContext';
import CorrectModal from './CorrectModal';
import IncorrectModal from './IncorrectModal';

// Extract the 11-char YouTube video id from a URL (watch, youtu.be, embed, shorts).
// If the string is already just an id, return it as-is.
function extractVideoId(url: string): string {
    if (!url) return '';
    const match = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
    return match ? match[1] : url;
  }

// Convert a "MM:SS:mmm" time value into a number of seconds.
// e.g. "02:33:5000" -> 2*60 + 33 + 5000/1000 = 158 seconds.
function parseTime(t: string | number | undefined): number {
    if (t === undefined || t === null || t === '') return 0;
    if (typeof t === 'number') return t;
    const parts = t.split(':').map(Number);
    if (parts.length === 3) {
      const [minutes, seconds, milliseconds] = parts;
      return minutes * 60 + seconds + milliseconds / 1000;
    }
    const fallback = parseFloat(t);
    return Number.isNaN(fallback) ? 0 : fallback;
  }

  interface TakeVideoQuizLiveProps {
    user_name: string;
    live_quiz_id: string;
    video_url: string;
    video_segments: VideoSegment[];
    playKey: number; // changing this prop will force the player to reload and play from the start time
    parent_callback: () => void;   // to notify parent component when a
}

// How many times a user may rewatch each segment before they must move on.
const MAX_REWATCHES = 3;

function TakeVideoQuizLive({ user_name, live_quiz_id, video_url, video_segments, parent_callback }: TakeVideoQuizLiveProps) {

    const [activeSegment, setActiveSegment] = useState<VideoSegment | null>(null);
    const [showRewatchPrompt, setShowRewatchPrompt] = useState<boolean>(false);
    const [rewatchesLeft, setRewatchesLeft] = useState<number>(MAX_REWATCHES);
    // Local play trigger: bump to (re)play the active segment. Seeded from the `playKey` prop
    // and also bumped internally when the user chooses to rewatch a segment.
    const [playTrigger, setPlayTrigger] = useState<number | undefined>(undefined);

    const [showQuestion, setShowQuestion] = useState<boolean>(false);

    const videoId = extractVideoId(video_url) || 'dQw4w9WgXcQ';

    const {eventEmitter } = useWebSocket();

    const [liveQuestionNumber, setLiveQuestionNumber] = useState<string | null>(null);

    const chimeAduioRef = useRef<HTMLAudioElement | null>(null);

    const [pendingQuestionAttempt, setPendingQuestionAttempt] = useState<boolean>(false); // to track if a question attempt is being processed by the server. This is important to prevent multiple submissions of the same question attempt when user clicks submit button multiple times before receiving a response from the server.

    const [question, setQuestion] = useState<QuestionProps | null>(null);

    const childRef = useRef<ChildRef>(null);

    const [questionAttemptAssessmentResults, setQuestionAttemptAssessmentResults] = 
                useState<QuestionAttemptAssesmentResultsProps | null>(null);

    const [showCorrectModal, setShowCorrectModal] = useState(false);
    const [showIncorrectModal, setShowIncorrectModal] = useState(false);

    const [showYouTubePlayer, setShowYouTubePlayer] = useState<boolean>(true);
            
    const [, setMyLiveScore] = useState<UserRowProps>({
          name: user_name || '', 
          live_question_number: undefined, 
          live_score: undefined, 
          live_total_score: undefined });
    
        const [totalScore, setTotalScore] = useState<number>(0);
            
                //const [playKey, setPlayKey] = useState<number | undefined>(undefined);
                //const [finishedLiveQuestion, setFinishedLiveQuestion] = useState<{status: boolean, question_number: string}>({ status: false, question_number: '' });
            
    let correctModalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
            

    // Start with segment number 1 once the segments arrive.
    /*
    useEffect(() => {
      const firstSegment = video_segments.find((seg) => seg.segment_number === 1);
      if (firstSegment) {
        setActiveSegment(firstSegment);
      }
    }, [video_segments]);
    */

    // Each time a new segment becomes active: reset the rewatch allowance and show the
    // video again (hide any question left over from the previous segment).
    useEffect(() => {
      setRewatchesLeft(MAX_REWATCHES);
      setShowQuestion(false);
    }, [activeSegment?.segment_number]);

    // Note: we intentionally do NOT auto-play when a segment becomes active — the video frame
    // is shown paused. Playback is only (re)started by an explicit user action (rewatch),
    // which bumps `playTrigger` below.

    // Play (or replay) the current active segment by bumping the play trigger.
    const handlePlaySegment = () => {
      if (activeSegment) {
        setPlayTrigger((k) => (k ?? 0) + 1);
      }
    };

    // Replay the current active segment (used by the rewatch flow).
    const handleReplay = handlePlaySegment;

    const handleRewatchYes = () => {
      if (rewatchesLeft <= 0) return; // no rewatches left — guard (the modal also disables Yes)
      setShowRewatchPrompt(false);
      setRewatchesLeft((n) => n - 1);
      handleReplay();
    };

    const handleRewatchNo = () => {
      setShowRewatchPrompt(false);
      // Hide the video (the player is gated on `!showQuestion`) while keeping `activeSegment`
      // so we still know which segment's question(s) to show next.
      // setShowQuestion(true);
      setShowYouTubePlayer(false);
      // TODO: load/show the question(s) for `activeSegment`.
    };

    // Called when a segment finishes playing — prompt the user to rewatch it.
    const handleSegmentPlayingEnd = () => {
      //console.log("TakeVDQuizLive: segment ended, segment number:", activeSegment?.segment_number);
      setShowRewatchPrompt(true);
    };

    const displayQuestion = () => {
        if (!question) return null;
        return <QuestionInput question={question} ref={childRef} />;
      }

useEffect(() => {
      const handleMessage = (data: WebSocketMessageProps) => {
        if (data.message_type === "video_segment_number") {
            //console.log("TakeVDQuizLive: received video_segment_number message from server, segment number:", data.content);
            setActiveSegment(video_segments.find((seg) => seg.segment_number === Number(data.content)) || null);
            setShowYouTubePlayer(true); // show the video player when a new segment is received
            if (chimeAduioRef.current) {
                chimeAduioRef.current.play().catch((error) => {
                    console.error("Error playing chime sound:", error);
                });
            }
        }
        if (data.message_type === "live_question_number") {
            //console.log("TakeQuizLive: Received live_question_number message from server, question number:", data.content);
              setLiveQuestionNumber(data.content);
              if (chimeAduioRef.current) {
                chimeAduioRef.current.play().catch((error) => {
                    console.error("Error playing chime sound:", error);
                });
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

    const displayPendingQuestionStatus = () => {
        // only display status if quiz_id is set
        if (live_quiz_id) {
            if (!showQuestion) {
              return "Waiting for question ...";
                //return <div>Question number: {question?.question_number}</div>
            }
        }
      }


    const fetchLiveQuestion = useEffectEvent((questionNum: number) => {
        // We check pending status here to ensure we have the latest state
        if (pendingQuestionAttempt) return;
  
        api.post(`/api/quizzes/${live_quiz_id}/questions/${questionNum}/live/`, {
          user_name: user_name || '',
        })
          .then((res) => res.data)
          .then((data) => {
            console.log("TakeVDQuizLive: Quiz Question Data:", data);
            /*
{
  "id": 2,
  "quiz_id": 2,
  "video_segment_id": 1,
  "question_number": 1,
  "question_purpose": "practice",
  "content": "How [are] you?",
  "content_language": "en",
  "format": 1,
  "answer_key": "are",
  "instructions": "<p>instruction</p>",
  "prompt": "",
  "audio_str": "",
  "score": 0,
  "button_cloze_options": null,
  "timeout": 30000,
  "hint": "",
  "explanation": ""
}
            */

            setQuestion(data);
            setShowQuestion(true);
            setShowYouTubePlayer(false); // hide the video player when question is shown
            setPendingQuestionAttempt(true);
            // set question number in myLiveScore state to keep track of which question I am on for scoring purposes
            /*
            setMyLiveScore((prev) => ({
              ...prev,
              live_question_number: Number(liveQuestionNumber),
              live_score: undefined, // reset live score for the new question
            }));
            */
          })
          .catch(err => console.error("Fetch failed", err));
      });

      useEffect(() => {
        if (!liveQuestionNumber) {
          //console.log("TakeQuizLive: question_number is not set.");
          return;
        }
  
        // Call the event handler
        console.log("TakeQuizLive: useEffect triggered for liveQuestionNumber change. Calling fetchLiveQuestion with question number:", Number(liveQuestionNumber));
        fetchLiveQuestion(Number(liveQuestionNumber));
  
        // Dependency array is now clean and specific
      }, [liveQuestionNumber]);

      function SafeHTML({ content }: { content: string }) {
        const sanitizedContent = DOMPurify.sanitize(content, {
          USE_PROFILES: { html: true },
          ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'br', 'span', 'div', 'img'],
          ALLOWED_ATTR: ['href', 'target', 'rel']
        });
        return <div dangerouslySetInnerHTML={{ __html: sanitizedContent }} />;
      }

      const handleModalClose = () => {
        //console.log("handleCorrectModalTimeout called. nextQuestionId =", nextQuestionId.current);
        setShowCorrectModal(false);
        setShowIncorrectModal(false);
        setPendingQuestionAttempt(false); // reset pending question attempt status when question attempt is finished
        // clear liveQuestionNumber to prepare for next question
        setLiveQuestionNumber(null);
        parent_callback(); // notify parent component that question is finished
      };

      const handleSubmit = () => {
        //console.log("TakeQuizLive: handleSubmit called");
         setShowQuestion(false); //
         const url = `/api/process_live_question_attempt/`;
         //console.log("POSTing to url =", url);
         
         api.post<ProcessQuestionAttemptResultsProps>(url, { user_name: user_name, format: question?.format , user_answer: childRef.current?.getAnswer(), answer_key: question?.answer_key })
           .then((res) => {     
             const { assessment_results } = res.data;
             setQuestionAttemptAssessmentResults(assessment_results);
             //setTotalScore((prevTotalScore) => prevTotalScore + assessment_results.score);
             const new_total_score = (totalScore || 0) + (assessment_results.score || 0);
             setTotalScore(new_total_score);
             setMyLiveScore((prev) => ({
               ...prev,
               live_score: assessment_results.score,
               live_total_score: new_total_score,
              
             }));

             if (assessment_results.error_flag === false) {
               //alert("Answer is correct.");
               setShowCorrectModal(true);
              
               correctModalTimerRef.current = setTimeout(() => {
                 setShowCorrectModal(false);
                 // show next question if available by checking next_question_data
                 handleModalClose();
                 // handle end of quiz scenario here
               }, 2000); // Close modal after 2 seconds
             }
             else {
               //alert("Answer is incorrect. Please try again.");
              
               setShowIncorrectModal(true);
             }
         })
           .catch((error) => {
             console.error("Error processing question attempt:", error);
           });
   }

  return (
    <div>
        { !showQuestion && showYouTubePlayer && (
            <CustomYoutubePlayer
            videoId={videoId}
            startTime={activeSegment ? parseTime(activeSegment.start_time) : 0}
            stopTime={activeSegment ? parseTime(activeSegment.end_time) : 0}
            playKey={playTrigger}
            onSegmentEnd={handleSegmentPlayingEnd}
            blockClicks
            />
        )}

        { (!showQuestion || video_segments.length > 0) && (
            <div className="mt-2 flex justify-center items-center gap-2">
                { !showQuestion && (
                  <button
                    onClick={handlePlaySegment}
                    disabled={!activeSegment}
                    className="px-4 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-green-600"
                  >
                    Play
                  </button>
                )}
                {video_segments.map((seg) => (
                   <span key={seg.id} className={`p-2 ${activeSegment?.segment_number === seg.segment_number ? 'bg-green-500 text-white font-bold' : 'bg-blue-200'}`}>{seg.segment_number}</span>
                ))}
            </div>
        )
        }
        {  liveQuestionNumber && (
                <div>Live Question Number: {liveQuestionNumber}</div>
        )
        }
           {question && showQuestion ? (
            <div className="col-span-8 mx-15 my-5 p-10 rounded-md bg-cyan-200">
              <div className="mb-3 text-lg text-amber-800">
                Question: {question?.question_number}
                {questionTypeName(question?.format) && <span className='ml-2 inline-block rounded-full bg-teal-700 px-2 py-0.5 text-sm font-semibold text-white align-middle'>{questionTypeName(question?.format)}</span>}
              </div>
              {SafeHTML({ content: question.instructions ?? "" })}
              {question?.prompt && (
                <div className="mb-3 mt-5 text-amber-800 whitespace-pre-wrap">
                  {question.prompt}
                </div>
              )
              }
              <div>
                {(question?.audio_str && question.audio_str.trim().length > 0) &&
                  <OpenAIStream sentence={question.audio_str} />
                }
              </div>
              <div className='my-5'>
                {displayQuestion()}
              </div>
              <button className='bg-green-500 text-white mx-10 mt-7 p-2 rounded-md hover:bg-red-300'
                onClick={() => handleSubmit()}
              >
                Submit
              </button>
            </div>

          ) : (
            <div className="col-span-8 mx-15 my-5 p-10 rounded-md bg-cyan-200 text-center text-xl text-gray-700">
              {displayPendingQuestionStatus()}
            </div>
          )}

      {showRewatchPrompt && (
        <RewatchPromptModalLive
          onYes={handleRewatchYes}
          onNo={handleRewatchNo}
          rewatchesLeft={rewatchesLeft}
        />
      )}

{(showCorrectModal || showIncorrectModal) && (
        <div className="fixed inset-0 bg-slate-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
          {showCorrectModal && <CorrectModal score={questionAttemptAssessmentResults?.score} />}
          {showIncorrectModal && <IncorrectModal
            parentCallback={handleModalClose}
            format={question?.format ?? 1}
            content={question?.content ?? ""}
            answer_key={question?.answer_key ?? ""}
            explanation={question?.explanation ?? ""}
            processQuestionResults={questionAttemptAssessmentResults as QuestionAttemptAssesmentResultsProps}
          />}
        </div>
      )}

    </div>
  )
}

export default TakeVideoQuizLive
