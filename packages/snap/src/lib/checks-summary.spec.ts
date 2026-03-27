/**
 * @file Unit tests for {@link formatSummaryStatus} and {@link toChecksSummary}.
 */
import { describe, expect, it } from '@jest/globals';

import {
  formatSummaryStatus,
  toChecksSummary,
  type CheckProgressInput,
} from './checks-summary';

describe('formatSummaryStatus', () => {
  it('returns Unverified for undefined or empty', () => {
    expect(formatSummaryStatus(undefined)).toBe('Unverified');
    expect(formatSummaryStatus('')).toBe('Unverified');
  });

  it('returns Preparing for preparation, running, pending', () => {
    expect(formatSummaryStatus('preparation')).toBe('Preparing');
    expect(formatSummaryStatus('running')).toBe('Preparing');
    expect(formatSummaryStatus('pending')).toBe('Preparing');
  });

  it('returns Approval Pending for approval_pending', () => {
    expect(formatSummaryStatus('approval_pending')).toBe('Approval Pending');
  });

  it('returns Approved for approved and onchain statuses', () => {
    expect(formatSummaryStatus('approved')).toBe('Approved');
    expect(formatSummaryStatus('onchain_tx_processing')).toBe('Approved');
    expect(formatSummaryStatus('onchain_tx_success')).toBe('Approved');
    expect(formatSummaryStatus('onchain_tx_failed')).toBe('Approved');
  });

  it('returns Failed for rejected, failed', () => {
    expect(formatSummaryStatus('rejected')).toBe('Failed');
    expect(formatSummaryStatus('failed')).toBe('Failed');
  });

  it('returns Canceled for canceled', () => {
    expect(formatSummaryStatus('canceled')).toBe('Canceled');
  });

  it('returns Error for error', () => {
    expect(formatSummaryStatus('error')).toBe('Error');
  });

  it('returns Timeout for timeout', () => {
    expect(formatSummaryStatus('timeout')).toBe('Timeout');
  });

  it('returns status as-is for unknown values', () => {
    expect(formatSummaryStatus('unknown_status')).toBe('unknown_status');
  });
});

describe('toChecksSummary', () => {
  it('returns check status fields with empty progress', () => {
    const progress: CheckProgressInput = {};
    const result = toChecksSummary(progress);
    expect(result.checkStatusLabel).toBe('Check status');
    expect(result.checkStatusValue).toBe('Unverified');
    expect(result.checkStatusRawValue).toBe('');
    expect(result.igChecks).toBeUndefined();
    expect(result.egChecks).toBeUndefined();
    expect(result.vgChecks).toBeUndefined();
  });

  it('returns formatted status from progress.status', () => {
    expect(toChecksSummary({ status: 'approved' }).checkStatusValue).toBe(
      'Approved',
    );
    expect(toChecksSummary({ status: 'approved' }).checkStatusRawValue).toBe(
      'approved',
    );
    expect(toChecksSummary({ status: 'running' }).checkStatusValue).toBe(
      'Preparing',
    );
  });

  it('returns igChecks, egChecks, vgChecks when progress.checks is present', () => {
    const progress: CheckProgressInput = {
      status: 'approved',
      checks: {
        parseCheck: 'passed',
        whitelistCheck: 'passed',
        blacklistCheck: 'passed',
        llmCheck: 'passed',
        policyCheck: 'passed',
        approve1Check: 'passed',
        approve2Check: 'passed',
        approve3Check: 'passed',
      },
    };
    const result = toChecksSummary(progress);
    expect(result.igChecks).toEqual([
      { label: 'Parse', status: 'passed' },
      { label: 'Whitelist', status: 'passed' },
      { label: 'LLM', status: 'passed' },
      { label: 'Policy', status: 'passed' },
    ]);
    expect(result.egChecks).toEqual([{ label: 'Blacklist', status: 'passed' }]);
    expect(result.vgChecks).toEqual([
      { label: 'Approve 1', status: 'passed' },
      { label: 'Approve 2', status: 'passed' },
      { label: 'Approve 3', status: 'passed' },
    ]);
  });

  it('handles partial checks', () => {
    const progress: CheckProgressInput = {
      status: 'running',
      checks: {
        parseCheck: 'passed',
        whitelistCheck: 'pending',
      },
    };
    const result = toChecksSummary(progress);
    expect(result.checkStatusValue).toBe('Preparing');
    expect(result.igChecks).toEqual([
      { label: 'Parse', status: 'passed' },
      { label: 'Whitelist', status: 'pending' },
      { label: 'LLM', status: undefined },
      { label: 'Policy', status: undefined },
    ]);
    expect(result.egChecks).toEqual([
      { label: 'Blacklist', status: undefined },
    ]);
    expect(result.vgChecks).toEqual([
      { label: 'Approve 1', status: undefined },
      { label: 'Approve 2', status: undefined },
      { label: 'Approve 3', status: undefined },
    ]);
  });
});
