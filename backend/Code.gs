/**
 * Cuanki POS - Google Apps Script bound to the Google Sheets database.
 * Run setupDatabase() once from the Apps Script editor, then deploy as Web App.
 * Browser POST: Content-Type: text/plain;charset=utf-8; body: JSON.stringify(payload).
 * Change the seeded PIN 0000 before deployment. The spreadsheet timezone is the sales timezone.
 */
var TABLES = {
  Master_Config: ['branch_id','branch_name','pin_code','daily_wage','daily_rent','sku_code','menu_name','sell_price','hpp_cost','is_active'],
  Log_Transaksi: ['trx_id','timestamp','date','branch_id','cashier_name','qty_ayam','qty_kare','qty_creamy','total_cups','total_amount','payment_method','omset_ayam','omset_kare','omset_creamy','hpp_total'],
  Rekap_Shift: ['shift_id','date','branch_id','cashier_name','cup_bawa','cup_sisa','cup_reject','cup_fisik','cup_sistem','selisih_cup','modal_awal','qris_awal','qris_akhir','op_lampu','op_kebersihan','op_penitipan','op_galon','op_lain_nominal','op_lain_detail','total_op','tunai_fisik_laci','daily_wage_snapshot','daily_rent_snapshot'],
  Laporan_Admin: ['date','branch_id','modal_awal','qris_awal','qris_akhir','omset_ayam','omset_kare','omset_creamy','omset_penjualan','total_kas_kotor','total_operasional','tunai_penerimaan','total_penerimaan','gaji_karyawan','laba_kotor','sewa_lahan','total_hpp','laba_bersih','selisih_kas_laci','status_audit']
};

function setupDatabase() {
  var ss = database_();
  Object.keys(TABLES).forEach(function(name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = TABLES[name];
    var current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    if (current.some(function(x) { return x !== ''; }) && current.join('|') !== headers.join('|')) {
      throw new Error('Header ' + name + ' berbeda. Periksa sheet sebelum setup ulang.');
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#242420').setFontColor('#fff9ed');
    sh.setFrozenRows(1);
  });
  var config = ss.getSheetByName('Master_Config');
  config.getRange('C:C').setNumberFormat('@');
  if (config.getLastRow() === 1) {
    config.getRange(2, 1, 3, 10).setValues([
      ['CBG-001','Cabang Utama','0000',50000,26000,'MN-AYM','Cuanki Ayam Bawang',18000,11500,true],
      ['CBG-001','Cabang Utama','0000',50000,26000,'MN-KRE','Cuanki Kare Pedas',18000,11500,true],
      ['CBG-001','Cabang Utama','0000',50000,26000,'MN-CKJ','Cuanki Creamy Keju',20000,18500,true]
    ]);
  }
  var report = ss.getSheetByName('Laporan_Admin');
  if (report.getRange('C2').isBlank()) report.getRange(2, 3, 1, 18).setFormulas([reportFormulas_(2)]);
  report.getRange('C:R').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  report.getRange('S:S').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  ss.getSheetByName('Log_Transaksi').getRange('J:O').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  ss.getSheetByName('Rekap_Shift').getRange('K:W').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  var starter = ss.getSheetByName('Sheet1');
  if (starter && starter.getLastRow() === 0 && ss.getSheets().length > 4) ss.deleteSheet(starter);
  return 'Database siap. Ganti PIN 0000, lalu deploy Web App.';
}

function doGet(e) {
  try {
    var action = e && e.parameter ? e.parameter.action : '';
    if (action !== 'getConfig') throw new Error('Gunakan ?action=getConfig');
    var map = configMap_();
    var branches = Object.keys(map).map(function(id) {
      var b = map[id];
      return {branch_id:id, branch_name:b.name, menus:Object.keys(b.menus).map(function(sku) {
        var m = b.menus[sku];
        return {sku_code:sku, menu_name:m.name, sell_price:m.price};
      })};
    }).filter(function(b) { return b.menus.length > 0; });
    return json_({ok:true, branches:branches, pin_required:true});
  } catch (err) { return json_({ok:false, error:err.message}); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Body JSON kosong.');
    var p = JSON.parse(e.postData.contents); // text/plain;charset=utf-8 avoids OPTIONS preflight.
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Payload harus objek JSON.');
    lock.waitLock(30000);
    var result;
    if (p.action === 'VALIDATE_PIN') {
      var branch = configMap_()[safeId_(p.branch_id, 'branch_id')];
      result = {ok:true, valid:!!branch && String(p.pin_code) === branch.pin};
    } else if (p.action === 'CREATE_TRANSACTION') {
      result = createTransactions_(p);
    } else if (p.action === 'CLOSE_SHIFT') {
      result = closeShift_(p);
    } else throw new Error('Action tidak dikenal.');
    SpreadsheetApp.flush();
    return json_(result);
  } catch (err) {
    return json_({ok:false, error:err.message});
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function createTransactions_(p) {
  var items = Array.isArray(p.transactions) ? p.transactions : [p.transaction || p];
  if (!items.length || items.length > 100) throw new Error('Batch harus berisi 1-100 transaksi.');
  var map = configMap_();
  var sheet = database_().getSheetByName('Log_Transaksi');
  var known = idSet_(sheet);
  var pending = {};
  var rows = [];
  var duplicates = [];
  var tz = database_().getSpreadsheetTimeZone();
  items.forEach(function(t) {
    var id = safeId_(t.trx_id, 'trx_id');
    var branchId = safeId_(t.branch_id || p.branch_id, 'branch_id');
    var b = authorizedBranch_(map, branchId, t.pin_code || p.pin_code);
    if (known[id] || pending[id]) { duplicates.push(id); return; }
    pending[id] = true;
    var q = [whole_(t.qty_ayam || 0, 'qty_ayam'), whole_(t.qty_kare || 0, 'qty_kare'), whole_(t.qty_creamy || 0, 'qty_creamy')];
    if (q[0] + q[1] + q[2] < 1) throw new Error('Keranjang transaksi kosong.');
    var skus = ['MN-AYM','MN-KRE','MN-CKJ'];
    var revenue = [0,0,0], hpp = 0;
    q.forEach(function(n, i) {
      if (!n) return;
      var menu = b.menus[skus[i]];
      if (!menu) throw new Error('Menu tidak aktif: ' + skus[i]);
      revenue[i] = n * menu.price;
      hpp += n * menu.hpp;
    });
    var total = revenue[0] + revenue[1] + revenue[2];
    if (t.total_amount !== undefined && money_(t.total_amount, 'total_amount') !== total) throw new Error('Total transaksi tidak cocok dengan harga menu.');
    var method = String(t.payment_method || '').toUpperCase();
    if (method !== 'TUNAI' && method !== 'QRIS') throw new Error('payment_method harus TUNAI atau QRIS.');
    var time = t.timestamp ? new Date(t.timestamp) : new Date();
    if (isNaN(time.getTime())) throw new Error('timestamp tidak valid.');
    rows.push([id,time,Utilities.formatDate(time,tz,'yyyy-MM-dd'),branchId,safeText_(t.cashier_name,'cashier_name',80),q[0],q[1],q[2],q[0]+q[1]+q[2],total,method,revenue[0],revenue[1],revenue[2],hpp]);
  });
  rows.forEach(function(row) { sheet.appendRow(row); });
  return {ok:true, inserted:rows.length, duplicate_ids:duplicates};
}

function closeShift_(p) {
  var s = p.shift || p;
  var id = safeId_(s.shift_id, 'shift_id');
  var branchId = safeId_(s.branch_id || p.branch_id, 'branch_id');
  var b = authorizedBranch_(configMap_(), branchId, s.pin_code || p.pin_code);
  var date = String(s.date || '');
  var parsedDate = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10) !== date) throw new Error('date harus YYYY-MM-DD.');
  var ss = database_(), shifts = ss.getSheetByName('Rekap_Shift');
  if (idSet_(shifts)[id]) {
    var previousRow = shifts.getRange(2,1,shifts.getLastRow()-1,1).getValues().findIndex(function(x) { return String(x[0]) === id; }) + 2;
    var previous = shifts.getRange(previousRow,2,1,2).getValues()[0];
    if (String(previous[0]) !== date || String(previous[1]) !== branchId) throw new Error('shift_id sudah dipakai untuk cabang/tanggal lain.');
    if (shifts.getRange(previousRow,9).isBlank()) setShiftFormulas_(shifts,previousRow);
    return {ok:true, duplicate:true, shift_id:id, report_row:ensureReport_(ss,date,branchId)};
  }
  if (hasBranchDate_(shifts,date,branchId)) throw new Error('Cabang ini sudah tutup shift pada tanggal tersebut.');
  var report = ss.getSheetByName('Laporan_Admin');
  if (hasBranchDate_(report,date,branchId)) throw new Error('Laporan untuk cabang/tanggal ini sudah ada.');
  var bawa = whole_(s.cup_bawa,'cup_bawa'), sisa = whole_(s.cup_sisa,'cup_sisa'), reject = whole_(s.cup_reject,'cup_reject');
  if (sisa + reject > bawa) throw new Error('Cup sisa dan reject melebihi cup bawa.');
  var lampu = money_(s.op_lampu || 0,'op_lampu'), kebersihan = money_(s.op_kebersihan || 0,'op_kebersihan');
  var penitipan = money_(s.op_penitipan || 0,'op_penitipan'), galon = money_(s.op_galon || 0,'op_galon');
  var other = money_(s.op_lain_nominal || 0,'op_lain_nominal');
  var detail = s.op_lain_detail ? safeText_(s.op_lain_detail,'op_lain_detail',500) : '';
  if (s.other_expenses !== undefined) {
    if (!Array.isArray(s.other_expenses) || s.other_expenses.length > 50) throw new Error('other_expenses maksimal 50 item.');
    if (other || detail) throw new Error('Pilih other_expenses atau op_lain_nominal/detail.');
    var names = [];
    s.other_expenses.forEach(function(x) {
      names.push(safeText_(x.name,'nama pengeluaran',80) + ': Rp' + money_(x.amount,'nominal pengeluaran'));
      other += money_(x.amount,'nominal pengeluaran');
    });
    detail = names.length ? safeText_(names.join('; '),'op_lain_detail',500) : '';
  }
  var op = lampu + kebersihan + penitipan + galon + other;
  if (s.total_op !== undefined && money_(s.total_op,'total_op') !== op) throw new Error('total_op tidak cocok.');
  var row = shifts.getLastRow() + 1;
  shifts.appendRow([id,date,branchId,safeText_(s.cashier_name,'cashier_name',80),bawa,sisa,reject,bawa-sisa-reject,'','',money_(s.modal_awal,'modal_awal'),money_(s.qris_awal || 0,'qris_awal'),money_(s.qris_akhir,'qris_akhir'),lampu,kebersihan,penitipan,galon,other,detail,op,money_(s.tunai_fisik_laci,'tunai_fisik_laci'),b.wage,b.rent]);
  setShiftFormulas_(shifts,row);
  var rr = ensureReport_(ss,date,branchId);
  return {ok:true, shift_id:id, report_row:rr};
}

function setShiftFormulas_(shifts,row) {
  shifts.getRange(row,9).setFormula('=SUMIFS(Log_Transaksi!$I$2:$I,Log_Transaksi!$C$2:$C,B'+row+',Log_Transaksi!$D$2:$D,C'+row+')');
  shifts.getRange(row,10).setFormula('=H'+row+'-I'+row);
}

function ensureReport_(ss,date,branchId) {
  var report = ss.getSheetByName('Laporan_Admin');
  var last = report.getLastRow();
  if (last > 1) {
    var pairs = report.getRange(2,1,last-1,2).getValues();
    var found = pairs.findIndex(function(x) { return String(x[0]) === date && String(x[1]) === branchId; });
    if (found >= 0) return found + 2;
  }
  var row = report.getRange('A2').isBlank() ? 2 : last + 1;
  if (row > 2) report.getRange(2,3,1,18).copyTo(report.getRange(row,3,1,18));
  report.getRange(row,1,1,2).setValues([[date,branchId]]);
  return row;
}

function reportFormulas_(r) {
  var guard = 'OR($A'+r+'="",$B'+r+'="")';
  function sh(col) { return 'SUMIFS(Rekap_Shift!$'+col+'$2:$'+col+',Rekap_Shift!$B$2:$B,$A'+r+',Rekap_Shift!$C$2:$C,$B'+r+')'; }
  function tx(col) { return 'SUMIFS(Log_Transaksi!$'+col+'$2:$'+col+',Log_Transaksi!$C$2:$C,$A'+r+',Log_Transaksi!$D$2:$D,$B'+r+')'; }
  function f(body) { return '=IF('+guard+',"",'+body+')'; }
  return [f(sh('K')),f(sh('L')),f(sh('M')),f(tx('L')),f(tx('M')),f(tx('N')),
    f('SUM(F'+r+':H'+r+')'),f('I'+r+'+C'+r),f(sh('T')),
    f('J'+r+'-K'+r+'-(E'+r+'-D'+r+')-C'+r),f('L'+r+'+(E'+r+'-D'+r+')'),
    f(sh('V')),f('M'+r+'-N'+r),f(sh('W')),f(tx('O')),
    f('O'+r+'-P'+r+'-Q'+r),f(sh('U')+'-(C'+r+'+L'+r+')'),
    f('IF(AND(S'+r+'=0,'+sh('J')+'=0),"SESUAI","SELISIH")')];
}

function configMap_() {
  var sh = database_().getSheetByName('Master_Config');
  if (!sh) throw new Error('Jalankan setupDatabase() terlebih dahulu.');
  var rows = sh.getLastRow() > 1 ? sh.getRange(2,1,sh.getLastRow()-1,10).getValues() : [];
  var map = {};
  rows.forEach(function(x) {
    if (!x[0] || (x[9] !== true && String(x[9]).toUpperCase() !== 'TRUE')) return;
    var id = String(x[0]).trim();
    var wage = money_(x[3],'daily_wage'), rent = money_(x[4],'daily_rent');
    if (!map[id]) map[id] = {name:String(x[1]),pin:String(x[2]),wage:wage,rent:rent,menus:{}};
    else if (map[id].name !== String(x[1]) || map[id].pin !== String(x[2]) || map[id].wage !== wage || map[id].rent !== rent) throw new Error('Konfigurasi cabang ' + id + ' tidak konsisten antar-SKU.');
    if (x[5]) {
      var price = money_(x[7],'sell_price'), hpp = money_(x[8],'hpp_cost');
      if (price <= 0) throw new Error('sell_price harus lebih besar dari 0.');
      map[id].menus[String(x[5]).trim()] = {name:String(x[6]),price:price,hpp:hpp};
    }
  });
  return map;
}

function authorizedBranch_(map,id,pin) {
  var b = map[id];
  if (!b || !/^\d{4}$/.test(b.pin) || String(pin) !== b.pin) throw new Error('Cabang atau PIN tidak valid.');
  return b;
}
function database_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Script harus terikat ke file Google Sheets.');
  return ss;
}
function idSet_(sh) {
  var set = {};
  if (sh.getLastRow() > 1) sh.getRange(2,1,sh.getLastRow()-1,1).getValues().forEach(function(x) { if (x[0]) set[String(x[0])] = true; });
  return set;
}
function hasBranchDate_(sh,date,branchId) {
  var n = sh.getLastRow();
  if (n < 2) return false;
  var col = sh.getName() === 'Rekap_Shift' ? 2 : 1;
  return sh.getRange(2,col,n-1,2).getValues().some(function(x) { return String(x[0]) === date && String(x[1]) === branchId; });
}
function safeId_(v,label) {
  var s = String(v || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) throw new Error(label + ' tidak valid.');
  return s;
}
function safeText_(v,label,max) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!s || s.length > max) throw new Error(label + ' wajib diisi (maks. ' + max + ' karakter).');
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function whole_(v,label) {
  var n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(label + ' harus bilangan bulat >= 0.');
  return n;
}
function money_(v,label) { return whole_(v,label); }
function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}
