

import { useEffect, useEffectEvent, useRef, useState } from 'react';
//import {  useParams } from 'react-router-dom';
import { useWebSocket } from './context/WebSocketContext';
import type { ProcessQuestionAttemptResultsProps, QuestionAttemptAssesmentResultsProps, QuestionProps, VideoSegment, WebSocketMessageProps } from './shared/types';
import api from '../api';
import DOMPurify from 'dompurify';
import type { ChildRef } from './TakeQuiz';
import CorrectModal from './CorrectModal';
import IncorrectModal from './IncorrectModal';
import QuestionInput from './QuestionInput';

import { useSelector } from 'react-redux';
import { type RootState } from '../redux/store';


// import './VideoPlayer.css';


import OpenAIStream from './shared/OpenAIStream';
import ScoreBoard from '../pages/ScoreBoard';
import chimeSound from '../assets/chime.mp3';
//import { User } from 'microsoft-cognitiveservices-speech-sdk';
import type { UserRowProps } from './context/UserConnectionsContext';
//import CustomYoutubePlayer from './shared/CustomYoutubePlayer';

interface TakeQuizLiveProps {
    live_quiz_id: string;
    live_question_number?: string;
    parent_callback: () => void;   // to notify parent component when a question is finished ( or the quiz is finished??)
}

// Extract the 11-char YouTube video id from a URL (watch, youtu.be, embed, shorts).
// If the string is already just an id, return it as-is.
function extractVideoId(url: string): string {
  if (!url) return '';
  const match = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return match ? match[1] : url;
}


function TakeQuizLive({ live_quiz_id , live_question_number,  parent_callback}: TakeQuizLiveProps) {
    // scenarios:
    /*
     1) if live quiz id is set, then it can be either the student receives a enable live quiz message for the teacher
     or the student is logged in while a live quiz is already in progress and there has been no questions to do yet. 
     In this case, the student should receive the current live quiz id from the server upon logging in.

    2) if both live quiz id and live question number are set, then that means the student is logged while a live quiz is in progress
    with a question being unfinished This can happens if user's connection is dropped while doing a live question.
    In this scenario, the student should receive both live quiz id and live question number from the server upon login.
    (see backend logic for handling connection_established message in consumers.py)
    */

    const [question, setQuestion] = useState<QuestionProps | null>(null);

    const [liveQuestionNumber, setLiveQuestionNumber] = useState<string | null>(null);

    const childRef = useRef<ChildRef>(null);
    const {eventEmitter } = useWebSocket();
    const [showQuestion, setShowQuestion] = useState<boolean>(false); // work in conjunction with questionAttemptData 

    //const [activeSegment, setActiveSegment] = useState<VideoSegment | null>(null);

    const [showCorrectModal, setShowCorrectModal] = useState(false);
    const [showIncorrectModal, setShowIncorrectModal] = useState(false);

    const [pendingQuestionAttempt, setPendingQuestionAttempt] = useState<boolean>(false); // to track if a question attempt is being processed by the server. This is important to prevent multiple submissions of the same question attempt when user clicks submit button multiple times before receiving a response from the server.

    //const [playKey, setPlayKey] = useState<number | undefined>(undefined);
    //const [finishedLiveQuestion, setFinishedLiveQuestion] = useState<{status: boolean, question_number: string}>({ status: false, question_number: '' });

    let correctModalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const chimeAduioRef = useRef<HTMLAudioElement | null>(null);

    const { name } = useSelector((state: RootState) => state.user);

     const [questionAttemptAssessmentResults, setQuestionAttemptAssessmentResults] = 
            useState<QuestionAttemptAssesmentResultsProps | null>(null);

    const [allVideoSegments, setAllVideoSegments] = useState<VideoSegment[]>([]);
    //const [videoUrl, setVideoUrl] = useState<string>("");
    const [, setVideoId] = useState<string>("");
 
    //const videoId = extractVideoId(video_url) || 'dQw4w9WgXcQ';

    const [myLiveScore, setMyLiveScore] = useState<UserRowProps>({ 
      name: name || '', 
      live_question_number: undefined, 
      live_score: undefined, 
      live_total_score: undefined });

    const [totalScore, setTotalScore] = useState<number>(0);

    useEffect(() => {
        if (live_question_number) {
          console.log("TakeQuizLive: live_question_number prop changed, updating liveQuestionNumber state to ", live_question_number);
          setLiveQuestionNumber(live_question_number);
  
        }
    }, [live_question_number]);
  
    useEffect(() => {
      chimeAduioRef.current = new Audio(chimeSound);
    }, []);


    useEffect(() => {
      const handleMessage = (data: WebSocketMessageProps) => {
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
    }, [eventEmitter, allVideoSegments]); // Only include eventEmitter in the dependency array

   
    useEffect(() => {
         // call api to get quiz question 
         // data for quizId and questionId
         // only if both quizId and questionNumber are set
         //console.log("TakeQuizLive: useEffect for fetching quiz question triggered. live_quiz_id =", live_quiz_id, "liveQuestionNumber =", liveQuestionNumber, "pendingQuestionAttempt =", pendingQuestionAttempt);
            if (!live_quiz_id ) {
                console.log("TakeQuizLive: quiz_id is not set.");
                return;
            }
        
            api.get(`/api/quizzes/${live_quiz_id}/`)
            .then((res) => res.data)
            .then((data) => {
                console.log("TakeQuizLive: Quiz  Data:", data);
                if (data.video_url && data.video_segments) {
                  setAllVideoSegments(data.video_segments);
                  setVideoId(extractVideoId(data.video_url));
                  //setVideoUrl(data.video_url);
                }
            })
      }, [live_quiz_id]);

    // 1. Encapsulate the "Action" that needs the latest values
    const fetchLiveQuestion = useEffectEvent((questionNum: number) => {
      // We check pending status here to ensure we have the latest state
      if (pendingQuestionAttempt) return;

      api.post(`/api/quizzes/${live_quiz_id}/questions/${questionNum}/live/`, {
        user_name: name || '',
      })
        .then((res) => res.data)
        .then((data) => {
          //console.log("TakeQuizLive: Quiz Question Data:", data);
          setQuestion(data);
          setShowQuestion(true);
          setPendingQuestionAttempt(true);
          // set question number in myLiveScore state to keep track of which question I am on for scoring purposes
          setMyLiveScore((prev) => ({
            ...prev,
            live_question_number: Number(liveQuestionNumber),
            live_score: undefined, // reset live score for the new question
          }));
        })
        .catch(err => console.error("Fetch failed", err));
    });

    // 2. The Effect now only cares about the "Event" (the number changing)
    useEffect(() => {
      if (!liveQuestionNumber) {
        //console.log("TakeQuizLive: question_number is not set.");
        return;
      }
      //console.log("TakeQuizLive: useEffect triggered for liveQuestionNumber change. Calling fetchLiveQuestion with question number:", Number(liveQuestionNumber));
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

      const handleSubmit = () => {
           //console.log("TakeQuizLive: handleSubmit called");
            // A Shadowing question is answered by a checked recording (its answer is the take's token).
            if (question?.format === 9 && !childRef.current?.getAnswer()) {
              alert("Record yourself and click “Check my recording” first.");
              return;
            }
            setShowQuestion(false); //
            const url = `/api/process_live_question_attempt/`;
            //console.log("POSTing to url =", url);
            
            api.post<ProcessQuestionAttemptResultsProps>(url, { user_name: name, format: question?.format , user_answer: childRef.current?.getAnswer(), answer_key: question?.answer_key })
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

      const handleModalClose = () => {
        //console.log("handleCorrectModalTimeout called. nextQuestionId =", nextQuestionId.current);
        setShowCorrectModal(false);
        setShowIncorrectModal(false);
        setPendingQuestionAttempt(false); // reset pending question attempt status when question attempt is finished
        // clear liveQuestionNumber to prepare for next question
        setLiveQuestionNumber(null);
        parent_callback(); // notify parent component that question is finished
      };

      const displayPendingQuestionStatus = () => {
        // only display status if quiz_id is set
        if (live_quiz_id) {
            if (!showQuestion) {
              return "Waiting for question ...";
                //return <div>Question number: {question?.question_number}</div>
            }
        }
      }

  const displayQuestion = () => {
    if (!question) return null;
    return <QuestionInput question={question} ref={childRef} />;
  }

  return (
    <>
      <div className="grid grid-cols-[3fr_1fr] gap-4 mr-5 bg-gray-200 min-h-screen">
        {/* Left Column */}
        <div className="bg-cyan-400 py-2 px-10 h-full">
          <div>Pending question attempt: {pendingQuestionAttempt.toString()}</div>
          <div className='bg-cyan-300 flex flex-row justify-center items-center mt-5 mb-3'>
            <span className='mx-3'>Quiz ID:</span>
            <span className={`text-red-300 text-md font-bold border-2 mr-5  border-red-400 rounded-full px-2 py-0 inline-block`}>{live_quiz_id} </span>
          </div>

          {question && showQuestion ? (
            <div className="col-span-8 mx-15 my-5 p-10 rounded-md bg-cyan-200">
              <div className="mb-3 text-lg text-amber-800">
                Question: {question?.question_number}
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
        </div>

        {/* Right Column */}
        <div className="bg-blue-200 flex flex-col">
          <ScoreBoard my_row={myLiveScore} />
        </div>
      </div>

      {/* Feedback modal — fixed overlay centered on top of the whole component */}
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
    </>
  )
}

export default TakeQuizLive

