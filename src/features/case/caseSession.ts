/** The (synthetic) case/session shown throughout the POC. */
export const CASE = {
  reference: 'CR/2026/00421',
  court: 'District Court, Ernakulam',
  session: 'Witness Deposition',
  language: 'Malayalam',
} as const;

/** Filesystem-safe identifier, e.g. "CR-2026-00421_witness-deposition". */
export const CASE_SLUG = `${CASE.reference.replace(/\//g, '-')}_${CASE.session.toLowerCase().replace(/\s+/g, '-')}`;
