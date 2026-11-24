import { useEffect, useRef, useState } from "react";

const PREFIX = "oceanguard:v1:";

function read(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback; // storage blocked or corrupt JSON: fall back to the default
  }
}

/** useState that mirrors its value to localStorage. Returns [value, setValue]. */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(initial);
  const fallback = useRef(value);
  const [loadedKey, setLoadedKey] = useState(null);

  useEffect(() => {
    setValue(read(key, fallback.current));
    setLoadedKey(key);
  }, [key]);

  useEffect(() => {
    if (loadedKey !== key || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* ignore quota/privacy errors */
    }
  }, [key, value, loadedKey]);

  return [value, setValue];
}
