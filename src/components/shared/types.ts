

export interface ProcessQuestionAttemptResultsProps {
  assessment_results: QuestionAttemptAssesmentResultsProps,
  quiz_attempt: {
      completed: boolean,
      score: number,
  }
  next_question_id? : number,
  quiz_attempt_has_errors: boolean,
}

export interface QuestionAttemptAssesmentResultsProps {
  answer?: string 
  score: number,
  error_flag: boolean,
  cloze_question_results?: ClozeAnswerResultsProps[] | undefined,
}

type ClozeAnswerResultsProps = {
  user_answer: string,   
  answer_key: string,
  score: number,
  error_flag: boolean,
}

export type CurrentStudentLiveQuestionNumberProps = {
  key: string;
  value: string;
}

export interface ReceivedConnectedUserDataProps { 
  name: string, 
  live_question_number: string | null,
  live_total_score: string | null,
  is_logged_in: string | null,  // note that Redis store doesn't have boolean type, any "boolean" 
  // value is stored as string, so this will have to be converted to Javascript boolean type when used in the frontend
  // such as in ScoreBoard or RedisDataModal components
}

//live_question_retrieved
interface BaseWebSocketMessageProps {
  message_type: 
  "user_disconnected" |
  "chat" |
  "live_image" |
  "live_video" |
  "live_text" |
  "live_score" |
  "live_user_answer" |
  "live_quiz_id" | 
  "live_question_number" | 
  "video_segment_number" |
  "live_quiz_id_and_live_question_number" |
  "student_acknowleged_live_question_number" |
  "live_question_retrieved" | 
  "recording_received" |
  "student_acknowleged_live_quiz_id" |
  "disconnect_user" |
  "cache_query_response" | 
  "live_quiz_terminated" |
  "welcome_message" |
  "another_user_joined" |
  "REDIS_DATA" |
  "terminate_live_quiz";
  content: any;
  user_name: string;  // identify sender, except for questin_number message where user_name is target user
}

export interface VideoSegment {
  id: number,
  segment_number: number,
  start_time: string,
  end_time: string,
  question_ids: string, // comma-separated list of question ids
}

export interface QuizProps {
  id: number,
  name: string,
  quiz_number: number,
  video_url: string,
  video_segments: VideoSegment[],
}

// A single word the teacher marked "to learn", resolved in context by spaCy. `index` is the
// token's position in the tokenized text, so repeated words (e.g. "record" verb vs. noun) stay
// distinct; `pos`/`lemma` disambiguate the meaning for dictionary lookup on the student side.
export interface MarkedWord {
  index: number;
  text: string;
  pos: string;
  lemma: string;
  start: number; // character offset of this token in the text (for inline rendering)
  sense_id?: number; // dictionary sense the teacher associated with this word; card is made from it
}

// The exact shape of a "live_text" message the teacher sends to students — only the fields this
// message uses (unlike the broad WebSocketMessageProps, whose live_quiz_id/live_question_number
// are required). Annotate the teacher's send payload with this to catch drift at compile time.
export interface LiveTextMessage {
  message_type: "live_text";
  content: string;        // the text students display
  user_name: string;      // sender (the teacher)
  marked_words: MarkedWord[]; // words the teacher marked "to learn" (may be empty)
}

export interface WebSocketMessageProps extends BaseWebSocketMessageProps {
  connected_users?: ReceivedConnectedUserDataProps[];
  queried_value?: string; // only for cache_query_response message type
  quiz_name?: string; //
  live_quiz_id: string; // for quiz host to identify which quiz the message is related to, and for students to identify which quiz to join
  live_question_number: string; // for quiz host to identify which question the message is related to, and for students to identify which question to answer
  audio_url?: string; // for chat voice answers: presigned S3 url of the recorded audio
  marked_words?: MarkedWord[]; // for live_text: words the teacher marked as "to learn" (in context)
  voice?: string; // for SR prompts: the Neural2 voice the teacher chose for TTS playback
}

export interface QuestionProps {
    id: number,
    quiz_id: number,
    video_segment_id?: number,
    question_number: number,
    content: string,
    content_language: string,
    format: number,
    answer_key: string,
    instructions?: string,
    prompt?: string,
    audio_str?: string,
    score: number,
    button_cloze_options?: string,
    hint?: string,
    explanation?: string,
    timeout: number,
  }

  export interface QuizAttemptProps {
    id: number,
    quiz_id: number,
    user_name: string,
    score: number,
    created_at: string,
    updated_at: string,
    completion_status: string,
    review_state: boolean
  }

  export interface QuizAttemptCreatedProps {
    question: QuestionProps,
    question_attempt_id: number,
    created: boolean
    quiz_attempt: QuizAttemptProps,
  }
  
export type RadioProps =
  {
    id: number
    choice_1_text: string
    choice_2_text: string
    choice_3_text: string
    choice_4_text: string
    selected: string
    questionId: number
  }

  export interface InputLetterRef {
    getFillContent: () => string | undefined;
  }

  export interface QuestionAttempResultsProps {
    answer: string | undefined,
    score: number,
    error_flag: boolean,
}
