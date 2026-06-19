// Top bar: school code chip + breadcrumb
import { useLocation } from "react-router-dom";

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
        <div className="code-chip">{schoolCode}</div>
      </div>
    </header>
  );
}
