"use client";
import { useState, useRef, useEffect } from 'react';
import ChatWindow from '@/components/ChatWindow';
import ChatInput from '@/components/ChatInput';

interface Message {
  role:     "user" | "assistant";
  content:  string;
  sources?: { full_ref?: string; url?: string; title?: string }[];
  toolCall?: string;
}

const WELCOME: Message = {
  role:    "assistant",
  content: "**नमस्ते। मैं VakilSahab हूँ।**\n\nDescribe your client's case — the facts, the parties involved, and the relief you're seeking. I'll research relevant case precedents and constitutional provisions, then give you my legal assessment.\n\nOnce we've worked through the research, you can ask me to draft a legal notice.",
};

export default function Home() {
  const [messages,  setMessages]  = useState<Message[]>([WELCOME]);
  const [loading,   setLoading]   = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(text: string) {
    const userMsg: Message = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Add a placeholder assistant message that we'll stream into
    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev, { role: "assistant", content: "", sources: [] }]);

    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages:  [...messages.filter(m => m.role !== "assistant" || m.content), userMsg]
                       .map(m => ({ role: m.role, content: m.content })),
          sessionId,
        }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));

          if (event.type === "text") {
            setMessages(prev => {
              const updated = [...prev];
              updated[assistantIdx] = {
                ...updated[assistantIdx],
                content: (updated[assistantIdx].content ?? "") + event.delta,
              };
              return updated;
            });
          } else if (event.type === "tool_call") {
            setMessages(prev => {
              const updated = [...prev];
              updated[assistantIdx] = { ...updated[assistantIdx], toolCall: event.tool };
              return updated;
            });
          } else if (event.type === "sources") {
            setMessages(prev => {
              const updated = [...prev];
              updated[assistantIdx] = { ...updated[assistantIdx], sources: event.sources, toolCall: undefined };
              return updated;
            });
          } else if (event.type === "session") {
            setSessionId(event.sessionId);
          }
        }
      }
    } catch (e) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { role: "assistant", content: "Something went wrong. Please try again." };
        return updated;
      });
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <span className="text-xl">⚖️</span>
          <div>
            <h1 className="font-semibold text-gray-900">VakilSahab</h1>
            <p className="text-xs text-gray-400">Indian Civil Law Research Assistant</p>
          </div>
        </div>
      </header>

      {/* Chat area */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4">
          <ChatWindow messages={messages} />
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input */}
      <div className="sticky bottom-0 bg-gray-50 border-t border-gray-100 px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <ChatInput onSend={handleSend} disabled={loading} />
          <p className="text-center text-xs text-gray-400 mt-2">
            For research assistance only. Not a substitute for professional legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}