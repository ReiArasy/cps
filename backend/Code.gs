/**
 * Cuanki POS - Google Apps Script bound to the Google Sheets database.
 * Run setupDatabase() once from the Apps Script editor, then deploy as Web App.
 * Browser POST: Content-Type: text/plain;charset=utf-8; body: JSON.stringify(payload).
 * Change the seeded PIN 0000 before deployment. The spreadsheet timezone is the sales timezone.
 */
var TABLES = {
  Master_Config: ['branch_id','branch_name','pin_code','daily_wage','daily_rent','sku_code','menu_name','sell_price','hpp_cost','is_active'],
  Log_Transaksi: ['trx_id','timestamp','date','branch_id','cashier_name','qty_ayam','qty_kare','qty_creamy','total_cups','total_amount','payment_method','omset_ayam','omset_kare','omset_creamy','hpp_total','shift_id','items_json'],
  Rekap_Shift: ['shift_id','date','branch_id','cashier_name','cup_bawa','cup_sisa','cup_reject','cup_fisik','cup_sistem','selisih_cup','modal_awal','qris_awal','qris_akhir','op_lampu','op_kebersihan','op_penitipan','op_galon','op_lain_nominal','op_lain_detail','total_op','tunai_fisik_laci','daily_wage_snapshot','daily_rent_snapshot','status','opened_at'],
  Laporan_Admin: ['date','branch_id','modal_awal','qris_awal','qris_akhir','omset_ayam','omset_kare','omset_creamy','omset_penjualan','total_kas_kotor','total_operasional','tunai_penerimaan','total_penerimaan','gaji_karyawan','laba_kotor','sewa_lahan','total_hpp','laba_bersih','selisih_kas_laci','status_audit','omset_menu_lain'],
  Laporan_Menu: ['date','branch_id','shift_id','sku_code','menu_name','qty_cup','omset','total_hpp','laba_kotor']
};

function setupDatabase() {
  var ss = database_();
  ss.setSpreadsheetTimeZone('Asia/Jakarta');
  Object.keys(TABLES).forEach(function(name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = TABLES[name];
    var current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    var oldHeaders = current.filter(function(x) { return x !== ''; });
    if (oldHeaders.length && headers.slice(0, oldHeaders.length).join('|') !== oldHeaders.join('|')) {
      throw new Error('Header ' + name + ' berbeda. Periksa sheet sebelum setup ulang.');
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#242420').setFontColor('#fff9ed');
    sh.setFrozenRows(1);
  });
  var config = ss.getSheetByName('Master_Config');
  config.getRange('C:C').setNumberFormat('@');
  ss.getSheetByName('Log_Transaksi').getRange('C:C').setNumberFormat('@');
  ss.getSheetByName('Rekap_Shift').getRange('B:B').setNumberFormat('@');
  ss.getSheetByName('Laporan_Admin').getRange('A:A').setNumberFormat('@');
  if (config.getLastRow() === 1) {
    config.getRange(2, 1, 3, 10).setValues([
      ['CBG-001','Cabang Utama','0000',50000,26000,'MN-AYM','Cuanki Ayam Bawang',18000,11500,true],
      ['CBG-001','Cabang Utama','0000',50000,26000,'MN-KRE','Cuanki Kare Pedas',18000,11500,true],
      ['CBG-001','Cabang Utama','0000',50000,26000,'MN-CKJ','Cuanki Creamy Keju',20000,18500,true]
    ]);
  }
  var shifts = ss.getSheetByName('Rekap_Shift');
  if (shifts.getLastRow() > 1) {
    var oldRows = shifts.getRange(2,1,shifts.getLastRow()-1,24).getValues();
    oldRows.forEach(function(row,index) {
      if (row[0] && !row[23]) shifts.getRange(index+2,24).setValue('CLOSED');
    });
  }
  repairFormulas();
  var report = ss.getSheetByName('Laporan_Admin');
  report.getRange('C:R').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  report.getRange('S:S').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  report.getRange('U:U').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  ss.getSheetByName('Log_Transaksi').getRange('J:O').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  ss.getSheetByName('Rekap_Shift').getRange('K:W').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  var starter = ss.getSheetByName('Sheet1');
  if (starter && starter.getLastRow() === 0 && ss.getSheets().length > 5) ss.deleteSheet(starter);
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
      result = login_(p);
    } else if (p.action === 'OPEN_SHIFT') {
      result = openShift_(p);
    } else if (p.action === 'GET_SHIFT') {
      result = getShift_(p);
    } else if (p.action === 'CREATE_TRANSACTION') {
      result = createTransactions_(p);
    } else if (p.action === 'CLOSE_SHIFT') {
      result = closeShiftV2_(p);
    } else throw new Error('Action tidak dikenal.');
    SpreadsheetApp.flush();
    return json_(result);
  } catch (err) {
    return json_({ok:false, error:err.message});
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function login_(p) {
  var id = safeId_(p.branch_id, 'branch_id');
  var branch = configMap_()[id];
  var cache = CacheService.getScriptCache();
  var key = 'pin-fails:' + id;
  var fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw new Error('Terlalu banyak percobaan PIN. Tunggu 15 menit.');
  var valid = !!branch && String(p.pin_code) === branch.pin && /^\d{4,8}$/.test(branch.pin);
  if (!valid) {
    cache.put(key, String(fails + 1), 900);
    return {ok:true, valid:false};
  }
  cache.remove(key);
  var expiresAt = Date.now() + 16 * 60 * 60 * 1000;
  var data = Utilities.base64EncodeWebSafe(JSON.stringify({branch_id:id, exp:expiresAt}));
  var secret = sessionSecret_();
  var signature = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(data, secret));
  return {ok:true, valid:true, session_token:data + '.' + signature, expires_at:expiresAt};
}

function sessionSecret_() {
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty('SESSION_SECRET', secret);
  }
  return secret;
}

function authorizedSession_(p, branchId) {
  var token = String(p.session_token || '');
  var parts = token.split('.');
  if (parts.length !== 2) throw new Error('Sesi tidak valid. Masuk ulang.');
  var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], sessionSecret_()));
  if (parts[1] !== expected) throw new Error('Sesi tidak valid. Masuk ulang.');
  var claims;
  try { claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); }
  catch (err) { throw new Error('Sesi tidak valid. Masuk ulang.'); }
  if (claims.branch_id !== branchId || !claims.exp || Date.now() > claims.exp) throw new Error('Sesi berakhir. Masuk ulang.');
  var branch = configMap_()[branchId];
  if (!branch) throw new Error('Cabang tidak aktif.');
  return branch;
}

function shiftRow_(shifts, id) {
  var n = shifts.getLastRow();
  if (n < 2) return 0;
  var ids = shifts.getRange(2,1,n-1,1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

function openShift_(p) {
  var s = p.shift || p;
  var id = safeId_(s.shift_id, 'shift_id');
  var branchId = safeId_(s.branch_id, 'branch_id');
  var branch = authorizedSession_(p, branchId);
  var date = String(s.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Tanggal shift tidak valid.');
  var today = Utilities.formatDate(new Date(), database_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  if (date !== today) throw new Error('Shift baru hanya dapat dibuka untuk tanggal hari ini.');
  var bawa = whole_(s.cup_bawa, 'cup_bawa');
  if (bawa < 1) throw new Error('Cup Bawa minimal 1.');
  var modal = money_(s.modal_awal, 'modal_awal');
  var shifts = database_().getSheetByName('Rekap_Shift');
  var found = shiftRow_(shifts, id);
  if (found) {
    var existing = shifts.getRange(found,2,1,24).getValues()[0];
    if (String(existing[0]) !== date || String(existing[1]) !== branchId || Number(existing[3]) !== bawa || Number(existing[9]) !== modal) throw new Error('Data pembukaan shift berbeda dari yang tersimpan.');
    return {ok:true, shift_id:id, opened:true, closed:String(existing[22]) === 'CLOSED'};
  }
  if (hasBranchDate_(shifts,date,branchId)) throw new Error('Cabang ini sudah memiliki shift pada tanggal tersebut.');
  shifts.appendRow([id,date,branchId,safeText_(s.cashier_name,'cashier_name',80),bawa,'','','','','',modal,0,0,0,0,0,0,0,'',0,'',branch.wage,branch.rent,'OPEN',new Date()]);
  return {ok:true, shift_id:id, opened:true, closed:false};
}

function shiftTotals_(id) {
  var sheet = database_().getSheetByName('Log_Transaksi');
  var rows = sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,17).getValues() : [];
  var totals = {cups:0, cash:0, qris:0, revenue:0};
  rows.forEach(function(row) {
    if (String(row[15]) !== id) return;
    totals.cups += Number(row[8]) || 0;
    totals.revenue += Number(row[9]) || 0;
    if (row[10] === 'QRIS') totals.qris += Number(row[9]) || 0;
    else totals.cash += Number(row[9]) || 0;
  });
  return totals;
}

function getShift_(p) {
  var branchId = safeId_(p.branch_id, 'branch_id');
  authorizedSession_(p, branchId);
  var shifts = database_().getSheetByName('Rekap_Shift');
  var id = p.shift_id ? safeId_(p.shift_id, 'shift_id') : '';
  var row = id ? shiftRow_(shifts, id) : 0;
  if (!row && p.date && shifts.getLastRow() > 1) {
    var pairs = shifts.getRange(2,2,shifts.getLastRow()-1,2).getValues();
    for (var i = 0; i < pairs.length; i++) if (String(pairs[i][0]) === String(p.date) && String(pairs[i][1]) === branchId) { row = i + 2; break; }
  }
  if (!row) return {ok:true, found:false};
  var data = shifts.getRange(row,1,1,25).getValues()[0];
  if (String(data[2]) !== branchId) throw new Error('Shift bukan milik cabang ini.');
  return {ok:true, found:true, shift_id:String(data[0]), closed:String(data[23]) === 'CLOSED', cup_bawa:Number(data[4]), modal_awal:Number(data[10]), totals:shiftTotals_(String(data[0]))};
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
  items.forEach(function(t) {
    var id = safeId_(t.trx_id, 'trx_id');
    var branchId = safeId_(t.branch_id || p.branch_id, 'branch_id');
    var b = authorizedSession_(p, branchId);
    if (known[id] || pending[id]) { duplicates.push(id); return; }
    pending[id] = true;
    var shiftId = safeId_(t.shift_id, 'shift_id');
    var shiftSheet = database_().getSheetByName('Rekap_Shift');
    var shiftRow = shiftRow_(shiftSheet, shiftId);
    if (!shiftRow) throw new Error('Buka shift sebelum mencatat transaksi.');
    var shift = shiftSheet.getRange(shiftRow,1,1,25).getValues()[0];
    if (String(shift[2]) !== branchId || String(shift[23]) !== 'OPEN') throw new Error('Shift tidak aktif.');
    var items = t.items;
    if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('Keranjang transaksi kosong atau terlalu besar.');
    var q = [0,0,0], revenue = [0,0,0], hpp = 0, total = 0, cups = 0, seen = {}, snapshots = [];
    var skus = ['MN-AYM','MN-KRE','MN-CKJ'];
    items.forEach(function(item) {
      var sku = safeId_(item.sku_code, 'sku_code');
      if (seen[sku]) throw new Error('SKU ganda dalam transaksi.');
      seen[sku] = true;
      var n = whole_(item.qty, 'qty');
      if (n < 1 || !b.menus[sku]) throw new Error('Menu tidak aktif atau jumlah tidak valid: ' + sku);
      var amount = n * b.menus[sku].price;
      total += amount; cups += n; hpp += n * b.menus[sku].hpp;
      snapshots.push({sku_code:sku, menu_name:b.menus[sku].name, qty:n,
        sell_price:b.menus[sku].price, hpp_cost:b.menus[sku].hpp, amount:amount, hpp_total:n*b.menus[sku].hpp});
      var index = skus.indexOf(sku);
      if (index >= 0) { q[index] = n; revenue[index] = amount; }
    });
    var already = shiftTotals_(shiftId).cups;
    var inBatch = rows.filter(function(x) { return x[15] === shiftId; }).reduce(function(sum,x) { return sum + Number(x[8]); },0);
    if (already + inBatch + cups > Number(shift[4])) throw new Error('Jumlah cup melebihi Cup Bawa.');
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(hpp)) throw new Error('Nominal transaksi terlalu besar.');
    if (t.total_amount !== undefined && money_(t.total_amount, 'total_amount') !== total) throw new Error('Total transaksi tidak cocok dengan harga menu.');
    var method = String(t.payment_method || '').toUpperCase();
    if (method !== 'TUNAI' && method !== 'QRIS') throw new Error('payment_method harus TUNAI atau QRIS.');
    var time = t.timestamp ? new Date(t.timestamp) : new Date();
    if (isNaN(time.getTime())) throw new Error('timestamp tidak valid.');
    var saleDate = String(shift[1]);
    rows.push([id,time,saleDate,branchId,safeText_(t.cashier_name,'cashier_name',80),q[0],q[1],q[2],cups,total,method,revenue[0],revenue[1],revenue[2],hpp,shiftId,JSON.stringify(snapshots)]);
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

function closeShiftV2_(p) {
  var s = p.shift || p;
  var id = safeId_(s.shift_id, 'shift_id');
  var branchId = safeId_(s.branch_id, 'branch_id');
  authorizedSession_(p, branchId);
  var ss = database_(), shifts = ss.getSheetByName('Rekap_Shift');
  var row = shiftRow_(shifts, id);
  if (!row) throw new Error('Shift belum dibuka.');
  var values = shifts.getRange(row,1,1,25).getValues()[0];
  if (String(values[2]) !== branchId) throw new Error('Shift bukan milik cabang ini.');
  if (String(values[23]) === 'CLOSED') {
    refreshMenuReport_(ss,id,String(values[1]),branchId);
    return {ok:true, duplicate:true, shift_id:id, report_row:ensureReport_(ss,String(values[1]),branchId)};
  }
  if (String(values[23]) !== 'OPEN') throw new Error('Status shift tidak valid.');
  var totals = shiftTotals_(id);
  var sisa = whole_(s.cup_sisa,'cup_sisa'), reject = whole_(s.cup_reject,'cup_reject');
  var bawa = Number(values[4]);
  if (sisa + reject > bawa) throw new Error('Cup Sisa + Reject melebihi Cup Bawa.');
  var lampu = money_(s.op_lampu || 0,'op_lampu'), kebersihan = money_(s.op_kebersihan || 0,'op_kebersihan');
  var penitipan = money_(s.op_penitipan || 0,'op_penitipan'), galon = money_(s.op_galon || 0,'op_galon');
  var other = 0, names = [];
  if (s.other_expenses !== undefined) {
    if (!Array.isArray(s.other_expenses) || s.other_expenses.length > 50) throw new Error('Pengeluaran lain maksimal 50.');
    s.other_expenses.forEach(function(x) {
      var amount = money_(x.amount,'nominal pengeluaran');
      other += amount;
      names.push(safeText_(x.name,'nama pengeluaran',80) + ': Rp' + amount);
    });
  }
  var op = lampu + kebersihan + penitipan + galon + other;
  if (op > totals.cash) throw new Error('Operasional melebihi penjualan tunai shift.');
  var physical = money_(s.tunai_fisik_laci,'tunai_fisik_laci');
  var mode = String(s.cash_count_mode || 'FULL_DRAWER');
  if (mode !== 'FULL_DRAWER' && mode !== 'SALES_ONLY') throw new Error('Mode hitung kas tidak valid.');
  var fullDrawer = mode === 'SALES_ONLY' ? physical + Number(values[10]) : physical;
  shifts.getRange(row,6,1,2).setValues([[sisa,reject]]);
  shifts.getRange(row,8).setValue(bawa-sisa-reject);
  shifts.getRange(row,12,1,2).setValues([[0,totals.qris]]);
  shifts.getRange(row,14,1,8).setValues([[lampu,kebersihan,penitipan,galon,other,names.join('; '),op,fullDrawer]]);
  shifts.getRange(row,24).setValue('CLOSED');
  setShiftFormulas_(shifts,row);
  refreshMenuReport_(ss,id,String(values[1]),branchId);
  return {ok:true, shift_id:id, totals:totals, report_row:ensureReport_(ss,String(values[1]),branchId)};
}

function refreshMenuReport_(ss,shiftId,date,branchId) {
  var report = ss.getSheetByName('Laporan_Menu');
  var log = ss.getSheetByName('Log_Transaksi');
  if (!report) throw new Error('Jalankan setupDatabase() untuk membuat Laporan_Menu.');
  if (report.getLastRow() > 1) {
    var ids = report.getRange(2,3,report.getLastRow()-1,1).getValues();
    if (ids.some(function(x) { return String(x[0]) === shiftId; })) return;
  }
  var rows = log.getLastRow() > 1 ? log.getRange(2,1,log.getLastRow()-1,17).getValues() : [];
  var totals = {};
  rows.forEach(function(row) {
    if (String(row[15]) !== shiftId) return;
    var items = JSON.parse(String(row[16] || '[]'));
    items.forEach(function(item) {
      var sku = item.sku_code;
      if (!totals[sku]) totals[sku] = {name:item.menu_name,qty:0,revenue:0,hpp:0};
      totals[sku].qty += Number(item.qty);
      totals[sku].revenue += Number(item.amount);
      totals[sku].hpp += Number(item.hpp_total);
    });
  });
  var result = Object.keys(totals).map(function(sku) {
    var x = totals[sku];
    return [date,branchId,shiftId,sku,x.name,x.qty,x.revenue,x.hpp,x.revenue-x.hpp];
  });
  if (result.length) report.getRange(report.getLastRow()+1,1,result.length,9).setValues(result);
}

function setShiftFormulas_(shifts,row) {
  var sep = formulaSeparator_(shifts.getParent());
  shifts.getRange(row,9).setFormula('=SUMIFS(Log_Transaksi!$I$2:$I'+sep+'Log_Transaksi!$C$2:$C'+sep+'B'+row+sep+'Log_Transaksi!$D$2:$D'+sep+'C'+row+')');
  shifts.getRange(row,10).setFormula('=H'+row+'-I'+row);
}

function repairFormulas() {
  var ss = database_();
  var report = ss.getSheetByName('Laporan_Admin');
  var shifts = ss.getSheetByName('Rekap_Shift');
  if (!report || !shifts) throw new Error('Jalankan setupDatabase() terlebih dahulu.');
  var last = Math.max(2, report.getLastRow());
  var sep = formulaSeparator_(ss);
  var formulas = [];
  for (var r = 2; r <= last; r++) formulas.push(reportFormulas_(r, sep));
  report.getRange(2, 3, formulas.length, 18).setFormulas(formulas);
  report.getRange(2, 21, formulas.length, 1).setFormulas(formulas.map(function(_,index) {
    var row = index + 2;
    return ['=IF(OR($A'+row+'=""'+sep+'$B'+row+'="")'+sep+'""'+sep+'I'+row+'-SUM(F'+row+':H'+row+'))'];
  }));
  for (var row = 2; row <= shifts.getLastRow(); row++) setShiftFormulas_(shifts, row);
  SpreadsheetApp.flush();
  if (report.getRange('C2').getDisplayValue() === '#ERROR!') {
    throw new Error('Rumus masih gagal diparse. Periksa File > Setelan > Lokalitas dan kirim formula C2.');
  }
  return 'Rumus Laporan_Admin dan Rekap_Shift diperbarui untuk locale ' + ss.getSpreadsheetLocale() + '.';
}

function formulaSeparator_(ss) {
  return /^id(?:_|$)/i.test(String(ss.getSpreadsheetLocale())) ? ';' : ',';
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
  if (row > 2) report.getRange(2,3,1,19).copyTo(report.getRange(row,3,1,19));
  report.getRange(row,1,1,2).setValues([[date,branchId]]);
  return row;
}

function reportFormulas_(r) {
  var sep = arguments.length > 1 ? arguments[1] : formulaSeparator_(database_());
  var guard = 'OR($A'+r+'=""'+sep+'$B'+r+'="")';
  function sh(col) { return 'SUMIFS(Rekap_Shift!$'+col+'$2:$'+col+sep+'Rekap_Shift!$B$2:$B'+sep+'$A'+r+sep+'Rekap_Shift!$C$2:$C'+sep+'$B'+r+')'; }
  function tx(col) { return 'SUMIFS(Log_Transaksi!$'+col+'$2:$'+col+sep+'Log_Transaksi!$C$2:$C'+sep+'$A'+r+sep+'Log_Transaksi!$D$2:$D'+sep+'$B'+r+')'; }
  function f(body) { return '=IF('+guard+sep+'""'+sep+body+')'; }
  return [f(sh('K')),f(sh('L')),f(sh('M')),f(tx('L')),f(tx('M')),f(tx('N')),
    f(tx('J')),f('I'+r+'+C'+r),f(sh('T')),
    f('J'+r+'-K'+r+'-(E'+r+'-D'+r+')-C'+r),f('L'+r+'+(E'+r+'-D'+r+')'),
    f(sh('V')),f('M'+r+'-N'+r),f(sh('W')),f(tx('O')),
    f('O'+r+'-P'+r+'-Q'+r),f(sh('U')+'-(C'+r+'+L'+r+')'),
    f('IF(AND(S'+r+'=0'+sep+sh('J')+'=0)'+sep+'"SESUAI"'+sep+'"SELISIH")')];
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
      var sku = safeId_(x[5], 'sku_code');
      if (map[id].menus[sku]) throw new Error('SKU ganda untuk cabang ' + id + ': ' + sku);
      map[id].menus[sku] = {name:String(x[6]),price:price,hpp:hpp};
    }
  });
  return map;
}

function authorizedBranch_(map,id,pin) {
  var b = map[id];
  if (!b || !/^\d{4,8}$/.test(b.pin) || String(pin) !== b.pin) throw new Error('Cabang atau PIN tidak valid.');
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
