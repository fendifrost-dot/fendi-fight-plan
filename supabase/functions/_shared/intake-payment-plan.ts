import type { IntakeClientRecord } from "./intake-types.ts";

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildInitialPaymentPlan(params: {
  netTotal: number;
  depositAmount: number;
  depositDueBy: string;
  scheduleNote?: string;
  /** Default: biweekly after deposit for remainder */
  installmentIntervalDays?: number;
}): NonNullable<IntakeClientRecord["paymentPlan"]> {
  const { netTotal, depositAmount, depositDueBy } = params;
  const remainder = Math.max(0, netTotal - depositAmount);
  const installments: NonNullable<IntakeClientRecord["paymentPlan"]>["installments"] = [];
  if (remainder > 0) {
    const n = 2;
    const each = Math.round((remainder / n) * 100) / 100;
    let running = remainder;
    const interval = params.installmentIntervalDays ?? 14;
    for (let i = 1; i <= n; i++) {
      const amt = i === n ? Math.round(running * 100) / 100 : each;
      running = Math.round((running - amt) * 100) / 100;
      installments.push({
        installmentNumber: i,
        amount: amt,
        dueDate: addDaysIso(depositDueBy, interval * i),
      });
    }
  }
  return recomputePaymentPlanView({
    totalAgreed: netTotal,
    deposit: { amount: depositAmount, dueBy: depositDueBy },
    installments,
    paymentsReceived: [],
    remainingBalance: netTotal,
    status: "current",
  });
}

export function recomputePaymentPlanView(
  plan: NonNullable<IntakeClientRecord["paymentPlan"]>,
): NonNullable<IntakeClientRecord["paymentPlan"]> {
  const paidFromList = plan.paymentsReceived.reduce((s, p) => s + p.amount, 0);
  let remaining = plan.totalAgreed - paidFromList;
  if (remaining < 0) remaining = 0;
  const paidInFull = remaining <= 0.009;
  return {
    ...plan,
    remainingBalance: Math.round(remaining * 100) / 100,
    status: paidInFull ? "paid_in_full" : plan.status,
  };
}

export function applyPaymentReceived(
  plan: NonNullable<IntakeClientRecord["paymentPlan"]>,
  amount: number,
  method: string,
  date: string,
  reference?: string,
): NonNullable<IntakeClientRecord["paymentPlan"]> {
  const paymentsReceived = [
    ...plan.paymentsReceived,
    { date, amount, method, reference },
  ];
  let pool = amount;
  let deposit = { ...plan.deposit };
  const installments = plan.installments.map((inst) => ({ ...inst }));

  if (!deposit.receivedAt && pool > 0) {
    const need = deposit.amount;
    if (pool >= need) {
      deposit.receivedAt = date;
      pool = Math.round((pool - need) * 100) / 100;
    }
  }

  for (const inst of installments) {
    if (pool <= 0) break;
    const already = inst.receivedAmount ?? 0;
    const need = Math.max(0, inst.amount - already);
    if (need <= 0) continue;
    const apply = Math.min(pool, need);
    inst.receivedAmount = Math.round((already + apply) * 100) / 100;
    if (inst.receivedAmount >= inst.amount - 0.009) {
      inst.receivedAt = date;
    }
    pool = Math.round((pool - apply) * 100) / 100;
  }

  const next = recomputePaymentPlanView({
    ...plan,
    deposit,
    installments,
    paymentsReceived,
    status: plan.status,
  });
  return next;
}
