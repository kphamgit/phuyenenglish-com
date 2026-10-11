import { useLocation, useParams, useNavigate, useOutletContext } from 'react-router-dom';
import type { HomeStudentOutletContext } from '../pages/HomeStudent';
import CustomYoutubePlayer from './shared/CustomYoutubePlayer';
import { useEffect, useRef, useState } from 'react';
import api from '../api';
import type { ProcessQuestionAttemptResultsProps, QuestionAttemptAssesmentResultsProps, QuizAttemptProps } from './shared/types';
import RewatchPromptModal from './RewatchPromptModal';
import ReviewPromptModal from './ReviewPromptModal';
import { useSelector } from 'react-redux';
import { type QuestionProps} from './shared/types';

import type { ChildRef } from './TakeQuiz';
import IncorrectModal from './IncorrectModal';
import CorrectModal from './CorrectModal';
import QuestionInput from './QuestionInput';
import OpenAIStream from './shared/OpenAIStream';
import DOMPurify from 'dompurify';
//import { on } from 'events';

interface VideoSegment {
  id: number,
  quiz_id: number,
  segment_number: number,
  start_time: string,
  end_time: string,
  question_ids: string
}

// Shape of the /video_quiz_attempts/create/ response.
interface CreateVideoQuizAttemptResponse {
  created: boolean; // false => an existing pending attempt was returned
  quiz_attempt: QuizAttemptProps;
  question: QuestionProps;
  question_attempt_id: number;
}

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

// Fallback segments so the player is testable when no route state is passed.
const DEFAULT_SEGMENTS: VideoSegment[] = [
  { id: 1, quiz_id: 0, segment_number: 1, start_time: '00:00:000', end_time: '00:20:000', question_ids: '' },
  { id: 2, quiz_id: 0, segment_number: 2, start_time: '00:20:000', end_time: '00:40:000', question_ids: '' },
  { id: 3, quiz_id: 0, segment_number: 3, start_time: '00:40:000', end_time: '01:00:000', question_ids: '' },
];

// How many times a student may rewatch each segment before they must move on.
// (Total plays per segment = initial view + MAX_REWATCHES; 3 rewatches -> 4 plays total.)
const MAX_REWATCHES = 3;

export default function TakeVideoQuiz() {
  const location = useLocation();
  const { quiz_id, video_url, video_segments } = location.state || {};
  const { category_id } = useParams<{ category_id: string, quiz_id: string }>();
  const navigate = useNavigate();

  //console.log("VIDEO SEGMENTS from route state:", video_segments);
  const { name } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);
  // Use the video from the route if present, otherwise a default test video.
  const videoId = extractVideoId(video_url) || 'dQw4w9WgXcQ';
  const segments: VideoSegment[] =
    Array.isArray(video_segments) && video_segments.length > 0 ? video_segments : DEFAULT_SEGMENTS;

  const [activeSegment, setActiveSegment] = useState<VideoSegment | null>(null);
  // undefined until the first click, so nothing auto-plays on mount.
  // Bumped on every click so clicking the same segment again replays it.
  const [playKey, setPlayKey] = useState<number | undefined>(undefined);
  const [showQuestion, setShowQuestion] = useState<boolean>(false);
  const [question, setQuestion] = useState<QuestionProps | undefined>()
  const childRef = useRef<ChildRef>(null);

  const [quizAttempt, setQuizAttempt] = useState<QuizAttemptProps | null>(null);
  const [questionAttemptId, setQuestionAttemptId] = useState<number | null>(null);
  const [showRewatchPrompt, setShowRewatchPrompt] = useState<boolean>(false); //
  const [rewatchesLeft, setRewatchesLeft] = useState<number>(MAX_REWATCHES); // per-segment rewatch allowance
  const [showCorrectModal, setShowCorrectModal] = useState(false);
  const [showIncorrectModal, setShowIncorrectModal] = useState(false);
  const [showRedoQuizPrompt, setShowRedoQuizPrompt] = useState<boolean>(false); //
  const [showReviewPrompt, setShowReviewPrompt] = useState<boolean>(false); //

  let correctModalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [endOfQuiz, setEndOfQuiz] = useState<boolean>(false);

  // quiz is over -> re-enable the Navbar (it's disabled while on a take-quiz route)
  const outletContext = useOutletContext<HomeStudentOutletContext | undefined>();
  useEffect(() => {
    if (endOfQuiz) outletContext?.setFinishedQuizPath(location.pathname);
  }, [endOfQuiz, outletContext, location.pathname]);

  //const [reviewMode, setReviewMode] = useState<boolean>(false);
  const reviewModeRef = useRef<boolean>(false);

  const [questionAttemptAssessmentResults, setQuestionAttemptAssessmentResults] =
             useState<QuestionAttemptAssesmentResultsProps | null>(null);

  const incorrectModalQuestion = useRef<QuestionProps | undefined>(undefined);
  // Holds the pending-attempt response while the redo prompt is up, so its handlers can use it.
  const pendingResponseRef = useRef<CreateVideoQuizAttemptResponse | null>(null);
  // Which quiz we've already POSTed a create-attempt for, so StrictMode's double-invocation (or a
  // re-render) doesn't create/fetch the attempt twice — the 2nd call would return created:false.
  const requestedQuizRef = useRef<unknown>(undefined);
  // Mirror of activeSegment so async handlers read the latest value (no stale closure).
  const activeSegmentRef = useRef<VideoSegment | null>(null);
  activeSegmentRef.current = activeSegment;

  useEffect(() => {
    // Only POST once per quiz (guards against StrictMode's setup→cleanup→setup double-invocation,
    // whose 2nd call would find the just-created attempt and return created:false → false redo prompt).
    if (requestedQuizRef.current === quiz_id) return;
    requestedQuizRef.current = quiz_id;
    // console.log("Starting quiz attempt because this is the first segment.");
      api.post(`/api/video_quiz_attempts/create/`, {
        quiz_id: quiz_id,
        user_name: name,
      })
     .then((response) => {
        //console.log("Quiz attempt created response's data:", response.data);
        // `created` is false when the server returns an existing *pending* attempt for this
        // user+quiz. In that case, stash the response and ask the user whether to continue it
        // or start over — and DON'T auto-start the segment until they choose.
        /*
{
  "quiz_attempt": {
    "id": 1386,
    "quiz_id": 14,
    "user_name": "student1",
    "score": 0,
    "created_at": "2026-08-01T19:23:34.412340Z",
    "updated_at": "2026-08-01T19:23:34.412709Z",
    "completion_status": "uncompleted",
    "errorneous_questions": "",
    "review_state": false
  },
  "created": true,
  "question": {
    "id": 37,
    "quiz_id": 14,
    "video_segment_id": 44,
    "question_number": 1,
    "question_purpose": "practice",
    "content": "Where [were] they?",
    "content_language": "en",
    "format": 1,
    "answer_key": "were",
    "instructions": "<p>instruction</p>",
    "prompt": "",
    "audio_str": "",
    "score": 0,
    "button_cloze_options": "",
    "timeout": 30000,
    "hint": "",
    "explanation": ""
  },
  "question_attempt_id": 2381
}
        */

        if (!response.data.created) {
          
          pendingResponseRef.current = response.data;
          setShowRedoQuizPrompt(true);
          return;
        }
        // A fresh attempt was created — start it.
        applyQuizAttemptResponse(response.data);
      })
      .catch((error) => {
        console.error("Error fetching quiz attempt data:", error);
      
      });
 },[quiz_id, video_segments, name])


  const handleSegmentPlay = (segment: VideoSegment) => {
    //console.log(`handleSegmentPlay Playing segment ${segment.segment_number}: ${segment.start_time} to ${segment.end_time}`);
    setActiveSegment(segment);
    setRewatchesLeft(MAX_REWATCHES); // fresh rewatch allowance for the new segment
    setShowQuestion(false); // hide any previous question while the new segment plays
    setPlayKey((k) => (k ?? 0) + 1);
    // playKey is watched inside CustomYoutubePlayer, so bumping it 
    // triggers a re-render and starts playback of the new segment.
  };

  // Apply a create-attempt response: save the attempt/question ids and play the segment
  // that contains the current question. Shared by the fresh-attempt path and "continue".
  const applyQuizAttemptResponse = (data: CreateVideoQuizAttemptResponse) => {
    setQuizAttempt(data.quiz_attempt);
    setQuestion(data.question);
    setQuestionAttemptId(data.question_attempt_id);
    const segmentContainingQuestion = segments.find((segment) =>
      segment.question_ids.split(',').map((num) => parseInt(num.trim())).includes(data.question.id)
    );
    if (segmentContainingQuestion) {
      //console.log(`Found segment ${segmentContainingQuestion.segment_number} containing question ${data.question.id}.`);
      handleSegmentPlay(segmentContainingQuestion);
    } else {
      console.warn(`No segment found containing question ${data.question.id}.`);
    }
  };

  // Redo prompt: continue the pending attempt using the stashed response.
  const handleRedoContinue = () => {
    setShowRedoQuizPrompt(false);
    if (pendingResponseRef.current) {
      applyQuizAttemptResponse(pendingResponseRef.current);
    }
  };

  // Redo prompt: reset the pending attempt and start it fresh from the first question.
  const handleRedoStartOver = async () => {
    setShowRedoQuizPrompt(false);
    const pendingAttemptId = pendingResponseRef.current?.quiz_attempt?.id;
    if (!pendingAttemptId) {
      console.warn("No pending attempt id to reset.");
      return;
    }
    try {
      const res = await api.get<CreateVideoQuizAttemptResponse>(`/api/quiz_attempts/${pendingAttemptId}/reset/`);
      applyQuizAttemptResponse(res.data);
    } catch (err) {
      console.error("Error resetting quiz attempt:", err);
    }
  };

  const handleReplay = () => {
    // retrieve the current active segment and replay it
    //console.log("handleReplay called. Current active segment:", activeSegment);
    if (activeSegment) {
      //console.log(`Replaying segment ${activeSegment.segment_number}: ${activeSegment.start_time} to ${activeSegment.end_time}`);
      //setShowQuestion(false); // hide any previous question while the segment replays
      setPlayKey((k) => (k ?? 0) + 1);
    }
  }

  const handleRewatchYes = () => {
    if (rewatchesLeft <= 0) return; // no rewatches left (the modal also disables "Yes")
    setShowRewatchPrompt(false);
    setRewatchesLeft((n) => n - 1);
    handleReplay();
  };
  const handleRewatchNo = async () => {
    setShowRewatchPrompt(false);
    // In review mode the erroneous question is already loaded — just show it
    // (don't fetch the segment's first question).
    if (reviewModeRef.current) {
      setShowQuestion(true);
      return;
    }
    // check if this the first video segment
    const is_first_video_segment = activeSegment?.segment_number === 1;
    if (is_first_video_segment) {
      // when the first video segment ends, there should be a question to show,
      // since the frontend should have already fetched the first question of the first segment when the quiz attempt was created.
      // see the useEffect loop above
      // console.log("This is the first video segment.");
      // show the first question of the first segment
      setShowQuestion(true);
      return;
    }
    // fetch the first question of the current segment and show it
    const current_segment = segments.find((seg) => seg.segment_number === activeSegment?.segment_number);
    const question_ids_for_segment = current_segment?.question_ids.split(',').map((num) => parseInt(num.trim()));
    const first_question_id = question_ids_for_segment?.[0];

    if (first_question_id === undefined || !quizAttempt) {
      //console.warn("Cannot create question attempt: missing first_question_id or quizAttempt.");
      return;
    }

    const ok = await fetchQuestionAttempt(quizAttempt.id, first_question_id);
    if (ok) {
      setShowQuestion(true);
    }
  };

  const fetchQuestionAttempt = async (quiz_attempt_id: number, question_id: number) => {
    const url = `/api/quiz_attempts/${quiz_attempt_id}/create_question_attempt/`;
    //console.log(`fetchQuestionAttempt - Creating next question attempt for quiz_attempt_id=${quiz_attempt_id}, question_id=${question_id} url = ${url}`);
    try {
        const response = await api.post<{ question: QuestionProps, question_attempt_id: number, question_attempt_number: number }>
        (url, {
            question_id: question_id,
        });
        //console.log("fetchQuestionAttempt - response.data for question_id=" + question_id + ":", response.data);
        if (response.data.question && response.data.question_attempt_id) {
           //console.log(`fetchQuestionAttempt - Created question attempt with id ${response.data.question_attempt_id} for question_id=${question_id}`);
            setQuestionAttemptId(response.data.question_attempt_id);
            setQuestion(response.data.question);
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error creating next question attempt:", error);
        return false;
    }
  }


  const handleSegmentPlayingEnd = () => {
    //console.log(`Segment ${activeSegment?.segment_number} ended.`);
    // get the first question number from the segment's question_ids string
    //console.log(' segments', segments);
    // retrieve the first question of the active segment and show it (for now, just log it)
    //const first_question_number = activeSegment?.question_ids.split(',')[0];
    //const current_segment = segments.find((seg) => seg.segment_number === activeSegment?.segment_number);
    //const question_ids_for_segment = current_segment?.question_ids.split(',').map((num) => parseInt(num.trim()));
  
    //console.log(`Question ids for segment ${activeSegment?.segment_number}:`, question_ids_for_segment);
    setShowRewatchPrompt(true); // show the rewatch prompt modal
    /*
[
    {
        "id": 44,
        "quiz_id": 14,
        "segment_number": 1,
        "start_time": "0:00:000",
        "end_time": "0:15:000",
        "question_ids": "30"
    },
    {
        "id": 45,
        "quiz_id": 14,
        "segment_number": 2,
        "start_time": "0:15:200",
        "end_time": "0:30:600",
        "question_ids": "37"
    },
]
    */

    setShowQuestion(false);
  }

  // Fetch the next still-incorrect question for review and show it. When none remain,
  // mark the attempt completed. Shared by the review prompt (onReviewYes) and handleModalClose.
  const loadNextIncorrectQuestion = async () => {
    try {
      const response = await api.get(`/api/quiz_attempts/${quizAttempt?.id}/get_incorrect_question_attempt/`);
      //console.log("Received response from get_incorrect_question_attempt API:", response.data);
      const { question_attempt_id, question: nextQuestion } = response.data;
      if (question_attempt_id && nextQuestion) {
        setQuestionAttemptId(question_attempt_id);
        setQuestion(nextQuestion);
        // find the segment that contains this question
        const segmentContainingQuestion = segments.find((segment) =>
          segment.question_ids.split(',').map((num) => parseInt(num.trim())).includes(nextQuestion.id)
        );
        // If the next incorrect question belongs to a DIFFERENT segment than the one currently
        // active, play that segment first: segment end -> Rewatch modal -> show the question.
        // Otherwise (same segment), show the question directly.
        const isDifferentSegment =
          !!segmentContainingQuestion &&
          segmentContainingQuestion.segment_number !== activeSegmentRef.current?.segment_number;
        if (isDifferentSegment) {
          handleSegmentPlay(segmentContainingQuestion); // sets activeSegment, hides question, plays
        } else {
          setActiveSegment(segmentContainingQuestion ?? null);
          setShowQuestion(true);
        }
      } else {
        //console.log("Review: no more incorrect questions. Marking quiz attempt as completed.");
        api.post(`/api/quiz_attempts/${quizAttempt?.id}/mark_completed/`)
          .then(() => setEndOfQuiz(true))
          .catch(err => console.error("Error marking quiz attempt as completed.", err));
      }
    } catch (error) {
      console.error("Error fetching next incorrect question for review:", error);
    }
  };

  const handleModalClose = async (finishedQuestionId?: number) => {
   if (showCorrectModal) {
     setShowCorrectModal(false);
   }
   if (showIncorrectModal) {
     setShowIncorrectModal(false);
   }

   // Review mode: there are no segments to advance through — just load the next
   // erroneous question (if any). When none remain, the review is done.
   if (reviewModeRef.current) {
     await loadNextIncorrectQuestion();
     return;
   }

   // Use the id passed in from the caller (captured before `question` was cleared),
   // rather than reading `question` state which is undefined by now.
    //console.log(`IN handleModalClose Current question id: ${finishedQuestionId}`);
    const current_question_id = finishedQuestionId;
    // see if current question is the last question in the segment, if so, show the next segment's video
    const current_segment = segments.find((seg) => seg.segment_number === activeSegment?.segment_number);
    // is current question the last question in the segment?
    const question_ids_for_segment = current_segment?.question_ids.split(',').map((num) => parseInt(num.trim()));
    //console.log(`Question ids for segment ${activeSegment?.segment_number}:`, question_ids_for_segment);
    const is_last_question_in_segment = question_ids_for_segment?.[question_ids_for_segment.length - 1] === current_question_id;
    // load the next question if available, otherwise show the next segment's video
    
    if (is_last_question_in_segment) {
      //console.log(`Current question ${current_question_id} is the last question in segment ${activeSegment?.segment_number}.`);
      // find the next segment
      const next_segment = segments.find((seg) => seg.segment_number === (activeSegment?.segment_number ?? 0) + 1);
      if (next_segment) {
        //console.log(`Loading next segment ${next_segment.segment_number}.`);
        handleSegmentPlay(next_segment);
      } else {
        console.log("No more segments. Check incorrect count.");

        let wrongCount = 0;
    
        try {
                const res = await api.get<{ count: number }>(`/api/quiz_attempts/${quizAttempt?.id}/incorrect_count/`);
                //console.log("Incorrect count response:", res.data);
                wrongCount = res.data.count;
                if (wrongCount > 0) {
                  //console.log(`There are ${wrongCount} incorrect questions. Showing review prompt.`);
                  // show ReviewPrompt modal to ask user 
                  setShowReviewPrompt(true);
                  //setRedoCount(wrongCount);
                  //setShowRedoPrompt(true);
              } else {
                  //console.log("No more segments and no incorrect questions. Marking quiz attempt as completed.");
                  api.post(`/api/quiz_attempts/${quizAttempt?.id}/mark_completed/`)
                    .then(() => setEndOfQuiz(true))
                    .catch(err => console.error("Error marking quiz attempt as completed.", err));
              }
        } catch (err) {
                console.error("Error fetching incorrect count:", err);
        }
      }
    } else {
      // load the next question in the current segment
      //console.log("****** Loading next question in the current segment.question_ids_for_segment =", question_ids_for_segment);
      
      const current_question_index = question_ids_for_segment?.indexOf(current_question_id ?? -1);
      //console.log(`Current question index in segment ${activeSegment?.segment_number}: ${current_question_index}`);
      const next_question_id = question_ids_for_segment?.[current_question_index! + 1];
      if (next_question_id) {
        //console.log(`Loading next question ${next_question_id} in segment ${activeSegment?.segment_number}.`);
        // fetchQuestionAttempt already sets the question + questionAttemptId on success,
        // so no separate GET /api/questions/:id/ is needed.
        if (quizAttempt && quizAttempt.id) {
          const ok = await fetchQuestionAttempt(quizAttempt.id, next_question_id);
          //console.log("fetchQuestionAttempt ok =", ok, "-> setShowQuestion(true) will", ok ? "run" : "NOT run");
          if (ok) {
            setShowQuestion(true);
          }
        } else {
          console.warn("No quizAttempt.id available to fetch the next question.", quizAttempt);
        }
      } else {
        console.warn(`No next question found after current question ${current_question_id} in segment ${activeSegment?.segment_number}.`);
      }
    }
    //
  };

  const handleSubmit = () => {
    const url = `/api/question_attempts/${questionAttemptId}/process/`;
    const uanswer = childRef.current?.getAnswer(); 
    const aKey = question?.answer_key;
   
    api.post<ProcessQuestionAttemptResultsProps>(url, { format: question?.format, user_answer: uanswer, answer_key: aKey })
    .then((res) => {
      const finishedQuestion = question; // capture before clearing so we can pass its id along
      setQuestion(undefined)
      const { assessment_results } = res.data;
      // console.log("******** Assessment results:", assessment_results);
      setQuestionAttemptAssessmentResults(assessment_results);
      // The server marks the QuestionAttempt completed in /process/, so no local progress tracking is needed.
      if (assessment_results.error_flag === false) {
        //alert("Answer is correct.");
        setShowCorrectModal(true);
        correctModalTimerRef.current = setTimeout(() => {
          setShowCorrectModal(false);
          handleModalClose(finishedQuestion?.id);
        }, 1000); // Close modal after 2 seconds
      }
      else {
         incorrectModalQuestion.current = question;
         setShowIncorrectModal(true);
      }
    })
    .catch((err) => {
      console.error("Error processing question attempt:", err);
    });
  }

  /*
  const finishQuiz = useEffectEvent(() => {
    //setShowCorrectModal(false);
    //setShowVideoPlayer(false);
    if (quizAttempt) {
        api.post(`/api/quiz_attempts/${quizAttempt.id}/mark_completed/`)
            .then(() => setEndOfQuiz(true))
            .catch(err => console.error("Error marking quiz attempt as completed.", err));
    }
});
*/

  // Let the student end the quiz early. This does NOT mark the attempt completed — it just leaves
  // the quiz route (back to the category), which closes the panel and re-enables the Navbar. The
  // attempt stays "uncompleted" so it can be resumed later.
  const handleTerminateQuiz = () => {
    if (!window.confirm("End this quiz now?")) return;
    navigate(`/categories/${category_id}`);
  };

  if (endOfQuiz) {
    return (
      <div className='text-center mt-10'>
        <h2 className='text-2xl font-bold mb-4'>Quiz Completed!</h2>
      </div>
    );
   }

  const onReviewYes = () => {
    console.log("User chose to review incorrect questions.");
    setShowReviewPrompt(false);
    api.get(`/api/quiz_attempts/${quizAttempt?.id}/set_review_mode/`, )
    .then(() => {
      console.log("Quiz attempt review mode set to true in server.");
      reviewModeRef.current = true;
      setActiveSegment(null); // stop any video playback
      // fetch the first incorrect question and show it
      loadNextIncorrectQuestion();
    })
    .catch((error) => {
      console.error("Error setting quiz attempt review mode in server:", error);
    });
  }

  const onReviewNo = () => {
    console.log("User chose not to review incorrect questions.");
    setShowReviewPrompt(false);
    // mark the quiz attempt as completed
    if (quizAttempt) {
        api.post(`/api/quiz_attempts/${quizAttempt.id}/mark_completed/`)
            .then(() => setEndOfQuiz(true))
            .catch(err => console.error("Error marking quiz attempt as completed.", err));
    }
  }

  function SafeHTML({ content }: { content: string }) {
    const sanitizedContent = DOMPurify.sanitize(content, {
      USE_PROFILES: { html: true },
      ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'br', 'span', 'div', 'img'],
      ALLOWED_ATTR: ['href', 'target', 'rel']
    });
    return <div dangerouslySetInnerHTML={{ __html: sanitizedContent }} />;
  }

  return (
    <div className='bg-green-500'>
      <div className="relative" style={{ maxWidth: '720px', margin: 'auto' }}>
        <button
          onClick={handleTerminateQuiz}
          className="absolute top-2 right-2 z-10 bg-red-600 hover:bg-red-800 text-white text-sm px-3 py-1 rounded-md"
        >
          Terminate Quiz
        </button>
        { showQuestion && question && (
               <div className='bg-cyan-200 flex flex-col rounded-md justify-center items-center'>
               <div className='my-5'>
                 {SafeHTML({ content: question.instructions ?? "" })}
                 {question?.prompt && (
                   <div className="mb-3 mt-5 text-amber-800 whitespace-pre-wrap">
                     {question.prompt}
                   </div>
                 )}
                 {(question?.audio_str && question.audio_str.trim().length > 0) && (
                   <OpenAIStream sentence={question.audio_str} />
                 )}
                 {/* key on the attempt id forces a fresh input when the next question loads */}
                 <QuestionInput key={questionAttemptId ?? 0} question={question} ref={childRef} />
               </div>
            <button className='bg-green-700 text-white mx-10 mt-7 p-2 rounded-md hover:bg-red-700'
              onClick={() => handleSubmit()}
            >
              Submit
            </button>
             </div>
        )}
        { !showQuestion && activeSegment && (
        <CustomYoutubePlayer
          videoId={videoId}
          startTime={activeSegment ? parseTime(activeSegment.start_time) : 0}
          stopTime={activeSegment ? parseTime(activeSegment.end_time) : 0}
          playKey={playKey}
          onSegmentEnd={() => {
            // e.g. show the question for the finished segment
            // setShowQuestion(true);
            handleSegmentPlayingEnd()
          }}
        />
        )}

        { showReviewPrompt && (
            <ReviewPromptModal 
                onYes={onReviewYes} 
                onNo={onReviewNo} 
                incorrectCount={1}
            />
        )
        }
       {showRewatchPrompt && (
             <RewatchPromptModal
               onYes={handleRewatchYes}
               onNo={handleRewatchNo}
               rewatchesLeft={rewatchesLeft}
             />
           )}
        {showRedoQuizPrompt && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 w-80 text-center">
              <h2 className="text-lg font-bold mb-3 text-gray-800">Continue previous attempt?</h2>
              <p className="text-sm text-gray-600 mb-5">
                You have an unfinished attempt for this quiz. Continue where you left off, or start over?
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={handleRedoContinue}
                  className="px-4 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white font-medium"
                >
                  Continue
                </button>
                <button
                  onClick={handleRedoStartOver}
                  className="px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium"
                >
                  Start over
                </button>
              </div>
            </div>
          </div>
        )}
        {showCorrectModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <CorrectModal score={questionAttemptAssessmentResults?.score}/>
          </div>
        )}
        {showIncorrectModal && (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
         <div className="max-h-[90vh] overflow-y-auto">
           <IncorrectModal
             parentCallback={() => handleModalClose(incorrectModalQuestion.current?.id)}
             format={incorrectModalQuestion.current?.format ?? 1}
             content={incorrectModalQuestion.current?.content ?? ""}
             answer_key={incorrectModalQuestion.current?.answer_key ?? ""}
             explanation={incorrectModalQuestion.current?.explanation ?? ""}
             processQuestionResults={questionAttemptAssessmentResults as QuestionAttemptAssesmentResultsProps}
           />
         </div>
       </div>
     )}
    </div>
    </div>
  );
}
