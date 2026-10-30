type Props = {
  answer_key: string;
};

// A writing question can accept several answers, saved in answer_key joined by "*".
// Must match WRITING_ANSWER_SEPARATOR in the teacher app and check_writing in the backend.
const WRITING_ANSWER_SEPARATOR = '*';

// Shown when a writing answer (format 13) is wrong: the accepted version(s), line breaks kept.
const WritingExplanation = ({ answer_key }: Props) => {
  const answers = answer_key.split(WRITING_ANSWER_SEPARATOR).map(a => a.trim()).filter(Boolean);
  return (
    <div className="text-left">
      <div className="font-semibold">{answers.length > 1 ? 'Correct versions:' : 'Correct version:'}</div>
      {answers.map((answer, index) => (
        <p key={index} className={`whitespace-pre-wrap ${index > 0 ? 'mt-2 pt-2 border-t border-gray-300' : ''}`}>
          {answer}
        </p>
      ))}
    </div>
  );
};

export default WritingExplanation;
