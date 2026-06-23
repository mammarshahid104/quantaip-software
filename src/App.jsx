// HashRouter (not BrowserRouter): the packaged desktop app loads from a
// file:// URL whose origin is null, so the History API used by BrowserRouter
// throws a SecurityError on navigation and the app renders blank. Hash-based
// routing (#/route) sidesteps the History API and works under file:// and http.
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";

import Login from "./pages/Login";
import SchoolSetup from "./pages/SchoolSetup";
import Dashboard from "./pages/Dashboard";
import Students from "./pages/Students";
import Teachers from "./pages/Teachers";
import Classes from "./pages/Classes";
import Fees from "./pages/Fees";
import Attendance from "./pages/Attendance";
import Results from "./pages/Results";
import Timetable from "./pages/Timetable";
import Homework from "./pages/Homework";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Login />} />

        {/* Super-admin school onboarding — standalone, no app login */}
        <Route path="/setup" element={<SchoolSetup />} />

        {/* Protected app shell */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/students" element={<Students />} />
          <Route path="/teachers" element={<Teachers />} />
          <Route path="/classes" element={<Classes />} />
          <Route path="/fees" element={<Fees />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/results" element={<Results />} />
          <Route path="/timetable" element={<Timetable />} />
          <Route path="/homework" element={<Homework />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
