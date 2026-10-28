"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Banknote, Check, CircleAlert, ClipboardCheck, CloudOff,
  CloudUpload, Info, LogOut, Menu, Minus, Plus, QrCode, RefreshCw,
  ShieldAlert, Trash2, UserCheck, Wallet, Wifi, WifiOff, X,
} from "lucide-react";
import {
  Branch, OtherExpense, PaymentMethod, Quantities, QueueEntry, SaleRecord,
  Session, ShiftDraft, TransactionPayload, displayDate, emptyShiftDraft,
  gasGetConfig, gasPost, jakartaDate, numberText, parseNonNegative, readLocal,
  rupiah, writeLocal,
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
  const height = Math.round((width * 256) / 560);
  return (
    <span className={className} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-cuanki.png" alt="Cuanki Cep Bewok Express" width={width} height={height} className="cuanki-logo" decoding="async" />
    </span>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="Cuanki Cep Bewok Express">
      <LogoBadge className="brand-mark" width={compact ? 142 : 192} />
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
      setOpenBranch((current) => current || live[0]?.branch_id || "");
    } catch (error) {
      const cached = readLocal<Branch[]>(CONFIG_KEY, []);
      if (cached.length) {
        setBranches(cached);
        setConfigCached(true);
        setOpenBranch((current) => current || cached[0].branch_id);
      } else {
        setConfigError(error instanceof Error ? error.message : "Daftar cabang gagal dimuat.");
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
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    if (!popup && !openModalVisible && !closeModalVisible && !sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (popup) { setPopup(null); return; }
      if (openModalVisible) { setOpenModalVisible(false); return; }
      if (closeModalVisible) { setCloseModalVisible(false); return; }
      if (sidebarOpen) { setSidebarOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popup, openModalVisible, closeModalVisible, sidebarOpen]);

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
      setClosed(readLocal<boolean>(closedKey(session.branchId, date), false));
      setShiftError("");
    });
    return () => { cancelled = true; };
  }, [session, date]);

  useEffect(() => {
    if (!session?.shiftId || !session.branchId || !navigator.onLine) return;
    void gasPost({ action: "GET_SHIFT", branch_id: session.branchId, shift_id: session.shiftId,
      session_token: session.token }).then((state) => {
      if (state.found && state.closed) {
        setClosed(true);
        writeLocal(closedKey(session.branchId, session.shiftDate || jakartaDate()), true);
      }
    }).catch(() => {});
  }, [session]);

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
  const cartCups = Object.values(cart).reduce((sum, value) => sum + value, 0);
  const cartTotal = menus.reduce((sum, menu) => sum + (cart[menu.sku_code] || 0) * menu.sell_price, 0);
  const effectiveCashReceived = cashReceived === null ? cartTotal : cashReceived;
  const change = cartCups === 0 ? 0 : effectiveCashReceived - cartTotal;
  const shiftSales = ledger.filter((sale) => Boolean(session?.shiftId) && sale.shiftId === session?.shiftId);
  const shiftCups = shiftSales.reduce((sum, sale) => sum + sale.cups, 0);
  const shiftRevenue = shiftSales.reduce((sum, sale) => sum + sale.amount, 0);
  const pendingToday = queue.filter((entry) => Boolean(session?.shiftId) && entry.payload.shift_id === session?.shiftId).length;
  const pendingCurrentBranch = queue.filter((entry) => Boolean(session?.branchId) && entry.payload.branch_id === session?.branchId).length;
  const physicalCups = draft.cupBawa !== null && draft.cupSisa !== null && draft.cupReject !== null
    ? draft.cupBawa - draft.cupSisa - draft.cupReject : null;
  const cupDifference = physicalCups === null ? null : physicalCups - shiftCups;
  const operationTotal = (draft.opLampu || 0) + (draft.opKebersihan || 0) + (draft.opPenitipan || 0)
    + (draft.opGalon || 0) + draft.otherExpenses.reduce((sum, item) => sum + (item.amount || 0), 0);
  const qrisNet = shiftSales.filter((sale) => sale.paymentMethod === "QRIS").reduce((sum, sale) => sum + sale.amount, 0);
  const cashSales = shiftRevenue - qrisNet;
  const cashIntake = cashSales - operationTotal;
  const expectedDrawer = draft.modalAwal !== null ? draft.modalAwal + cashIntake : null;
  const cashDifference = expectedDrawer !== null && draft.tunaiFisikLaci !== null ? draft.tunaiFisikLaci - expectedDrawer : null;
  const requiredShiftValues = [draft.cupBawa, draft.cupSisa, draft.cupReject, draft.modalAwal, draft.tunaiFisikLaci];
  const shiftValid = requiredShiftValues.every((value) => value !== null)
    && physicalCups !== null && physicalCups >= 0 && (draft.cupBawa || 0) >= 1 && operationTotal <= cashSales
    && draft.otherExpenses.every((item) => item.name.trim() && item.amount !== null)
    && closeConfirmed && pendingToday === 0 && online && !!session?.shiftId && !closed && !shiftBusy;

  function updateDraft(patch: Partial<ShiftDraft>) {
    if (!session) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    if (session.shiftId && session.branchId) writeLocal(draftKey(session.branchId, date), next);
  }

  function navigateTab(nextTab: TabKey) {
    setTab(nextTab);
    setSidebarOpen(false);
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
    if (closed) {
      triggerPopup(
        "Shift Sudah Ditutup",
        "Shift pada sesi ini sudah ditutup. Silakan keluar sesi (Log Out) melalui menu Akun untuk mengakhiri sesi kasir.",
        "Ke Menu Akun",
        () => { setTab("account"); setPopup(null); },
      );
      return;
    }
    if (delta > 0 && shiftCups + cartCups + delta > (draft.cupBawa || 0)) {
      triggerPopup(
        "Batas Cup Bawa Tercapai",
        `Pesanan melebihi sisa Cup Bawa shift ini (${Math.max(0, (draft.cupBawa || 0) - shiftCups)} cup tersisa dari ${draft.cupBawa || 0} Cup Bawa). Tidak ada restock di tengah shift.`,
      );
      return;
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
        setLoginError("Username atau PIN kasir tidak sesuai. Akun kasir hanya dikelola di Google Sheets.");
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
    if (draft.modalAwal === null || !draft.cupBawa || draft.cupBawa < 1) {
      triggerPopup("Data Shift Belum Lengkap", "Isi Modal Awal Kas dan Cup Bawa (minimal 1 cup) sebelum memulai shift.");
      return;
    }
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
            cup_bawa: draft.cupBawa,
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
      const nextDraft: ShiftDraft = { ...emptyShiftDraft(), modalAwal: draft.modalAwal, cupBawa: draft.cupBawa, shiftId };
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
      };
      writeLocal(SESSION_KEY, next);
      sessionRef.current = next;
      setSession(next);
      setOpenModalVisible(false);
      setTab("pos");
      setNotice(`Shift ${chosenBranch.branch_name} dibuka dengan modal ${rupiah(draft.modalAwal)} dan ${draft.cupBawa} cup.`);
      void flushQueue();
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Buka shift gagal.");
    } finally {
      setOpenBusy(false);
    }
  }

  function requestLogout() {
    if (session?.shiftId && !closed) {
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

  function handlePay() {
    if (!session?.shiftId || !session.branchId) {
      triggerPopup(
        "Shift Belum Dibuka",
        "Kasir tidak dapat mencatat transaksi sebelum membuka shift. Pilih cabang, isi Modal Awal Kas, dan Cup Bawa terlebih dahulu.",
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
    if (closed) {
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
    if (closed) {
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
    if (draft.cupSisa === null || draft.cupReject === null || draft.tunaiFisikLaci === null) {
      triggerPopup("Data Audit Belum Lengkap", "Isi Cup Sisa, Cup Reject, dan Total Uang Fisik di Laci sebelum mengirim laporan tutup shift.");
      return;
    }
    if (physicalCups === null || physicalCups < 0) {
      triggerPopup("Hitungan Cup Tidak Valid", "Jumlah Cup Sisa + Cup Reject tidak boleh melebihi Cup Bawa awal.");
      return;
    }
    if (operationTotal > cashSales) {
      triggerPopup("Operasional Melebihi Tunai", "Total pengeluaran operasional tidak boleh melebihi penjualan tunai pada shift ini.");
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
    setShiftBusy(true);
    setShiftError("");
    try {
      const server = await gasPost({
        action: "GET_SHIFT",
        session_token: session.token,
        branch_id: session.branchId,
        shift_id: shiftId,
      });
      const totals = server.totals as { cups: number; cash: number; qris: number; revenue: number };
      if (!server.found || Number(totals.cups) !== shiftCups || Number(totals.revenue) !== shiftRevenue) {
        throw new Error("Total di Google Sheets berbeda dari perangkat ini. Periksa sinkronisasi sebelum tutup shift.");
      }
      await gasPost({
        action: "CLOSE_SHIFT",
        shift: {
          shift_id: shiftId,
          date,
          branch_id: session.branchId,
          cashier_name: session.cashierName,
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
      setNotice(`Laporan tutup shift ${session.branchName} berhasil dikirim. Silakan Log Out melalui menu Akun.`);
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
          <Brand />
          <div className="login-story">
            <h2>Pesanan masuk.<br />Hitungan rapi.</h2>
            <p>Kasir dan rekonsiliasi shift Cuanki Cep Bewok Express dalam satu ruang kerja.</p>
          </div>
          <div className="login-foot">Akun terverifikasi · Rekap shift otomatis ke Google Sheets.</div>
        </div>
        <div className="login-panel-wrap">
          <form className="login-panel" onSubmit={handleLogin}>
            <div className="login-mobile-brand"><Brand /></div>
            <div className="login-heading">
              <LogoBadge className="login-symbol" width={184} />
              <h1>Mulai sesi kasir</h1>
              <p>Masuk menggunakan akun kasir terdaftar untuk mengakses aplikasi.</p>
            </div>
            <label className="form-field" htmlFor="cashier-username">
              <span className="field-label">Username kasir</span>
              <input
                id="cashier-username"
                autoComplete="username"
                maxLength={60}
                placeholder="Contoh: kasir1"
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
                placeholder="4–8 digit angka"
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
            <p className="login-help">Pembuatan dan pengelolaan akun kasir hanya dilakukan oleh admin di tab <strong>Master_Kasir</strong> pada Google Sheets.</p>
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

  const shiftStatusLabel = !session.shiftId
    ? "Belum buka shift"
    : closed
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

            <div className="sidebar-cashier-card">
              <div className="sidebar-avatar" aria-hidden="true">
                {session.cashierName.slice(0, 2).toUpperCase()}
              </div>
              <div className="sidebar-cashier-meta">
                <strong>{session.cashierName}</strong>
                <span>{branchDisplay}</span>
              </div>
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
                <span className={`sidebar-pill ${!session.shiftId ? "pill-warn" : closed ? "pill-muted" : "pill-ok"}`}>
                  {!session.shiftId ? "Buka" : closed ? "Selesai" : "Aktif"}
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

          <div className="sidebar-foot">
            <div className={`connection ${!online || syncError ? "connection-warn" : ""}`} aria-live="polite">
              {!online ? <WifiOff size={16} /> : syncing ? <CloudUpload size={16} /> : syncError ? <CloudOff size={16} /> : <Wifi size={16} />}
              <span>{!online ? "Perangkat offline" : syncing ? "Menyinkronkan data…" : pendingCurrentBranch ? `${pendingCurrentBranch} menunggu kirim` : syncError ? "Perlu sinkronisasi" : "Tersinkron ke Sheets"}</span>
            </div>
            <p className="sidebar-foot-note">Keluar sesi (Log Out) tersedia melalui menu Akun setelah shift ditutup.</p>
          </div>
        </aside>

        <div className="workspace">
          <div className="workspace-top">
            <div>
              <div className="scope-line">
                <span className="scope-dot" />
                <span>{branchDisplay}</span>
                <span className="scope-divider">/</span>
                <span>{session.cashierName}</span>
                <span className="scope-divider">·</span>
                <span className="scope-badge">{shiftStatusLabel}</span>
              </div>
              <h1>{tab === "pos" ? "Kasir" : tab === "shift" ? "Manajemen Shift" : "Informasi Akun"}</h1>
              <p className="page-date">{displayDate(date)}</p>
            </div>
            <div className="desktop-status">
              <span>{session.shiftId ? `${shiftCups} cup terjual pada shift ini` : "Shift belum dibuka"}</span>
              {pendingCurrentBranch > 0 && <button type="button" onClick={() => void flushQueue()} disabled={!online || syncing}><RefreshCw size={16} /> Kirim ulang</button>}
            </div>
          </div>

          {notice && <div className="message success-message" role="status"><Check size={18} /><span>{notice}</span><button type="button" aria-label="Tutup pesan" onClick={() => setNotice("")}><X size={17} /></button></div>}
          {syncError && pendingCurrentBranch > 0 && <div className="message warning-message" role="alert"><CircleAlert size={18} /><span>{syncError}. {pendingCurrentBranch} transaksi tetap tersimpan di perangkat.</span><button type="button" onClick={() => void flushQueue()} disabled={!online || syncing}>Kirim ulang</button></div>}
          {!online && <div className="message offline-message" role="status"><WifiOff size={18} /><span>Offline. Pesanan baru akan disimpan di perangkat lalu dikirim saat koneksi pulih.</span></div>}

          {tab === "pos" && (
            <div className="pos-layout">
              <section className="menu-area" aria-labelledby="menu-title">
                {!session.shiftId && (
                  <div className="shift-gate-banner">
                    <div>
                      <strong>Shift belum dibuka</strong>
                      <p>Pilih cabang, isi Modal Awal Kas, dan Cup Bawa terlebih dahulu sebelum mencatat transaksi pesanan.</p>
                    </div>
                    <button
                      type="button"
                      className="gate-action-button"
                      onClick={() => {
                        setTab("shift");
                        setOpenError("");
                        setOpenModalVisible(true);
                      }}
                    >
                      Buka Shift <ArrowRight size={17} />
                    </button>
                  </div>
                )}
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
                    return (
                      <article className="menu-row" key={menu.sku_code}>
                        <div className="menu-ordinal">0{index + 1}</div>
                        <div className="menu-info">
                          <h3>{menu.menu_name}</h3>
                          <p>Harga satuan per cup</p>
                          <strong>{rupiah(menu.sell_price)}</strong>
                        </div>
                        <div className="stepper" aria-label={`Jumlah ${menu.menu_name}`}>
                          <button type="button" aria-label={`Kurangi ${menu.menu_name}`} onClick={() => stepQty(menu.sku_code, -1)}><Minus size={19} /></button>
                          <output aria-live="polite">{qty}</output>
                          <button type="button" aria-label={`Tambah ${menu.menu_name}`} onClick={() => stepQty(menu.sku_code, 1)}><Plus size={19} /></button>
                        </div>
                      </article>
                    );
                  }) : <div className="empty-state">Menu belum tersedia. Pastikan konfigurasi cabang aktif di Google Sheets.</div>}
                </div>
                <div className="day-strip">
                  <span>Terjual pada shift ini</span>
                  <strong>{shiftCups} cup · {rupiah(shiftRevenue)}</strong>
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
                <div className="payment-block">
                  <span className="field-label">Metode pembayaran</span>
                  <div className="payment-options" role="group" aria-label="Metode pembayaran">
                    <button type="button" className={payment === "TUNAI" ? "selected" : ""} onClick={() => setPayment("TUNAI")}><Banknote size={18} /> Tunai</button>
                    <button type="button" className={payment === "QRIS" ? "selected" : ""} onClick={() => setPayment("QRIS")}><QrCode size={18} /> QRIS</button>
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
                <button className="primary-button pay-button" type="button" onClick={handlePay}>
                  <span>{closed ? "Shift sudah ditutup" : !session.shiftId ? "Buka shift dulu" : `Bayar ${rupiah(cartTotal)}`}</span>
                  <ArrowRight size={21} />
                </button>
                <p className="checkout-help">Penjualan tunai & QRIS langsung dikalkulasikan ke rekonsiliasi tutup shift.</p>
                {Boolean(session.shiftId) && shiftCups + cartCups > (draft.cupBawa || 0) && <p className="field-error">Cup tersedia tidak cukup. Tidak ada restock dalam shift ini.</p>}
              </aside>
              {cartCups > 0 && !checkoutVisible && <div className="mobile-checkout-bar"><div><span>{cartCups} cup dipilih</span><strong>{rupiah(cartTotal)}</strong></div><button type="button" onClick={() => document.getElementById("checkout-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Lanjut bayar <ArrowRight size={18} /></button></div>}
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
              {closed && (
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
                  <span className={`account-status-pill ${!session.shiftId ? "status-idle" : closed ? "status-closed" : "status-open"}`}>
                    {shiftStatusLabel}
                  </span>
                </div>

                <dl className="account-list">
                  <div><dt>Nama kasir</dt><dd>{session.cashierName}</dd></div>
                  {session.username && <div><dt>Username akun</dt><dd>{session.username}</dd></div>}
                  <div><dt>Cabang bertugas</dt><dd>{branchDisplay}</dd></div>
                  <div><dt>Status shift</dt><dd>{shiftStatusLabel}</dd></div>
                  <div><dt>Tanggal operasional</dt><dd>{displayDate(date)}</dd></div>
                  <div><dt>Waktu masuk sesi</dt><dd>{loginTime} WIB</dd></div>
                  <div><dt>Batas sesi otomatis</dt><dd>{expiryTime} WIB</dd></div>
                </dl>

                <div className="account-summary-box">
                  <h3>Ringkasan penjualan sesi ini</h3>
                  <div className="reconcile-strip">
                    <div><span>Modal awal kas</span><strong>{session.shiftId ? rupiah(draft.modalAwal || 0) : "—"}</strong></div>
                    <div><span>Pendapatan tunai</span><strong>{rupiah(cashSales)}</strong></div>
                    <div><span>QRIS sistem</span><strong>{rupiah(qrisNet)}</strong></div>
                  </div>
                </div>

                <div className="account-logout-bar">
                  <div>
                    <strong>Keluar dari aplikasi kasir</strong>
                    <p>
                      {session.shiftId && !closed
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

              <div className="field-grid two">
                <NumberField
                  id="opening-cash"
                  label="Modal awal kas"
                  value={draft.modalAwal}
                  onChange={(value) => updateDraft({ modalAwal: value })}
                  currency
                  required
                  hint="Uang modal di laci saat mulai."
                />
                <NumberField
                  id="opening-cups"
                  label="Cup Bawa"
                  value={draft.cupBawa}
                  onChange={(value) => updateDraft({ cupBawa: value })}
                  required
                  hint="Minimal 1 cup. Tanpa restock."
                />
              </div>

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
                    <h3 id="cup-title">1. Audit cup</h3>
                    <p>Hitung cup fisik tersisa dan bandingkan dengan penjualan POS.</p>
                  </div>
                  <span className="section-count">Cup Bawa: {draft.cupBawa ?? 0} cup</span>
                </div>
                <div className="field-grid two">
                  <NumberField
                    id="cup-sisa"
                    label="Cup Sisa"
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
                    <p>Biaya operasional yang diambil dari uang tunai laci pada shift ini.</p>
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
