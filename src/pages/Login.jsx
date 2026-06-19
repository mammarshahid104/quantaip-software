// Premium Light login — school code + password
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase/config";

// Admin email format matches the mobile app:
//   GHS-001  ->  ghs-001-adm-001@quantaip.edu.pk
function buildAdminEmail(schoolCode) {
  const email = `${schoolCode.trim()}-ADM-001@quantaip.edu.pk`.toLowerCase();
  console.log('Attempting login with:', email);
  return email;
}

export default function Login() {
  const navigate = useNavigate();
  const [schoolCode, setSchoolCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const code = schoolCode.trim().toUpperCase();
    if (!code || !password) {
      setError("Please enter your school code and password.");
      return;
    }

    setLoading(true);
    try {
      const email = buildAdminEmail(code);
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Persist school context for the sidebar / top bar.
      localStorage.setItem("schoolCode", code);
      localStorage.setItem(
        "userName",
        cred.user.displayName || `${code} Admin`
      );

      navigate("/dashboard");
    } catch (err) {
      const map = {
        "auth/invalid-credential": "Invalid school code or password.",
        "auth/wrong-password": "Invalid school code or password.",
        "auth/user-not-found": "Invalid school code or password.",
        "auth/invalid-email": "That school code doesn't look right.",
        "auth/too-many-requests":
          "Too many attempts. Please try again shortly.",
        "auth/network-request-failed":
          "Network error. Check your connection.",
      };
      setError(map[err.code] || "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Navy header */}
        <div className="login-header">
          <div className="login-logo">
            QUANT<span className="login-logo-accent">AI</span>P
          </div>
          <div className="login-logo-sub">EduOS · School Dashboard</div>
        </div>

        {/* Form body */}
        <form className="login-body" onSubmit={handleSubmit}>
          <h1 className="login-title">Welcome back</h1>
          <p className="login-subtitle">
            Sign in with your school code to continue.
          </p>

          <label className="field">
            <span className="field-label">School Code</span>
            <input
              className="field-input"
              type="text"
              placeholder="e.g. GHS-001"
              value={schoolCode}
              onChange={(e) => setSchoolCode(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <input
              className="field-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>

          <div className="login-foot">
            Administrator access · QUANTAIP EduOS
          </div>
        </form>
      </div>
    </div>
  );
}
