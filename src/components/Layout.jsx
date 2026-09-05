// App shell: Sidebar + TopBar + routed content
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { useActingTeacher } from "../services/actingTeacher";

export default function Layout() {
  const { teacher, acting, exit } = useActingTeacher();

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        {acting && (
          <div className="acting-banner">
            <span className="acting-banner-text">
              🔵 Acting as: <strong>{teacher.name}</strong>
              {teacher.subject ? ` · ${teacher.subject}` : ""}
              <span className="acting-banner-note">
                Work is saved under this teacher&apos;s name; your admin ID is
                recorded alongside it.
              </span>
            </span>
            <button className="acting-banner-exit" onClick={exit}>
              Exit Teacher Mode
            </button>
          </div>
        )}
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
