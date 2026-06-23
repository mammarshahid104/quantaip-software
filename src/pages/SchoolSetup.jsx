// School Onboarding / Setup wizard (Super Admin only).
// Standalone page at /setup — no sidebar, no app login required.
//
// Flow: Verify super-admin password → fill school + admin + plan form →
// create the Firebase Auth admin account and Firestore docs → success screen.
//
// New auth accounts are created on a SECONDARY Firebase app so the call does
// not sign the current user in/out of the primary app session.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { firebaseConfig } from "../firebase/config";

const SUPER_ADMIN_PASSWORD = "QUANTAIP@SuperAdmin2026";

const PLANS = {
  Starter: { maxStudents: 100 },
  Standard: { maxStudents: 500 },
  Premium: { maxStudents: "unlimited" },
};

// "GHS" -> "GHS-001"; "CBC-001" stays "CBC-001". Uppercase, alphanumeric + dash.
function formatSchoolCode(raw) {
  let s = String(raw || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!s) return "";
  // If it doesn't already end with "-<number>", append "-001".
  if (!/-\d+$/.test(s)) s = `${s.replace(/-+$/, "")}-001`;
  return s;
}

// GHS-001 -> ghs-001-adm-001@quantaip.edu.pk (matches the mobile app + Login).
function buildAdminEmail(schoolCode) {
  return `${schoolCode}-ADM-001@quantaip.edu.pk`.toLowerCase();
}

const STEPS = ["Verify", "School Info", "Done"];

export default function SchoolSetup() {
  const navigate = useNavigate();

  // 0 = verify, 1 = form, 2 = done
  const [step, setStep] = useState(0);

  // Step 1 — super admin gate
  const [superPassword, setSuperPassword] = useState("");
  const [verifyError, setVerifyError] = useState("");

  // Step 2 — form
  const [form, setForm] = useState({
    schoolName: "",
    schoolCode: "",
    address: "",
    phone: "",
    principalName: "",
    adminName: "",
    adminPassword: "",
    plan: "Standard",
    trial: true,
  });
  const [adminPasswordTouched, setAdminPasswordTouched] = useState(false);
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);

  // Step 3 — result
  const [result, setResult] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const formattedCode = useMemo(
    () => formatSchoolCode(form.schoolCode),
    [form.schoolCode]
  );

  const handleVerify = (e) => {
    e.preventDefault();
    setVerifyError("");
    if (superPassword !== SUPER_ADMIN_PASSWORD) {
      setVerifyError("Access Denied — incorrect admin password.");
      return;
    }
    setStep(1);
  };

  const generatePassword = () => {
    const code = formattedCode || "SCHOOL";
    const pwd = `${code}@Admin2026`;
    setAdminPasswordTouched(true);
    update("adminPassword", pwd);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError("");

    const schoolCode = formattedCode;
    if (!form.schoolName.trim()) {
      setFormError("School name is required.");
      return;
    }
    if (!schoolCode) {
      setFormError("School code is required.");
      return;
    }
    if (!form.adminName.trim()) {
      setFormError("Admin name is required.");
      return;
    }
    if (form.adminPassword.length < 8) {
      setFormError("Admin password must be at least 8 characters.");
      return;
    }

    const email = buildAdminEmail(schoolCode);
    const maxStudents = PLANS[form.plan].maxStudents;

    // Secondary app: creating a user here won't touch the primary session.
    const secondaryApp = initializeApp(firebaseConfig, `setup-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);

    setCreating(true);
    try {
      // 1) Create the Firebase Auth admin account.
      await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        form.adminPassword
      );

      // 2) Write Firestore docs — authenticated as the new admin via the
      //    secondary app, so security rules see the school's own admin.
      const db2 = getFirestore(secondaryApp);

      await setDoc(doc(db2, `schools/${schoolCode}/settings/profile`), {
        schoolName: form.schoolName.trim(),
        principalName: form.principalName.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        schoolCode,
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db2, `schools/${schoolCode}/subscription/current`), {
        plan: form.plan,
        status: form.trial ? "trial" : "active",
        trialStart: serverTimestamp(),
        trialDays: form.trial ? 7 : 0,
        maxStudents,
        createdAt: serverTimestamp(),
      });

      setResult({
        schoolName: form.schoolName.trim(),
        schoolCode,
        email,
        password: form.adminPassword,
        plan: form.plan,
        trial: form.trial,
      });
      setStep(2);

      await signOut(secondaryAuth).catch(() => {});
    } catch (err) {
      console.error("School setup failed:", err);
      const map = {
        "auth/email-already-in-use":
          "A school with this code already exists. Pick a different code.",
        "auth/invalid-email": "That school code produces an invalid email.",
        "auth/weak-password": "Admin password is too weak (min 6 characters).",
        "auth/network-request-failed":
          "Network error. Check your connection and try again.",
        "permission-denied":
          "The account was created but Firestore writes were blocked by security rules.",
      };
      setFormError(
        map[err.code] || "Couldn't create the school. Please try again."
      );
    } finally {
      await deleteApp(secondaryApp).catch(() => {});
      setCreating(false);
    }
  };

  const copyCredentials = async () => {
    if (!result) return;
    const text =
      `QUANTAIP EduOS — School Credentials\n` +
      `School: ${result.schoolName}\n` +
      `School Code: ${result.schoolCode}\n` +
      `Admin Email: ${result.email}\n` +
      `Admin Password: ${result.password}\n` +
      `Plan: ${result.plan}${result.trial ? " (7-day trial)" : ""}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const progressPct = (step / (STEPS.length - 1)) * 100;

  return (
    <div className="login-page">
      <div className="login-card setup-card">
        {/* Navy header */}
        <div className="login-header">
          <div className="login-logo">
            QUANT<span className="login-logo-accent">AI</span>P
          </div>
          <div className="login-logo-sub">EduOS · Setup</div>
        </div>

        {/* Steps indicator + progress bar */}
        <div className="setup-steps">
          <div className="setup-steps-row">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={
                  "setup-step" +
                  (i === step ? " is-active" : "") +
                  (i < step ? " is-done" : "")
                }
              >
                <span className="setup-step-dot">
                  {i < step ? "✓" : i + 1}
                </span>
                <span className="setup-step-label">{label}</span>
              </div>
            ))}
          </div>
          <div className="setup-progress">
            <div
              className="setup-progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="login-body">
          {/* STEP 1 — Super admin verify */}
          {step === 0 && (
            <form onSubmit={handleVerify}>
              <h1 className="login-title">Super Admin</h1>
              <p className="login-subtitle">
                Enter the QUANTAIP admin password to create a new school.
              </p>

              <label className="field">
                <span className="field-label">QUANTAIP Admin Password</span>
                <input
                  className="field-input"
                  type="password"
                  placeholder="••••••••"
                  value={superPassword}
                  onChange={(e) => setSuperPassword(e.target.value)}
                  autoFocus
                />
              </label>

              {verifyError && <div className="login-error">{verifyError}</div>}

              <button className="login-btn" type="submit">
                Continue
              </button>
            </form>
          )}

          {/* STEP 2 — Setup form */}
          {step === 1 && (
            <form onSubmit={handleCreate}>
              <h1 className="login-title">New School</h1>
              <p className="login-subtitle">
                Create the school, its admin account, and a subscription.
              </p>

              {/* Section A: School Info */}
              <div className="setup-section-title">School Info</div>

              <label className="field">
                <span className="field-label">School Name *</span>
                <input
                  className="field-input"
                  type="text"
                  placeholder="e.g. Green Hills School"
                  value={form.schoolName}
                  onChange={(e) => update("schoolName", e.target.value)}
                  autoFocus
                />
              </label>

              <label className="field">
                <span className="field-label">School Code *</span>
                <input
                  className="field-input"
                  type="text"
                  placeholder="e.g. GHS or CBC-001"
                  value={form.schoolCode}
                  onChange={(e) => update("schoolCode", e.target.value)}
                />
                {formattedCode && (
                  <span className="setup-hint">
                    Code: <strong>{formattedCode}</strong> · Login email:{" "}
                    <strong>{buildAdminEmail(formattedCode)}</strong>
                  </span>
                )}
              </label>

              <label className="field">
                <span className="field-label">School Address</span>
                <input
                  className="field-input"
                  type="text"
                  placeholder="Optional"
                  value={form.address}
                  onChange={(e) => update("address", e.target.value)}
                />
              </label>

              <div className="fee-row-grid">
                <label className="field">
                  <span className="field-label">School Phone</span>
                  <input
                    className="field-input"
                    type="tel"
                    placeholder="Optional"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="field-label">Principal Name</span>
                  <input
                    className="field-input"
                    type="text"
                    placeholder="Optional"
                    value={form.principalName}
                    onChange={(e) => update("principalName", e.target.value)}
                  />
                </label>
              </div>

              {/* Section B: Admin Account */}
              <div className="setup-section-title">Admin Account</div>

              <label className="field">
                <span className="field-label">Admin Name *</span>
                <input
                  className="field-input"
                  type="text"
                  placeholder="e.g. Imran Khan"
                  value={form.adminName}
                  onChange={(e) => update("adminName", e.target.value)}
                />
              </label>

              <label className="field">
                <span className="field-label">Admin Password * (min 8)</span>
                <div className="setup-pwd-row">
                  <input
                    className="field-input"
                    type="text"
                    placeholder="At least 8 characters"
                    value={form.adminPassword}
                    onChange={(e) => {
                      setAdminPasswordTouched(true);
                      update("adminPassword", e.target.value);
                    }}
                  />
                  <button
                    type="button"
                    className="btn-edit setup-gen-btn"
                    onClick={generatePassword}
                  >
                    Generate
                  </button>
                </div>
              </label>

              {/* Section C: Subscription */}
              <div className="setup-section-title">Subscription</div>

              <div className="fee-row-grid">
                <label className="field">
                  <span className="field-label">Plan</span>
                  <select
                    className="field-input"
                    value={form.plan}
                    onChange={(e) => update("plan", e.target.value)}
                  >
                    {Object.keys(PLANS).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">Max Students</span>
                  <input
                    className="field-input"
                    type="text"
                    value={String(PLANS[form.plan].maxStudents)}
                    readOnly
                  />
                </label>
              </div>

              <label className="setup-checkbox">
                <input
                  type="checkbox"
                  checked={form.trial}
                  onChange={(e) => update("trial", e.target.checked)}
                />
                <span>Start with a 7-day trial</span>
              </label>

              {formError && <div className="login-error">{formError}</div>}

              <button className="login-btn" type="submit" disabled={creating}>
                {creating ? "Creating school…" : "Create School"}
              </button>

              <button
                type="button"
                className="setup-back"
                onClick={() => setStep(0)}
                disabled={creating}
              >
                ← Back
              </button>
            </form>
          )}

          {/* STEP 3 — Success */}
          {step === 2 && result && (
            <div>
              <h1 className="login-title">✅ School Created Successfully!</h1>
              <p className="login-subtitle">
                Share these credentials with the school admin.
              </p>

              <div className="setup-result">
                <div className="setup-result-row">
                  <span className="setup-result-label">School</span>
                  <span className="setup-result-value">{result.schoolName}</span>
                </div>
                <div className="setup-result-row">
                  <span className="setup-result-label">School Code</span>
                  <span className="setup-result-value">{result.schoolCode}</span>
                </div>
                <div className="setup-result-row">
                  <span className="setup-result-label">Admin Email</span>
                  <span className="setup-result-value">{result.email}</span>
                </div>
                <div className="setup-result-row">
                  <span className="setup-result-label">Admin Password</span>
                  <span className="setup-result-value">
                    {showPassword ? result.password : "••••••••••"}
                    <button
                      type="button"
                      className="setup-link"
                      onClick={() => setShowPassword((s) => !s)}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </span>
                </div>
                <div className="setup-result-row">
                  <span className="setup-result-label">Plan</span>
                  <span className="setup-result-value">
                    {result.plan}
                    {result.trial ? " (7-day trial)" : ""}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="login-btn"
                onClick={copyCredentials}
              >
                {copied ? "Copied ✓" : "Copy Credentials"}
              </button>

              <button
                type="button"
                className="setup-back"
                onClick={() => navigate("/")}
              >
                Go to Login →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
