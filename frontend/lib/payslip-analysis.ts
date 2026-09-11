export type PayslipFieldKey =
  | 'employeeName'
  | 'employerName'
  | 'periodStart'
  | 'periodEnd'
  | 'netBeforeTaxCents'
  | 'netPaidCents'
  | 'netTaxableCents';
export interface PayslipField {
  value: string | number | null;
  page: number | null;
  evidence: string | null;
}
export interface PayslipAnalysisView {
  documentId: string;
  revision: number;
  status: 'NOT_REQUESTED' | 'UNAVAILABLE' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  configured: boolean;
  message: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  retryAfterSeconds: number;
  canRequest: boolean;
  extraction:
    | ({ kind: 'PAYSLIP' | 'OTHER' | 'UNREADABLE'; warnings: string[] } & Record<
        PayslipFieldKey,
        PayslipField
      >)
    | null;
  checks: {
    code: string;
    tone: 'match' | 'attention' | 'unknown';
    label: string;
    detail: string;
  }[];
}
