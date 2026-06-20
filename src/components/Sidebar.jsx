// Premium grouped sidebar (Option C) for QUANTAIP EduOS
import { NavLink, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/config";

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
    title: "SYSTEM",
    items: [{ label: "Settings", to: "/settings", icon: "⚙️" }],
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
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
        {NAV_GROUPS.map((group) => (
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
          {userName.charAt(0).toUpperCase()}
        </div>
        <div className="user-meta">
          <div className="user-name">{userName}</div>
          <div className="user-role">Admin</div>
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
