// Guards authenticated routes; redirects to login when no user.
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase/config";

export default function ProtectedRoute({ children }) {
  const [status, setStatus] = useState("checking"); // checking | in | out

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setStatus(user ? "in" : "out");
    });
    return unsub;
  }, []);

  if (status === "checking") {
    return (
      <div className="route-loading">
        <div className="route-loading-spinner" />
        <span>Loading…</span>
      </div>
    );
  }

  if (status === "out") {
    return <Navigate to="/" replace />;
  }

  return children;
}
