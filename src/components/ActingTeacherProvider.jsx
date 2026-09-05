// Holds the "acting as teacher" selection for the whole app shell.
// The state itself and the helpers live in services/actingTeacher.js.
import { useCallback, useMemo, useState } from "react";
import {
  ActingTeacherContext,
  ACTING_TEACHER_KEY,
  readStoredTeacher,
} from "../services/actingTeacher";

export default function ActingTeacherProvider({ children }) {
  const [teacher, setTeacher] = useState(readStoredTeacher);

  const actAs = useCallback((next) => {
    try {
      sessionStorage.setItem(ACTING_TEACHER_KEY, JSON.stringify(next));
    } catch {
      // Private-mode / storage-disabled: proxy mode still works for this
      // render, it just won't survive a refresh.
    }
    setTeacher(next);
  }, []);

  const exit = useCallback(() => {
    try {
      sessionStorage.removeItem(ACTING_TEACHER_KEY);
    } catch {
      // ignore — clearing state below is what actually matters
    }
    setTeacher(null);
  }, []);

  const value = useMemo(
    () => ({ teacher, acting: !!teacher, actAs, exit }),
    [teacher, actAs, exit]
  );

  return (
    <ActingTeacherContext.Provider value={value}>
      {children}
    </ActingTeacherContext.Provider>
  );
}
