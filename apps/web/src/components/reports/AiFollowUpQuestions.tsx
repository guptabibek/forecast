import { ArrowPathIcon } from '@heroicons/react/24/outline';

interface AiFollowUpQuestionsProps {
  questions?: string[];
  onAsk: (question: string) => void;
}

export function AiFollowUpQuestions({ questions, onAsk }: AiFollowUpQuestionsProps) {
  if (!questions?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase text-gray-500">Follow up</span>
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onAsk(question)}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-primary-300 hover:text-primary-700"
        >
          <ArrowPathIcon className="h-3.5 w-3.5" />
          {question}
        </button>
      ))}
    </div>
  );
}
