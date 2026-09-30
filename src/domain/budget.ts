/**
 * Season budget (pure): fees, travel, gear and the rest, with a total per
 * category and month, and progress against an optional season budget.
 */

export const EXPENSE_CATEGORIES = ["club_fees", "tournaments", "travel", "gear", "training", "food", "medical", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  club_fees: "Club fees", tournaments: "Tournaments", travel: "Travel and hotels", gear: "Gear and uniforms",
  training: "Private training and camps", food: "Food on the road", medical: "Physio and medical", other: "Other",
};

export interface Expense { id: string; date: string; category: ExpenseCategory; amount: number; note?: string }
export type ExpenseInput = Omit<Expense, "id">;

export function validateExpense(x: ExpenseInput): string[] {
  const e: string[] = [];
  if (!x || typeof x !== "object") return ["Body must be an object."];
  if (typeof x.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) e.push("date must be YYYY-MM-DD");
  if (!EXPENSE_CATEGORIES.includes(x.category)) e.push("category is not valid");
  if (typeof x.amount !== "number" || !Number.isFinite(x.amount) || x.amount <= 0 || x.amount > 100000) e.push("amount must be between 0 and 100,000");
  if (x.note !== undefined && (typeof x.note !== "string" || x.note.length > 120)) e.push("note must be under 120 characters");
  return e;
}

export interface BudgetSummary {
  from: string;
  to: string;
  total: number;
  plan: number | null;
  left: number | null;
  byCategory: { category: ExpenseCategory; label: string; total: number; share: number }[];
  byMonth: { month: string; total: number }[];
  expenses: Expense[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Season = Aug 1 to Jul 31 by default (fall and spring seasons together). */
export function seasonRange(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const start = m >= 8 ? y : y - 1;
  return { from: `${start}-08-01`, to: `${start + 1}-07-31` };
}

export function budgetSummary(expenses: Expense[], from: string, to: string, plan?: number): BudgetSummary {
  const list = expenses.filter((x) => x.date >= from && x.date <= to).sort((a, b) => b.date.localeCompare(a.date));
  const total = r2(list.reduce((a, x) => a + x.amount, 0));
  const cats = new Map<ExpenseCategory, number>();
  const months = new Map<string, number>();
  for (const x of list) {
    cats.set(x.category, (cats.get(x.category) || 0) + x.amount);
    months.set(x.date.slice(0, 7), (months.get(x.date.slice(0, 7)) || 0) + x.amount);
  }
  return {
    from, to, total,
    plan: plan ?? null,
    left: plan ? r2(plan - total) : null,
    byCategory: [...cats].sort((a, b) => b[1] - a[1]).map(([category, t]) => ({ category, label: CATEGORY_LABEL[category], total: r2(t), share: total ? Math.round((t / total) * 100) : 0 })),
    byMonth: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, t]) => ({ month, total: r2(t) })),
    expenses: list,
  };
}
