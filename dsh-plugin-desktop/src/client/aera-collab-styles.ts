/** Aera Collab entry-point styles, installed independently of presentation mode. */

const STYLE_ID = 'aera-collab-entry-styles'

const CSS = `
.aera-collab-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: min(100%, 880px);
  padding: 20px 0 120px;
  color: var(--dsw-alias-label-primary);
}
.aera-collab-header { display: flex; flex-direction: column; gap: 8px; }
.aera-collab-title { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.35; }
.aera-collab-intro,
.aera-collab-reason,
.aera-collab-picker-intro {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.65;
}
.aera-collab-resolved-id {
  margin: 0;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 13px;
  word-break: break-all;
}
.aera-collab-resolved-repository {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.aera-collab-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.aera-collab-open,
.aera-collab-change,
.aera-collab-retry,
.aera-collab-sidebar-button {
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.35));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 7px 14px;
}
.aera-collab-open { background: var(--dsw-alias-fill-primary, rgba(127, 127, 127, 0.14)); font-weight: 600; }
.aera-collab-open:disabled,
.aera-collab-sidebar-button:disabled { cursor: default; opacity: 0.6; }
.aera-collab-picker { display: flex; flex-direction: column; gap: 10px; }
.aera-collab-picker-title { margin: 0; font-size: 15px; font-weight: 600; }
.aera-collab-search-label {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.aera-collab-search {
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.35));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 8px 12px;
  width: 100%;
}
.aera-collab-listing {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.aera-collab-rows { display: flex; flex-direction: column; gap: 6px; list-style: none; margin: 0; padding: 0; }
.aera-collab-row-button {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.28));
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 10px 12px;
}
.aera-collab-row-button:hover:not(:disabled) { background: var(--dsw-alias-fill-primary, rgba(127, 127, 127, 0.1)); }
.aera-collab-row-button:disabled { cursor: default; opacity: 0.6; }
.aera-collab-row-title { font-weight: 600; font-size: 13px; line-height: 1.45; }
.aera-collab-row-id {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  word-break: break-all;
}
.aera-collab-row-facts { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aera-collab-state { font-weight: 600; letter-spacing: 0.03em; }
.aera-collab-row-matched { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aera-collab-status,
.aera-collab-total {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.aera-collab-error { margin: 0; color: var(--dsw-alias-label-error, #d64545); font-size: 12px; }
.aera-collab-sidebar-action { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.aera-collab-sidebar-button { text-align: left; width: 100%; }
.aera-collab-surface { display: flex; flex-direction: column; gap: 10px; }
.aera-collab-surface-head { display: flex; flex-direction: column; gap: 4px; padding-bottom: 4px; }
.aera-collab-surface-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.aera-collab-surface-id {
  margin: 0;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  word-break: break-all;
}
.aera-collab-surface-repos,
.aera-collab-surface-authority {
  margin: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.aera-collab-section {
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.24));
  border-radius: 10px;
  padding: 8px 12px;
}
.aera-collab-section > summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.aera-collab-section-count {
  border-radius: 999px;
  background: var(--dsw-alias-fill-primary, rgba(127, 127, 127, 0.16));
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  padding: 1px 8px;
}
.aera-collab-lines,
.aera-collab-participants,
.aera-collab-activity,
.aera-collab-checkpoints,
.aera-collab-evidence,
.aera-collab-files,
.aera-collab-unrepresentable { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.aera-collab-line { border-radius: 8px; }
.aera-collab-line-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.22));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 8px 10px;
}
.aera-collab-line-head:hover { background: var(--dsw-alias-fill-primary, rgba(127, 127, 127, 0.1)); }
.aera-collab-line-caret { font-size: 10px; opacity: 0.7; }
.aera-collab-line-label { font-weight: 600; font-size: 12px; }
.aera-collab-line-participant,
.aera-collab-line-provenance { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aera-collab-line-provenance { margin-left: auto; letter-spacing: 0.04em; }
.aera-collab-line-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 4px 24px;
  border-left: 2px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.22));
  margin: 4px 0 0 12px;
}
.aera-collab-line-topology { margin: 0; font-size: 12px; line-height: 1.6; }
.aera-collab-line-conflict { margin: 0; font-size: 12px; color: var(--dsw-alias-label-warning, #d19a2f); }
.aera-collab-line-actions { display: flex; gap: 8px; }
.aera-collab-compare-toggle {
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.35));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 5px 12px;
}
.aera-collab-compare {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding: 10px;
  border-radius: 8px;
  background: var(--dsw-alias-fill-secondary, rgba(127, 127, 127, 0.07));
}
.aera-collab-compare-heading { margin: 0; font-size: 12px; font-weight: 600; }
.aera-collab-compare-banner,
.aera-collab-compare-direction { margin: 0; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aera-collab-compare-headline { margin: 0; font-size: 12px; font-weight: 600; }
.aera-collab-files,
.aera-collab-unrepresentable {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.18));
  border-radius: 6px;
  padding: 6px 8px;
}
.aera-collab-unrepresentable { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aera-collab-file { display: flex; gap: 8px; align-items: baseline; font-size: 11px; }
.aera-collab-file-kind { font-weight: 600; min-width: 68px; }
.aera-collab-file-path { font-family: var(--dsw-font-mono, ui-monospace, monospace); word-break: break-all; }
.aera-collab-file-counts,
.aera-collab-file-flag { color: var(--dsw-alias-label-secondary); }
.aera-collab-participant { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; font-size: 12px; }
.aera-collab-participant-name { font-weight: 600; }
.aera-collab-participant-kind {
  font-size: 10px;
  letter-spacing: 0.06em;
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--dsw-alias-fill-primary, rgba(127, 127, 127, 0.16));
}
.aera-collab-participant-status,
.aera-collab-activity-when,
.aera-collab-evidence-status { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aera-collab-activity-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; font-size: 12px; }
.aera-collab-activity-actor { font-weight: 600; }
.aera-collab-technical { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.aera-collab-technical > summary { cursor: pointer; }
.aera-collab-technical ul {
  list-style: none;
  margin: 4px 0 0;
  padding: 0 0 0 12px;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  word-break: break-all;
}
.aera-collab-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px;
  background: rgba(0, 0, 0, 0.42);
  pointer-events: auto;
  z-index: 40;
}
.aera-collab-overlay-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(100%, 760px);
  max-height: 100%;
  overflow-y: auto;
  padding: 18px 20px 24px;
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.3));
  border-radius: 14px;
  background: var(--dsw-alias-background-primary, #202124);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}
.aera-collab-overlay-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.aera-collab-overlay-title { margin: 0; font-size: 16px; font-weight: 600; }
.aera-collab-overlay-close {
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.35));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
}
.aera-collab-overlay-body { display: flex; flex-direction: column; gap: 12px; }
.aera-collab-overlay-body .aera-collab-panel,
.aera-collab-overlay-body .aera-collab-surface { padding-bottom: 0; }
.aera-collab-context-group { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.aera-collab-context-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.aera-collab-context-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.aera-collab-context-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; font-size: 12px; }
.aera-collab-context-status { font-size: 11px; color: var(--dsw-alias-label-secondary); letter-spacing: 0.03em; }
.aera-collab-context-source {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--dsw-alias-label-secondary);
  word-break: break-all;
}
.aera-collab-context-note { font-size: 11px; color: var(--dsw-alias-label-secondary); }
`

/** Install one scoped stylesheet; tolerate headless Client boot. */
export function installAeraCollabStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
