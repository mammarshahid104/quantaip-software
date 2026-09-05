// Premium grouped sidebar (Option C) for QUANTAIP EduOS
import { NavLink, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/config";
import { useActingTeacher } from "../services/actingTeacher";

const NAV_GROUPS = [
  {
    title: "OVERVIEW",
    items: [{ label: "Dashboard", to: "/dashboard", icon: "📊" }],
  },
  {
    title: "PEOPLE",
    items: [
      { label: "Students", to: "/students", icon: "🎓" },
      { label: "Teachers", to: "/teachers", icon: "🧑‍🏫" },
      { label: "Classes", to: "/classes", icon: "🏫" },
    ],
  },
  {
    title: "MANAGEMENT",
    items: [
      { label: "Fee Management", to: "/fees", icon: "💰" },
      { label: "Attendance", to: "/attendance", icon: "🗓️" },
      { label: "Results", to: "/results", icon: "📈" },
      { label: "Timetable", to: "/timetable", icon: "⏰" },
      { label: "Homework", to: "/homework", icon: "📝" },
    ],
  },
  {
    title: "REPORTS",
    items: [{ label: "Analytics", to: "/analytics", icon: "📉" }],
  },
  {
    title: "LEARNING",
    items: [{ label: "Virtual Lab", to: "/virtual-lab", icon: "🧪" }],
  },
  {
    title: "SYSTEM",
    items: [{ label: "Settings", to: "/settings", icon: "⚙️" }],
  },
];

// What a teacher actually does in this app. In proxy mode the admin-only
// sections (people, money, settings) are hidden so the screen matches what the
// teacher would see on their own login.
const TEACHER_ROUTES = new Set([
  "/attendance",
  "/results",
  "/homework",
  "/timetable",
]);

export default function Sidebar() {
  const navigate = useNavigate();
  const { teacher, acting } = useActingTeacher();
  const schoolCode = localStorage.getItem("schoolCode") || "—";
  const schoolName = localStorage.getItem("schoolName") || "";
  const userName = localStorage.getItem("userName") || "Administrator";

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore — clear local state regardless
    }
    localStorage.removeItem("schoolCode");
    localStorage.removeItem("userName");
    navigate("/");
  };

  // Proxy mode: drop admin-only destinations, and any group left empty.
  const groups = acting
    ? NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => TEACHER_ROUTES.has(i.to)),
      })).filter((g) => g.items.length > 0)
    : NAV_GROUPS;

  return (
    <aside className="sidebar">
      {/* Logo + school chip */}
      <div className="sidebar-head">
        <div className="sidebar-logo">
          QUANT<span className="sidebar-logo-accent">AI</span>P
          <div className="sidebar-logo-sub">EduOS</div>
        </div>
        <div className="school-chip">{schoolName || `School: ${schoolCode}`}</div>
      </div>

      {/* Grouped nav */}
      <nav className="sidebar-nav">
        {groups.map((group) => (
          <div className="nav-group" key={group.title}>
            <div className="nav-group-title">{group.title}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  "nav-item" + (isActive ? " nav-item-active" : "")
                }
              >
                <span className="nav-item-icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="sidebar-foot">
        <div className="user-avatar">
          {(acting ? teacher.name : userName).charAt(0).toUpperCase()}
        </div>
        <div className="user-meta">
          <div className="user-name">{acting ? teacher.name : userName}</div>
          <div className="user-role">
            {acting ? "Teacher (acting)" : "Admin"}
          </div>
        </div>
        <button
          className="logout-btn"
          onClick={handleLogout}
          title="Log out"
          aria-label="Log out"
        >
          ⏻
        </button>
      </div>
    </aside>
  );
}
