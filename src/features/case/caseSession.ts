/** The (synthetic) case/session shown throughout the POC. */
export const CASE = {
  /** Case ID (synthetic demo data). */
  reference: 'CR/2026/00421',
  name: 'State v. Accused — Witness Deposition',
  /** Courtroom session this workspace belongs to (synthetic demo data). */
  sessionId: 'SES-2026-11-16-WD-01',
  court: 'District Court, Ernakulam',
  session: 'Witness Deposition',
  language: 'Malayalam',
} as const;

/** Filesystem-safe identifier, e.g. "CR-2026-00421_witness-deposition". */
export const CASE_SLUG = `${CASE.reference.replace(/\//g, '-')}_${CASE.session.toLowerCase().replace(/\s+/g, '-')}`;
