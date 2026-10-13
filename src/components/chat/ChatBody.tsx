import { useRef, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import api from '../../api';
//import { MessageProps } from './ChatPage';
import { type ChatProps } from './ChatPage';
import { ttsTextOf, playPromptTts } from './tts';


const ChatBody = (props: { messages: ChatProps[] }) => {

    const messagesEndRef = useRef<null | HTMLDivElement>(null);
    const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ block: 'nearest', inline: 'start'  })
    }

  useEffect(() => {
    //console.log("ChatBody: messages updated=", props.messages)
    scrollToBottom()
  }, [props.messages])

  // Only the teacher may delete a student's recording (before they can't hear it anymore).
  const { name } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);
  const isTeacher = name === 'teacher';

  // audio_urls the teacher has deleted this session (so we hide the player) + the one in flight.
  const [deletedAudios, setDeletedAudios] = useState<Set<string>>(new Set());
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);

  // A recording's presigned url encodes its S3 object key in the path. Recordings live under
  // "audios/recordings/", so anchor on that prefix (works for both path- and virtual-hosted urls).
  const extractFileKey = (audioUrl: string): string => {
    try {
      const path = decodeURIComponent(new URL(audioUrl).pathname);
      const idx = path.indexOf('audios/');
      return idx >= 0 ? path.slice(idx) : path.replace(/^\//, '');
    } catch {
      return '';
    }
  };

  const handleDeleteAudio = (audioUrl: string) => {
    const fileKey = extractFileKey(audioUrl);
    if (!fileKey) return;
    setDeletingUrl(audioUrl);
    api.post('/english/delete-audio/', { file_key: fileKey })
      .then(() => {
        setDeletedAudios((prev) => new Set(prev).add(audioUrl));
      })
      .catch((err) => {
        console.error('Error deleting audio:', err);
        alert('Could not delete the audio.');
      })
      .finally(() => setDeletingUrl(null));
  };

  // {{console.log("message in ChatBody=", message)}}
  return (
    <>
      {/*This shows messages sent from you*/}
      <div className='m-1 h-40 bg-bgColor2 text-textColor2 overflow-scroll'>
      <div>
        {props.messages.map((message, index) => {
           // Messages beginning with "SR" are speech-recognition prompts: hide the "SR" marker
           // and show them in a distinct color.
           const isSR = message.text?.trim().startsWith("SR") ?? false;
           const displayText = isSR ? message.text!.trim().replace(/^SR\s*/, '') : message.text;
           // A voice answer is sent as "English — Vietnamese". Split on the first " — "
           // so the Vietnamese translation can be shown smaller and in dark brown.
           const sepIndex = displayText?.indexOf(' — ') ?? -1;
           const englishPart = sepIndex >= 0 ? displayText!.slice(0, sepIndex) : displayText;
           const vietnamesePart = sepIndex >= 0 ? displayText!.slice(sepIndex + 3) : null;

           return (
           <div key={index} className='m-1'>
                <p className={isSR ? 'text-purple-700 font-semibold' : ''}>
                  {message.user_name}: {englishPart}
                  {vietnamesePart && (
                    <span className='text-sm' style={{ color: '#5C4033' }}> — {vietnamesePart}</span>
                  )}
                </p>
                {/* Recording prompt: play it (Google TTS, 0.75x) in the voice chosen for this
                    message, so the teacher's preview matches what the student will hear. */}
                {isSR && (
                  <button
                    onClick={() => playPromptTts(ttsTextOf(message.text), message.voice)}
                    className="mt-1 text-xs px-2 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white"
                    title="Play this prompt"
                  >
                    ▶ Play
                  </button>
                )}
                {/* Recorded voice answer — replay it (mainly for the teacher to score) */}
                {message.audio_url && (
                  deletedAudios.has(message.audio_url) ? (
                    <p className="mt-1 text-xs italic text-gray-500">Audio deleted</p>
                  ) : isTeacher ? (
                    // Teacher: the chat box is wider, so the Delete button sits to the right of the audio.
                    <div className="mt-1 flex items-center gap-2">
                      <audio controls src={message.audio_url} className="flex-1 min-w-0 h-8" />
                      <button
                        onClick={() => handleDeleteAudio(message.audio_url!)}
                        disabled={deletingUrl === message.audio_url}
                        className="shrink-0 text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                      >
                        {deletingUrl === message.audio_url ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  ) : (
                    // Student: no delete button, audio fills the (narrower) row.
                    <audio controls src={message.audio_url} className="mt-1 w-full h-8" />
                  )
                )}
            </div> )
          }
        )}
        {/* Scroll anchor — kept at the very bottom so the newest message (incl. its audio) is visible */}
        <div ref={messagesEndRef} />
      </div>
      </div>
    </>
  );
};

export default ChatBody
