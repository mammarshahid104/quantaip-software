// Virtual Lab — embeds the standalone QUANTAIP Simulator (public/simulator).
// The simulator is plain HTML/CSS/JS served from the public/ folder, so it
// lives outside React Router. We compute its URL relative to the current
// document so it resolves correctly both in dev (http://localhost:5173/) and
// in the packaged Electron app (file://.../dist/index.html), where base is './'
// and an absolute "/simulator/..." path would break.
import { useMemo } from "react";

export default function VirtualLab() {
  const simulatorUrl = useMemo(
    () => new URL("simulator/index.html", window.location.href).href,
    []
  );

  return (
    <div className="virtual-lab-page">
      <div className="page-head virtual-lab-head">
        <div>
          <div className="page-title">Virtual Lab</div>
          <div className="page-subtitle">
            Interactive physics simulations — QUANTAIP Simulator
          </div>
        </div>
        <a
          className="btn-primary virtual-lab-open-btn"
          href={simulatorUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in new tab ↗
        </a>
      </div>

      <div className="virtual-lab-frame-wrap">
        <iframe
          className="virtual-lab-frame"
          src={simulatorUrl}
          title="QUANTAIP Virtual Lab"
        />
      </div>
    </div>
  );
}
