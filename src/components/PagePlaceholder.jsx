// Reusable "coming soon" scaffold for pages not yet built out.
export default function PagePlaceholder({ title, icon, description }) {
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{description}</p>
      </div>
      <div className="card placeholder-card">
        <div className="placeholder-icon">{icon}</div>
        <h2 className="placeholder-title">{title} module</h2>
        <p className="placeholder-text">
          This section is wired into the dashboard and ready for its data layer.
        </p>
      </div>
    </div>
  );
}
