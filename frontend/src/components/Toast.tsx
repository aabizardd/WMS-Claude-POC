import { useEffect } from 'react';

interface ToastProps {
  type: 'success' | 'error';
  message: string;
  onClose: () => void;
  duration?: number; // ms, default 5000 for success, 8000 for error
}

export default function Toast({ type, message, onClose, duration }: ToastProps) {
  const dur = duration ?? (type === 'success' ? 5000 : 8000);

  useEffect(() => {
    if (dur <= 0) return;
    const timer = setTimeout(onClose, dur);
    return () => clearTimeout(timer);
  }, [dur, onClose]);

  const colors =
    type === 'success'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
      : 'border-rose-300 bg-rose-50 text-rose-800';

  return (
    <div
      className={`pointer-events-auto animate-[fadeIn_0.3s_ease-out] rounded-lg border px-4 py-3 shadow-lg ${colors}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm font-medium">{message}</span>
        <button
          onClick={onClose}
          className="ml-2 flex-shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
