/** Aera Collab entry-point styles, installed independently of presentation mode. */

const STYLE_ID = 'aera-collab-entry-styles'

const CSS = `
.aera-collab-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: min(100%, 880px);
  padding: 20px 0 36px;
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
