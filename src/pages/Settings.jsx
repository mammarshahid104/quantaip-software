// School Settings — profile + logo, stored at schools/{schoolCode}/settings/profile
import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase/config";

// Keep logos small enough to fit Firestore's 1MB document limit once base64'd.
const MAX_LOGO_BYTES = 500 * 1024; // 500 KB

const EMPTY = {
  schoolName: "",
  principalName: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  logo: "", // base64 data URL
};

export default function Settings() {
  const schoolCode = localStorage.getItem("schoolCode") || "your school";

  const [form, setForm] = useState({
    ...EMPTY,
    schoolName: localStorage.getItem("schoolName") || "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const ref = doc(db, `schools/${schoolCode}/settings/profile`);
        const snap = await getDoc(ref);
        if (!cancelled && snap.exists()) {
          const d = snap.data();
          setForm({
            schoolName: d.schoolName || "",
            principalName: d.principalName || "",
            address: d.address || "",
            phone: d.phone || "",
            email: d.email || "",
            website: d.website || "",
            logo: d.logo || "",
          });
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Settings load failed:", err);
        setError(
          err.code === "permission-denied"
            ? "You don't have access to this school's settings."
            : "Couldn't load settings. Please try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

  const handleLogo = (e) => {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Logo is too large. Please choose an image under 500 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update("logo", String(reader.result));
    reader.onerror = () => setError("Couldn't read that image. Try another.");
    reader.readAsDataURL(file);
  };

  const showSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 4000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.schoolName.trim()) {
      setError("School name is required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        schoolName: form.schoolName.trim(),
        principalName: form.principalName.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        website: form.website.trim(),
        logo: form.logo || "",
      };
      await setDoc(
        doc(db, `schools/${schoolCode}/settings/profile`),
        payload,
        { merge: true }
      );

      // Mirror to localStorage: name for the sidebar chip, logo for the diary PDF.
      localStorage.setItem("schoolName", payload.schoolName);
      if (payload.logo) localStorage.setItem("schoolLogo", payload.logo);
      else localStorage.removeItem("schoolLogo");

      showSuccess("Settings saved successfully!");
    } catch (err) {
      console.error("Settings save failed:", err);
      setError(
        err.code === "permission-denied"
          ? "You don't have permission to edit settings."
          : "Couldn't save settings. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">School Settings ⚙️</h1>
        <p className="page-subtitle">
          Profile &amp; branding for <strong>{schoolCode}</strong>
        </p>
      </div>

      {success && <div className="success-banner">{success}</div>}
      {error && <div className="login-error">{error}</div>}

      {loading ? (
        <div className="card">
          <div className="table-state">
            <div className="route-loading-spinner" />
            <span>Loading settings…</span>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSave} className="settings-form">
          {/* A) School profile */}
          <div className="card">
            <div className="card-head">
              <span className="card-title">School Profile</span>
            </div>

            <label className="field">
              <span className="field-label">School Name *</span>
              <input
                className="field-input"
                type="text"
                value={form.schoolName}
                onChange={(e) => update("schoolName", e.target.value)}
                placeholder="e.g. Green Hills School"
              />
            </label>

            <label className="field">
              <span className="field-label">Principal Name</span>
              <input
                className="field-input"
                type="text"
                value={form.principalName}
                onChange={(e) => update("principalName", e.target.value)}
                placeholder="e.g. Mr. Imran Khan"
              />
            </label>

            <label className="field">
              <span className="field-label">Address</span>
              <textarea
                className="field-input"
                rows={3}
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
                placeholder="School address"
              />
            </label>

            <label className="field">
              <span className="field-label">Phone</span>
              <input
                className="field-input"
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="e.g. 0300-1234567"
              />
            </label>

            <label className="field">
              <span className="field-label">Email</span>
              <input
                className="field-input"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="e.g. info@school.edu.pk"
              />
            </label>

            <label className="field">
              <span className="field-label">Website</span>
              <input
                className="field-input"
                type="text"
                value={form.website}
                onChange={(e) => update("website", e.target.value)}
                placeholder="e.g. www.school.edu.pk"
              />
            </label>
          </div>

          {/* B) School logo */}
          <div className="card">
            <div className="card-head">
              <span className="card-title">School Logo</span>
            </div>

            <div className="logo-row">
              <div className="logo-preview">
                {form.logo ? (
                  <img src={form.logo} alt="School logo" />
                ) : (
                  <span className="logo-placeholder">No logo</span>
                )}
              </div>
              <div className="logo-controls">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogo}
                  className="field-input"
                />
                <p className="page-subtitle" style={{ marginTop: 8 }}>
                  PNG or JPG, under 500 KB. Used on the sidebar and diary PDF.
                </p>
                {form.logo && (
                  <button
                    type="button"
                    className="btn-delete"
                    style={{ marginTop: 8 }}
                    onClick={() => update("logo", "")}
                  >
                    Remove Logo
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* C) Save */}
          <div className="settings-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "💾 Save Settings"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
