// Combobox — a free-text input with a dropdown of values already in use.
// Schools on A/B/C just pick from the list like a dropdown; schools using
// "Purple" or "Mango" type whatever they want. Any typed value is kept as-is.
import { useEffect, useRef, useState } from "react";

export default function ComboBox({
  value,
  onChange,
  options = [],
  placeholder = "",
  disabled = false,
  autoFocus = false,
  emptyHint = "",
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef(null);

  // Suggestions narrow as you type, but typing something new is never blocked.
  // Once the value exactly matches an option (just picked, or loaded from an
  // existing record) the full list comes back, so switching A → B is one click.
  const query = String(value || "").trim().toLowerCase();
  const exact = options.some((o) => String(o).toLowerCase() === query);
  const matches =
    !query || exact
      ? options
      : options.filter((o) => String(o).toLowerCase().includes(query));

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const choose = (option) => {
    onChange(option);
    setOpen(false);
    setHighlight(-1);
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open && highlight >= 0) {
      e.preventDefault();
      choose(matches[highlight]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="combobox" ref={wrapRef}>
      <input
        className="field-input combobox-input"
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(-1);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      <button
        type="button"
        className="combobox-toggle"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Show existing options"
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>

      {open && (matches.length > 0 || emptyHint) && (
        <ul className="combobox-list" role="listbox">
          {matches.length > 0 ? (
            matches.map((o, i) => (
              <li key={o}>
                <button
                  type="button"
                  role="option"
                  aria-selected={String(value) === String(o)}
                  className={`combobox-option${
                    i === highlight ? " highlighted" : ""
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(o)}
                >
                  {o}
                </button>
              </li>
            ))
          ) : (
            <li className="combobox-empty">{emptyHint}</li>
          )}
        </ul>
      )}
    </div>
  );
}
