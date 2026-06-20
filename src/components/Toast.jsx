// Toast — bottom-right auto-dismissing notification (navy bg, gold text)
import { useEffect } from "react";

export default function Toast({ message, onClose, duration = 3000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [message, onClose, duration]);

  if (!message) return null;
  return <div className="toast">{message}</div>;
}
