export interface ReviewCard {
  id: number;
  text: string;            // front (the word)
  definition: string;      // back
  part_of_speech?: string; // e.g. "verb", "noun"
}

// Base url for the Azure TTS pronunciation clips ("<word>.mp3").
const TTS_BASE = 'https://kphamazureblobstore.blob.core.windows.net/tts-audio/';

// Shown the first time a student clicks a marked word (it was just added to their review).
// They've only just met the word, so this is a study card, not a test: it shows the
// definition and records no grade. The first multiple-choice review is due tomorrow
// (add_sense_card_to_review schedules it).
export default function SingleCardReview({
  card,
  autoPlay,
  audioMissing,
  surfaceWord,
  onClose,
}: {
  card: ReviewCard;
  autoPlay: boolean; // autoplay the pronunciation only when the lemma differs from the surface form
  audioMissing?: boolean; // the surface word had no audio file — show a warning
  surfaceWord?: string;   // the exact word clicked in the text (for the "no audio" warning)
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-[28rem] max-w-[95vw] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold text-gray-800">SingleCardReview: New word</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-800">✕</button>
        </div>

        {/* The word (with its part of speech) */}
        <div className="w-full min-h-16 flex items-center justify-center gap-2 bg-white border-2 border-gray-300 rounded-xl shadow p-3 mb-4">
          <span className="text-xl font-bold text-gray-800">{card.text}</span>
          {card.part_of_speech && (
            <span className="italic text-sm text-indigo-600">{card.part_of_speech}</span>
          )}
        </div>

        {/* Pronunciation audio — autoplays when the card opens. */}
        <audio
          key={card.id}
          src={`${TTS_BASE}${card.text}.mp3`}
          autoPlay={autoPlay}
          controls
          className="w-full mb-4"
        />

        {audioMissing && (
          <p className="mb-4 text-center text-sm text-amber-700">
            🔇 There's no audio for the word "{surfaceWord}". Ask your teacher to create the audio.
          </p>
        )}

        {/* The definition, to study */}
        <div className="w-full bg-gray-50 border-2 border-gray-200 rounded-xl p-5 mb-4 text-center">
          <span className="text-lg text-gray-800">{card.definition}</span>
        </div>

        {/* This panel only appears the first time a word is clicked — i.e. it was just added. */}
        <p className="text-center text-sm text-green-700">
          ✓ This word has been added to your review list. You'll be quizzed on it from tomorrow.
        </p>
        <div className="flex justify-center mt-4">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
