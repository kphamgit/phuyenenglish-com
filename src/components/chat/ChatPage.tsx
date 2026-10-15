
import { useEffect, useImperativeHandle, useState } from 'react';
import ChatBody from './ChatBody';
import { useWebSocket } from '../context/WebSocketContext';
import { useSelector } from 'react-redux';
import { FaAngleDoubleRight } from 'react-icons/fa';
import { NEURAL2_VOICES } from './tts';
import SsmlConvertModal from './SsmlConvertModal';
//import type { WebSocketMessageProps } from '../shared/types';
//import type { RootState } from '../../redux/store';
//import type { WebSocketMessageProps } from '../shared/types';

//import { useAppSelector } from '../../redux/store';
//import { v4 as uuidv4 } from "uuid";

export interface ChatPageRefProps {
  get_isChatOpen: () => boolean | undefined;
  toggle_chat: () => void | undefined;
}

export interface ChatPageProps {
    ref: React.Ref<ChatPageRefProps>;
    chat: ChatProps;
    onClose?: () => void; // collapse/close the chat window
  }

export interface ChatProps {
    text?: string;
    user_name: string;
    audio_url?: string; // presigned S3 url of a recorded voice answer (for the teacher to replay)
    voice?: string; // SR prompts: the Neural2 voice chosen for TTS playback (so Play isn't random)
    no_audio?: boolean; // SR prompts sent with "SR No Audio": no TTS for the student (no auto-play, no Play)
  }

// Vietnamese-specific letters (đ ă ơ ư, â ê ô, and every tone-marked vowel). English never uses
// these, so any match means the text contains Vietnamese — used to keep students chatting in English.
const VIETNAMESE_REGEX = /[À-ÃÈ-ÊÌÍÒ-ÕÙÚÝà-ãè-êìíò-õùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;

    export const ChatPage = ({ ref, chat, onClose }: ChatPageProps) => {

    const [incomingMessages, setIncomingMessages] = useState<ChatProps[]>([]);

    //get user from redux store using useAppSelector
    //const user_name = useSelector((state: RootState) => state.name);
 
    const [isChatOpen, setIsChatOpen] = useState(true);

    const [outgoingMessage, setOutgoingMessage] = useState<string>('');

    // Inline error shown under the composer when a student tries to send non-English text.
    const [langError, setLangError] = useState<string | null>(null);

    // Teacher-only: the Neural2 voice attached to an SR prompt, so the student always hears the
    // same voice for that message (instead of a random one per Play click).
    const [srVoice, setSrVoice] = useState<string>('en-US-Neural2-F');

    // Teacher-only: SSML Convert modal (sentence -> clickable word buttons).
    const [showSsmlModal, setShowSsmlModal] = useState(false);

    const {websocketRef} = useWebSocket();
    
    //const { name, isLoggedIn } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);
    const { name } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);

    useImperativeHandle(ref, () => ({

      get_isChatOpen: () => isChatOpen,
      toggle_chat: () => setIsChatOpen(!isChatOpen)
    }));
  
    useEffect(() => {
      // check for duplicate message id before adding to incomingMessages



      if (chat.text) {
        const chatMessage: ChatProps = { text: chat.text, user_name: chat.user_name };
        // ignore messages from myself. 
        if (name === chatMessage.user_name) {
          return;
        }
        if (name !== "teacher" && chatMessage.user_name !== "teacher") {
          // students only accept messages from teacher, not from other students
          return;
        }

        setIncomingMessages((prevMessages) => {
          return [...prevMessages, chat]
          });

      }
    }, [chat])

    /*
    useEffect(() => {
      const handleMessage = (data: WebSocketMessageProps) => {
        //console.log("MessageControl: handleMessage called with data:", data);
        //if (data.message_type === "chat") {
       //console.log("*********** MessageControl: Received data from server:", data); 
        if (data.message_type === "chat") {
          // console.log('ChatPage: Received CHAT message from server:', data, "isChatOpen:", isChatOpen);

          const chat: ChatProps = { text: data.content, user_name: data.user_name };

          if (name === chat.user_name) { // ignore messages from myself. See sendChatMessage function.
            //console.log("ChatPage: Ignoring chat message from myself:", chat.user_name);
            return;
          }
          if (name !== "teacher" && chat.user_name !== "teacher") {
            // students only accept messages from teacher, not from other students
            return;
          }
          //console.log('ChatPage: adding chat message: ' + chat.text);
          setIncomingMessages((prevMessages) => {
          return [...prevMessages, chat]
          });

          }
      }
    

      // Subscribe to the "message" event
      eventEmitter?.on("message", handleMessage);
      // Cleanup the event listener on unmount
      return () => {
        eventEmitter?.off("message", handleMessage);
      };
    }, [eventEmitter]); // Only include eventEmitter in the dependency array
    */
    
    // Send an arbitrary piece of text as a chat message. `audioUrl` (optional) is the S3 link of a
    // recorded voice answer, so the teacher can replay it. `echoLocally` controls whether the sender
    // also sees the message in their own chat body.
    const sendText = (text: string, echoLocally: boolean = true, audioUrl?: string, voice?: string, noAudio?: boolean) => {
      if (!text || text.trim().length === 0) return;
      if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) {
        alert('ChatPage: WebSocket is not connected');
        return;
      }
      const messageToSend = {
        message_type: 'chat',
        content: text,
        user_name: name, // You can replace this with the actual user name from your state
        audio_url: audioUrl, // forwarded verbatim by the ws-server's general broadcast
        voice, // SR prompts carry the teacher's chosen Neural2 voice (also forwarded verbatim)
        no_audio: noAudio, // "SR No Audio": the student gets the prompt + mic, but no TTS
      };
      websocketRef.current.send(JSON.stringify(messageToSend));
      if (echoLocally) {
        setIncomingMessages((prevMessages) => [
          ...prevMessages,
          { text, user_name: name, audio_url: audioUrl, voice, no_audio: noAudio },
        ]);
      }
    };

    // Everyone who isn't the teacher is treated as a student.
    const isStudent = name !== "teacher";

    // Reset the composer after a message is sent.
    const clearComposer = () => {
      setOutgoingMessage('');
    };

    const sendChatMessage = () => {
      // Students must chat in English; reject typed messages containing Vietnamese characters.
      // (The teacher is exempt. The recorded voice-answer flow now lives in HomeStudent, not here.)
      if (isStudent && VIETNAMESE_REGEX.test(outgoingMessage)) {
        setLangError("Please chat in English only — Vietnamese isn't allowed here.");
        return; // keep the text so the student can rewrite it
      }
      setLangError(null);
      sendText(outgoingMessage);
      clearComposer();
    };

    // Teacher-only: prepend "SR" so the student is forced to answer by voice. The chosen Neural2
    // voice rides along so the student hears that same voice on every playback.
    const sendSRMessage = () => {
      const srText = outgoingMessage.trim() ? `SR ${outgoingMessage.trim()}` : 'SR';
      sendText(srText, true, undefined, srVoice);
      clearComposer();
    };

    // Teacher-only: like Send SR, but the student hears no audio (no auto-play, no Play button);
    // the mic is still enabled so they can record and send back an answer.
    const sendSRNoAudioMessage = () => {
      const srText = outgoingMessage.trim() ? `SR ${outgoingMessage.trim()}` : 'SR';
      sendText(srText, true, undefined, undefined, true);
      clearComposer();
    };

    return (
      <div
        className={`absolute bottom-[15px] right-[15px] bg-white shadow-lg border border-gray-300 rounded-lg ${isStudent ? 'w-[334px]' : 'w-[440px]'} ${isStudent ? 'h-[268px]' : 'h-[340px]'} flex flex-col z-20`}
      >
          {/* Close arrow — sticks to the right edge of the chat window */}
          <button
            onClick={onClose}
            aria-label="Close chat"
            title="Close chat"
            className="absolute top-1 right-1 z-30 p-1 text-gray-500 hover:text-gray-800"
          >
            <FaAngleDoubleRight />
          </button>

          <>
            <div className="flex flex-col h-full">
              {/* Chat Body */}
              <div className="flex-1 overflow-y-auto p-4">
                <ChatBody messages={incomingMessages} />
              </div>

              {/* Composer: textarea + buttons */}
              <div className="p-2 border-t border-gray-300 bg-gray-100">
                <textarea
                  className="w-full bg-gray-200 text-black p-2 rounded-md text-sm resize-none"
                  rows={isStudent ? 2 : 3}
                  placeholder={isStudent ? "Type your message…" : "Type a message or paste SSML (<speak>…</speak>)…"}
                  value={outgoingMessage}
                  onChange={(e) => { setOutgoingMessage(e.target.value); if (langError) setLangError(null); }}
                />
                {langError && (
                  <p className="mt-1 text-xs text-red-600">{langError}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <button
                    className="bg-blue-500 text-white px-3 py-1 rounded-md hover:bg-blue-600 text-sm"
                    onClick={sendChatMessage}
                  >
                    Send
                  </button>
                  {/* Teacher-only: voice picker + Send SR */}
                  {!isStudent && (
                    <>
                      <select
                        value={srVoice}
                        onChange={(e) => setSrVoice(e.target.value)}
                        title="Voice for the SR prompt"
                        className="flex-1 bg-gray-200 text-black text-sm p-1 rounded-md"
                      >
                        {NEURAL2_VOICES.map((v) => (
                          <option key={v} value={v}>{v.replace('en-US-Neural2-', 'Voice ')}</option>
                        ))}
                      </select>
                      <button
                        className="bg-teal-600 text-white px-3 py-1 rounded-md hover:bg-teal-700 text-sm"
                        onClick={() => setShowSsmlModal(true)}
                      >
                        SSML Convert
                      </button>
                      <button
                        className="bg-purple-600 text-white px-3 py-1 rounded-md hover:bg-purple-700 text-sm"
                        onClick={sendSRMessage}
                      >
                        Send SR
                      </button>
                      <button
                        className="bg-purple-400 text-white px-3 py-1 rounded-md hover:bg-purple-500 text-sm"
                        onClick={sendSRNoAudioMessage}
                        title="Send an SR prompt without audio — the student only reads it and records an answer"
                      >
                        SR No Audio
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </>

        {showSsmlModal && <SsmlConvertModal onClose={() => setShowSsmlModal(false)} />}
      </div>
    );
  };
  
  export default ChatPage;

