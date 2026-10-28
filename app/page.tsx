"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Banknote, Check, CircleAlert, ClipboardCheck, CloudOff,
  CloudUpload, LogOut, Minus, Plus, QrCode, RefreshCw, Soup, Trash2, Wifi,
  WifiOff, X,
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

function draftKey(branchId: string, date: string) { return `cps:shift:${branchId}:${date}`; }
function closedKey(branchId: string, date: string) { return `cps:closed:${branchId}:${date}`; }

function NumberField({ id, label, value, onChange, currency = false, required = false, hint }: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  currency?: boolean;
  required?: boolean;
  hint?: string;
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

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true"><Soup size={23} strokeWidth={2} /></span>
      <span className="brand-name">cuanki<span>POS</span></span>
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
  const [loginBranch, setLoginBranch] = useState("");
  const [loginName, setLoginName] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState<"pos" | "shift">("pos");
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
  const date = session?.shiftDate || jakartaDate();

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
      setLoginBranch((current) => current || live[0]?.branch_id || "");
    } catch (error) {
      const cached = readLocal<Branch[]>(CONFIG_KEY, []);
      if (cached.length) {
        setBranches(cached);
        setConfigCached(true);
        setLoginBranch((current) => current || cached[0].branch_id);
      } else {
        setConfigError(error instanceof Error ? error.message : "Daftar cabang gagal dimuat.");
      }
    }
  }, []);

  const flushQueue = useCallback(async () => {
    const active = sessionRef.current;
    if (syncingRef.current || !active || !navigator.onLine) return;
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
          if (saved.branchId && saved.cashierName && saved.token && saved.expiresAt > Date.now()) {
            sessionRef.current = saved;
            setSession(saved);
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
    if (!session) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const saved = readLocal<ShiftDraft & { cashCountMode?: string }>(draftKey(session.branchId, date), emptyShiftDraft());
      setDraft({ ...emptyShiftDraft(), ...saved,
        tunaiFisikLaci: saved.cashCountMode === "SALES_ONLY" ? null : saved.tunaiFisikLaci });
      setClosed(readLocal<boolean>(closedKey(session.branchId, date), false));
      setShiftError("");
    });
    return () => { cancelled = true; };
  }, [session, date]);

  useEffect(() => {
    if (!session?.shiftId || !navigator.onLine) return;
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

  const branch = branches.find((item) => item.branch_id === session?.branchId);
  const menus = useMemo(() => {
    const bySku = new Map((branch?.menus || []).map((menu) => [menu.sku_code, menu]));
    return [...bySku.values()];
  }, [branch]);
  const cartCups = Object.values(cart).reduce((sum, value) => sum + value, 0);
  const cartTotal = menus.reduce((sum, menu) => sum + (cart[menu.sku_code] || 0) * menu.sell_price, 0);
  const change = cashReceived === null ? null : cashReceived - cartTotal;
  const shiftSales = ledger.filter((sale) => sale.shiftId === session?.shiftId);
  const shiftCups = shiftSales.reduce((sum, sale) => sum + sale.cups, 0);
  const shiftRevenue = shiftSales.reduce((sum, sale) => sum + sale.amount, 0);
  const pendingToday = queue.filter((entry) => entry.payload.shift_id === session?.shiftId).length;
  const pendingCurrentBranch = queue.filter((entry) => entry.payload.branch_id === session?.branchId).length;
  const physicalCups = draft.cupBawa !== null && draft.cupSisa !== null && draft.cupReject !== null
    ? draft.cupBawa - draft.cupSisa - draft.cupReject : null;
  const cupDifference = physicalCups === null ? null : physicalCups - shiftCups;
  const operationTotal = (draft.opLampu || 0) + (draft.opKebersihan || 0) + (draft.opPenitipan || 0)
    + (draft.opGalon || 0) + draft.otherExpenses.reduce((sum, item) => sum + (item.amount || 0), 0);
  const qrisNet = shiftSales.filter((sale) => sale.paymentMethod === "QRIS").reduce((sum, sale) => sum + sale.amount, 0);
  const cashIntake = shiftRevenue - qrisNet - operationTotal;
  const expectedDrawer = draft.modalAwal !== null ? draft.modalAwal + cashIntake : null;
  const cashDifference = expectedDrawer !== null && draft.tunaiFisikLaci !== null ? draft.tunaiFisikLaci - expectedDrawer : null;
  const requiredShiftValues = [draft.cupBawa, draft.cupSisa, draft.cupReject, draft.modalAwal, draft.tunaiFisikLaci];
  const shiftValid = requiredShiftValues.every((value) => value !== null)
    && physicalCups !== null && physicalCups >= 0 && (draft.cupBawa || 0) >= 1 && operationTotal <= shiftRevenue - qrisNet
    && draft.otherExpenses.every((item) => item.name.trim() && item.amount !== null)
    && pendingToday === 0 && online && !!session?.shiftId && !closed && !shiftBusy;

  function updateDraft(patch: Partial<ShiftDraft>) {
    if (!session) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    writeLocal(draftKey(session.branchId, date), next);
  }

  function stepQty(sku: string, delta: number) {
    setCart((current) => ({ ...current, [sku]: Math.max(0, (current[sku] || 0) + delta) }));
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = loginName.trim();
    if (!loginBranch || !name || !/^\d{4,8}$/.test(loginPin)) {
      setLoginError("Pilih cabang, isi nama kasir, dan masukkan PIN 4–8 digit.");
      return;
    }
    const chosen = branches.find((item) => item.branch_id === loginBranch);
    if (!chosen) { setLoginError("Cabang tidak tersedia. Muat ulang daftar cabang."); return; }
    setLoginBusy(true);
    setLoginError("");
    try {
      const result = await gasPost({ action: "VALIDATE_PIN", branch_id: loginBranch, pin_code: loginPin });
      if (!result.valid) { setLoginError("PIN tidak sesuai. Periksa kembali lalu coba lagi."); return; }
      if (!result.session_token || !result.expires_at) {
        setLoginError("Apps Script masih versi lama. Perbarui Code.gs dan deployment Web App terlebih dahulu.");
        return;
      }
      const next: Session = { branchId: chosen.branch_id, branchName: chosen.branch_name, cashierName: name,
        token: String(result.session_token), expiresAt: Number(result.expires_at) };
      const activeShift = await gasPost({ action: "GET_SHIFT", branch_id: next.branchId,
        date: jakartaDate(), session_token: next.token });
      if (activeShift.found) {
        next.shiftId = String(activeShift.shift_id);
        next.shiftDate = jakartaDate();
        const saved = readLocal<ShiftDraft>(draftKey(next.branchId, next.shiftDate), emptyShiftDraft());
        writeLocal(draftKey(next.branchId, next.shiftDate), { ...saved,
          shiftId: next.shiftId, cupBawa: Number(activeShift.cup_bawa), modalAwal: Number(activeShift.modal_awal) });
        writeLocal(closedKey(next.branchId, next.shiftDate), Boolean(activeShift.closed));
      }
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      sessionRef.current = next;
      setSession(next);
      setLoginPin("");
      void flushQueue();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Koneksi tidak tersedia. Coba lagi saat online.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !online || !draft.cupBawa || draft.cupBawa < 1 || draft.modalAwal === null) return;
    const shiftId = draft.shiftId || crypto.randomUUID();
    updateDraft({ shiftId });
    setOpenBusy(true);
    setOpenError("");
    try {
      await gasPost({ action: "OPEN_SHIFT", session_token: session.token,
        shift: { shift_id: shiftId, date, branch_id: session.branchId, cashier_name: session.cashierName,
          cup_bawa: draft.cupBawa, modal_awal: draft.modalAwal } });
      const next = { ...session, shiftId, shiftDate: date };
      writeLocal(SESSION_KEY, next);
      sessionRef.current = next;
      setSession(next);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Buka shift gagal.");
    } finally { setOpenBusy(false); }
  }

  function logout() {
    window.localStorage.removeItem(SESSION_KEY);
    sessionRef.current = null;
    setSession(null);
    setCart({});
    setPayment("TUNAI");
    setCashReceived(null);
    setQrisConfirmed(false);
    setTab("pos");
    setNotice("");
  }

  function handlePay() {
    if (!session?.shiftId || !cartCups || !menus.length || closed || shiftCups + cartCups > (draft.cupBawa || 0)) return;
    if (payment === "TUNAI" && (cashReceived === null || cashReceived < cartTotal)) return;
    if (payment === "QRIS" && !qrisConfirmed) return;
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const payload: TransactionPayload = {
      trx_id: id, timestamp, branch_id: session.branchId, cashier_name: session.cashierName,
      shift_id: session.shiftId, items: menus.filter((menu) => (cart[menu.sku_code] || 0) > 0).map((menu) => ({ sku_code: menu.sku_code, qty: cart[menu.sku_code] })),
      total_amount: cartTotal, payment_method: payment,
    };
    const entry: QueueEntry = { payload, createdAt: timestamp };
    const record: SaleRecord = {
      id, shiftId: session.shiftId, date, branchId: session.branchId,
      cashierName: session.cashierName, cups: cartCups, amount: cartTotal,
      paymentMethod: payment, synced: false,
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
    setNotice(`${rupiah(cartTotal)} · ${cartCups} cup tersimpan. Sinkronisasi berjalan otomatis.`);
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
    if (!session || !shiftValid) return;
    const shiftId = draft.shiftId || crypto.randomUUID();
    if (!draft.shiftId) updateDraft({ shiftId });
    setShiftBusy(true);
    setShiftError("");
    try {
      const server = await gasPost({ action: "GET_SHIFT", session_token: session.token,
        branch_id: session.branchId, shift_id: shiftId });
      const totals = server.totals as { cups: number; cash: number; qris: number; revenue: number };
      if (!server.found || Number(totals.cups) !== shiftCups || Number(totals.revenue) !== shiftRevenue) {
        throw new Error("Total di Google Sheets berbeda dari perangkat ini. Periksa sinkronisasi sebelum tutup shift.");
      }
      await gasPost({
        action: "CLOSE_SHIFT",
        shift: {
          shift_id: shiftId, date, branch_id: session.branchId, cashier_name: session.cashierName,
          cup_sisa: draft.cupSisa,
          cup_reject: draft.cupReject, op_lampu: draft.opLampu || 0,
          op_kebersihan: draft.opKebersihan || 0, op_penitipan: draft.opPenitipan || 0,
          op_galon: draft.opGalon || 0,
          other_expenses: draft.otherExpenses.map((item) => ({ name: item.name.trim(), amount: item.amount })),
          tunai_fisik_laci: draft.tunaiFisikLaci, cash_count_mode: "FULL_DRAWER",
        },
        session_token: session.token,
      });
      writeLocal(closedKey(session.branchId, date), true);
      setClosed(true);
      setNotice(`Shift ${session.branchName} berhasil ditutup dan dikirim ke Google Sheets.`);
    } catch (error) {
      setShiftError(error instanceof Error ? error.message : "Tutup shift gagal. Coba ulang dengan ID yang sama.");
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
            <p>Kasir dan tutup shift Cuanki dalam satu layar kerja.</p>
          </div>
          <div className="login-foot">Satu cabang. Satu shift. Semua tercatat.</div>
        </div>
        <div className="login-panel-wrap">
          <form className="login-panel" onSubmit={handleLogin}>
            <div className="login-mobile-brand"><Brand compact /></div>
            <div className="login-heading">
              <span className="login-symbol" aria-hidden="true"><Soup size={24} /></span>
              <h1>Mulai sesi kasir</h1>
              <p>Pilih cabang dan masuk sebelum menerima pesanan.</p>
            </div>
            <label className="form-field" htmlFor="branch">
              <span className="field-label">Cabang</span>
              <select id="branch" value={loginBranch} onChange={(event) => setLoginBranch(event.target.value)} disabled={!branches.length || loginBusy}>
                {!branches.length && <option value="">Memuat cabang…</option>}
                {branches.map((item) => <option value={item.branch_id} key={item.branch_id}>{item.branch_name}</option>)}
              </select>
            </label>
            <label className="form-field" htmlFor="cashier-name">
              <span className="field-label">Nama kasir</span>
              <input id="cashier-name" autoComplete="name" maxLength={80} value={loginName} onChange={(event) => setLoginName(event.target.value)} />
            </label>
            <label className="form-field" htmlFor="pin">
              <span className="field-label">PIN cabang</span>
              <input id="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={loginPin} onChange={(event) => setLoginPin(event.target.value.replace(/\D/g, ""))} />
            </label>
            {configCached && <p className="inline-note"><CloudOff size={16} /> Daftar cabang tersimpan di perangkat. Login tetap perlu koneksi.</p>}
            {configError && <div className="message error-message"><CircleAlert size={18} /><span>{configError}</span><button type="button" onClick={() => void loadConfig()}>Coba lagi</button></div>}
            {loginError && <div className="message error-message" role="alert"><CircleAlert size={18} /><span>{loginError}</span></div>}
            <button className="primary-button login-submit" type="submit" disabled={loginBusy || !branches.length}>
              <span>{loginBusy ? "Memeriksa PIN…" : "Masuk ke kasir"}</span><ArrowRight size={19} />
            </button>
            <p className="login-help">Akses kasir mengikuti PIN cabang di Google Sheets.</p>
          </form>
        </div>
      </main>
    );
  }

  if (!session.shiftId) {
    return <main className="login-shell"><div className="login-intro"><Brand /><div className="login-story"><h2>Siapkan shift.<br />Mulai jualan.</h2><p>Catat modal dan cup sekali sebelum menerima pesanan.</p></div><div className="login-foot">{session.branchName} · {session.cashierName}</div></div><div className="login-panel-wrap"><form className="login-panel" onSubmit={handleOpen}><div className="login-mobile-brand"><Brand compact /></div><div className="login-heading"><span className="login-symbol"><Soup size={24} /></span><h1>Buka shift</h1><p>{displayDate(date)} · {session.branchName}</p></div><NumberField id="opening-cash" label="Modal awal kas" value={draft.modalAwal} onChange={(value) => updateDraft({ modalAwal: value })} currency required /><div style={{ height: 20 }} /><NumberField id="opening-cups" label="Cup Bawa" value={draft.cupBawa} onChange={(value) => updateDraft({ cupBawa: value })} required hint="Minimal 1 cup. Stok dibawa sekali saat buka shift." />{openError && <div className="message error-message" role="alert"><CircleAlert size={18} /><span>{openError}</span></div>}<button className="primary-button login-submit" type="submit" disabled={openBusy || !online || !draft.cupBawa || draft.modalAwal === null}><span>{openBusy ? "Membuka shift…" : "Buka shift & mulai"}</span><ArrowRight size={19} /></button><p className="login-help">Buka shift perlu koneksi. Setelah terbuka, transaksi dapat antre saat offline.</p><button className="text-button" type="button" onClick={logout}>Keluar sesi</button></form></div></main>;
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <Brand compact />
          <div className="header-right">
            <span className={`connection ${!online || syncError ? "connection-warn" : ""}`} aria-live="polite">
              {!online ? <WifiOff size={16} /> : syncing ? <CloudUpload size={16} /> : syncError ? <CloudOff size={16} /> : <Wifi size={16} />}
              <span>{!online ? "Offline" : syncing ? "Menyinkronkan" : pendingCurrentBranch ? `${pendingCurrentBranch} menunggu` : syncError ? "Perlu sinkronisasi" : "Tersinkron"}</span>
            </span>
            <button className="icon-button logout-button" type="button" onClick={logout} aria-label="Keluar sesi" title="Keluar sesi"><LogOut size={19} /></button>
          </div>
        </div>
      </header>

      <div className="workspace">
        <div className="workspace-top">
          <div>
            <div className="scope-line"><span className="scope-dot" /> {session.branchName} <span className="scope-divider">/</span> {session.cashierName}</div>
            <h1>{tab === "pos" ? "Kasir" : "Tutup Shift"}</h1>
            <p className="page-date">{displayDate(date)}</p>
          </div>
          <div className="desktop-status">
            <span>{shiftCups} cup tercatat di perangkat untuk shift ini</span>
            {pendingCurrentBranch > 0 && <button type="button" onClick={() => void flushQueue()} disabled={!online || syncing}><RefreshCw size={16} /> Kirim ulang</button>}
          </div>
        </div>

        <nav className="tabs" aria-label="Layar kasir">
          <button type="button" className={tab === "pos" ? "active" : ""} aria-current={tab === "pos" ? "page" : undefined} onClick={() => setTab("pos")}><Banknote size={18} /> Kasir</button>
          <button type="button" className={tab === "shift" ? "active" : ""} aria-current={tab === "shift" ? "page" : undefined} onClick={() => setTab("shift")}><ClipboardCheck size={18} /> Tutup Shift</button>
        </nav>

        {notice && <div className="message success-message" role="status"><Check size={18} /><span>{notice}</span><button type="button" aria-label="Tutup pesan" onClick={() => setNotice("")}><X size={17} /></button></div>}
        {syncError && pendingCurrentBranch > 0 && <div className="message warning-message" role="alert"><CircleAlert size={18} /><span>{syncError}. {pendingCurrentBranch} transaksi tetap tersimpan di perangkat.</span><button type="button" onClick={() => void flushQueue()} disabled={!online || syncing}>Kirim ulang</button></div>}
        {!online && <div className="message offline-message" role="status"><WifiOff size={18} /><span>Offline. Pesanan baru akan disimpan di perangkat lalu dikirim saat koneksi pulih.</span></div>}

        {tab === "pos" ? (
          <div className="pos-layout">
            <section className="menu-area" aria-labelledby="menu-title">
              <div className="section-heading"><div><h2 id="menu-title">Menu cuanki</h2><p>Pilih varian dan jumlah cup.</p></div><span className="section-count">{menus.length} varian</span></div>
              <div className="menu-list">
                {menus.length ? menus.map((menu, index) => {
                  const qty = cart[menu.sku_code] || 0;
                  return (
                    <article className="menu-row" key={menu.sku_code}>
                      <div className="menu-ordinal">0{index + 1}</div>
                      <div className="menu-info"><h3>{menu.menu_name}</h3><p>{menu.sku_code}</p><strong>{rupiah(menu.sell_price)}</strong></div>
                      <div className="stepper" aria-label={`Jumlah ${menu.menu_name}`}>
                        <button type="button" aria-label={`Kurangi ${menu.menu_name}`} disabled={qty === 0 || closed} onClick={() => stepQty(menu.sku_code, -1)}><Minus size={19} /></button>
                        <output aria-live="polite">{qty}</output>
                        <button type="button" aria-label={`Tambah ${menu.menu_name}`} disabled={closed} onClick={() => stepQty(menu.sku_code, 1)}><Plus size={19} /></button>
                      </div>
                    </article>
                  );
                }) : <div className="empty-state">Menu cabang belum tersedia. Periksa `Master_Config` lalu muat ulang.</div>}
              </div>
              <div className="day-strip"><span>Terjual pada shift di perangkat ini</span><strong>{shiftCups} cup · {rupiah(shiftRevenue)}</strong></div>
            </section>

            <aside className="checkout" aria-labelledby="checkout-title">
              <div className="checkout-head"><div><h2 id="checkout-title">Pesanan saat ini</h2><p>{cartCups ? `${cartCups} cup dipilih` : "Belum ada menu dipilih"}</p></div><span className="checkout-icon"><Soup size={20} /></span></div>
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
              {payment === "TUNAI" && <div className="cash-block"><NumberField id="cash-received" label="Uang diterima" value={cashReceived} onChange={setCashReceived} currency /><div className={`change-line ${change !== null && change < 0 ? "negative" : ""}`}><span>Kembalian</span><strong>{change === null ? "—" : change < 0 ? `Kurang ${rupiah(-change)}` : rupiah(change)}</strong></div></div>}
              {payment === "QRIS" && <label className="field-hint" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}><input type="checkbox" checked={qrisConfirmed} onChange={(event) => setQrisConfirmed(event.target.checked)} /> Pembayaran berhasil terlihat di aplikasi merchant.</label>}
              <button className="primary-button pay-button" type="button" disabled={closed || !cartCups || shiftCups + cartCups > (draft.cupBawa || 0) || (payment === "TUNAI" && (cashReceived === null || cashReceived < cartTotal)) || (payment === "QRIS" && !qrisConfirmed)} onClick={handlePay}>
                <span>{closed ? "Shift sudah ditutup" : `Bayar ${rupiah(cartTotal)}`}</span><ArrowRight size={21} />
              </button>
              <p className="checkout-help">Pesanan tersimpan di perangkat sebelum dikirim ke Sheets.</p>
              {shiftCups + cartCups > (draft.cupBawa || 0) && <p className="field-error">Cup tersedia tidak cukup. Tidak ada restock dalam shift ini.</p>}
              {payment === "QRIS" && <p className="checkout-help">Pastikan pembayaran berhasil di aplikasi merchant sebelum menekan Bayar.</p>}
            </aside>
            {cartCups > 0 && !checkoutVisible && <div className="mobile-checkout-bar"><div><span>{cartCups} cup dipilih</span><strong>{rupiah(cartTotal)}</strong></div><button type="button" onClick={() => document.getElementById("checkout-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Lanjut bayar <ArrowRight size={18} /></button></div>}
          </div>
        ) : (
          <form className="shift-layout" onSubmit={handleClose}>
            <div className="shift-form">
              {closed && <div className="message success-message"><Check size={18} /><span>Shift hari ini sudah ditutup. Data tercatat di Google Sheets.</span></div>}
              <section className="form-section" aria-labelledby="cup-title">
                <div className="section-heading"><div><h2 id="cup-title">Audit cup</h2><p>Hitung cup fisik dan bandingkan dengan penjualan POS.</p></div><span className="section-count">{shiftCups} di POS</span></div>
                <p className="field-hint">Cup Bawa saat buka shift: <strong>{draft.cupBawa ?? 0} cup</strong></p>
                <div className="field-grid two"><NumberField id="cup-sisa" label="Cup Sisa" value={draft.cupSisa} onChange={(value) => updateDraft({ cupSisa: value })} required /><NumberField id="cup-reject" label="Cup Reject" value={draft.cupReject} onChange={(value) => updateDraft({ cupReject: value })} required /></div>
                <div className={`reconcile-strip ${cupDifference !== null && cupDifference !== 0 ? "has-difference" : ""}`}><div><span>Cup fisik terjual</span><strong>{physicalCups === null ? "—" : `${physicalCups} cup`}</strong></div><div><span>Cup di POS</span><strong>{shiftCups} cup</strong></div><div><span>Selisih cup</span><strong>{cupDifference === null ? "—" : `${cupDifference > 0 ? "+" : ""}${cupDifference} cup`}</strong></div></div>
                {physicalCups !== null && physicalCups < 0 && <p className="field-error">Cup Sisa + Reject tidak boleh melebihi Cup Bawa.</p>}
              </section>

              <section className="form-section" aria-labelledby="cash-title"><div className="section-heading"><div><h2 id="cash-title">Kas & QRIS</h2><p>Modal dicatat saat buka shift. QRIS dihitung dari transaksi yang berhasil.</p></div></div><div className="reconcile-strip"><div><span>Modal awal</span><strong>{rupiah(draft.modalAwal || 0)}</strong></div><div><span>QRIS sistem</span><strong>{rupiah(qrisNet)}</strong></div></div></section>

              <section className="form-section" aria-labelledby="operation-title">
                <div className="section-heading"><div><h2 id="operation-title">Operasional harian</h2><p>Pengeluaran berikut diambil dari hasil jualan tunai.</p></div></div>
                <div className="field-grid two"><NumberField id="op-lampu" label="Lampu" value={draft.opLampu} onChange={(value) => updateDraft({ opLampu: value })} currency /><NumberField id="op-kebersihan" label="Kebersihan" value={draft.opKebersihan} onChange={(value) => updateDraft({ opKebersihan: value })} currency /><NumberField id="op-penitipan" label="Penitipan" value={draft.opPenitipan} onChange={(value) => updateDraft({ opPenitipan: value })} currency /><NumberField id="op-galon" label="Galon" value={draft.opGalon} onChange={(value) => updateDraft({ opGalon: value })} currency /></div>
                {draft.otherExpenses.map((item, index) => <div className="other-expense" key={item.id}><label className="form-field" htmlFor={`expense-${item.id}`}><span className="field-label">Keperluan lain {index + 1}</span><input id={`expense-${item.id}`} value={item.name} maxLength={80} onChange={(event) => updateExpense(item.id, { name: event.target.value })} /></label><NumberField id={`amount-${item.id}`} label="Nominal" value={item.amount} onChange={(value) => updateExpense(item.id, { amount: value })} currency /><button type="button" className="icon-button remove-expense" aria-label={`Hapus keperluan lain ${index + 1}`} onClick={() => updateDraft({ otherExpenses: draft.otherExpenses.filter((entry) => entry.id !== item.id) })}><Trash2 size={19} /></button></div>)}
                <button className="text-button add-expense" type="button" onClick={addExpense}><Plus size={18} /> Tambah Operasional Lain</button>
                <div className="operation-total"><span>Total operasional</span><strong>{rupiah(operationTotal)}</strong></div>
              </section>

              <section className="form-section" aria-labelledby="drawer-title">
                <div className="section-heading"><div><h2 id="drawer-title">Cash opname laci</h2><p>Hitung seluruh uang fisik di laci, termasuk modal awal.</p></div></div>
                <NumberField id="tunai-fisik" label="Total uang fisik di laci" value={draft.tunaiFisikLaci} onChange={(value) => updateDraft({ tunaiFisikLaci: value })} currency required />
              </section>
            </div>

            <aside className="shift-preview" aria-labelledby="preview-title">
              <div className="preview-head"><h2 id="preview-title">Periksa sebelum tutup</h2><p>{session.branchName} · {date}</p></div>
              <div className="preview-lines"><div><span>Omset POS di perangkat</span><strong>{rupiah(shiftRevenue)}</strong></div><div><span>QRIS dari penjualan</span><strong>{rupiah(qrisNet)}</strong></div><div><span>Penjualan tunai</span><strong>{rupiah(shiftRevenue - qrisNet)}</strong></div><div><span>Operasional tunai</span><strong>− {rupiah(operationTotal)}</strong></div><div className="preview-emphasis"><span>Kas sistem tanpa modal</span><strong>{rupiah(cashIntake)}</strong></div><div><span>Modal awal</span><strong>{draft.modalAwal === null ? "—" : rupiah(draft.modalAwal)}</strong></div><div><span>Kas laci seharusnya</span><strong>{expectedDrawer === null ? "—" : rupiah(expectedDrawer)}</strong></div></div>
              <div className={`audit-result ${cashDifference === null ? "audit-pending" : cashDifference === 0 ? "audit-pass" : "audit-difference"}`}><span>Selisih kas laci</span><strong>{cashDifference === null ? "Belum lengkap" : cashDifference === 0 ? "PAS" : cashDifference < 0 ? `KURANG ${rupiah(-cashDifference)}` : `LEBIH ${rupiah(cashDifference)}`}</strong><small>{cashDifference === null ? "Isi uang fisik." : `Fisik ${rupiah(draft.tunaiFisikLaci || 0)} − seharusnya ${rupiah(expectedDrawer || 0)}`}</small></div>
              {pendingToday > 0 && <div className="message warning-message"><CloudUpload size={18} /><span>{pendingToday} transaksi hari ini belum tersinkron. Kirim dulu sebelum tutup shift.</span></div>}
              {shiftError && <div className="message error-message" role="alert"><CircleAlert size={18} /><span>{shiftError}</span></div>}
              <button className="primary-button close-button" type="submit" disabled={!shiftValid}><span>{shiftBusy ? "Mengirim tutup shift…" : closed ? "Shift sudah ditutup" : "Tutup Shift & Kirim"}</span><ArrowRight size={20} /></button>
              <p className="checkout-help">Selisih tetap dicatat untuk ditinjau admin.</p>
            </aside>
          </form>
        )}
      </div>
    </main>
  );
}
