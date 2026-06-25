"use client";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SourceBadge from './SourceBadge';

interface Message {
  role:     "user" | "assistant";
  content:  string;
  sources?: { full_ref?: string; url?: string; title?: string }[];
  toolCall?: string; // tool name currently being called
}

export default function ChatWindow({ messages }: { messages: Message[] }) {
  return (
    <div className="flex flex-col gap-6 py-6">
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-2xl rounded-2xl px-5 py-4 text-sm leading-relaxed
            ${msg.role === "user"
              ? "bg-gray-900 text-white"
              : "bg-white border border-gray-100 text-gray-800 shadow-sm"
            }`}
          >
            {msg.toolCall && (
              <p className="text-xs text-gray-400 mb-2 italic">
                🔍 Searching {msg.toolCall === "search_constitution" ? "Constitution" : "web"}...
              </p>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {msg.content}
            </ReactMarkdown>
            {msg.sources && msg.sources.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                {msg.sources.map((s, j) => <SourceBadge key={j} source={s} />)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}