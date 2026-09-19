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
/*
 * Owner feedback on the first inline surface: the activity notes read as "a
 * wall of light… you can't even read it", and the changed-file counts were
 * "all over the place" rather than in one column. Sizes below are set for
 * reading prose, not for fitting the most rows on screen.
 */

/* --- recorded instants: never the thing that gets squeezed out ----------- */
.aera-collab-when {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.aera-collab-surface-provenance,
.aera-collab-compare-provenance {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.aera-collab-provenance-sep { opacity: 0.5; }

/* --- activity: one act per block, prose at a readable measure ------------ */
.aera-collab-activity { gap: 10px; }
.aera-collab-activity-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-primary, rgba(127, 127, 127, 0.2));
  border-radius: 10px;
  background: var(--dsw-alias-fill-secondary, rgba(127, 127, 127, 0.05));
}
.aera-collab-activity-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.aera-collab-activity-actor { font-size: 12px; font-weight: 600; }
.aera-collab-activity-when { flex: none; }
.aera-collab-activity-summary {
  margin: 0;
  max-width: 78ch;
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.aera-collab-activity-detail {
  margin: 0;
  max-width: 78ch;
  font-size: 12px;
  line-height: 1.7;
  color: var(--dsw-alias-label-secondary);
}
.aera-collab-activity-more {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-link, #7aa2f7);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 0;
  text-decoration: underline;
}

/* --- changed files: kind, path, and counts in one aligned column --------- */
.aera-collab-file {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr) 104px;
  gap: 12px;
  align-items: baseline;
  padding: 3px 0;
  font-size: 12px;
  line-height: 1.6;
}
.aera-collab-file-kind { font-weight: 600; letter-spacing: 0.01em; }
.aera-collab-kind-added { color: var(--dsw-alias-label-success, #4fb06d); }
.aera-collab-kind-removed { color: var(--dsw-alias-label-error, #e5534b); }
.aera-collab-kind-modified { color: var(--dsw-alias-label-warning, #d9a441); }
.aera-collab-kind-renamed { color: var(--dsw-alias-label-link, #7aa2f7); }
.aera-collab-file-path {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}
.aera-collab-file-previous { opacity: 0.65; }
.aera-collab-file-arrow { opacity: 0.65; padding: 0 5px; }
.aera-collab-file-flag {
  display: inline-block;
  margin-left: 8px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--dsw-alias-fill-primary, rgba(127, 127, 127, 0.16));
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 10px;
  white-space: nowrap;
}
.aera-collab-flag-conflict {
  background: rgba(229, 83, 75, 0.16);
  color: var(--dsw-alias-label-error, #e5534b);
}
/* One column, right-aligned, tabular figures, so every row lines up. */
.aera-collab-file-counts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.aera-collab-count-added { color: var(--dsw-alias-label-success, #4fb06d); }
.aera-collab-count-removed { color: var(--dsw-alias-label-error, #e5534b); }
.aera-collab-count-raw { color: var(--dsw-alias-label-secondary); }

/* --- the rest, sized for reading ---------------------------------------- */
.aera-collab-files { max-height: 420px; }
.aera-collab-checkpoint-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}
.aera-collab-participant { font-size: 12.5px; line-height: 1.6; }
.aera-collab-participant-status { font-size: 11.5px; }
.aera-collab-line-topology { font-size: 12.5px; line-height: 1.7; }
.aera-collab-line-conflict { font-size: 12.5px; line-height: 1.7; }
.aera-collab-status { font-size: 12px; line-height: 1.7; }
.aera-collab-section > summary { font-size: 12px; }

/*
 * WO-AERA-COLLAB-DURABLE-...-CHECKPOINTS-001 §41-§46.
 *
 * Every rule here does one job: make the institutional facts legible without
 * changing the ratified composition. The owner's original complaint about the
 * first surface was "a wall of light… you can't even read it", so the new
 * material is blocked, spaced and given a readable measure rather than being
 * added as more inline spans in an already dense row.
 */

/* §41: lineage and target as two quiet, separate lines under the label. */
.aera-collab-line-lineage,
.aera-collab-line-target,
.aera-collab-line-checkpoint {
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.88;
  margin: 2px 0 0;
}
.aera-collab-line-lifecycle {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
}

/* §42: a checkpoint is a card, not a one-line log entry. */
.aera-collab-checkpoint-row { display: block; padding: 8px 0; }
.aera-collab-checkpoint-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}
.aera-collab-checkpoint-label { font-weight: 600; font-size: 12.5px; }
.aera-collab-checkpoint-origin,
.aera-collab-checkpoint-who { font-size: 11.5px; opacity: 0.8; }
.aera-collab-checkpoint-summary {
  font-size: 12.5px;
  line-height: 1.7;
  max-width: 70ch;
  margin: 4px 0 0;
}

/* §43: a block reads as one unit; its members keep their own rhythm. */
.aera-collab-blocks { list-style: none; margin: 0; padding: 0; }
.aera-collab-block { margin: 0 0 6px; }
.aera-collab-block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  cursor: pointer;
}
.aera-collab-block-title { font-weight: 600; font-size: 12.5px; }
.aera-collab-block-range,
.aera-collab-block-participants { font-size: 11.5px; opacity: 0.8; }
.aera-collab-block-count {
  font-size: 11px;
  opacity: 0.85;
  padding: 0 6px;
  border-radius: 8px;
  border: 1px solid currentColor;
}
.aera-collab-raw-activity > summary,
.aera-collab-evidence-raw > summary { font-size: 11.5px; opacity: 0.8; cursor: pointer; }

/* §46: the CLASS leads the card, so the kind of claim reads first. */
.aera-collab-evidence-cards { list-style: none; margin: 0; padding: 0; }
.aera-collab-evidence-card { padding: 8px 0; }
.aera-collab-evidence-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}
.aera-collab-evidence-class {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 600;
}
.aera-collab-evidence-outcome { font-size: 11px; font-weight: 600; }
.aera-collab-evidence-subject {
  font-size: 12.5px;
  line-height: 1.7;
  max-width: 70ch;
  margin: 3px 0 0;
}
.aera-collab-evidence-actor {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
  opacity: 0.8;
  margin: 2px 0 0;
}
/* An interpretation must never be mistaken for an observation at a glance. */
.aera-collab-evidence-analytical {
  font-size: 11.5px;
  line-height: 1.7;
  max-width: 70ch;
  opacity: 0.9;
  margin: 4px 0 0;
  padding-left: 8px;
  border-left: 2px solid currentColor;
}

/* §44/§45: a decision opens into its context. */
.aera-collab-decisions,
.aera-collab-discussions { list-style: none; margin: 0; padding: 0; }
.aera-collab-decision { margin: 0 0 6px; }
.aera-collab-decision-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  cursor: pointer;
}
.aera-collab-decision-subject { font-weight: 600; font-size: 12.5px; }
.aera-collab-decision-selected { font-size: 12px; }
.aera-collab-decision-status {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.8;
}
.aera-collab-decision-actors {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11.5px;
  opacity: 0.85;
  margin: 4px 0 0;
}
.aera-collab-decision-rationale,
.aera-collab-decision-superseded {
  font-size: 12.5px;
  line-height: 1.7;
  max-width: 70ch;
  margin: 6px 0 0;
}
.aera-collab-decision-facts { margin: 6px 0 0; font-size: 12px; line-height: 1.7; }
.aera-collab-decision-facts-label {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
}
.aera-collab-decision-facts ul { margin: 2px 0 0; padding-left: 18px; max-width: 70ch; }
/* §21, quiet but always present. */
.aera-collab-decision-not-a-fact {
  font-size: 11.5px;
  line-height: 1.7;
  max-width: 70ch;
  opacity: 0.8;
  margin: 8px 0 0;
  font-style: italic;
}
.aera-collab-discussion { padding: 6px 0; font-size: 12.5px; line-height: 1.7; }
.aera-collab-discussion-subject { font-weight: 600; }
.aera-collab-discussion-count { font-size: 11.5px; opacity: 0.8; margin-left: 8px; }
.aera-collab-discussion-entry { max-width: 70ch; margin: 4px 0 0; opacity: 0.9; }
.aera-collab-participant-contribution { font-size: 11.5px; opacity: 0.9; }

/* §47: a corrected record is marked, and the original stays one click away. */
.aera-collab-corrected {
  margin: 6px 0 0;
  padding-left: 8px;
  border-left: 2px solid currentColor;
}
.aera-collab-corrected-note {
  font-size: 12px;
  line-height: 1.7;
  max-width: 70ch;
  margin: 0;
  font-weight: 600;
}
.aera-collab-corrected-original > summary { font-size: 11.5px; opacity: 0.8; cursor: pointer; }
.aera-collab-corrected-original p { font-size: 11.5px; line-height: 1.7; max-width: 70ch; opacity: 0.9; }

@media (max-width: 720px) {
  /* Below this the three-column file row stops helping; keep the counts on
     their own line rather than crushing the path. */
  .aera-collab-file { grid-template-columns: 82px minmax(0, 1fr); }
  .aera-collab-file-counts { grid-column: 1 / -1; justify-content: flex-start; }
}

/*
 * §50 — enough visual structure to tell that messages are messages, state
 * cards are state cards, and technical data is subordinate. Explicitly NOT a
 * polish pass: no animation, no bespoke palette, no spacing tuning. Everything
 * below uses the host's own design tokens so it inherits the product's theme
 * rather than inventing one.
 */
.aera-collab-mode { display: flex; gap: 4px; padding: 8px 12px 0; }
.aera-collab-mode-tab {
  border: 0; background: transparent; cursor: pointer; padding: 6px 12px;
  border-radius: 6px 6px 0 0; color: var(--dsw-alias-text-l2, inherit); font-size: 13px;
}
.aera-collab-mode-tab-on {
  background: var(--dsw-alias-bg-l1, rgba(127,127,127,.12));
  color: var(--dsw-alias-text-l1, inherit); font-weight: 600;
}
.aera-collab-prepare-state { margin: 8px 12px; }

/*
 * Collab inside the details column (controller ruling, Option B).
 *
 * The column is roughly 300-520px, so the same content has to survive being
 * narrow. Nothing is hidden and nothing is restyled into a different surface:
 * the padding tightens, the header wraps, and the Compare table scrolls inside
 * itself rather than pushing the column wider.
 */
.aera-collab-in-details { min-width: 0; height: 100%; overflow-y: auto; }
.aera-collab-in-details .aera-collab-mode { padding: 6px 8px 0; }
.aera-collab-in-details .aera-rail { padding: 8px 10px 14px; }
.aera-collab-in-details .aera-collab-head { flex-wrap: wrap; gap: 6px; }
.aera-collab-in-details table { display: block; overflow-x: auto; max-width: 100%; }

/*
 * The Details tab's unobtrusive indicator, from the patched panel. A dot, at
 * the host's own muted accent: a tool selection that lands while Collaborate
 * is showing should be noticeable on a glance back, not demand attention.
 */
[data-details-indicator] {
  margin-left: 6px; font-size: 10px; line-height: 1;
  color: var(--dsw-alias-text-l3, #888);
}
[data-details-pending] { font-weight: 600; }

/* --- the rail ---------------------------------------------------------- */
.aera-rail { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 16px; min-width: 0; }
.aera-rail-head { display: flex; flex-direction: column; gap: 4px; }
.aera-rail-title { margin: 0; font-size: 15px; font-weight: 600; }
.aera-rail-about, .aera-rail-delivery {
  margin: 0; font-size: 12px; color: var(--dsw-alias-text-l3, #888); line-height: 1.45;
}
.aera-rail-participants { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.aera-rail-participants li { display: flex; align-items: baseline; gap: 5px; font-size: 12px; }
.aera-rail-person { font-weight: 600; }
.aera-rail-person-note { color: var(--dsw-alias-text-l3, #888); }
.aera-rail-switch { display: flex; gap: 6px; align-items: center; font-size: 12px; }

/*
 * §9 — a message is a speaker and then what they said. Own messages sit right,
 * others left, which is the oldest and least surprising convention there is.
 */
.aera-rail-stream { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.aera-rail-msg {
  max-width: 88%; align-self: flex-start; padding: 8px 10px; border-radius: 10px;
  background: var(--dsw-alias-bg-l1, rgba(127,127,127,.10)); min-width: 0;
}
.aera-rail-msg-mine { align-self: flex-end; background: var(--dsw-alias-bg-l2, rgba(80,130,255,.14)); }
/* An agent is visibly a different kind of speaker, by border not by colour alone. */
.aera-rail-msg-agent { border-left: 3px solid var(--dsw-alias-border-l2, #777); }
.aera-rail-msg-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.aera-rail-msg-who { font-weight: 600; font-size: 13px; }
.aera-rail-msg-badge {
  font-size: 10px; letter-spacing: .04em; text-transform: uppercase;
  padding: 1px 5px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l2, #777);
}
.aera-rail-msg-intent { font-size: 11px; color: var(--dsw-alias-text-l3, #888); }
/* §9: subordinate, and it says so by being small and last. */
.aera-rail-msg-when, .aera-rail-when { font-size: 11px; color: var(--dsw-alias-text-l3, #888); }
.aera-rail-msg-analysis { margin: 4px 0 0; font-size: 11px; font-style: italic; color: var(--dsw-alias-text-l3, #888); }
.aera-rail-msg-body { margin: 4px 0 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.aera-rail-msg-refs { list-style: none; margin: 6px 0 0; padding: 0; font-size: 11px; }

/* --- §13 the state card ------------------------------------------------ */
.aera-rail-state-card {
  margin-top: 8px; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, #777); background: var(--dsw-alias-bg-base, transparent);
}
.aera-rail-state-head { display: flex; flex-direction: column; gap: 1px; }
.aera-rail-state-title { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--dsw-alias-text-l3, #888); }
.aera-rail-state-operands { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.aera-rail-state-facts { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; }
.aera-rail-state-captured { margin: 6px 0 0; font-size: 11px; color: var(--dsw-alias-text-l3, #888); }
.aera-rail-state-moved { margin: 4px 0 0; font-size: 12px; font-weight: 600; }
.aera-rail-state-steady, .aera-rail-state-live { margin: 4px 0 0; font-size: 12px; color: var(--dsw-alias-text-l2, inherit); }
.aera-rail-state-actions { display: flex; gap: 6px; margin-top: 8px; }

/* --- §14 the inspector: over the conversation, never instead of it ------ */
.aera-rail-inspector {
  position: sticky; bottom: 0; margin-top: 10px; padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2, #777); border-radius: 10px;
  background: var(--dsw-alias-bg-base, #111);
}
.aera-rail-inspector-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 13px; }
.aera-rail-inspector-operands { margin: 6px 0 0; font-size: 12px; overflow-wrap: anywhere; }

/* --- §10 composer ------------------------------------------------------- */
.aera-rail-composer { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.aera-rail-composer textarea { width: 100%; resize: vertical; font: inherit; font-size: 13px; padding: 6px 8px; box-sizing: border-box; }
.aera-rail-composer-actions { display: flex; gap: 6px; }
.aera-rail-error { margin: 0; font-size: 12px; }
.aera-rail-empty { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }

/* §44 — forensic detail exists, collapsed, and never leads. */
.aera-rail-technical { margin-top: 6px; font-size: 11px; color: var(--dsw-alias-text-l3, #888); }
.aera-rail-technical summary { cursor: pointer; }
.aera-rail-technical ul { list-style: none; margin: 4px 0 0; padding: 0; }
.aera-rail-technical code { overflow-wrap: anywhere; }

/* --- Record: institutional history, deliberately not a message surface -- */
.aera-record { display: flex; flex-direction: column; gap: 12px; padding: 10px 12px 16px; }
.aera-record-lede { margin: 0; font-size: 12px; color: var(--dsw-alias-text-l3, #888); }
.aera-record-category { border-top: 1px solid var(--dsw-alias-border-l2, #444); padding-top: 8px; }
.aera-record-category-head { display: flex; gap: 8px; align-items: baseline; margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.aera-record-count { font-size: 11px; padding: 0 6px; border-radius: 8px; background: var(--dsw-alias-bg-l1, rgba(127,127,127,.15)); }
.aera-record-empty { margin: 0; font-size: 12px; color: var(--dsw-alias-text-l3, #888); }
.aera-record-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.aera-record-list > li { display: flex; flex-direction: column; gap: 2px; }
.aera-record-name { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.aera-record-sub { font-size: 11px; color: var(--dsw-alias-text-l3, #888); }
.aera-record-note { margin: 2px 0 0; font-size: 12px; line-height: 1.45; }
.aera-record-caveat { margin: 2px 0 0; font-size: 11px; font-style: italic; color: var(--dsw-alias-text-l3, #888); }
.aera-record-class { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; align-self: flex-start; padding: 1px 5px; border: 1px solid var(--dsw-alias-border-l2, #777); border-radius: 4px; }
.aera-record-observed { border-top: 1px dashed var(--dsw-alias-border-l2, #444); padding-top: 8px; opacity: .85; }
.aera-record-foot { margin: 0; font-size: 11px; color: var(--dsw-alias-text-l3, #888); }
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
