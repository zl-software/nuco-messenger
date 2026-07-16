// Abuse report submission (protocol 3.2, see PROTOCOL.md "Reports and bans"). A report
// is metadata only: the reported handle, a category, an optional short comment. Message
// content never leaves the sealed channel. Reports fail visibly instead of queueing: the
// report sheet keeps its state and the user retries.

import type { ReportCategory, ReportContext } from '@nuco/protocol';

import { getRelay } from './relay';

// Error codes the report sheet maps to a localized string; anything else falls back to
// the generic failure line. REPORT_UNSUPPORTED is client local (relay below 3.2).
export const REPORT_ERROR_CODES = ['REPORT_REJECTED', 'REPORT_UNSUPPORTED', 'RATE_LIMITED'] as const;

export async function submitReport(params: {
  handle: string;
  category: ReportCategory;
  comment?: string;
  context: ReportContext;
}): Promise<void> {
  const relay = getRelay();
  if (!relay) throw new Error('relay not started');
  const comment = params.comment?.trim();
  await relay.report({
    handle: params.handle,
    category: params.category,
    ...(comment ? { comment } : {}),
    context: params.context,
  });
}
