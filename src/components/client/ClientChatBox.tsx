import { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/appStore';
import { answerClientQuestion, type ClientQAAgentResults } from '@/lib/claudeClient';
import type { Client } from '@/types';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

interface Props {
  client: Client;
  agentResults?: ClientQAAgentResults;
}

export function ClientChatBox({ client, agentResults }: Props) {
  const apiKey = useAppStore((s) => s.claudeApiKey);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function handleSubmit() {
    const question = draft.trim();
    if (!question || loading) return;
    setDraft('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setLoading(true);
    try {
      const answer = await answerClientQuestion(client, question, agentResults);
      setMessages((prev) => [...prev, { role: 'assistant', text: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error.');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const noKey = !apiKey;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageCircle size={15} className="text-violet-600" />
          <CardTitle className="text-sm">Ask about this client</CardTitle>
          <span className="text-[10px] text-gray-400 ml-1">answers from this client's data only</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {noKey && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            No API key configured — add your Claude API key in Settings to use this feature.
          </div>
        )}

        {/* Message thread */}
        {messages.length > 0 && (
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`text-xs leading-relaxed rounded-lg px-3 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-violet-50 text-violet-900 ml-6 border border-violet-100'
                    : 'bg-gray-50 text-gray-800 mr-6 border border-gray-100'
                }`}
              >
                <span className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${
                  msg.role === 'user' ? 'text-violet-500' : 'text-gray-400'
                }`}>
                  {msg.role === 'user' ? 'You' : 'AI'}
                </span>
                <span className="whitespace-pre-wrap">{msg.text}</span>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-gray-400 mr-6 px-3 py-2.5 bg-gray-50 border border-gray-100 rounded-lg">
                <Loader2 size={12} className="animate-spin" />
                Thinking…
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
                <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={noKey || loading}
            placeholder={noKey ? 'API key required' : `Ask anything about ${client.name.split(' ')[0]}… (Enter to send)`}
            rows={2}
            className="flex-1 resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-xs placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-violet-300 disabled:opacity-50"
          />
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={noKey || loading || !draft.trim()}
            className="h-8 w-8 p-0 bg-violet-600 hover:bg-violet-700"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </Button>
        </div>
        {messages.length === 0 && !noKey && (
          <p className="text-[10px] text-gray-400">
            Answers are grounded in this client's loaded record only — goals, history, holdings, life events, and any AI assessments already run. The assistant will say so if the data doesn't cover your question.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
