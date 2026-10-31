"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Award, Banknote, Check, CircleAlert, ClipboardCheck, CloudOff,
  CloudUpload, Info, LogOut, Menu, Minus, Plus, QrCode, RefreshCw,
  ShieldAlert, Trash2, UserCheck, Wallet, Wifi, WifiOff, X,
} from "lucide-react";
import {
  Branch, OtherExpense, PaymentMethod, Quantities, QueueEntry, SaleRecord,
  Session, ShiftDraft, TransactionPayload, bonusTierInfo, calculateBonus, displayDate,
  emptyShiftDraft, gasGetConfig, gasPost, jakartaDate, numberText, parseNonNegative,
  readLocal, rupiah, writeLocal,
} from "@/lib/pos";

const QUEUE_KEY = "cps:queue:v1";
const LEDGER_KEY = "cps:ledger:v1";
const CONFIG_KEY = "cps:config:v1";
const SESSION_KEY = "cps:session:v1";

type TabKey = "pos" | "shift" | "account";
type PopupState = {
  id: number;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

function draftKey(branchId: string, date: string) { return `cps:shift:${branchId}:${date}`; }
function closedKey(branchId: string, date: string) { return `cps:closed:${branchId}:${date}`; }

function NumberField({ id, label, value, onChange, currency = false, required = false, hint, placeholder }: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  currency?: boolean;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label className="number-field" htmlFor={id}>
      <span className="field-label">{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</span>
      <span className="number-control">
        {currency && <span className="number-prefix">Rp</span>}
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={value === null ? "" : numberText(value)}
          onChange={(event) => onChange(parseNonNegative(event.target.value))}
          aria-required={required}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      </span>
      {hint && <span className="field-hint" id={`${id}-hint`}>{hint}</span>}
    </label>
  );
}

function LogoBadge({ className, width = 168 }: { className: string; width?: number }) {
  const cuankiHeight = Math.round((width * 256) / 560);
  const agencyHeight = Math.round(cuankiHeight * 0.94);
  return (
    <span className={`collab-brand-lockup ${className}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-cuanki.png"
        alt="Cuanki Cep Bewok Express"
        width={Math.round(cuankiHeight * (560 / 256))}
        height={cuankiHeight}
        className="cuanki-logo"
        decoding="async"
      />
      <span className="collab-sep" aria-hidden="true">×</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-agency.png"
        alt="Agency"
        width={agencyHeight}
        height={agencyHeight}
        className="agency-logo"
        decoding="async"
      />
    </span>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="Cuanki Cep Bewok Express × Agency">
      <LogoBadge className="brand-mark" width={compact ? 120 : 160} />
    </div>
  );
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [configError, setConfigError] = useState("");
  const [configCached, setConfigCached] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState<TabKey>("pos");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openBranch, setOpenBranch] = useState("");
  const [openModalVisible, setOpenModalVisible] = useState(false);
  const [closeModalVisible, setCloseModalVisible] = useState(false);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [closeConfirmed, setCloseConfirmed] = useState(false);
  const [cart, setCart] = useState<Quantities>({});
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("TUNAI");
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [qrisConfirmed, setQrisConfirmed] = useState(false);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const queueRef = useRef<QueueEntry[]>([]);
  const [ledger, setLedger] = useState<SaleRecord[]>([]);
  const ledgerRef = useRef<SaleRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const [syncError, setSyncError] = useState("");
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState("");
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [draft, setDraft] = useState<ShiftDraft>(emptyShiftDraft);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState("");
  const [closed, setClosed] = useState(false);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const date = session?.shiftDate || jakartaDate();

  const triggerPopup = useCallback((title: string, message: string, actionLabel?: string, onAction?: () => void) => {
    setPopup({ id: Date.now() + Math.floor(Math.random() * 1000), title, message, actionLabel, onAction });
  }, []);

  const saveQueue = useCallback((value: QueueEntry[]) => {
    writeLocal(QUEUE_KEY, value);
    queueRef.current = value;
    setQueue(value);
  }, []);

  const saveLedger = useCallback((value: SaleRecord[]) => {
    writeLocal(LEDGER_KEY, value);
    ledgerRef.current = value;
    setLedger(value);
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigError("");
    try {
      const live = await gasGetConfig();
      writeLocal(CONFIG_KEY, live);
      setBranches(live);
      setConfigCached(false);
      setOpenBranch((current) => (live.some((b) => b.branch_id === current) ? current : live[0]?.branch_id || ""));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Daftar cabang & menu gagal dimuat dari Sheets.";
      setConfigError(errMsg);
      const cached = readLocal<Branch[]>(CONFIG_KEY, []);
      if (cached.length) {
        setBranches(cached);
        setConfigCached(true);
        setOpenBranch((current) => current || cached[0].branch_id);
      }
    }
  }, []);

  const flushQueue = useCallback(async () => {
    const active = sessionRef.current;
    if (syncingRef.current || !active || !active.branchId || !navigator.onLine) return;
    const matching = queueRef.current.filter((entry) => entry.payload.branch_id === active.branchId);
    if (!matching.length) { setSyncError(""); return; }
    syncingRef.current = true;
    setSyncing(true);
    setSyncError("");
    try {
      for (const entry of matching) {
        const currentSession = sessionRef.current;
        if (!currentSession || currentSession.branchId !== entry.payload.branch_id) break;
        await gasPost({
          action: "CREATE_TRANSACTION",
          session_token: currentSession.token,
          transaction: entry.payload,
        });
        saveQueue(queueRef.current.filter((item) => item.payload.trx_id !== entry.payload.trx_id));
        saveLedger(ledgerRef.current.map((sale) => sale.id === entry.payload.trx_id ? { ...sale, synced: true } : sale));
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Sinkronisasi tertunda.");
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [saveLedger, saveQueue]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const storedQueue = readLocal<QueueEntry[]>(QUEUE_KEY, []);
      const storedLedger = readLocal<SaleRecord[]>(LEDGER_KEY, []);
      queueRef.current = storedQueue;
      ledgerRef.current = storedLedger;
      setQueue(storedQueue);
      setLedger(storedLedger);
      setOnline(navigator.onLine);
      try {
        const raw = window.localStorage.getItem(SESSION_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Session;
          if (saved.cashierName && saved.token && saved.expiresAt > Date.now()) {
            const today = jakartaDate();
            // Mitigasi shift lintas hari: Shift kemarin tidak boleh aktif hari ini
            if (saved.shiftId && saved.shiftDate && saved.shiftDate !== today) {
              saved.shiftId = undefined;
              saved.shiftDate = undefined;
              saved.branchId = "";
              saved.branchName = "";
              saved.isShiftClosed = false;
              window.localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
            } else if (saved.branchId && saved.shiftId) {
              const isClosedLocally = saved.isShiftClosed || readLocal<boolean>(closedKey(saved.branchId, saved.shiftDate || today), false);
              if (isClosedLocally) {
                saved.isShiftClosed = true;
                setClosed(true);
              }
            }
            sessionRef.current = saved;
            setSession(saved);
            if (saved.branchId) setOpenBranch(saved.branchId);
          } else {
            window.localStorage.removeItem(SESSION_KEY);
          }
        }
      } catch { /* A fresh login is available below. */ }
      setReady(true);
      void loadConfig();
    });
    return () => { cancelled = true; };
  }, [loadConfig]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").then((reg) => { void reg.update(); }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!popup && !openModalVisible && !closeModalVisible && !paymentModalVisible && !sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (popup) { setPopup(null); return; }
      if (paymentModalVisible) { setPaymentModalVisible(false); return; }
      if (openModalVisible) { setOpenModalVisible(false); return; }
      if (closeModalVisible) { setCloseModalVisible(false); return; }
      if (sidebarOpen) { setSidebarOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popup, openModalVisible, closeModalVisible, paymentModalVisible, sidebarOpen]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!session.shiftId || !session.branchId) {
        setDraft(emptyShiftDraft());
        setClosed(false);
        setShiftError("");
        return;
      }
      const saved = readLocal<ShiftDraft & { cashCountMode?: string }>(draftKey(session.branchId, date), emptyShiftDraft());
      setDraft({ ...emptyShiftDraft(), ...saved,
        tunaiFisikLaci: saved.cashCountMode === "SALES_ONLY" ? null : saved.tunaiFisikLaci });
      const isShiftClosed = Boolean(session.isShiftClosed) || readLocal<boolean>(closedKey(session.branchId, date), false);
      setClosed(isShiftClosed);
      setShiftError("");
    });
    return () => { cancelled = true; };
  }, [session, date]);

  useEffect(() => {
    if (!session?.shiftId || !session.branchId || !navigator.onLine) return;
    void gasPost({ action: "GET_SHIFT", branch_id: session.branchId, shift_id: session.shiftId,
      session_token: session.token }).then((state) => {
      if (state.found && state.bumbu_bawa && typeof state.bumbu_bawa === "object") {
        const serverBumbu = state.bumbu_bawa as Record<string, number>;
        if (Object.keys(serverBumbu).length > 0) {
          setDraft((prev) => {
            if (Object.keys(prev.bumbuBawa || {}).length > 0) return prev;
            const merged = { ...prev, bumbuBawa: serverBumbu };
            writeLocal(draftKey(session.branchId, session.shiftDate || jakartaDate()), merged);
            return merged;
          });
        }
      }
      if (state.found && state.closed) {
        setClosed(true);
        writeLocal(closedKey(session.branchId, session.shiftDate || jakartaDate()), true);
        setSession((prev) => (prev && !prev.isShiftClosed ? { ...prev, isShiftClosed: true } : prev));
      } else if (state.found === false) {
        const targetDate = session.shiftDate || jakartaDate();
        window.localStorage.removeItem(draftKey(session.branchId, targetDate));
        window.localStorage.removeItem(closedKey(session.branchId, targetDate));
        saveQueue(queueRef.current.filter((item) => item.payload.shift_id !== session.shiftId));
        saveLedger(ledgerRef.current.filter((sale) => sale.shiftId !== session.shiftId));
        const resetSession: Session = {
          ...session,
          branchId: "",
          branchName: "",
          shiftId: undefined,
          shiftDate: undefined,
        };
        writeLocal(SESSION_KEY, resetSession);
        sessionRef.current = resetSession;
        setSession(resetSession);
        setDraft(emptyShiftDraft());
        setClosed(false);
        setCart({});
        setTab("shift");
      }
    }).catch(() => {});
  }, [session, saveLedger, saveQueue]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); void loadConfig(); void flushQueue(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = window.setInterval(() => { if (navigator.onLine) void flushQueue(); }, 20000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(timer);
    };
  }, [flushQueue, loadConfig]);

  useEffect(() => { if (session && queue.length) void flushQueue(); }, [session, queue.length, flushQueue]);

  useEffect(() => {
    if (tab !== "pos") return;
    const target = document.querySelector(".checkout");
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setCheckoutVisible(entry.isIntersecting && entry.intersectionRatio > 0.15), { threshold: [0, 0.15, 1] });
    observer.observe(target);
    return () => observer.disconnect();
  }, [tab, session]);

  const activeBranchId = session?.branchId || openBranch || branches[0]?.branch_id || "";
  const branch = branches.find((item) => item.branch_id === activeBranchId);
  const menus = useMemo(() => {
    const bySku = new Map((branch?.menus || []).map((menu) => [menu.sku_code, menu]));
    return [...bySku.values()];
  }, [branch]);
  const openBranchObj = branches.find((item) => item.branch_id === openBranch) || branches[0];
  const openBranchMenus = useMemo(() => {
    const bySku = new Map((openBranchObj?.menus || []).map((menu) => [menu.sku_code, menu]));
    return [...bySku.values()];
  }, [openBranchObj]);
  const totalBumbuBawa = openBranchMenus.reduce((sum, menu) => sum + (draft.bumbuBawa?.[menu.sku_code] || 0), 0);
  const cartCups = Object.values(cart).reduce((sum, value) => sum + value, 0);
  const cartTotal = menus.reduce((sum, menu) => sum + (cart[menu.sku_code] || 0) * menu.sell_price, 0);
  const effectiveCashReceived = cashReceived === null ? cartTotal : cashReceived;
  const change = cartCups === 0 ? 0 : effectiveCashReceived - cartTotal;
  const shiftSales = useMemo(
    () => ledger.filter((sale) => Boolean(session?.shiftId) && sale.shiftId === session?.shiftId),
    [ledger, session?.shiftId]
  );
  const shiftSoldBySku = useMemo(() => {
    const counts: Record<string, number> = {};
    shiftSales.forEach((sale) => {
      (sale.items || []).forEach((item) => {
        counts[item.sku_code] = (counts[item.sku_code] || 0) + item.qty;
      });
    });
    return counts;
  }, [shiftSales]);
  const shiftCups = shiftSales.reduce((sum, sale) => sum + sale.cups, 0);
  const shiftRevenue = shiftSales.reduce((sum, sale) => sum + sale.amount, 0);
  const activeBranch = branches.find((item) => item.branch_id === session?.branchId);
  const dailyWage = activeBranch?.daily_salary ?? 50000;
  const shiftBonus = calculateBonus(shiftCups);
  const totalHakKasir = dailyWage + shiftBonus;
  const bonusInfo = bonusTierInfo(shiftCups);
  const pendingToday = queue.filter((entry) => Boolean(session?.shiftId) && entry.payload.shift_id === session?.shiftId).length;
  const pendingCurrentBranch = queue.filter((entry) => Boolean(session?.branchId) && entry.payload.branch_id === session?.branchId).length;
  const physicalCups = draft.cupBawa !== null && draft.cupSisa !== null && draft.cupReject !== null
    ? draft.cupBawa - draft.cupSisa - draft.cupReject : null;
  const cupDifference = physicalCups === null ? null : physicalCups - shiftCups;
  const allBumbuSisaFilled = menus.length > 0 && menus.every((menu) => {
    const bawa = draft.bumbuBawa?.[menu.sku_code] || 0;
    if (bawa === 0) return true;
    return draft.bumbuSisa?.[menu.sku_code] !== undefined && draft.bumbuSisa?.[menu.sku_code] !== null;
  });
  const bumbuSisaValid = menus.every((menu) => {
    const bawa = draft.bumbuBawa?.[menu.sku_code] || 0;
    const sisa = draft.bumbuSisa?.[menu.sku_code] ?? (bawa === 0 ? 0 : null);
    if (sisa === null) return false;
    return sisa <= bawa;
  });
  const operationTotal = (draft.opLampu || 0) + (draft.opKebersihan || 0) + (draft.opPenitipan || 0)
    + (draft.opGalon || 0) + draft.otherExpenses.reduce((sum, item) => sum + (item.amount || 0), 0);
  const qrisNet = shiftSales.filter((sale) => sale.paymentMethod === "QRIS").reduce((sum, sale) => sum + sale.amount, 0);
  const cashSales = shiftRevenue - qrisNet;
  const availableCashForOp = (draft.modalAwal || 0) + cashSales;
  const cashIntake = cashSales - operationTotal;
  const expectedDrawer = draft.modalAwal !== null ? draft.modalAwal + cashIntake : null;
  const cashDifference = expectedDrawer !== null && draft.tunaiFisikLaci !== null ? draft.tunaiFisikLaci - expectedDrawer : null;
  const requiredShiftValues = [draft.cupBawa, draft.cupSisa, draft.cupReject, draft.modalAwal, draft.tunaiFisikLaci];
  const shiftValid = requiredShiftValues.every((value) => value !== null)
    && allBumbuSisaFilled && bumbuSisaValid
    && physicalCups !== null && physicalCups >= 0 && (draft.cupBawa || 0) >= 1 && operationTotal <= availableCashForOp
    && draft.otherExpenses.every((item) => item.name.trim() && item.amount !== null)
    && closeConfirmed && pendingToday === 0 && online && !!session?.shiftId && !closed && !shiftBusy;

  function updateDraft(patch: Partial<ShiftDraft>) {
    if (!session) return;
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (session.shiftId && session.branchId) writeLocal(draftKey(session.branchId, date), next);
      return next;
    });
  }

  function updateBumbuBawa(sku: string, value: number | null) {
    if (!session) return;
    setDraft((prev) => {
      const nextBumbuBawa = { ...(prev.bumbuBawa || {}), [sku]: value };
      const nextSum = openBranchMenus.reduce((sum, menu) => sum + (nextBumbuBawa[menu.sku_code] || 0), 0);
      const nextCupBawa = !prev.cupBawaManual || (prev.cupBawa || 0) < nextSum
        ? (nextSum > 0 ? nextSum : null)
        : prev.cupBawa;
      const next = { ...prev, bumbuBawa: nextBumbuBawa, cupBawa: nextCupBawa };
      if (session.shiftId && session.branchId) writeLocal(draftKey(session.branchId, date), next);
      return next;
    });
  }

  function updateBumbuSisa(sku: string, value: number | null) {
    if (!session) return;
    setDraft((prev) => {
      const nextBumbuSisa = { ...(prev.bumbuSisa || {}), [sku]: value };
      const allFilled = menus.length > 0 && menus.every((menu) => {
        const bawa = prev.bumbuBawa?.[menu.sku_code] || 0;
        if (bawa === 0) return true;
        return nextBumbuSisa[menu.sku_code] !== undefined && nextBumbuSisa[menu.sku_code] !== null;
      });
      const sumSisa = menus.reduce((sum, menu) => sum + (nextBumbuSisa[menu.sku_code] || 0), 0);
      const sumBawa = menus.reduce((sum, menu) => sum + (prev.bumbuBawa?.[menu.sku_code] || 0), 0);
      const extraCups = Math.max(0, (prev.cupBawa || 0) - sumBawa);
      const next = {
        ...prev,
        bumbuSisa: nextBumbuSisa,
        cupSisa: allFilled ? sumSisa + extraCups : prev.cupSisa,
        cupReject: prev.cupReject === null ? 0 : prev.cupReject,
      };
      if (session.shiftId && session.branchId) writeLocal(draftKey(session.branchId, date), next);
      return next;
    });
  }

  function navigateTab(nextTab: TabKey) {
    setTab(nextTab);
    setSidebarOpen(false);
    if (nextTab === "pos" || nextTab === "shift") {
      void loadConfig();
    }
  }

  function stepQty(sku: string, delta: number) {
    if (!session?.shiftId) {
      triggerPopup(
        "Shift Belum Dibuka",
        "Kasir tidak dapat memilih menu atau melakukan transaksi sebelum membuka shift. Pilih cabang, isi Modal Awal Kas, dan Cup Bawa terlebih dahulu.",
        "Buka Shift",
        () => {
          setTab("shift");
          setOpenError("");
          setOpenModalVisible(true);
          setPopup(null);
        },
      );
      return;
    }
    if (closed || session?.isShiftClosed) {
      triggerPopup(
        "Shift Sudah Ditutup",
        "Shift pada sesi ini sudah ditutup. Silakan keluar sesi (Log Out) melalui menu Akun untuk mengakhiri sesi kasir.",
        "Ke Menu Akun",
        () => { setTab("account"); setPopup(null); },
      );
      return;
    }
    if (delta > 0) {
      const bawaSku = draft.bumbuBawa?.[sku];
      const soldSku = shiftSoldBySku[sku] || 0;
      const currentCartSku = cart[sku] || 0;
      const menuObj = menus.find((m) => m.sku_code === sku);
      if (bawaSku !== undefined && bawaSku !== null && soldSku + currentCartSku + delta > bawaSku) {
        triggerPopup(
          "Stok Bumbu Menu Habis",
          `Stok bungkus bumbu ${menuObj?.menu_name || sku} tersisa ${Math.max(0, bawaSku - soldSku)} bungkus (dari ${bawaSku} bawa awal). Kasir tidak dapat menambah pesanan varian ini lagi.`,
        );
        return;
      }
      if (shiftCups + cartCups + delta > (draft.cupBawa || 0)) {
        triggerPopup(
          "Batas Cup Bawa Tercapai",
          `Pesanan melebihi sisa Cup Bawa shift ini (${Math.max(0, (draft.cupBawa || 0) - shiftCups)} cup tersisa dari ${draft.cupBawa || 0} Cup Bawa). Tidak ada restock di tengah shift.`,
        );
        return;
      }
    }
    setCart((current) => ({ ...current, [sku]: Math.max(0, (current[sku] || 0) + delta) }));
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const usernameInput = loginUsername.trim();
    if (!usernameInput || !/^\d{4,8}$/.test(loginPin)) {
      setLoginError("Masukkan username kasir terdaftar dan PIN 4–8 digit.");
      return;
    }
    setLoginBusy(true);
    setLoginError("");
    try {
      let result: Record<string, unknown>;
      try {
        result = await gasPost({ action: "LOGIN", username: usernameInput, pin_code: loginPin });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("Aksi tidak dikenali") || msg.includes("branch_id tidak valid")) {
          const fallbackBranch = branches[0]?.branch_id || "";
          if (!fallbackBranch) throw err;
          result = await gasPost({ action: "VALIDATE_PIN", branch_id: fallbackBranch, pin_code: loginPin });
        } else {
          throw err;
        }
      }
      if (!result.valid) {
        setLoginError("Username atau PIN kasir tidak sesuai");
        return;
      }
      if (!result.session_token || !result.expires_at) {
        setLoginError("Apps Script masih versi lama. Perbarui Code.gs dan deployment Web App terlebih dahulu.");
        return;
      }
      window.sessionStorage.removeItem(SESSION_KEY);
      const resolvedName = String(result.cashier_name || usernameInput);
      const resolvedUsername = String(result.username || usernameInput.toLowerCase());
      const next: Session = {
        username: resolvedUsername,
        branchId: "",
        branchName: "",
        cashierName: resolvedName,
        token: String(result.session_token),
        expiresAt: Number(result.expires_at),
        loginAt: Date.now(),
        shiftId: undefined,
        shiftDate: undefined,
        isShiftClosed: false,
      };
      setDraft(emptyShiftDraft());
      setClosed(false);
      setCart({});
      setTab("shift");
      setOpenModalVisible(false);
      setCloseModalVisible(false);
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      sessionRef.current = next;
      setSession(next);
      setLoginPin("");
      void loadConfig();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Koneksi tidak tersedia. Coba lagi saat online.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    if (!online) {
      triggerPopup("Koneksi Diperlukan", "Pembukaan shift membutuhkan koneksi internet untuk mencatat cabang, Modal Awal, dan Cup Bawa ke Google Sheets.");
      return;
    }
    const chosenBranch = branches.find((item) => item.branch_id === openBranch);
    if (!chosenBranch) {
      triggerPopup("Cabang Belum Dipilih", "Pilih cabang operasional terlebih dahulu sebelum memulai shift.");
      return;
    }
    const branchMenus = chosenBranch.menus || [];
    const sumBumbuBawa = branchMenus.reduce((sum, menu) => sum + (draft.bumbuBawa?.[menu.sku_code] || 0), 0);
    if (sumBumbuBawa < 1) {
      triggerPopup("Stok Bumbu Belum Lengkap", "Isi Stok Bawa Awal (bungkus bumbu) minimal 1 bungkus sebelum memulai shift.");
      return;
    }
    if (draft.modalAwal === null || draft.modalAwal <= 0) {
      triggerPopup("Modal Awal Kas Wajib Diisi", "Modal Awal Kas wajib diisi dan harus lebih dari Rp0 sebelum memulai shift.");
      return;
    }
    const effectiveCupBawa = draft.cupBawa !== null ? draft.cupBawa : sumBumbuBawa;
    if (effectiveCupBawa < 1) {
      triggerPopup("Data Shift Belum Lengkap", "Isi Stok Bumbu Bawa (minimal 1 bungkus/cup) sebelum memulai shift.");
      return;
    }
    if (effectiveCupBawa < sumBumbuBawa) {
      triggerPopup("Cup Bawa Kurang dari Total Bumbu", `Jumlah Cup Bawa (${effectiveCupBawa} cup) tidak boleh kurang dari total bungkus bumbu yang dibawa (${sumBumbuBawa} bungkus).`);
      return;
    }
    const cleanBumbuBawa: Record<string, number> = {};
    branchMenus.forEach((menu) => {
      cleanBumbuBawa[menu.sku_code] = draft.bumbuBawa?.[menu.sku_code] || 0;
    });
    let shiftId = draft.shiftId || crypto.randomUUID();
    const today = jakartaDate();
    setOpenBusy(true);
    setOpenError("");
    try {
      try {
        await gasPost({
          action: "OPEN_SHIFT",
          session_token: session.token,
          shift: {
            shift_id: shiftId,
            date: today,
            branch_id: chosenBranch.branch_id,
            cashier_name: session.cashierName,
            cup_bawa: effectiveCupBawa,
            bumbu_bawa: cleanBumbuBawa,
            modal_awal: draft.modalAwal,
          },
        });
      } catch (innerError) {
        const msg = innerError instanceof Error ? innerError.message : "";
        if (msg.includes("sudah memiliki shift")) {
          const existing = await gasPost({
            action: "GET_SHIFT",
            branch_id: chosenBranch.branch_id,
            date: today,
            session_token: session.token,
          });
          if (existing.found && !existing.closed && existing.shift_id) {
            shiftId = String(existing.shift_id);
          } else {
            throw innerError;
          }
        } else {
          throw innerError;
        }
      }
      const nextDraft: ShiftDraft = {
        ...emptyShiftDraft(),
        modalAwal: draft.modalAwal,
        cupBawa: effectiveCupBawa,
        bumbuBawa: cleanBumbuBawa,
        shiftId,
      };
      writeLocal(draftKey(chosenBranch.branch_id, today), nextDraft);
      writeLocal(closedKey(chosenBranch.branch_id, today), false);
      setDraft(nextDraft);
      setClosed(false);
      setCloseConfirmed(false);
      const next: Session = {
        ...session,
        branchId: chosenBranch.branch_id,
        branchName: chosenBranch.branch_name,
        shiftId,
        shiftDate: today,
        isShiftClosed: false,
      };
      writeLocal(SESSION_KEY, next);
      sessionRef.current = next;
      setSession(next);
      setOpenModalVisible(false);
      setTab("pos");
      setNotice(`Shift ${chosenBranch.branch_name} dibuka dengan modal ${rupiah(draft.modalAwal)} dan ${effectiveCupBawa} cup.`);
      void flushQueue();
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Buka shift gagal.");
    } finally {
      setOpenBusy(false);
    }
  }

  function requestLogout() {
    if (session?.shiftId && !closed && !session?.isShiftClosed) {
      triggerPopup(
        "Shift Belum Ditutup",
        "Kasir tidak dapat keluar sesi (log out) selama shift masih berjalan. Selesaikan perhitungan fisik dan tekan Tutup Shift terlebih dahulu.",
        "Ke Menu Shift",
        () => {
          setTab("shift");
          setCloseModalVisible(true);
          setPopup(null);
        },
      );
      return;
    }
    if (pendingCurrentBranch > 0) {
      triggerPopup(
        "Transaksi Belum Tersinkron",
        `Masih ada ${pendingCurrentBranch} transaksi yang menunggu sinkronisasi ke Google Sheets. Pastikan perangkat online lalu kirim ulang sebelum keluar.`,
      );
      return;
    }
    const active = sessionRef.current;
    if (active) {
      const targetDate = active.shiftDate || jakartaDate();
      if (active.branchId) {
        window.localStorage.removeItem(draftKey(active.branchId, targetDate));
        window.localStorage.removeItem(closedKey(active.branchId, targetDate));
      }
      if (active.shiftId) {
        saveLedger(ledgerRef.current.filter((sale) => sale.shiftId !== active.shiftId));
      }
    }
    window.localStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
    sessionRef.current = null;
    setSession(null);
    setDraft(emptyShiftDraft());
    setClosed(false);
    setCloseConfirmed(false);
    setOpenModalVisible(false);
    setCloseModalVisible(false);
    setPaymentModalVisible(false);
    setSidebarOpen(false);
    setCart({});
    setPayment("TUNAI");
    setCashReceived(null);
    setQrisConfirmed(false);
    setLoginUsername("");
    setLoginPin("");
    setLoginError("");
    setOpenError("");
    setShiftError("");
    setTab("pos");
    setNotice("");
    setPopup(null);
  }

  function openPaymentModal() {
    if (!session?.shiftId || !session.branchId) {
      triggerPopup(
        "Shift Belum Dibuka",
        "Kasir tidak dapat mencatat transaksi sebelum membuka shift. Pilih cabang, isi Modal Awal Kas, dan Cup Bawa terlebih dahulu.",
        "Buka Shift",
        () => {
          setOpenError("");
          void loadConfig();
          setOpenModalVisible(true);
          setPopup(null);
        },
      );
      return;
    }
    if (closed || session?.isShiftClosed) {
      triggerPopup(
        "Shift Sudah Ditutup",
        "Shift ini sudah ditutup dan tidak dapat menerima transaksi baru. Silakan Log Out dari menu Akun.",
        "Ke Menu Akun",
        () => { setTab("account"); setPopup(null); },
      );
      return;
    }
    if (!cartCups || !menus.length) {
      triggerPopup("Keranjang Masih Kosong", "Pilih minimal 1 cup menu cuanki sebelum melanjutkan ke metode pembayaran.");
      return;
    }
    for (const menu of menus) {
      const qty = cart[menu.sku_code] || 0;
      if (qty <= 0) continue;
      const bawaSku = draft.bumbuBawa?.[menu.sku_code];
      const soldSku = shiftSoldBySku[menu.sku_code] || 0;
      if (bawaSku !== undefined && bawaSku !== null && soldSku + qty > bawaSku) {
        triggerPopup(
          "Stok Bumbu Menu Habis",
          `Pesanan ${menu.menu_name} (${qty} cup) melebihi sisa stok bungkus bumbu (${Math.max(0, bawaSku - soldSku)} bungkus tersisa).`,
        );
        return;
      }
    }
    if (shiftCups + cartCups > (draft.cupBawa || 0)) {
      triggerPopup("Stok Cup Tidak Cukup", "Jumlah cup pesanan melebihi sisa Cup Bawa pada shift ini.");
      return;
    }
    setPaymentModalVisible(true);
  }

  function handlePay() {
    if (!session?.shiftId || !session.branchId) {
      triggerPopup(
        "Shift Belum Dibuka",
        "Kasir tidak dapat mencatat transaksi sebelum membuka shift. Pilih cabang, isi Modal Awal Kas, dan Cup Bawa terlebih dahulu.",
        "Buka Shift",
        () => {
          setOpenError("");
          void loadConfig();
          setOpenModalVisible(true);
          setPopup(null);
        },
      );
      return;
    }
    if (closed || session?.isShiftClosed) {
      triggerPopup(
        "Shift Sudah Ditutup",
        "Shift ini sudah ditutup dan tidak dapat menerima transaksi baru. Silakan Log Out dari menu Akun.",
        "Ke Menu Akun",
        () => { setTab("account"); setPopup(null); },
      );
      return;
    }
    if (!cartCups || !menus.length) {
      triggerPopup("Keranjang Masih Kosong", "Pilih minimal 1 cup menu cuanki sebelum menekan tombol Bayar.");
      return;
    }
    if (shiftCups + cartCups > (draft.cupBawa || 0)) {
      triggerPopup("Stok Cup Tidak Cukup", "Jumlah cup pesanan melebihi sisa Cup Bawa pada shift ini.");
      return;
    }
    if (payment === "TUNAI" && cashReceived !== null && cashReceived < cartTotal) {
      triggerPopup("Nominal Tunai Kurang", `Uang diterima yang diinput (${rupiah(cashReceived)}) kurang dari total bayar (${rupiah(cartTotal)}). Kosongkan kolom jika pembeli membayar uang pas.`);
      return;
    }
    if (payment === "QRIS" && !qrisConfirmed) {
      triggerPopup("Konfirmasi QRIS Wajib", "Centang konfirmasi bahwa pembayaran QRIS sudah berhasil terlihat di aplikasi merchant sebelum menyelesaikan transaksi.");
      return;
    }
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const payload: TransactionPayload = {
      trx_id: id,
      timestamp,
      branch_id: session.branchId,
      cashier_name: session.cashierName,
      shift_id: session.shiftId,
      items: menus.filter((menu) => (cart[menu.sku_code] || 0) > 0).map((menu) => ({ sku_code: menu.sku_code, qty: cart[menu.sku_code] })),
      total_amount: cartTotal,
      payment_method: payment,
    };
    const entry: QueueEntry = { payload, createdAt: timestamp };
    const record: SaleRecord = {
      id,
      shiftId: session.shiftId,
      date,
      branchId: session.branchId,
      cashierName: session.cashierName,
      cups: cartCups,
      amount: cartTotal,
      paymentMethod: payment,
      synced: false,
      items: payload.items,
    };
    try {
      saveQueue([...queueRef.current, entry]);
      saveLedger([...ledgerRef.current, record]);
    } catch {
      setNotice("Penyimpanan perangkat penuh. Transaksi belum tersimpan; jangan serahkan pesanan.");
      return;
    }
    setCart({});
    setCashReceived(null);
    setQrisConfirmed(false);
    setPaymentModalVisible(false);
    setNotice(`${rupiah(cartTotal)} · ${cartCups} cup (${payment}) tersimpan.`);
    void flushQueue();
  }

  function addExpense() {
    updateDraft({ otherExpenses: [...draft.otherExpenses, { id: crypto.randomUUID(), name: "", amount: null }] });
  }

  function updateExpense(id: string, patch: Partial<OtherExpense>) {
    updateDraft({ otherExpenses: draft.otherExpenses.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }

  async function handleClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.shiftId || !session.branchId) {
      triggerPopup("Shift Belum Dibuka", "Buka shift terlebih dahulu sebelum melakukan penutupan shift.");
      return;
    }
    if (closed || session?.isShiftClosed) {
      triggerPopup("Shift Sudah Ditutup", "Shift ini sudah ditutup sebelumnya. Anda dapat keluar sesi dari menu Akun.", "Ke Menu Akun", () => { setCloseModalVisible(false); setTab("account"); setPopup(null); });
      return;
    }
    if (!online) {
      triggerPopup("Koneksi Diperlukan", "Tutup shift membutuhkan koneksi internet agar laporan langsung masuk ke Google Sheets.");
      return;
    }
    if (pendingToday > 0) {
      triggerPopup("Antrean Belum Tersinkron", `Masih ada ${pendingToday} transaksi yang belum terkirim ke Google Sheets. Tekan Kirim Ulang terlebih dahulu.`);
      return;
    }
    if (!allBumbuSisaFilled) {
      triggerPopup("Audit Bumbu Belum Lengkap", "Isi Sisa Bungkus Bumbu untuk setiap menu sebelum mengirim laporan tutup shift.");
      return;
    }
    if (!bumbuSisaValid) {
      triggerPopup("Sisa Bumbu Tidak Valid", "Jumlah Sisa Bungkus Bumbu tidak boleh melebihi Bawa Awal pada menu tersebut.");
      return;
    }
    if (draft.cupSisa === null || draft.cupReject === null || draft.tunaiFisikLaci === null) {
      triggerPopup("Data Audit Belum Lengkap", "Isi Cup Sisa, Cup Reject, dan Total Uang Fisik di Laci sebelum mengirim laporan tutup shift.");
      return;
    }
    if (physicalCups === null || physicalCups < 0) {
      triggerPopup("Hitungan Cup Tidak Valid", "Jumlah Cup Sisa + Cup Reject tidak boleh melebihi Cup Bawa awal.");
      return;
    }
    if (operationTotal > availableCashForOp) {
      triggerPopup("Operasional Melebihi Kas Laci", "Total pengeluaran operasional tidak boleh melebihi total uang tunai di laci (Modal Awal Kas + Penjualan Tunai).");
      return;
    }
    if (!draft.otherExpenses.every((item) => item.name.trim() && item.amount !== null)) {
      triggerPopup("Pengeluaran Lain Belum Lengkap", "Lengkapi nama dan nominal pada setiap baris Keperluan Lain, atau hapus baris yang kosong.");
      return;
    }
    if (!closeConfirmed) {
      triggerPopup("Validasi Data Wajib Dicentang", "Centang pernyataan bahwa data yang Anda isi sudah valid sebelum mengirim laporan tutup shift.");
      return;
    }
    if (!shiftValid) return;

    const shiftId = session.shiftId;
    const cleanBumbuBawa: Record<string, number> = {};
    const cleanBumbuSisa: Record<string, number> = {};
    menus.forEach((menu) => {
      cleanBumbuBawa[menu.sku_code] = draft.bumbuBawa?.[menu.sku_code] || 0;
      cleanBumbuSisa[menu.sku_code] = draft.bumbuSisa?.[menu.sku_code] || 0;
    });
    setShiftBusy(true);
    setShiftError("");
    try {
      if (pendingToday > 0) {
        await flushQueue();
      }
      const server = await gasPost({
        action: "GET_SHIFT",
        session_token: session.token,
        branch_id: session.branchId,
        shift_id: shiftId,
      });
      const totals = server.totals as { cups: number; cash: number; qris: number; revenue: number };
      if (!server.found) {
        throw new Error("Shift tidak ditemukan di Google Sheets. Buka ulang modal atau hubungi admin.");
      }
      if (Number(totals.cups) !== shiftCups || Number(totals.revenue) !== shiftRevenue) {
        throw new Error(`Data di Google Sheets (${totals.cups} cup, ${rupiah(totals.revenue)}) berbeda dari kasir (${shiftCups} cup, ${rupiah(shiftRevenue)}). Kirim ulang transaksi atau periksa koneksi sebelum tutup shift.`);
      }
      await gasPost({
        action: "CLOSE_SHIFT",
        shift: {
          shift_id: shiftId,
          date,
          branch_id: session.branchId,
          cashier_name: session.cashierName,
          bumbu_bawa: cleanBumbuBawa,
          bumbu_sisa: cleanBumbuSisa,
          cup_sisa: draft.cupSisa,
          cup_reject: draft.cupReject,
          op_lampu: draft.opLampu || 0,
          op_kebersihan: draft.opKebersihan || 0,
          op_penitipan: draft.opPenitipan || 0,
          op_galon: draft.opGalon || 0,
          other_expenses: draft.otherExpenses.map((item) => ({ name: item.name.trim(), amount: item.amount })),
          tunai_fisik_laci: draft.tunaiFisikLaci,
          cash_count_mode: "FULL_DRAWER",
        },
        session_token: session.token,
      });
      writeLocal(closedKey(session.branchId, date), true);
      setClosed(true);
      setCloseModalVisible(false);
      const closedSession: Session = {
        ...session,
        isShiftClosed: true,
      };
      sessionRef.current = closedSession;
      writeLocal(SESSION_KEY, closedSession);
      setSession(closedSession);
      setNotice(`Laporan tutup shift ${session.branchName} berhasil dikirim ke Google Sheets (Status: CLOSED). Silakan Log Out melalui menu Akun.`);
    } catch (error) {
      setShiftError(error instanceof Error ? error.message : "Tutup shift gagal. Coba ulang kembali.");
    } finally {
      setShiftBusy(false);
    }
  }

  if (!ready) return <main className="boot-screen"><Brand /><span>Menyiapkan kasir…</span></main>;

  if (!session) {
    return (
      <main className="login-shell">
        <div className="login-intro">
          <LogoBadge className="login-hero-logo" width={340} />
        </div>
        <div className="login-panel-wrap">
          <form className="login-panel" onSubmit={handleLogin}>
            <div className="login-mobile-brand"><Brand /></div>
            <div className="login-heading">
              <h1>Mulai Kasir</h1>
              <p>Masuk menggunakan akun kasir terdaftar</p>
            </div>
            <label className="form-field" htmlFor="cashier-username">
              <span className="field-label">Username kasir</span>
              <input
                id="cashier-username"
                autoComplete="username"
                maxLength={60}
                placeholder="Masukkan Username anda"
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                disabled={loginBusy}
              />
            </label>
            <label className="form-field" htmlFor="pin">
              <span className="field-label">PIN kasir</span>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={8}
                placeholder="Masukkan Pin Anda"
                value={loginPin}
                onChange={(event) => setLoginPin(event.target.value.replace(/\D/g, ""))}
                disabled={loginBusy}
              />
            </label>
            {configCached && <p className="inline-note"><CloudOff size={16} /> Konfigurasi cabang tersimpan di perangkat. Login tetap memerlukan koneksi.</p>}
            {configError && <div className="message error-message"><CircleAlert size={18} /><span>{configError}</span><button type="button" onClick={() => void loadConfig()}>Coba lagi</button></div>}
            {loginError && <div className="message error-message" role="alert"><CircleAlert size={18} /><span>{loginError}</span></div>}
            <button className="primary-button login-submit" type="submit" disabled={loginBusy}>
              <span>{loginBusy ? "Memverifikasi akun…" : "Masuk ke aplikasi"}</span><ArrowRight size={19} />
            </button>
          </form>
        </div>
      </main>
    );
  }

  const expiryTime = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(new Date(session.expiresAt));

  const loginTime = session.loginAt
    ? new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(session.loginAt))
    : "Hari ini";

  const isShiftClosed = closed || Boolean(session.isShiftClosed);
  const isShiftActive = Boolean(session.shiftId) && !isShiftClosed;

  const shiftStatusLabel = !session.shiftId
    ? "Belum buka shift"
    : isShiftClosed
      ? "Shift sudah ditutup"
      : "Shift sedang berjalan";

  const branchDisplay = session.branchName || "Belum memilih cabang";

  return (
    <main className="app-shell">
      <header className="mobile-topbar">
        <button
          type="button"
          className="icon-button menu-trigger"
          aria-label="Buka navigasi menu"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(true)}
        >
          <Menu size={22} />
        </button>
        <Brand compact />
        <span className={`connection ${!online || syncError ? "connection-warn" : ""}`} aria-live="polite">
          {!online ? <WifiOff size={15} /> : syncing ? <CloudUpload size={15} /> : syncError ? <CloudOff size={15} /> : <Wifi size={15} />}
          <span>{!online ? "Offline" : syncing ? "Sinkron…" : pendingCurrentBranch ? `${pendingCurrentBranch} antre` : "Online"}</span>
        </span>
      </header>

      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          role="presentation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="app-layout">
        <aside className={`app-sidebar ${sidebarOpen ? "open" : ""}`} aria-label="Menu utama aplikasi">
          <div className="sidebar-top">
            <div className="sidebar-brand-row">
              <Brand />
              <button
                type="button"
                className="icon-button sidebar-close"
                aria-label="Tutup navigasi"
                onClick={() => setSidebarOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <nav className="sidebar-nav" aria-label="Navigasi layar kerja">
              <button
                type="button"
                className={`sidebar-link ${tab === "pos" ? "active" : ""}`}
                aria-current={tab === "pos" ? "page" : undefined}
                onClick={() => navigateTab("pos")}
              >
                <Banknote size={19} />
                <span>Kasir</span>
                {cartCups > 0 && <span className="sidebar-badge">{cartCups}</span>}
              </button>

              <button
                type="button"
                className={`sidebar-link ${tab === "shift" ? "active" : ""}`}
                aria-current={tab === "shift" ? "page" : undefined}
                onClick={() => navigateTab("shift")}
              >
                <ClipboardCheck size={19} />
                <span>Shift</span>
                <span className={`sidebar-pill ${!session.shiftId ? "pill-warn" : isShiftClosed ? "pill-muted" : "pill-ok"}`}>
                  {!session.shiftId ? "Buka" : isShiftClosed ? "Selesai" : "Aktif"}
                </span>
              </button>

              <button
                type="button"
                className={`sidebar-link ${tab === "account" ? "active" : ""}`}
                aria-current={tab === "account" ? "page" : undefined}
                onClick={() => navigateTab("account")}
              >
                <UserCheck size={19} />
                <span>Akun</span>
              </button>
            </nav>
          </div>
        </aside>

        <div className="workspace">
          <div className="workspace-top">
            <div>
              <h1>{tab === "pos" ? "Kasir" : tab === "shift" ? "Manajemen Shift" : "Informasi Akun"}</h1>
              <p className="page-date">{displayDate(date)}</p>
            </div>
            <div className="desktop-status">
              <span>{session.shiftId ? `${shiftCups} cup terjual pada shift ini` : "Shift belum dibuka"}</span>
              <button type="button" onClick={() => void loadConfig()} disabled={!online}><RefreshCw size={15} /> Muat ulang Sheets</button>
              {pendingCurrentBranch > 0 && <button type="button" onClick={() => void flushQueue()} disabled={!online || syncing}><RefreshCw size={16} /> Kirim ulang</button>}
            </div>
          </div>

          {notice && <div className="message success-message" role="status"><Check size={18} /><span>{notice}</span><button type="button" aria-label="Tutup pesan" onClick={() => setNotice("")}><X size={17} /></button></div>}
          {configError && <div className="message warning-message" role="alert"><CircleAlert size={18} /><span>Gagal memuat pembaruan Google Sheets ({configError}). Pastikan Code.gs terbaru sudah di-Deploy sebagai <strong>New version</strong> di Apps Script.</span><button type="button" onClick={() => void loadConfig()}>Muat ulang</button></div>}
          {syncError && pendingCurrentBranch > 0 && <div className="message warning-message" role="alert"><CircleAlert size={18} /><span>{syncError}. {pendingCurrentBranch} transaksi tetap tersimpan di perangkat.</span><button type="button" onClick={() => void flushQueue()} disabled={!online || syncing}>Kirim ulang</button></div>}
          {!online && <div className="message offline-message" role="status"><WifiOff size={18} /><span>Offline. Pesanan baru akan disimpan di perangkat lalu dikirim saat koneksi pulih.</span></div>}

          {tab === "pos" && (
            <div className="pos-stage-wrap">
              <div className={`pos-layout ${!isShiftActive ? "is-blurred" : ""}`} aria-hidden={!isShiftActive ? true : undefined}>
                <section className="menu-area" aria-labelledby="menu-title">
                  <div className="section-heading">
                    <div>
                      <h2 id="menu-title">Menu cuanki</h2>
                      <p>{session.branchName ? `Menu aktif ${session.branchName}` : "Pilih varian dan jumlah cup setelah buka shift."}</p>
                    </div>
                    <span className="section-count">{menus.length} menu</span>
                  </div>
                  <div className="menu-list">
                    {menus.length ? menus.map((menu, index) => {
                      const qty = cart[menu.sku_code] || 0;
                      const bawaSku = draft.bumbuBawa?.[menu.sku_code] ?? null;
                      const soldSku = shiftSoldBySku[menu.sku_code] || 0;
                      const remainingSku = bawaSku !== null ? Math.max(0, bawaSku - soldSku - qty) : null;
                      return (
                        <article className="menu-row" key={menu.sku_code}>
                          <div className="menu-ordinal">0{index + 1}</div>
                          <div className="menu-info">
                            <h3 className="menu-name">{menu.menu_name}</h3>
                            <p className="menu-sub-desc">Harga satuan per cup</p>
                            {Boolean(session.shiftId) && remainingSku !== null && (
                              <p className="menu-bumbu-desc">
                                <span className={remainingSku <= 0 ? "stock-empty" : "stock-available"}>
                                  Sisa bumbu: {remainingSku}/{bawaSku}
                                </span>
                              </p>
                            )}
                            <strong className="menu-price">{rupiah(menu.sell_price)}</strong>
                          </div>
                          <div className="stepper" aria-label={`Jumlah ${menu.menu_name}`}>
                            <button type="button" tabIndex={!session.shiftId ? -1 : 0} aria-label={`Kurangi ${menu.menu_name}`} onClick={() => stepQty(menu.sku_code, -1)}><Minus size={19} /></button>
                            <output aria-live="polite">{qty}</output>
                            <button type="button" tabIndex={!session.shiftId ? -1 : 0} aria-label={`Tambah ${menu.menu_name}`} onClick={() => stepQty(menu.sku_code, 1)}><Plus size={19} /></button>
                          </div>
                        </article>
                      );
                    }) : <div className="empty-state">Menu belum tersedia. Pastikan konfigurasi cabang aktif di Google Sheets.</div>}
                  </div>
                  <div className="day-strip">
                    <div className="day-strip-metrics">
                      <span>Terjual pada shift ini</span>
                      <strong>{shiftCups} cup · {rupiah(shiftRevenue)}</strong>
                    </div>
                    {Boolean(session.shiftId) && (
                      <div className="bonus-strip-badge-wrap" title={bonusInfo.nextTargetText}>
                        <span className={`bonus-strip-badge ${shiftCups > 100 ? "badge-max" : shiftCups > 50 ? "badge-tier1" : "badge-none"}`}>
                          <Award size={14} />
                          {shiftCups > 50 ? `Bonus +${rupiah(shiftBonus)}` : "Bonus Rp0"}
                        </span>
                        <span className="bonus-strip-hint">{bonusInfo.nextTargetText}</span>
                      </div>
                    )}
                  </div>
                </section>

                <aside className="checkout" aria-labelledby="checkout-title">
                  <div className="checkout-head">
                    <div>
                      <h2 id="checkout-title">Pesanan saat ini</h2>
                      <p>{cartCups ? `${cartCups} cup dipilih` : "Belum ada menu dipilih"}</p>
                    </div>
                    <LogoBadge className="checkout-icon" width={92} />
                  </div>
                  <div className="cart-lines">
                    {cartCups ? menus.filter((menu) => (cart[menu.sku_code] || 0) > 0).map((menu) => {
                      const qty = cart[menu.sku_code] || 0;
                      return <div className="cart-line" key={menu.sku_code}><span>{qty}× {menu.menu_name}</span><strong>{rupiah(qty * menu.sell_price)}</strong></div>;
                    }) : <p className="cart-empty">Tambah menu untuk mulai menghitung pesanan.</p>}
                  </div>
                  <div className="cart-total"><span>Total bayar</span><strong>{rupiah(cartTotal)}</strong></div>
                  <button
                    className="primary-button checkout-cta-button"
                    type="button"
                    tabIndex={!session.shiftId ? -1 : 0}
                    onClick={openPaymentModal}
                  >
                    <span>{closed ? "Shift sudah ditutup" : !session.shiftId ? "Buka shift dulu" : cartCups ? `Checkout · ${rupiah(cartTotal)}` : "Checkout"}</span>
                    <ArrowRight size={20} />
                  </button>
                  <p className="checkout-help">Pilih metode pembayaran Tunai atau QRIS pada jendela berikutnya.</p>
                  {Boolean(session.shiftId) && shiftCups + cartCups > (draft.cupBawa || 0) && <p className="field-error">Cup tersedia tidak cukup. Tidak ada restock dalam shift ini.</p>}
                </aside>
                {Boolean(session.shiftId) && cartCups > 0 && !checkoutVisible && (
                  <div className="mobile-checkout-bar">
                    <div><span>{cartCups} cup dipilih</span><strong>{rupiah(cartTotal)}</strong></div>
                    <button type="button" onClick={openPaymentModal}>Checkout <ArrowRight size={18} /></button>
                  </div>
                )}
              </div>

              {!isShiftActive && (
                <div className="pos-blur-gate" role="region" aria-labelledby="pos-gate-heading">
                  <div className="pos-gate-card">
                    <span className="shift-stage-icon" aria-hidden="true">
                      <ClipboardCheck size={28} />
                    </span>
                    <h2 id="pos-gate-heading">{isShiftClosed ? "Shift sudah ditutup" : "Shift belum dibuka"}</h2>
                    <p>
                      {isShiftClosed
                        ? "Laporan shift berhasil dikirim ke Google Sheets. Silakan Log Out melalui menu Akun setelah shift selesai."
                        : "Pilih cabang, isi Modal Awal Kas, dan Cup Bawa terlebih dahulu sebelum mencatat transaksi pesanan."}
                    </p>
                    {isShiftClosed ? (
                      <button
                        type="button"
                        className="primary-button shift-center-cta"
                        onClick={() => setTab("account")}
                      >
                        <span>Ke Menu Akun (Log Out)</span>
                        <ArrowRight size={20} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary-button shift-center-cta"
                        onClick={() => {
                          setOpenError("");
                          void loadConfig();
                          setOpenModalVisible(true);
                        }}
                      >
                        <span>Buka Shift</span>
                        <ArrowRight size={20} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "shift" && !session.shiftId && (
            <section className="shift-empty-stage" aria-labelledby="empty-shift-heading">
              <div className="shift-stage-card">
                <span className="shift-stage-icon" aria-hidden="true">
                  <ClipboardCheck size={28} />
                </span>
                <h2 id="empty-shift-heading">Shift Kasir Belum Dibuka</h2>
                <p>
                  Pilih cabang bertugas, masukkan modal awal kas di laci, dan jumlah Cup Bawa hari ini sebelum mulai mencatat transaksi penjualan.
                </p>
                <button
                  type="button"
                  className="primary-button shift-center-cta"
                  onClick={() => {
                    setOpenError("");
                    void loadConfig();
                    setOpenModalVisible(true);
                  }}
                >
                  <span>Buka Shift</span>
                  <ArrowRight size={20} />
                </button>
              </div>
            </section>
          )}

          {tab === "shift" && Boolean(session.shiftId) && (
            <div className="shift-active-stage">
              {isShiftClosed && (
                <div className="message success-message">
                  <Check size={18} />
                  <span>Shift ini sudah ditutup dan tercatat di Google Sheets. Anda kini dapat keluar sesi (Log Out) melalui menu Akun.</span>
                </div>
              )}

              <div className="shift-kpi-grid">
                <article className="shift-kpi-card">
                  <div className="shift-kpi-head">
                    <span className="shift-kpi-icon"><Wallet size={20} /></span>
                    <span>Total Pendapatan Tunai</span>
                  </div>
                  <strong className="shift-kpi-value">{rupiah(cashSales)}</strong>
                  <p>Akumulasi pembayaran tunai di sistem pada shift ini (sebelum dikurangi operasional harian).</p>
                </article>

                <article className="shift-kpi-card">
                  <div className="shift-kpi-head">
                    <span className="shift-kpi-icon"><QrCode size={20} /></span>
                    <span>QRIS Sistem</span>
                  </div>
                  <strong className="shift-kpi-value">{rupiah(qrisNet)}</strong>
                  <p>Total transaksi QRIS nominal pas yang telah terkonfirmasi masuk ke aplikasi merchant.</p>
                </article>
              </div>

              <section className="form-section shift-overview-panel" aria-labelledby="shift-running-title">
                <div className="section-heading">
                  <div>
                    <h2 id="shift-running-title">Status shift berjalan</h2>
                    <p>{session.branchName} · Kasir {session.cashierName}</p>
                  </div>
                  <span className={`account-status-pill ${closed ? "status-closed" : "status-open"}`}>
                    {shiftStatusLabel}
                  </span>
                </div>

                <div className="reconcile-strip four-cols">
                  <div>
                    <span>Modal awal kas</span>
                    <strong>{rupiah(draft.modalAwal || 0)}</strong>
                  </div>
                  <div>
                    <span>Cup Bawa awal</span>
                    <strong>{draft.cupBawa || 0} cup</strong>
                  </div>
                  <div>
                    <span>Terjual di POS</span>
                    <strong>{shiftCups} cup</strong>
                  </div>
                  <div>
                    <span>Total omset POS</span>
                    <strong>{rupiah(shiftRevenue)}</strong>
                  </div>
                </div>

                <div className="shift-cta-bar">
                  <div>
                    <strong>{closed ? "Laporan tutup shift telah terkirim" : "Siap mengakhiri shift hari ini?"}</strong>
                    <p>
                      {closed
                        ? "Seluruh rekonsiliasi cup dan kas laci sudah tersimpan. Lanjutkan ke menu Akun untuk keluar sesi."
                        : "Tekan tombol Tutup Shift untuk mengisi audit cup, operasional harian, dan cash opname laci."}
                    </p>
                  </div>
                  {closed ? (
                    <button
                      type="button"
                      className="primary-button shift-close-cta"
                      onClick={() => setTab("account")}
                    >
                      <span>Ke Menu Akun</span>
                      <ArrowRight size={20} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary-button shift-close-cta"
                      onClick={() => {
                        setShiftError("");
                        setCloseModalVisible(true);
                      }}
                    >
                      <span>Tutup Shift</span>
                      <ArrowRight size={20} />
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}

          {tab === "account" && (
            <div className="account-stage">
              <section className="form-section account-card" aria-labelledby="account-profile-title">
                <div className="account-identity">
                  <div className="account-avatar" aria-hidden="true">
                    {session.cashierName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="account-title-block">
                    <h2 id="account-profile-title">{session.cashierName}</h2>
                    <p>{branchDisplay}</p>
                  </div>
                  <span className={`account-status-pill ${!session.shiftId ? "status-idle" : isShiftClosed ? "status-closed" : "status-open"}`}>
                    {shiftStatusLabel}
                  </span>
                </div>

                <dl className="account-list">
                  <div><dt>Nama kasir</dt><dd>{session.cashierName}</dd></div>
                  {session.username && <div><dt>Username akun</dt><dd>{session.username}</dd></div>}
                  <div><dt>Cabang bertugas</dt><dd>{branchDisplay}</dd></div>
                  <div><dt>Tanggal operasional</dt><dd>{displayDate(date)}</dd></div>
                  <div><dt>Waktu masuk sesi</dt><dd>{loginTime} WIB</dd></div>
                  <div><dt>Batas sesi otomatis</dt><dd>{expiryTime} WIB</dd></div>
                </dl>

                <div className="account-summary-box">
                  <h3>Ringkasan penjualan & hak kasir sesi ini</h3>
                  <div className="reconcile-strip four-cols">
                    <div><span>Pendapatan tunai</span><strong>{rupiah(cashSales)}</strong></div>
                    <div><span>QRIS sistem</span><strong>{rupiah(qrisNet)}</strong></div>
                    <div><span>Cup terjual</span><strong>{session.shiftId ? `${shiftCups} cup` : "—"}</strong></div>
                    <div><span>Omset POS</span><strong>{session.shiftId ? rupiah(shiftRevenue) : "—"}</strong></div>
                  </div>
                  {Boolean(session.shiftId) && (
                    <div className="account-bonus-box">
                      <div className="account-bonus-row">
                        <span>Gaji pokok harian:</span>
                        <strong>{rupiah(dailyWage)}</strong>
                      </div>
                      <div className="account-bonus-row">
                        <span>Bonus penjualan ({shiftCups} cup):</span>
                        <strong className={shiftBonus > 0 ? "bonus-active-text" : ""}>+{rupiah(shiftBonus)}</strong>
                      </div>
                      <div className="account-bonus-total">
                        <span>Total estimasi hak kasir:</span>
                        <strong>{rupiah(totalHakKasir)}</strong>
                      </div>
                      <small className="account-bonus-note">
                        * Skema bonus: 1–50 cup bonus Rp0, 51–100 cup +Rp1.000/cup, &gt;100 cup flat Rp50.000.
                      </small>
                    </div>
                  )}
                </div>

                <div className="account-logout-bar">
                  <div>
                    <strong>Keluar dari aplikasi kasir</strong>
                    <p>
                      {isShiftActive
                        ? "Shift masih berjalan. Anda wajib menyelesaikan Tutup Shift terlebih dahulu sebelum dapat keluar dari akun."
                        : "Sesi siap diakhiri. Menekan tombol keluar akan menghapus sesi login dari perangkat ini."}
                    </p>
                  </div>
                  <button className="primary-button account-logout-btn" type="button" onClick={requestLogout}>
                    <span>Keluar Sesi Kasir (Log Out)</span>
                    <LogOut size={19} />
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {paymentModalVisible && Boolean(session.shiftId) && (
        <div className="modal-backdrop" role="presentation" onClick={() => setPaymentModalVisible(false)}>
          <div
            className="shift-modal-dialog payment-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shift-modal-header">
              <div>
                <h2 id="payment-modal-title">Metode Pembayaran</h2>
                <p>{cartCups} cup dipilih · {session.branchName}</p>
              </div>
              <button
                type="button"
                className="icon-button modal-close"
                aria-label="Tutup modal pembayaran"
                onClick={() => setPaymentModalVisible(false)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="shift-modal-body">
              <div className="payment-modal-summary">
                <div className="cart-lines">
                  {menus.filter((menu) => (cart[menu.sku_code] || 0) > 0).map((menu) => {
                    const qty = cart[menu.sku_code] || 0;
                    return (
                      <div className="cart-line" key={menu.sku_code}>
                        <span>{qty}× {menu.menu_name}</span>
                        <strong>{rupiah(qty * menu.sell_price)}</strong>
                      </div>
                    );
                  })}
                </div>
                <div className="cart-total">
                  <span>Total bayar</span>
                  <strong>{rupiah(cartTotal)}</strong>
                </div>
              </div>

              <div className="payment-block">
                <span className="field-label">Pilih metode pembayaran</span>
                <div className="payment-options" role="group" aria-label="Metode pembayaran">
                  <button type="button" className={payment === "TUNAI" ? "selected" : ""} onClick={() => setPayment("TUNAI")}>
                    <Banknote size={18} /> Tunai
                  </button>
                  <button type="button" className={payment === "QRIS" ? "selected" : ""} onClick={() => setPayment("QRIS")}>
                    <QrCode size={18} /> QRIS
                  </button>
                </div>
              </div>

              {payment === "TUNAI" && (
                <div className="cash-block">
                  <div className="quick-cash-row" role="group" aria-label="Nominal cepat uang tunai">
                    <button
                      type="button"
                      className={`cash-chip ${cashReceived === null ? "active" : ""}`}
                      onClick={() => setCashReceived(null)}
                    >
                      Uang Pas
                    </button>
                    {[20000, 50000, 100000].map((denom) => (
                      <button
                        key={denom}
                        type="button"
                        className={`cash-chip ${cashReceived === denom ? "active" : ""}`}
                        onClick={() => setCashReceived(denom)}
                      >
                        {rupiah(denom)}
                      </button>
                    ))}
                  </div>
                  <NumberField
                    id="cash-received"
                    label="Hitung kembalian (opsional)"
                    placeholder="Kosongkan jika uang pas"
                    value={cashReceived}
                    onChange={setCashReceived}
                    currency
                    hint="Default otomatis Uang Pas. Isi hanya jika perlu menghitung uang kembalian."
                  />
                  <div className={`change-line ${change < 0 ? "negative" : ""}`}>
                    <span>Kembalian</span>
                    <strong>
                      {cartCups === 0
                        ? "—"
                        : cashReceived === null
                          ? "Rp0 (Uang pas)"
                          : change < 0
                            ? `Kurang ${rupiah(-change)}`
                            : rupiah(change)}
                    </strong>
                  </div>
                </div>
              )}

              {payment === "QRIS" && (
                <label className="qris-confirm-row">
                  <input type="checkbox" checked={qrisConfirmed} onChange={(event) => setQrisConfirmed(event.target.checked)} />
                  <span>Pembayaran QRIS sebesar <strong>{rupiah(cartTotal)}</strong> sudah berhasil terlihat di aplikasi merchant.</span>
                </label>
              )}

              <div className="shift-modal-actions">
                <button className="primary-button pay-button" type="button" onClick={handlePay}>
                  <span>Bayar {rupiah(cartTotal)}</span>
                  <ArrowRight size={21} />
                </button>
                <p className="checkout-help">Penjualan tunai & QRIS langsung dikalkulasikan ke rekonsiliasi tutup shift.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {openModalVisible && !session.shiftId && (
        <div className="modal-backdrop" role="presentation" onClick={() => !openBusy && setOpenModalVisible(false)}>
          <div
            className="shift-modal-dialog open-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shift-modal-header">
              <div>
                <h2 id="open-modal-title">Buka Shift Kasir</h2>
                <p>Pilih cabang dan catat modal serta stok Cup Bawa awal.</p>
              </div>
              <button
                type="button"
                className="icon-button modal-close"
                aria-label="Tutup modal buka shift"
                disabled={openBusy}
                onClick={() => setOpenModalVisible(false)}
              >
                <X size={20} />
              </button>
            </div>

            <form className="shift-modal-body" onSubmit={handleOpen}>
              <div className="field-grid two">
                <label className="form-field" htmlFor="open-branch">
                  <span className="field-label">Pilih cabang <span className="required-mark" aria-hidden="true">*</span></span>
                  <select
                    id="open-branch"
                    value={openBranch}
                    onChange={(event) => setOpenBranch(event.target.value)}
                    disabled={!branches.length || openBusy}
                  >
                    {!branches.length && <option value="">Memuat cabang…</option>}
                    {branches.map((item) => (
                      <option value={item.branch_id} key={item.branch_id}>
                        {item.branch_name}
                      </option>
                    ))}
                  </select>
                </label>

                <NumberField
                  id="opening-cash"
                  label="Modal awal kas"
                  value={draft.modalAwal}
                  onChange={(value) => updateDraft({ modalAwal: value })}
                  currency
                  required
                  hint="Uang modal di laci saat mulai."
                />
              </div>

              <section className="modal-subsection bumbu-open-section" aria-labelledby="bumbu-open-title">
                <div className="section-heading">
                  <div>
                    <h3 id="bumbu-open-title">Stok Bawa Awal per Menu (Bungkus Bumbu)</h3>
                    <p>Masukkan jumlah bungkus bumbu yang dibawa untuk setiap varian menu.</p>
                  </div>
                  <span className="section-count">Total bumbu: {totalBumbuBawa} bks</span>
                </div>
                <div className="field-grid two">
                  {openBranchMenus.map((menu) => (
                    <NumberField
                      key={menu.sku_code}
                      id={`bumbu-bawa-${menu.sku_code}`}
                      label={menu.menu_name}
                      placeholder="Jumlah bungkus"
                      value={draft.bumbuBawa?.[menu.sku_code] ?? null}
                      onChange={(value) => updateBumbuBawa(menu.sku_code, value)}
                      required
                      hint={`Harga ${rupiah(menu.sell_price)} / cup`}
                    />
                  ))}
                </div>
              </section>

              <NumberField
                id="opening-cups"
                label="Cup Bawa (Total Wadah Cup)"
                value={draft.cupBawa}
                onChange={(value) => updateDraft({ cupBawa: value, cupBawaManual: value !== null && value !== totalBumbuBawa })}
                required
                hint="Otomatis dijumlahkan dari total bungkus bumbu. Ubah jika membawa cup cadangan lebih banyak."
              />

              {openError && (
                <div className="message error-message" role="alert">
                  <CircleAlert size={18} />
                  <span>{openError}</span>
                </div>
              )}

              <div className="shift-modal-actions">
                <button className="primary-button" type="submit" disabled={openBusy || !branches.length}>
                  <span>{openBusy ? "Memulai shift…" : "Mulai Shift"}</span>
                  <ArrowRight size={20} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {closeModalVisible && Boolean(session.shiftId) && (
        <div className="modal-backdrop" role="presentation" onClick={() => !shiftBusy && setCloseModalVisible(false)}>
          <div
            className="shift-modal-dialog close-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shift-modal-header">
              <div>
                <h2 id="close-modal-title">Tutup Shift Kasir</h2>
                <p>{session.branchName} · {displayDate(date)}</p>
              </div>
              <button
                type="button"
                className="icon-button modal-close"
                aria-label="Tutup modal tutup shift"
                disabled={shiftBusy}
                onClick={() => setCloseModalVisible(false)}
              >
                <X size={20} />
              </button>
            </div>

            <form className="shift-modal-body" onSubmit={handleClose}>
              <section className="modal-subsection" aria-labelledby="cup-title">
                <div className="section-heading">
                  <div>
                    <h3 id="cup-title">1. Audit stok bumbu per menu & cup</h3>
                    <p>Hitung sisa bungkus bumbu setiap varian menu dan cup fisik tersisa, lalu bandingkan dengan penjualan POS.</p>
                  </div>
                  <span className="section-count">Cup Bawa: {draft.cupBawa ?? 0} cup</span>
                </div>

                <div className="field-grid two">
                  {menus.map((menu) => {
                    const bawaMenu = draft.bumbuBawa?.[menu.sku_code] ?? 0;
                    return (
                      <NumberField
                        key={menu.sku_code}
                        id={`bumbu-sisa-${menu.sku_code}`}
                        label={`Sisa bumbu ${menu.menu_name}`}
                        placeholder="Sisa bungkus"
                        value={draft.bumbuSisa?.[menu.sku_code] ?? null}
                        onChange={(value) => updateBumbuSisa(menu.sku_code, value)}
                        required
                        hint={`Bawa awal: ${bawaMenu} bungkus · Terjual POS: ${shiftSoldBySku[menu.sku_code] || 0}`}
                      />
                    );
                  })}
                </div>

                <div className="bumbu-table-wrap" role="region" aria-label="Tabel perbandingan stok bumbu per menu">
                  <table className="bumbu-audit-table">
                    <thead>
                      <tr>
                        <th>Menu</th>
                        <th>Bawa Awal</th>
                        <th>Sisa Akhir</th>
                        <th>Fisik Terpakai</th>
                        <th>Terjual di POS</th>
                        <th>Selisih per Menu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {menus.map((menu) => {
                        const bawa = draft.bumbuBawa?.[menu.sku_code] ?? 0;
                        const sisa = draft.bumbuSisa?.[menu.sku_code] ?? null;
                        const fisik = sisa !== null ? bawa - sisa : null;
                        const soldPos = shiftSoldBySku[menu.sku_code] || 0;
                        const selisih = fisik !== null ? fisik - soldPos : null;
                        return (
                          <tr key={menu.sku_code}>
                            <td className="bumbu-td-menu">
                              <span className="bumbu-menu-title">{menu.menu_name}</span>
                              <span className={`bumbu-mobile-pill ${selisih === null ? "pill-pending" : selisih === 0 ? "pill-ok" : "pill-diff"}`}>
                                {selisih === null ? "—" : selisih === 0 ? "0 (Sesuai)" : `${selisih > 0 ? "+" : ""}${selisih}`}
                              </span>
                            </td>
                            <td data-label="Bawa Awal">
                              <span className="bumbu-cell-label">Bawa Awal:</span>
                              <span className="bumbu-cell-val">{bawa}</span>
                            </td>
                            <td data-label="Sisa Akhir">
                              <span className="bumbu-cell-label">Sisa Akhir:</span>
                              <span className="bumbu-cell-val">{sisa === null ? "—" : sisa}</span>
                            </td>
                            <td data-label="Fisik Terpakai">
                              <span className="bumbu-cell-label">Fisik Terpakai:</span>
                              <span className="bumbu-cell-val">{fisik === null ? "—" : fisik}</span>
                            </td>
                            <td data-label="Terjual di POS">
                              <span className="bumbu-cell-label">Terjual POS:</span>
                              <span className="bumbu-cell-val">{soldPos}</span>
                            </td>
                            <td className={`bumbu-td-desktop-selisih ${selisih === null ? "" : selisih === 0 ? "cell-ok" : "cell-diff"}`}>
                              {selisih === null ? "—" : selisih === 0 ? "0 (Sesuai)" : `${selisih > 0 ? "+" : ""}${selisih}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {!bumbuSisaValid && <p className="field-error">Sisa bungkus bumbu tidak boleh melebihi jumlah Bawa Awal pada menu tersebut.</p>}

                <div className="field-grid two cup-audit-fields">
                  <NumberField
                    id="cup-sisa"
                    label="Cup Sisa (Wadah Cup)"
                    value={draft.cupSisa}
                    onChange={(value) => updateDraft({ cupSisa: value })}
                    required
                  />
                  <NumberField
                    id="cup-reject"
                    label="Cup Reject / Rusak"
                    value={draft.cupReject}
                    onChange={(value) => updateDraft({ cupReject: value })}
                    required
                  />
                </div>
                <div className={`reconcile-strip ${cupDifference !== null && cupDifference !== 0 ? "has-difference" : ""}`}>
                  <div><span>Cup fisik terjual</span><strong>{physicalCups === null ? "—" : `${physicalCups} cup`}</strong></div>
                  <div><span>Cup di POS</span><strong>{shiftCups} cup</strong></div>
                  <div><span>Selisih cup</span><strong>{cupDifference === null ? "—" : `${cupDifference > 0 ? "+" : ""}${cupDifference} cup`}</strong></div>
                </div>
                {physicalCups !== null && physicalCups < 0 && <p className="field-error">Cup Sisa + Reject tidak boleh melebihi Cup Bawa.</p>}
              </section>

              <section className="modal-subsection" aria-labelledby="operation-title">
                <div className="section-heading">
                  <div>
                    <h3 id="operation-title">2. Operasional harian</h3>
                    <p>Biaya operasional yang diambil dari uang tunai di laci (Penjualan Tunai + Modal Awal Kas).</p>
                  </div>
                </div>
                <div className="field-grid two">
                  <NumberField id="op-lampu" label="Lampu" value={draft.opLampu} onChange={(value) => updateDraft({ opLampu: value })} currency />
                  <NumberField id="op-kebersihan" label="Kebersihan" value={draft.opKebersihan} onChange={(value) => updateDraft({ opKebersihan: value })} currency />
                  <NumberField id="op-penitipan" label="Penitipan" value={draft.opPenitipan} onChange={(value) => updateDraft({ opPenitipan: value })} currency />
                  <NumberField id="op-galon" label="Galon" value={draft.opGalon} onChange={(value) => updateDraft({ opGalon: value })} currency />
                </div>
                {draft.otherExpenses.map((item, index) => (
                  <div className="other-expense" key={item.id}>
                    <label className="form-field" htmlFor={`expense-${item.id}`}>
                      <span className="field-label">Keperluan lain {index + 1}</span>
                      <input id={`expense-${item.id}`} value={item.name} maxLength={80} onChange={(event) => updateExpense(item.id, { name: event.target.value })} />
                    </label>
                    <NumberField id={`amount-${item.id}`} label="Nominal" value={item.amount} onChange={(value) => updateExpense(item.id, { amount: value })} currency />
                    <button type="button" className="icon-button remove-expense" aria-label={`Hapus keperluan lain ${index + 1}`} onClick={() => updateDraft({ otherExpenses: draft.otherExpenses.filter((entry) => entry.id !== item.id) })}>
                      <Trash2 size={19} />
                    </button>
                  </div>
                ))}
                <button className="text-button add-expense" type="button" onClick={addExpense}>
                  <Plus size={18} /> Tambah Operasional Lain
                </button>
                <div className="operation-total">
                  <span>Total operasional</span>
                  <strong>{rupiah(operationTotal)}</strong>
                </div>
              </section>

              <section className="modal-subsection" aria-labelledby="drawer-title">
                <div className="section-heading">
                  <div>
                    <h3 id="drawer-title">3. Cash opname laci</h3>
                    <p>Masukkan hasil hitung manual seluruh uang fisik yang ada di laci kasir.</p>
                  </div>
                </div>
                <NumberField
                  id="tunai-fisik"
                  label="Total uang fisik di laci"
                  value={draft.tunaiFisikLaci}
                  onChange={(value) => updateDraft({ tunaiFisikLaci: value })}
                  currency
                  required
                />
                <div className="cash-opname-explainer">
                  <div className="explainer-title">
                    <Info size={16} />
                    <strong>Dari mana Cash Opname Laci berasal & bagaimana perhitungannya?</strong>
                  </div>
                  <p>
                    <strong>Asal uang fisik laci:</strong> Dihitung manual dari seluruh uang tunai (kertas & koin) yang ada di dalam laci saat tutup shift, <strong>termasuk Modal Awal Kas</strong> (tidak termasuk pembayaran QRIS karena dana QRIS langsung masuk ke rekening merchant).
                  </p>
                  <p>
                    <strong>Cara hitung sistem:</strong> Sistem menghitung <code>Kas Laci Seharusnya = Modal Awal Kas + Penjualan Tunai − Operasional Tunai</code>, lalu membandingkannya dengan input Anda melalui rumus <code>Selisih Kas Laci = Total Uang Fisik di Laci − Kas Laci Seharusnya</code>.
                  </p>
                </div>
              </section>

              <section className="modal-subsection" aria-labelledby="preview-title">
                <div className="section-heading">
                  <div>
                    <h3 id="preview-title">4. Periksa sebelum tutup</h3>
                    <p>Rekonsiliasi sistem terhadap hasil perhitungan fisik kasir.</p>
                  </div>
                </div>
                <div className="preview-lines">
                  <div><span>Omset POS di perangkat</span><strong>{rupiah(shiftRevenue)}</strong></div>
                  <div><span>QRIS penjualan</span><strong>{rupiah(qrisNet)}</strong></div>
                  <div><span>Penjualan tunai</span><strong>{rupiah(cashSales)}</strong></div>
                  <div><span>Operasional tunai</span><strong>− {rupiah(operationTotal)}</strong></div>
                  <div className="preview-emphasis"><span>Kas sistem tanpa modal</span><strong>{rupiah(cashIntake)}</strong></div>
                  <div><span>Modal awal</span><strong>{draft.modalAwal === null ? "—" : rupiah(draft.modalAwal)}</strong></div>
                  <div className="preview-emphasis"><span>Kas laci seharusnya</span><strong>{expectedDrawer === null ? "—" : rupiah(expectedDrawer)}</strong></div>
                </div>

                <div className={`audit-result ${cashDifference === null ? "audit-pending" : cashDifference === 0 ? "audit-pass" : "audit-difference"}`}>
                  <span>Keterangan selisih kas laci</span>
                  <strong>
                    {cashDifference === null
                      ? "Menunggu input uang fisik laci"
                      : cashDifference === 0
                        ? "PAS (Rp0)"
                        : cashDifference < 0
                          ? `KURANG ${rupiah(-cashDifference)}`
                          : `LEBIH ${rupiah(cashDifference)}`}
                  </strong>
                  <small>
                    {cashDifference === null
                      ? "Isi Total uang fisik di laci pada bagian Cash opname laci di atas."
                      : `Uang fisik laci ${rupiah(draft.tunaiFisikLaci || 0)} dibandingkan Kas laci seharusnya ${rupiah(expectedDrawer || 0)}`}
                  </small>
                </div>

                <div className="shift-wage-bonus-card">
                  <div className="wage-bonus-head">
                    <span className="wage-bonus-icon"><Award size={18} /></span>
                    <div>
                      <strong>Estimasi Hak Gaji &amp; Bonus Kasir</strong>
                      <p>{shiftCups} cup terjual · {bonusInfo.nextTargetText}</p>
                    </div>
                  </div>
                  <div className="wage-bonus-grid">
                    <div><span>Gaji Pokok Shift</span><strong>{rupiah(dailyWage)}</strong></div>
                    <div><span>Bonus ({shiftCups > 50 ? `${shiftCups} cup` : "≤ 50 cup"})</span><strong className={shiftBonus > 0 ? "bonus-active-text" : ""}>{rupiah(shiftBonus)}</strong></div>
                    <div className="wage-total-cell"><span>Total Hak Kasir</span><strong>{rupiah(totalHakKasir)}</strong></div>
                  </div>
                  <small className="wage-bonus-rule-note">
                    * Ketentuan: 1–50 cup bonus Rp0, cup ke 51–100 bonus +Rp1.000/cup, &gt;100 cup bonus flat Rp50.000.
                  </small>
                </div>
              </section>

              <label className="validation-check-card" htmlFor="confirm-valid-shift">
                <input
                  id="confirm-valid-shift"
                  type="checkbox"
                  checked={closeConfirmed}
                  onChange={(event) => setCloseConfirmed(event.target.checked)}
                />
                <div>
                  <strong>Data yang saya isi sudah valid</strong>
                  <span>Apakah data yang diinputkan sudah valid dan sesuai dengan perhitungan fisik cup serta uang di laci?</span>
                </div>
              </label>

              {pendingToday > 0 && (
                <div className="message warning-message">
                  <CloudUpload size={18} />
                  <span>{pendingToday} transaksi hari ini belum tersinkron. Kirim ulang sebelum tutup shift.</span>
                </div>
              )}
              {shiftError && (
                <div className="message error-message" role="alert">
                  <CircleAlert size={18} />
                  <span>{shiftError}</span>
                </div>
              )}

              <div className="shift-modal-actions">
                <button className="primary-button" type="submit" disabled={shiftBusy || closed}>
                  <span>{shiftBusy ? "Mengirim laporan…" : "Kirim laporan tutup shift"}</span>
                  <ArrowRight size={20} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {popup && (
        <div className="modal-backdrop" role="presentation" onClick={() => setPopup(null)}>
          <div
            key={popup.id}
            className="bounce-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="popup-title"
            aria-describedby="popup-desc"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <span className="modal-badge" aria-hidden="true"><ShieldAlert size={24} /></span>
              <button type="button" className="icon-button modal-close" aria-label="Tutup peringatan" onClick={() => setPopup(null)}>
                <X size={19} />
              </button>
            </div>
            <h2 id="popup-title">{popup.title}</h2>
            <p id="popup-desc">{popup.message}</p>
            <div className="modal-actions">
              {popup.actionLabel && popup.onAction && (
                <button type="button" className="primary-button" onClick={popup.onAction}>
                  <span>{popup.actionLabel}</span><ArrowRight size={19} />
                </button>
              )}
              <button type="button" className="secondary-modal-button" onClick={() => setPopup(null)}>
                {popup.actionLabel ? "Nanti saja" : "Mengerti"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
