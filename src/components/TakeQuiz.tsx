//import { useCallback } from "react";
//import useCountdown from "../hooks/useCountdown";

import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
//import { type CounterHandleRefProps } from './Counter';
//import RedoQuestionModal from './RedoQuestionModal';
//import QuizStartModal from './QuizStartModal';
//import TimeoutModal from './TImeOutModal';
import CorrectModal from './CorrectModal';

import { useParams, useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import type { HomeStudentOutletContext } from '../pages/HomeStudent';
import { type ProcessQuestionAttemptResultsProps, type QuestionAttemptAssesmentResultsProps, type QuestionProps, type QuizAttemptProps } from './shared/types';
//import { processQuestion } from './processQuestion';
import IncorrectModal from './IncorrectModal';
import api from '../api';
import QuestionInput from './QuestionInput';
import { useSelector, useDispatch } from 'react-redux';
//import type { RootState } from '../redux/store';
import DOMPurify from 'dompurify';
import type { RootState } from '../redux/store';
import { removeAssignment } from '../redux/pendingAssignmentsSlice';
//import { AzureAudioPlayer } from './shared/AzureAudioPlayer';
import OpenAIStream from './shared/OpenAIStream';
import ReviewPromptModal from './ReviewPromptModal';
import { useCreateNextQuestionAttempt } from '../hooks/useCreateNextQuestionAttempt';

import CountdownTimer from "../components/CountdownTimer";
import TimeoutModal from './TImeOutModal';
import ReadingDisplay from './ReadingDisplay';



//import CountdownTimer, { type CoundownTimerHandleProps } from './CountdownTimer';

export interface ChildRef {
    getAnswer: () => string | undefined;
    // Optional: components backed by speech recognition can expose this to clear their transcript.
    resetTranscript?: () => void;
  }

// `readingHtml` (optional): when provided (e.g. when rendered after TakeReadingQuiz's reading
// gate), a "Reread" button appears next to "Terminate Quiz" that pops up the reading again.
const TakeQuiz: React.FC<{ readingHtml?: string }> = ({ readingHtml }) => {

  const [reviewMode, setReviewMode] = useState<boolean>(false); // State to manage the flow of reviewing incorrectly answered questions after finishing the quiz. We start in the "initial" state where we show the end of quiz screen with the final score and a button to review incorrectly answered questions. When the user clicks the button to review incorrectly answered questions, we transition to the "reviewing_incorrect" state where we load and show incorrectly answered questions one by one with a button to go to the next question until there are no more incorrectly answered questions to review, at which point we transition to the "completed" state where we show a message that the review is complete and a button to navigate back to the unit screen.
  
  const childRef = useRef<ChildRef>(null);

  //const [remainingQuestions, setRemainingQuestions] = useState<{question: QuestionProps, question_attempt_number?: number}[]>([]); // State to hold the remaining questions in the quiz attempt that have not been attempted yet. We initialize this as an empty array and populate it with the questions from the server response when we fetch or create the quiz attempt in the useEffect on component mount. When the user answers a question and clicks "Continue", we remove the next question to display from this remainingQuestions array and set it as the current question, so that we can have a smooth transition to the next question while waiting for the server response to create the next question attempt. We also use the length of this remainingQuestions array in another useEffect to determine when we are at the end of the currently loaded questions and need to fetch more questions from the server if there are more questions in the quiz (hasMoreQuestions is true).
  const [question, setQuestion] = useState<QuestionProps | undefined>(undefined) // State to hold the current question data
  const [quizAttempt, setQuizAttempt] = useState<QuizAttemptProps>(null as any);
  const [questionAttemptId, setQuestionAttemptId] = useState<number | null>(null);

  const { category_id, quiz_id } = useParams<{ category_id: string, quiz_id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const outletContext = useOutletContext<HomeStudentOutletContext | undefined>();

  const { name } = useSelector((state: RootState) => state.user);
  const dispatch = useDispatch();

  const [showReread, setShowReread] = useState(false);
  const [showCorrectModal, setShowCorrectModal] = useState(false);
  const [showIncorrectModal, setShowIncorrectModal] = useState(false);

  const [questionAttemptAssessmentResults, setQuestionAttemptAssessmentResults] = 
  useState<QuestionAttemptAssesmentResultsProps | null>(null);

  const [endOfQuiz, setEndOfQuiz] = useState<boolean>(false);
 
  let correctModalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incorrectModalQuestion = useRef<QuestionProps | undefined>(undefined);

  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);
  const [incorrectCount, setIncorrectCount] = useState(0);

   
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);

  useEffect(() => {
    // reset state when navigating to a different quiz (the component is reused, not remounted, by React Router)
    setEndOfQuiz(false);
    setReviewMode(false);
    setShowReviewPrompt(false);
    setShowCorrectModal(false);
    setShowIncorrectModal(false);
    setAnswerSubmitted(false);
    api.post(`/api/quiz_attempts/get_or_create/${quiz_id}/`, { user_name: name, number_of_questions_to_preload: 3 })
     .then((response) => {
        // console.log("******* Received response from get_or_create:", response.data);
        //const all_questions_loaded = response.data.questions;
        //const first_question = all_questions_loaded.length > 0 ? all_questions_loaded[0] : null;
        // console.log(" First question loaded from server:", first_question);
        //setRemainingQuestions(all_questions_loaded.slice(1).map((q: QuestionProps) => ({ question: q })));
        setQuestion(response.data.question ? response.data.question : undefined);
        setQuestionAttemptId(response.data.question_attempt_id ? response.data.question_attempt_id : null);
        setQuizAttempt(response.data.quiz_attempt);
     })
     .catch((error) => {
       console.error("Error fetching quiz attempt data:", error);
      
     });
 },[quiz_id])

 const createNextQuestionAttempt = useCreateNextQuestionAttempt({
   setQuestion,
   setQuestionAttemptId,
   setAnswerSubmitted,
   setIncorrectCount,
   setShowReviewPrompt,
   setEndOfQuiz,
 });

 useEffect(() => {
  if (!endOfQuiz) return;
  api.post(`/api/quiz_attempts/${quizAttempt.id}/mark_completed/`)
    .catch(err => console.error("Error marking quiz attempt as completed.", err));
  if (quiz_id) dispatch(removeAssignment(Number(quiz_id)));
  outletContext?.setFinishedQuizPath(location.pathname); // quiz is over -> re-enable the Navbar
}, [endOfQuiz]);

const handleFeedbackModalClose = () => {
    //console.log("handleFeedbackModalClose called. showCorrectModal:", showCorrectModal, " showIncorrectModal:", showIncorrectModal);
    setShowIncorrectModal(false);
    setShowCorrectModal(false);
  
    //createNextQuestionAttempt();
    // if not Review mode, create the next question attempt
    if (!reviewMode) {
      createNextQuestionAttempt(quizAttempt.id, question?.question_number);
    }
    else {   // get the next incorrect question attempt to review
      api.get(`/api/quiz_attempts/${quizAttempt.id}/get_incorrect_question_attempt/`)
        .then((response) => {
          //console.log("Received response from get_incorrect_question_attempt API:", response.data);
          const { question_attempt_id, question } = response.data;
          if (question_attempt_id && question) {
            setAnswerSubmitted(false);
            setQuestionAttemptId(question_attempt_id);
            setQuestion(question);
            //console.log("Next incorrectly answered question loaded for review. Question id:", question.id, " question number:", question.question_number, " content:", question.content);
          }
          else {
            //console.log("No question attempt id/question returned from get_incorrect_question_attempt API.");
            // if we can't load the next incorrectly answered question to review, we end the review session and show the end of quiz screen.
            setEndOfQuiz(true);
          }
        })
        .catch(() => {
          //console.error("Error fetching next incorrectly answered question for review:", error);
          // if there is an error fetching the next incorrectly answered question to review, we end the review session and show the end of quiz screen.
          setReviewMode(false);
          setEndOfQuiz(true);
        });


    }
  }

const handleReviewYes = () => {
  setQuestion(undefined);
    setShowReviewPrompt(false);
    setReviewMode(true);
    api.get(`/api/quiz_attempts/${quizAttempt.id}/get_incorrect_question_attempt/`)
      .then((response) => {
        //console.log("Received response from get_incorrect_question_attempt API:", response.data);
        const { question_attempt_id, question } = response.data;
        if (question_attempt_id && question) {
          setAnswerSubmitted(false);
          setQuestionAttemptId(question_attempt_id);
          setQuestion(question);
          //console.log("First incorrectly answered question loaded for review. Question id:", question.id, " question number:", question.question_number, " content:", question.content);
          // call api to set QuizAttept review mode to true
          //console.log("Setting quiz attempt review mode to true in server for quiz attempt id:", quizAttempt.id);
          api.get(`/api/quiz_attempts/${quizAttempt.id}/set_review_mode/`, )
            .then(() => {
              console.log("Quiz attempt review mode set to true in server.");
            })
            .catch((error) => {
              console.error("Error setting quiz attempt review mode in server:", error);
            });
        }
        else {
          console.error("Error: Invalid response from get_incorrect_question_attempt API. Missing question_attempt_id or question data.");
        }
      })
      .catch((error) => {
        console.error("Error fetching first incorrectly answered question for review:", error);
      });

  };

const handleReviewNo = () => {
    setShowReviewPrompt(false);
    setEndOfQuiz(true);
  };

 const handleSubmit = () => {
  setAnswerSubmitted(true);
  const url = `/api/question_attempts/${questionAttemptId}/process/`;
  const uanswer = childRef.current?.getAnswer();
  const aKey = question?.answer_key;
  
  api.post<ProcessQuestionAttemptResultsProps>(url, 
    { 
      format: question?.format, 
      user_answer: uanswer, 
      answer_key: aKey,
    })
  .then((res) => {
    // server returns the next question id (if any), together with assessment results 
    //console.log("---->>>> Received response from server after processing question attempt:", res.data);
    const { assessment_results } = res.data;

    setQuestionAttemptAssessmentResults(assessment_results);
    if (assessment_results.error_flag === false) {
      //alert("Answer is correct.");
      setShowCorrectModal(true);
      correctModalTimerRef.current = setTimeout(() => {
        setShowCorrectModal(false);
        // show next question if available by checking next_question_data
        handleFeedbackModalClose();
        // handle end of quiz scenario here
      }, 1000); // Close modal after 2 seconds
    }
    else {
      // make a snapshot of question for incorrect model because
      // question is undefined when passed as a prop to IncorrectModal.
       incorrectModalQuestion.current = question;
       setShowIncorrectModal(true);
    }
  })
  .catch((err) => {
    console.error("Error processing question attempt:", err);
  });
  
}
 const displayQuestion = () => {
  if (!question) return null;
  return (
    <div className='my-5'>
      {/* key forces a fresh input for each new question attempt */}
      <QuestionInput key={questionAttemptId ?? 0} question={question} ref={childRef} submitted={answerSubmitted} />
    </div>
  );
};

  function SafeHTML({ content }: { content: string }) {
    const sanitizedContent = DOMPurify.sanitize(content, {
      USE_PROFILES: { html: true },
      ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'br', 'span', 'div', 'img'],
      ALLOWED_ATTR: ['href', 'target', 'rel']
    });
    return <div dangerouslySetInnerHTML={{ __html: sanitizedContent }} />;
  }
  
  const questionTimeoutHandler = () => {
        console.log("Timer completed callback called. Submitting answer with timer completion flag set to true.");
        setShowTimeoutModal(true);
    }

    const handleTimeout = () => {
     
     
      const url = `/api/question_attempts/${questionAttemptId}/process_timeout/`;
      
      api.post<ProcessQuestionAttemptResultsProps>(url, { format: question?.format })
        .then(() => {     
          //console.log("Received response from server after processing question attempt timeout:", res.data);
          // load the next question.
          createNextQuestionAttempt(quizAttempt.id, question?.question_number);
      })
        .catch((error) => {
          console.error("Error processing question attempt:", error);
        });
        
  }

    const timeoutModalCallback = () => {
      setShowTimeoutModal(false);
      handleTimeout();
    }


  // Let the student end the quiz early. This does NOT mark the attempt completed — it just leaves
  // the quiz route (back to the category), which closes the panel and re-enables the Navbar. The
  // attempt stays "uncompleted" so it can be resumed later.
  const handleTerminateQuiz = () => {
    if (!window.confirm("End this quiz now?")) return;
    navigate(`/categories/${category_id}`);
  };

  if (endOfQuiz) {
    return (
      <div className='text-center bg-amber-50 mt-10'>
        <h2 className='text-2xl font-bold mb-4'>Quiz Completed!</h2>
        <p className='text-lg'>Congratulations on completing the quiz. Your final score is: {questionAttemptAssessmentResults?.score}</p>
      </div>
    );
  }

  return (
    <>
    <div className="relative flex flex-col items-center bg-amber-100 gap-6 p-4 max-w-4xl mx-auto">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        {readingHtml && (
          <button
            onClick={() => setShowReread(true)}
            className="bg-indigo-600 hover:bg-indigo-800 text-white text-sm px-3 py-1 rounded-md"
          >
            Reread
          </button>
        )}
        <button
          onClick={handleTerminateQuiz}
          className="bg-red-600 hover:bg-red-800 text-white text-sm px-3 py-1 rounded-md"
        >
          Terminate Quiz
        </button>
      </div>

      {/* Reread popup: shows the reading passage again with a Close button. */}
      {showReread && readingHtml && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowReread(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setShowReread(false)}
                className="bg-gray-200 text-gray-800 text-sm px-3 py-1 rounded-md hover:bg-gray-300"
              >
                Close
              </button>
            </div>
            <ReadingDisplay html={readingHtml} />
          </div>
        </div>
      )}
      {question && (
        <CountdownTimer
          key={questionAttemptId ?? 0}
          initialSeconds={(question.timeout ?? 0) / 1000}
          onComplete={questionTimeoutHandler}
          autoStart
          paused={answerSubmitted}
        />
      )}
      <AnimatePresence mode="wait">
        { question && (
          <motion.div
            key={questionAttemptId ?? 0}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.9, ease: 'easeOut' } }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            className="flex flex-col items-center w-full"
          >
            <div>Question Number: {question.question_number}</div>
            {SafeHTML({ content: question.instructions ?? "" })}
            {question?.prompt && (
              <div className="mb-3 mt-5 text-amber-800 whitespace-pre-wrap">
                {question.prompt}
              </div>
            )}
            <div>
              {(question?.audio_str && question.audio_str.trim().length > 0) &&
                <OpenAIStream sentence={question.audio_str} />
              }
            </div>
            {displayQuestion()}
            <button className={`bg-green-700 text-white mx-10 mt-7 p-2 rounded-md hover:bg-green-900 transition-colors duration-300 ${showCorrectModal || showIncorrectModal ? 'opacity-0' : 'opacity-100'}`}
              onClick={() => handleSubmit()}
            >
              Submit
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>

    {/* Centered overlay modals */}
    {showCorrectModal && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <CorrectModal score={questionAttemptAssessmentResults?.score}/>
      </div>
    )}
    {showIncorrectModal && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="max-h-[90vh] overflow-y-auto">
          <IncorrectModal
            parentCallback={handleFeedbackModalClose}
            format={incorrectModalQuestion.current?.format ?? 1}
            content={incorrectModalQuestion.current?.content ?? ""}
            answer_key={incorrectModalQuestion.current?.answer_key ?? ""}
            explanation={incorrectModalQuestion.current?.explanation ?? ""}
            processQuestionResults={questionAttemptAssessmentResults as QuestionAttemptAssesmentResultsProps}
          />
        </div>
      </div>
    )}
    {showTimeoutModal && questionAttemptId !== null && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <TimeoutModal parentCallback={timeoutModalCallback} questionAttemptId={questionAttemptId} />
      </div>
    )}

    {showReviewPrompt && (
      <ReviewPromptModal onYes={handleReviewYes} onNo={handleReviewNo} incorrectCount={incorrectCount} />
    )}
    </>
  );
  };

  export default TakeQuiz;



  
