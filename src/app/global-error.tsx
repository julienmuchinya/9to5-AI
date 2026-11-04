"use client";

/** Last-resort screen if the whole app shell fails to load. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0b0f17", color: "#e5e7eb", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 16 }}>
          <h1 style={{ fontSize: 18 }}>9to5 AI couldn’t load</h1>
          <p style={{ color: "#9ca3af", fontSize: 14 }}>Please refresh. If it keeps happening, the server may be restarting — try again in a minute.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: 0, background: "#6366f1", color: "white", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
