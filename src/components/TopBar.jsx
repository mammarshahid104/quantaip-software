// Top bar: school code chip + breadcrumb
import { useState } from "react";
import { useLocation } from "react-router-dom";
import ActAsTeacherModal from "./ActAsTeacherModal";
import { useActingTeacher } from "../services/actingTeacher";

const TITLES = {
  dashboard: "Dashboard",
  students: "Students",
  teachers: "Teachers",
  classes: "Classes",
  fees: "Fee Management",
  attendance: "Attendance",
  results: "Results",
  timetable: "Timetable",
  homework: "Homework",
  analytics: "Analytics",
};

export default function TopBar() {
  const { pathname } = useLocation();
  const { acting } = useActingTeacher();
  const [showActAs, setShowActAs] = useState(false);
  const segment = pathname.split("/").filter(Boolean)[0] || "dashboard";
  const title = TITLES[segment] || "Dashboard";
  const schoolCode = localStorage.getItem("schoolCode") || "—";

  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span className="breadcrumb-root">QUANTAIP EduOS</span>
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-current">{title}</span>
      </div>
      <div className="topbar-right">
        {!acting && (
          <button
            className="btn-act-as"
            onClick={() => setShowActAs(true)}
            title="Operate the app on a teacher's behalf"
          >
            👤 Act as Teacher
          </button>
        )}
        <div className="code-chip">{schoolCode}</div>
      </div>

      {showActAs && (
        <ActAsTeacherModal
          schoolCode={schoolCode}
          onClose={() => setShowActAs(false)}
        />
      )}
    </header>
  );
}
