export type Menu = {
  sku_code: "MN-AYM" | "MN-KRE" | "MN-CKJ" | string;
  menu_name: string;
  sell_price: number;
};

export type Branch = {
  branch_id: string;
  branch_name: string;
  menus: Menu[];
};

export type Session = {
  branchId: string;
  branchName: string;
  cashierName: string;
  pin: string;
};

export type PaymentMethod = "TUNAI" | "QRIS";
export type Quantities = { ayam: number; kare: number; creamy: number };

export type TransactionPayload = {
  trx_id: string;
  timestamp: string;
  branch_id: string;
  cashier_name: string;
  qty_ayam: number;
  qty_kare: number;
  qty_creamy: number;
  total_amount: number;
  payment_method: PaymentMethod;
};

export type QueueEntry = {
  payload: TransactionPayload;
  createdAt: string;
};

export type SaleRecord = {
  id: string;
  date: string;
  branchId: string;
  cashierName: string;
  cups: number;
  amount: number;
  paymentMethod: PaymentMethod;
  synced: boolean;
};

export type OtherExpense = { id: string; name: string; amount: number | null };

export type ShiftDraft = {
  shiftId: string;
  cupBawa: number | null;
  cupSisa: number | null;
  cupReject: number | null;
  modalAwal: number | null;
  qrisAwal: number | null;
  qrisAkhir: number | null;
  opLampu: number | null;
  opKebersihan: number | null;
  opPenitipan: number | null;
  opGalon: number | null;
  otherExpenses: OtherExpense[];
  tunaiFisikLaci: number | null;
};

export const SKU = ["MN-AYM", "MN-KRE", "MN-CKJ"] as const;

export function emptyShiftDraft(): ShiftDraft {
  return {
    shiftId: "",
    cupBawa: null,
    cupSisa: null,
    cupReject: null,
    modalAwal: null,
    qrisAwal: 0,
    qrisAkhir: null,
    opLampu: 0,
    opKebersihan: 0,
    opPenitipan: 0,
    opGalon: 0,
    otherExpenses: [],
    tunaiFisikLaci: null,
  };
}

const idr = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function rupiah(amount: number): string {
  return `Rp${idr.format(Math.round(amount))}`;
}

export function numberText(amount: number): string {
  return idr.format(amount);
}

export function jakartaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (part: string) => parts.find((item) => item.type === part)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function displayDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00+07:00`);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

export function parseNonNegative(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export async function gasGetConfig(): Promise<Branch[]> {
  const response = await fetch("/api/gas", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok || !Array.isArray(data.branches)) {
    throw new Error(data.error || "Konfigurasi cabang belum bisa dimuat.");
  }
  return data.branches as Branch[];
}

export async function gasPost(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch("/api/gas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Gagal terhubung ke Google Sheets.");
    return data as Record<string, unknown>;
  } finally {
    window.clearTimeout(timer);
  }
}
