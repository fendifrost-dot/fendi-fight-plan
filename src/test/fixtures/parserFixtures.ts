/**
 * Parser Regression Test Fixtures
 *
 * Each fixture simulates the structured JSON that the AI model would return
 * after parsing a specific report type. We test the post-processing,
 * validation, classification, and invariant checks against these fixtures.
 */

import type { ParsedReport, Tradeline, Collection, Inquiry, ReportMetadata } from '@/lib/parser-rules';

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE 1: Experian ACR
// Known bug case: RESURGENT/LVNV FUNDING must be detected
// ═══════════════════════════════════════════════════════════════════════════

export const EXPERIAN_ACR_METADATA: ReportMetadata = {
  bureau_names: ['experian'],
  report_type: 'single',
  consumer_name: 'JOHN Q CONSUMER',
  report_date: '01/15/2025',
  accounts_ever_late: 4,
  collections_count: 2,
  public_records_count: 0,
};

export const EXPERIAN_ACR: ParsedReport = {
  metadata: EXPERIAN_ACR_METADATA,
  derogatory_accounts: [
    {
      creditor_name: 'RESURGENT/LVNV FUNDING',
      account_number: '6124XXXX1234',
      account_type: 'Individual',
      date_opened: '03/2021',
      date_closed: null,
      balance: '$2,847',
      past_due_amount: '$2,847',
      status_as_reported: 'Collection',
      payment_grid_codes: null,
      remarks: 'Purchased by another lender',
      confidence: 'high',
      bureaus: ['experian'],
      date_first_delinquency: '09/2020',
      section_header: 'Potentially Negative Items',
      derogatory_triggers: ['collection'],
    },
    {
      creditor_name: 'CAPITAL ONE BANK',
      account_number: '5178XXXX5678',
      account_type: 'Individual',
      date_opened: '06/2019',
      date_closed: '02/2023',
      balance: '$0',
      past_due_amount: '$0',
      status_as_reported: 'Charged Off',
      payment_grid_codes: '1 1 1 CO CO CO',
      remarks: 'Profit and loss write-off',
      confidence: 'high',
      bureaus: ['experian'],
      date_first_delinquency: '08/2022',
      section_header: 'Potentially Negative Items',
      derogatory_triggers: ['charged off', 'profit and loss write-off'],
    },
    {
      creditor_name: 'AFFIRM INC',
      account_number: 'AFFIRM-XX9012',
      account_type: 'Individual',
      date_opened: '11/2022',
      date_closed: '05/2023',
      balance: '$0',
      past_due_amount: '$0',
      status_as_reported: 'Closed',
      payment_grid_codes: '1 1 2 1 1 1',
      remarks: '2 late payments',
      confidence: 'high',
      bureaus: ['experian'],
      date_first_delinquency: null,
      section_header: 'Potentially Negative Items',
      derogatory_triggers: ['late payments'],
    },
    {
      creditor_name: 'SYNCHRONY BANK',
      account_number: '6019XXXX3456',
      account_type: 'Individual',
      date_opened: '01/2020',
      date_closed: null,
      balance: '$1,234',
      past_due_amount: '$156',
      status_as_reported: '60 Days Past Due',
      payment_grid_codes: '1 1 1 1 3 2',
      remarks: null,
      confidence: 'high',
      bureaus: ['experian'],
      date_first_delinquency: '11/2024',
      section_header: 'Potentially Negative Items',
      derogatory_triggers: ['60 days late', 'past due'],
    },
  ],
  collections: [
    {
      collection_agency: 'RESURGENT/LVNV FUNDING',
      creditor_name: 'RESURGENT/LVNV FUNDING',
      original_creditor: 'CREDIT ONE BANK',
      account_number: '6124XXXX1234',
      date_opened: '03/2021',
      balance: '$2,847',
      status: 'Open',
      bureaus: ['experian'],
    },
    {
      collection_agency: 'MIDLAND CREDIT MGMT',
      creditor_name: 'MIDLAND CREDIT MGMT',
      original_creditor: 'SYNCHRONY BANK',
      account_number: 'MCM-XX7890',
      date_opened: '07/2022',
      balance: '$945',
      status: 'Open',
      bureaus: ['experian'],
    },
  ],
  charge_offs: [],
  inquiries: [
    { creditor_name: 'CAPITAL ONE', date: '01/10/2025', type: 'hard', bureaus: ['experian'] },
    { creditor_name: 'WELLS FARGO', date: '12/15/2024', type: 'hard', bureaus: ['experian'] },
  ],
  public_records: [],
  inaccurate_names: [],
  inaccurate_addresses: [],
  inaccurate_employers: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE 2: Equifax ACR
// Known bug case: Aidvantage accounts *0110, *0120, *0130, *0140
// ═══════════════════════════════════════════════════════════════════════════

export const EQUIFAX_ACR_METADATA: ReportMetadata = {
  bureau_names: ['equifax'],
  report_type: 'single',
  consumer_name: 'JANE M BORROWER',
  report_date: '02/01/2025',
  accounts_ever_late: 5,
  collections_count: 1,
  public_records_count: 1,
};

export const EQUIFAX_ACR: ParsedReport = {
  metadata: EQUIFAX_ACR_METADATA,
  derogatory_accounts: [
    {
      creditor_name: 'AIDVANTAGE',
      account_number: 'XXXX0110',
      account_type: 'Individual',
      date_opened: '08/2015',
      balance: '$12,450',
      past_due_amount: '$0',
      status_as_reported: '90 Days Late',
      payment_grid_codes: '1 1 1 4 3 2 1 1',
      bureaus: ['equifax'],
      section_header: 'Negative Accounts',
      derogatory_triggers: ['90 days late'],
    },
    {
      creditor_name: 'AIDVANTAGE',
      account_number: 'XXXX0120',
      account_type: 'Individual',
      date_opened: '08/2015',
      balance: '$8,900',
      past_due_amount: '$0',
      status_as_reported: '60 Days Late',
      payment_grid_codes: '1 1 1 3 2 1 1 1',
      bureaus: ['equifax'],
      section_header: 'Negative Accounts',
      derogatory_triggers: ['60 days late'],
    },
    {
      creditor_name: 'AIDVANTAGE',
      account_number: 'XXXX0130',
      account_type: 'Individual',
      date_opened: '01/2016',
      balance: '$15,200',
      past_due_amount: '$0',
      status_as_reported: '30 Days Late',
      payment_grid_codes: '1 1 2 1 1 1 1 1',
      bureaus: ['equifax'],
      section_header: 'Negative Accounts',
      derogatory_triggers: ['30 days late'],
    },
    {
      creditor_name: 'AIDVANTAGE',
      account_number: 'XXXX0140',
      account_type: 'Individual',
      date_opened: '01/2016',
      balance: '$11,750',
      past_due_amount: '$0',
      status_as_reported: '30 Days Late',
      payment_grid_codes: '1 2 1 1 1 1 1 1',
      bureaus: ['equifax'],
      section_header: 'Negative Accounts',
      derogatory_triggers: ['30 days late'],
    },
    {
      creditor_name: 'DISCOVER BANK',
      account_number: '6011XXXX9999',
      account_type: 'Individual',
      date_opened: '03/2018',
      date_closed: '11/2023',
      balance: '$0',
      past_due_amount: '$0',
      status_as_reported: 'Settled For Less Than Full Balance',
      bureaus: ['equifax'],
      section_header: 'Negative Accounts',
      derogatory_triggers: ['settled for less'],
    },
  ],
  collections: [
    {
      collection_agency: 'IC SYSTEM INC',
      original_creditor: 'VERIZON WIRELESS',
      account_number: 'ICS-XX4455',
      date_opened: '09/2023',
      balance: '$387',
      status: 'Open',
      bureaus: ['equifax'],
    },
  ],
  charge_offs: [],
  inquiries: [
    { creditor_name: 'TOYOTA MOTOR CREDIT', date: '01/20/2025', type: 'hard', bureaus: ['equifax'] },
  ],
  public_records: [
    {
      type: 'Bankruptcy',
      court_jurisdiction: 'US BKPT CT CENTRAL',
      filing_date: '06/15/2020',
      status: 'Discharged',
      amount: '$45,000',
      bureaus: ['equifax'],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE 3: Credit Karma / TransUnion (multi-bureau)
// ═══════════════════════════════════════════════════════════════════════════

export const CREDIT_KARMA_METADATA: ReportMetadata = {
  bureau_names: ['equifax', 'transunion'],
  report_type: 'credit_karma',
  consumer_name: 'ALEX P CONSUMER',
  accounts_ever_late: 3,
  collections_count: 1,
  public_records_count: 0,
};

export const CREDIT_KARMA_REPORT: ParsedReport = {
  metadata: CREDIT_KARMA_METADATA,
  derogatory_accounts: [
    {
      creditor_name: 'CHASE BANK',
      account_number: '4147XXXX8888',
      account_type: 'Individual',
      date_opened: '05/2020',
      balance: '$3,200',
      past_due_amount: '$450',
      status_as_reported: 'Past Due',
      bureaus: ['equifax'],
      bureau_status: { equifax: 'Past Due' },
      derogatory_triggers: ['past due'],
    },
    {
      creditor_name: 'CHASE BANK',
      account_number: '4147XXXX8888',
      account_type: 'Individual',
      date_opened: '05/2020',
      balance: '$3,200',
      past_due_amount: '$450',
      status_as_reported: 'Past Due',
      bureaus: ['transunion'],
      bureau_status: { transunion: 'Past Due' },
      derogatory_triggers: ['past due'],
    },
    {
      creditor_name: 'NAVY FEDERAL CU',
      account_number: 'NFCU-XX3344',
      account_type: 'Joint',
      date_opened: '02/2019',
      balance: '$750',
      past_due_amount: '$0',
      status_as_reported: 'Charge Off',
      bureaus: ['equifax'],
      bureau_status: { equifax: 'Charge Off' },
      derogatory_triggers: ['charge off'],
    },
    {
      creditor_name: 'NAVY FEDERAL CU',
      account_number: 'NFCU-XX3344',
      account_type: 'Joint',
      date_opened: '02/2019',
      balance: '$750',
      past_due_amount: '$0',
      status_as_reported: 'Charged Off',
      bureaus: ['transunion'],
      bureau_status: { transunion: 'Charged Off' },
      derogatory_triggers: ['charged off'],
    },
    // One account only on TransUnion
    {
      creditor_name: 'COMENITY BANK',
      account_number: 'COM-XXXX5566',
      account_type: 'Individual',
      date_opened: '09/2021',
      balance: '$0',
      past_due_amount: '$0',
      status_as_reported: '30 Days Late',
      payment_grid_codes: '1 1 1 2 1 1',
      bureaus: ['transunion'],
      bureau_status: { transunion: '30 Days Late' },
      derogatory_triggers: ['30 days late'],
    },
  ],
  collections: [
    {
      collection_agency: 'PORTFOLIO RECOVERY',
      original_creditor: 'SPRINT',
      account_number: 'PRA-XX7788',
      balance: '$612',
      status: 'Open',
      bureaus: ['equifax', 'transunion'],
    },
  ],
  charge_offs: [],
  inquiries: [],
  public_records: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE 4: Scanned PDF (low confidence, some UNEXTRACTABLE fields)
// ═══════════════════════════════════════════════════════════════════════════

export const SCANNED_PDF_METADATA: ReportMetadata = {
  bureau_names: ['experian'],
  report_type: 'single',
  consumer_name: 'UNEXTRACTABLE',
  accounts_ever_late: null, // summary not readable
  collections_count: null,
};

export const SCANNED_PDF_REPORT: ParsedReport = {
  metadata: SCANNED_PDF_METADATA,
  derogatory_accounts: [
    {
      creditor_name: 'WELLS FARGO',
      account_number: 'UNEXTRACTABLE',
      account_type: 'N/A',
      balance: '$4,500',
      status_as_reported: 'Derogatory',
      confidence: 'low',
      bureaus: ['experian'],
      section_header: 'Potentially Negative Items',
      derogatory_triggers: ['derogatory'],
    },
    {
      creditor_name: 'UNEXTRACTABLE',
      account_number: 'XXXX7777',
      balance: '$1,200',
      status_as_reported: 'Collection',
      confidence: 'low',
      bureaus: ['experian'],
      derogatory_triggers: ['collection'],
    },
  ],
  collections: [],
  charge_offs: [],
  inquiries: [],
  public_records: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE 5: Multi-page tradeline continuation
// Tests that a tradeline split across pages is NOT treated as two entries
// ═══════════════════════════════════════════════════════════════════════════

export const CONTINUATION_PAGE_1: Tradeline = {
  creditor_name: 'BANK OF AMERICA',
  account_number: '4400XXXX1111',
  account_type: 'Individual',
  date_opened: '04/2017',
  balance: '$6,300',
  status_as_reported: 'Late Payment',
  // payment grid continues on next page
  payment_grid_codes: null,
  bureaus: ['experian'],
  is_continuation: false,
};

export const CONTINUATION_PAGE_2: Tradeline = {
  // No creditor name → this is a continuation
  creditor_name: '',
  account_number: '',
  payment_grid_codes: '1 1 1 2 3 2 1 1 1 1 1 1 2 1 1 1 1 1',
  status_as_reported: null,
  bureaus: ['experian'],
  is_continuation: true,
};

export const CONTINUATION_MERGED: Tradeline = {
  creditor_name: 'BANK OF AMERICA',
  account_number: '4400XXXX1111',
  account_type: 'Individual',
  date_opened: '04/2017',
  balance: '$6,300',
  status_as_reported: 'Late Payment',
  payment_grid_codes: '1 1 1 2 3 2 1 1 1 1 1 1 2 1 1 1 1 1',
  bureaus: ['experian'],
  is_continuation: false,
  derogatory_triggers: ['late payment'],
};

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE 6: Report with summary counts only on page 1
// (tests validation gate with metadata present)
// ═══════════════════════════════════════════════════════════════════════════

export const SUMMARY_ONLY_METADATA: ReportMetadata = {
  bureau_names: ['transunion'],
  report_type: 'single',
  consumer_name: 'SARAH T CONSUMER',
  report_date: '03/01/2025',
  accounts_ever_late: 2,
  collections_count: 1,
  public_records_count: 0,
};

export const SUMMARY_COUNT_REPORT: ParsedReport = {
  metadata: SUMMARY_ONLY_METADATA,
  derogatory_accounts: [
    {
      creditor_name: 'US BANK',
      account_number: '4024XXXX2222',
      date_opened: '07/2020',
      balance: '$800',
      past_due_amount: '$0',
      status_as_reported: 'Late Payment',
      payment_grid_codes: '1 1 2 1 1',
      bureaus: ['transunion'],
      derogatory_triggers: ['late payment'],
    },
    {
      creditor_name: 'CITIBANK',
      account_number: '5412XXXX3333',
      date_opened: '01/2019',
      balance: '$0',
      past_due_amount: '$0',
      status_as_reported: 'Charge Off',
      bureaus: ['transunion'],
      derogatory_triggers: ['charge off'],
    },
  ],
  collections: [
    {
      collection_agency: 'ENHANCED RECOVERY',
      original_creditor: 'AT&T',
      account_number: 'ERC-XX6677',
      balance: '$234',
      status: 'Open',
      bureaus: ['transunion'],
    },
  ],
  charge_offs: [],
  inquiries: [
    { creditor_name: 'AMERICAN EXPRESS', date: '02/28/2025', type: 'hard', bureaus: ['transunion'] },
  ],
  public_records: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// Edge case fixtures for specific bug regression
// ═══════════════════════════════════════════════════════════════════════════

/** Past Due $0 must NOT be negative */
export const PAST_DUE_ZERO_TRADELINE: Tradeline = {
  creditor_name: 'DISCOVER',
  account_number: '6011XXXX4444',
  status_as_reported: 'Current',
  past_due_amount: '$0',
  balance: '$2,500',
  bureaus: ['experian'],
};

/** Past Due $0.00 must NOT be negative */
export const PAST_DUE_ZERO_DECIMAL_TRADELINE: Tradeline = {
  creditor_name: 'AMEX',
  account_number: '3782XXXX5555',
  status_as_reported: 'Current',
  past_due_amount: '$0.00',
  balance: '$1,000',
  bureaus: ['equifax'],
};

/** C/O in address must NOT trigger charge-off */
export const CO_IN_ADDRESS_TRADELINE: Tradeline = {
  creditor_name: 'SOME LENDER',
  account_number: 'SL-XX1234',
  status_as_reported: 'Current',
  block_text: 'Address: 123 Main St C/O John Smith, Anytown, ST 12345',
  bureaus: ['experian'],
};

/** C/O in status MUST trigger charge-off */
export const CO_IN_STATUS_TRADELINE: Tradeline = {
  creditor_name: 'ANOTHER LENDER',
  account_number: 'AL-XX5678',
  status_as_reported: 'C/O',
  bureaus: ['experian'],
};

/** "late" must NOT match "collateral" or "translated" */
export const FALSE_POSITIVE_TEXT = 'Collateral assignment for translated documents related to later review';

/** "late" MUST match "2 late payments" */
export const TRUE_POSITIVE_TEXT = 'Account has 2 late payments reported';

/** Closed account with negative indicator must still be included */
export const CLOSED_NEGATIVE_TRADELINE: Tradeline = {
  creditor_name: 'AFFIRM INC',
  account_number: 'AFF-XX9999',
  date_closed: '05/2023',
  status_as_reported: 'Closed',
  remarks: '2 late payments',
  bureaus: ['experian'],
  section_header: 'Potentially Negative Items',
};

/** Closed account WITHOUT negative indicator must NOT be included */
export const CLOSED_POSITIVE_TRADELINE: Tradeline = {
  creditor_name: 'DISCOVER',
  account_number: '6011XXXX8888',
  date_closed: '12/2023',
  status_as_reported: 'Paid/Closed',
  remarks: null,
  bureaus: ['equifax'],
  section_header: null,
};
