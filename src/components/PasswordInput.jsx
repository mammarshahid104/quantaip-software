// Password input with a show/hide eye toggle.
// Masked by default; the 👁️ button flips it to plain text and back. Used for
// every password field in the app so the behaviour is identical everywhere.
import { useState } from "react";

export default function PasswordInput({
  value,
  onChange,
  placeholder = "",
  autoFocus = false,
  autoComplete,
  disabled = false,
  className = "",
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`pwd-input${className ? ` ${className}` : ""}`}>
      <input
        className="field-input pwd-input-field"
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        disabled={disabled}
      />
      <button
        type="button"
        className="pwd-eye"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Hide password" : "Show password"}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? "🙈" : "👁️"}
      </button>
    </div>
  );
}
