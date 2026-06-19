// Reusable confirmation dialog (used for delete confirmations)
export default function ConfirmDialog({
  title = "Are you sure?",
  message,
  confirmLabel = "Delete",
  loading = false,
  onCancel,
  onConfirm,
}) {
  return (
    <div className="modal-overlay" onClick={loading ? undefined : onCancel}>
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon">⚠️</div>
        <div className="confirm-title">{title}</div>
        <div className="confirm-text">{message}</div>
        <div className="confirm-actions">
          <button
            type="button"
            className="btn-cancel"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
