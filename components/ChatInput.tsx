"use client";
import { useState } from 'react';
import { Send } from 'lucide-react';

export default function ChatInput({
  onSend,
  disabled,
}: {
  onSend:   (text: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
  };

  return (
    <div className="flex gap-3 items-end border border-gray-200 rounded-2xl p-3 bg-white shadow-sm">
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder="Describe the case — parties, facts, relief sought. Or ask to draft a legal notice."
        className="flex-1 resize-none text-sm outline-none min-h-[48px] max-h-40 leading-relaxed bg-white text-gray-900 placeholder-gray-400"
        rows={2}
        disabled={disabled}
      />
      <button
        onClick={submit}
        disabled={disabled || !value.trim()}
        className="p-2 bg-gray-900 text-white rounded-xl disabled:opacity-40 hover:bg-gray-700 transition-colors"
      >
        <Send size={16} />
      </button>
    </div>
  );
}