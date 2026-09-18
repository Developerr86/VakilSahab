"use client";
import { useState, useRef, useEffect } from 'react';
import ChatWindow from '@/components/ChatWindow';
import ChatInput from '@/components/ChatInput';

interface Message {
  role:     "user" | "assistant";
  content:  string;
  sources?: { full_ref?: string; url?: string; title?: string }[];
  toolCall?: string; // current stage of the running job
}

const WELCOME: Message = {
  role:    "assistant",
  content: "**à¤¨à¤®à¤¸à¥à¤¤à¥à¥¤ à¤®à¥à¤ VakilSahab à¤¹à¥à¤à¥¤**\n\nDescribe your client's case â the facts, the parties involved, and the relief you're seeking. I'll research relevant case precedents and constitutional provisions, then give you my legal assessment.\n\nOnce we've worked through the research, you can ask me to draft a legal notice.",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    // Placeholder assistant message that job progress streams into
    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev, { role: "assistant", content: "", sources: [], toolCall: "queued" }]);

    const updateAssistant = (patch: Partial<Message>) => {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { ...updated[assistantIdx], ...patch };
        return updated;
      });
    };

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
      if (!res.ok) throw new Error(`chat failed: ${res.status}`);
      const { jobId, sessionId: sid } = await res.json();
      if (sid) setSessionId(sid);

      // Poll the job. Each poll both drives the work (?work=1) and waits up to
      // 25s for progress, so the UI updates live while the agent thinks,
      // searches, and writes â with no single request exceeding Vercel's
      // 60-second function limit.
      for (;;) {
        let snap: any;
        try {
          const r = await fetch(`/api/jobs/${jobId}?work=1&wait=25`, { cache: "no-store" });
          if (!r.ok) { await sleep(2500); continue; }
          snap = await r.json();
        } catch {
          // Poll request died (e.g. function recycled) â the job survives
          // server-side; wait and poll again.
          await sleep(2500);
          continue;
        }

        if (snap.status === "done") {
          updateAssistant({
            content:  snap.result?.content ?? snap.partial ?? "",
            sources:  snap.result?.sources ?? [],
            toolCall: undefined,
          });
          break;
        }
        if (snap.status === "failed") {
          updateAssistant({
            content:  `Sorry â that request didn't complete (${snap.error ?? "unknown error"}). Please send it again to retry.`,
            toolCall: undefined,
          });
          break;
        }
        updateAssistant({
          toolCall: snap.stage ?? "thinking",
          ...(snap.partial ? { content: snap.partial } : {}),
        });
      }
    } catch {
      updateAssistant({ content: "Something went wrong. Please try again.", toolCall: undefined });
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <span className="text-xl">âï¸</span>
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
