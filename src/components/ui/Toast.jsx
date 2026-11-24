import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import Button from "./Button.jsx";

const ToastContext = createContext(null);

const iconByType = {
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
};

export function ToastProvider({ children }) {
  const [notice, setNotice] = useState(null);
  const serial = useRef(0);
  const [paused, setPaused] = useState(false);

  const notify = useCallback((title, description = "", type = "success") => {
    serial.current += 1;
    setNotice({ id: serial.current, title, description, type });
  }, []);

  useEffect(() => {
    if (!notice || paused) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice, paused]);

  const dismiss = useCallback(() => setNotice(null), []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {notice && `${notice.title}. ${notice.description}`}
      </div>
      {notice && <Toast notice={notice} onDismiss={dismiss} onPause={setPaused} />}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}

function Toast({ notice, onDismiss, onPause }) {
  const Icon = iconByType[notice.type] ?? Info;

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex justify-center sm:justify-end"
      onMouseEnter={() => onPause(true)}
      onMouseLeave={() => onPause(false)}
      onFocusCapture={() => onPause(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onPause(false);
      }}
    >
      <div
        key={notice.id}
        className="flex w-full max-w-md items-start gap-3 rounded-md border border-border bg-background p-4 text-foreground shadow-panel"
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{notice.title}</p>
          {notice.description && (
            <p className="mt-1 text-xs text-muted-foreground">{notice.description}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Dismiss notification"
          title="Dismiss notification"
          onClick={onDismiss}
          className="pointer-events-auto shrink-0 p-0"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
