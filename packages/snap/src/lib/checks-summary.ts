/**
 * Input shape compatible with `CheckProgress` (the Snap index passes `CheckProgress` here).
 */
export type CheckProgressInput = {
  status?: string;
  checks?: {
    parseCheck?: string;
    whitelistCheck?: string;
    blacklistCheck?: string;
    llmCheck?: string;
    policyCheck?: string;
    approve1Check?: string;
    approve2Check?: string;
    approve3Check?: string;
  };
};

export type ToChecksSummaryResult = {
  checkStatusLabel: string;
  checkStatusValue: string;
  checkStatusRawValue: string;
  igChecks?: { label: string; status?: string }[];
  egChecks?: { label: string; status?: string }[];
  vgChecks?: { label: string; status?: string }[];
};

/**
 * Maps a raw API check status to a short human-readable label for the transaction insight UI.
 * @param status - Optional raw status from the checks API.
 * @returns Localized-style label string (e.g. `Preparing`, `Approved`).
 */
export function formatSummaryStatus(status?: string): string {
  if (!status) {
    return 'Unverified';
  }
  if (
    status === 'preparation' ||
    status === 'running' ||
    status === 'pending'
  ) {
    return 'Preparing';
  }
  if (status === 'approval_pending') {
    return 'Approval Pending';
  }
  if (status === 'approved') {
    return 'Approved';
  }
  if (status === 'rejected' || status === 'failed') {
    return 'Failed';
  }
  if (status === 'canceled') {
    return 'Canceled';
  }
  if (status === 'error') {
    return 'Error';
  }
  if (status === 'timeout') {
    return 'Timeout';
  }
  if (
    status === 'onchain_tx_processing' ||
    status === 'onchain_tx_success' ||
    status === 'onchain_tx_failed'
  ) {
    return 'Approved';
  }
  return status;
}

/**
 * Pure function: converts `CheckProgress`-like input into showcase summary fields (easy to unit test).
 * @param progress - Check progress payload from the API or polling layer.
 * @returns Structured labels and per-check rows for IG / EG / VG sections.
 */
export function toChecksSummary(
  progress: CheckProgressInput,
): ToChecksSummaryResult {
  const checkStatusRawValue = progress.status ?? '';
  const checkStatusValue = formatSummaryStatus(progress.status);
  let igChecks: ToChecksSummaryResult['igChecks'];
  let egChecks: ToChecksSummaryResult['egChecks'];
  let vgChecks: ToChecksSummaryResult['vgChecks'];
  if (progress.checks) {
    const { checks } = progress;
    igChecks = [
      { label: 'Parse', status: checks.parseCheck },
      { label: 'Whitelist', status: checks.whitelistCheck },
      { label: 'LLM', status: checks.llmCheck },
      { label: 'Policy', status: checks.policyCheck },
    ];
    egChecks = [{ label: 'Blacklist', status: checks.blacklistCheck }];
    vgChecks = [
      { label: 'Approve 1', status: checks.approve1Check },
      { label: 'Approve 2', status: checks.approve2Check },
      { label: 'Approve 3', status: checks.approve3Check },
    ];
  }
  return {
    checkStatusLabel: 'Check status',
    checkStatusValue,
    checkStatusRawValue,
    igChecks,
    egChecks,
    vgChecks,
  };
}
