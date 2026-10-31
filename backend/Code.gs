/**
 * Cuanki POS - Google Apps Script bound to the Google Sheets database.
 * - Run setupDatabase() once to initialize or migrate schema to Normalized Master Tables.
 * - Run resetDatabase() anytime during testing to wipe transactional data and start fresh from 0 data.
 * Browser POST: Content-Type: text/plain;charset=utf-8; body: JSON.stringify(payload).
 */
var TABLES = {
  Master_Cabang: ['branch_id','branch_name','daily_wage','daily_rent','is_active'],
  Master_Menu: ['sku_code','menu_name','sell_price','hpp_cost','is_active'],
  Master_Kasir: ['username','cashier_name','pin_code','is_active'],
  Log_Transaksi: ['trx_id','timestamp','date','branch_id','shift_id','cashier_name','rincian_menu','total_cups','total_amount','hpp_total','payment_method','items_json'],
  Rekap_Shift: ['shift_id','date','branch_id','cashier_name','cup_bawa','cup_sisa','cup_reject','cup_fisik','cup_sistem','selisih_cup','modal_awal','penjualan_tunai','qris_sistem','op_lampu','op_kebersihan','op_penitipan','op_galon','op_lain_nominal','op_lain_detail','total_op','tunai_fisik_laci','daily_wage_snapshot','daily_rent_snapshot','status','opened_at','bumbu_bawa_json','bumbu_sisa_json','bonus_penjualan','total_gaji'],
  Laporan_Admin: ['date','branch_id','modal_awal','penjualan_tunai','qris_sistem','omset_penjualan','total_operasional','kas_sistem_tanpa_modal','total_penerimaan','gaji_karyawan','laba_kotor','sewa_lahan','total_hpp','laba_bersih','kas_laci_seharusnya','tunai_fisik_laci','selisih_kas_laci','status_audit'],
  Laporan_Menu: ['date','branch_id','shift_id','sku_code','menu_name','bumbu_bawa','bumbu_sisa','bumbu_fisik_terpakai','qty_pos','selisih_bumbu','omset','total_hpp','laba_kotor']
};

function setupDatabase() {
  var ss = database_();
  ss.setSpreadsheetTimeZone('Asia/Jakarta');

  var legacyConfig = ss.getSheetByName('Master_Config');
  var migratedBranches = [];
  var migratedMenus = [];
  if (legacyConfig && legacyConfig.getLastRow() > 1) {
    var legacyRows = legacyConfig.getRange(2, 1, legacyConfig.getLastRow() - 1, 10).getValues();
    var seenBranches = {}, seenMenus = {};
    legacyRows.forEach(function(r) {
      var bId = String(r[0] || '').trim();
      if (bId && !seenBranches[bId]) {
        seenBranches[bId] = true;
        migratedBranches.push([bId, String(r[1] || bId).trim(), Number(r[3]) || 50000, Number(r[4]) || 26000, r[9] === true || String(r[9]).toUpperCase() === 'TRUE']);
      }
      var sku = String(r[5] || '').trim();
      if (sku && !seenMenus[sku]) {
        seenMenus[sku] = true;
        migratedMenus.push([sku, String(r[6] || sku).trim(), Number(r[7]) || 18000, Number(r[8]) || 11500, r[9] === true || String(r[9]).toUpperCase() === 'TRUE']);
      }
    });
  }

  Object.keys(TABLES).forEach(function(name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = TABLES[name];
    var maxCols = Math.max(headers.length, sh.getLastColumn() || headers.length);
    var current = sh.getRange(1, 1, 1, maxCols).getValues()[0].filter(function(x) { return x !== ''; });
    if (current.length && current.join('|') !== headers.join('|')) {
      if (sh.getLastRow() <= 1) {
        sh.clear();
      }
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#231919').setFontColor('#fbf5f3');
    sh.setFrozenRows(1);
  });

  var branchesSheet = ss.getSheetByName('Master_Cabang');
  var menusSheet = ss.getSheetByName('Master_Menu');
  var cashiersSheet = ss.getSheetByName('Master_Kasir');
  var logSheet = ss.getSheetByName('Log_Transaksi');
  var shiftsSheet = ss.getSheetByName('Rekap_Shift');
  var reportSheet = ss.getSheetByName('Laporan_Admin');
  var menuReportSheet = ss.getSheetByName('Laporan_Menu');

  cashiersSheet.getRange('C:C').setNumberFormat('@');
  logSheet.getRange('C:C').setNumberFormat('@');
  shiftsSheet.getRange('B:B').setNumberFormat('@');
  reportSheet.getRange('A:A').setNumberFormat('@');
  menuReportSheet.getRange('A:A').setNumberFormat('@');

  if (branchesSheet.getLastRow() === 1) {
    var seedBranches = migratedBranches.length ? migratedBranches : [
      ['CBG-001','Cabang Utama',50000,26000,true]
    ];
    branchesSheet.getRange(2, 1, seedBranches.length, 5).setValues(seedBranches);
  }
  if (menusSheet.getLastRow() === 1) {
    var seedMenus = migratedMenus.length ? migratedMenus : [
      ['MN-AYM','Cuanki Ayam Bawang',18000,11500,true],
      ['MN-KRE','Cuanki Kare Pedas',18000,11500,true],
      ['MN-CKJ','Cuanki Creamy Keju',20000,18500,true]
    ];
    menusSheet.getRange(2, 1, seedMenus.length, 5).setValues(seedMenus);
  }
  if (cashiersSheet.getLastRow() === 1) {
    cashiersSheet.getRange(2, 1, 1, 4).setValues([
      ['kasir1','Kasir Utama','0000',true]
    ]);
  }

  branchesSheet.getRange('C:D').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  menusSheet.getRange('C:D').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  logSheet.getRange('I:J').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  shiftsSheet.getRange('K:R').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  shiftsSheet.getRange('T:W').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  reportSheet.getRange('C:Q').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');
  menuReportSheet.getRange('F:J').setNumberFormat('#,##0;(#,##0)');
  menuReportSheet.getRange('K:M').setNumberFormat('"Rp"#,##0;("Rp"#,##0)');

  repairFormulas();

  if (legacyConfig && ss.getSheets().length > 1) {
    ss.deleteSheet(legacyConfig);
  }
  var starter = ss.getSheetByName('Sheet1');
  if (starter && starter.getLastRow() === 0 && ss.getSheets().length > 5) {
    ss.deleteSheet(starter);
  }
  return 'Database siap dengan skema Master_Cabang, Master_Menu, dan Master_Kasir.';
}

/**
 * Jalankan fungsi ini dari editor Apps Script jika ingin mereset seluruh data transaksi & shift kembali ke 0
 * (data Master_Cabang, Master_Menu, dan Master_Kasir tetap dipertahankan).
 */
function resetDatabase() {
  var ss = database_();
  ['Log_Transaksi', 'Rekap_Shift', 'Laporan_Admin', 'Laporan_Menu'].forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (sh) sh.clear();
  });
  var legacy = ss.getSheetByName('Master_Config');
  if (legacy && ss.getSheets().length > 1) ss.deleteSheet(legacy);
  setupDatabase();
  return 'Seluruh data transaksi, shift, dan laporan berhasil di-reset ke 0.';
}

function doGet(e) {
  try {
    var action = e && e.parameter ? e.parameter.action : '';
    if (action !== 'getConfig') throw new Error('Gunakan ?action=getConfig');
    var map = configMap_();
    var branches = Object.keys(map).map(function(id) {
      var b = map[id];
      return {
        branch_id: id,
        branch_name: b.name,
        daily_salary: b.wage,
        daily_rent: b.rent,
        menus: Object.keys(b.menus).map(function(sku) {
          var m = b.menus[sku];
          return {sku_code:sku, menu_name:m.name, sell_price:m.price};
        })
      };
    }).filter(function(b) { return b.menus.length > 0; });
    return json_({ok:true, branches:branches, pin_required:true});
  } catch (err) { return json_({ok:false, error:err.message}); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Body JSON kosong.');
    var p = JSON.parse(e.postData.contents);
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Payload harus objek JSON.');
    lock.waitLock(30000);
    var result;
    if (p.action === 'VALIDATE_PIN' || p.action === 'LOGIN') {
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
  var cache = CacheService.getScriptCache();
  if (p.username !== undefined && String(p.username).trim() !== '') {
    var rawUser = safeText_(p.username, 'username', 80);
    var userKey = rawUser.toLowerCase();
    var rateKey = 'pin-fails:user:' + userKey;
    var userFails = Number(cache.get(rateKey) || 0);
    if (userFails >= 5) throw new Error('Terlalu banyak percobaan login. Tunggu 15 menit.');
    var accounts = cashiersMap_();
    var account = accounts.byUsername[userKey] || accounts.byName[userKey];
    var validUser = !!account && String(p.pin_code) === account.pin && /^\d{4,8}$/.test(account.pin);
    if (!validUser) {
      cache.put(rateKey, String(userFails + 1), 900);
      return {ok:true, valid:false};
    }
    cache.remove(rateKey);
    var userExpiresAt = Date.now() + 16 * 60 * 60 * 1000;
    var userData = Utilities.base64EncodeWebSafe(JSON.stringify({username:account.username, cashier_name:account.name, exp:userExpiresAt}));
    var userSig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(userData, sessionSecret_()));
    return {ok:true, valid:true, username:account.username, cashier_name:account.name, session_token:userData + '.' + userSig, expires_at:userExpiresAt};
  }
  var id = safeId_(p.branch_id, 'branch_id');
  var branch = configMap_()[id];
  var key = 'pin-fails:' + id;
  var fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw new Error('Terlalu banyak percobaan PIN. Tunggu 15 menit.');
  var valid = !!branch && !!branch.pin && String(p.pin_code) === branch.pin && /^\d{4,8}$/.test(branch.pin);
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
  if (!claims.exp || Date.now() > claims.exp) throw new Error('Sesi berakhir. Masuk ulang.');
  if (claims.branch_id && claims.branch_id !== branchId) throw new Error('Sesi tidak valid. Masuk ulang.');
  if (claims.username && !cashiersMap_().byUsername[String(claims.username).toLowerCase()]) throw new Error('Akun kasir tidak aktif.');
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

function parseJsonMap_(raw) {
  if (!raw) return {};
  try {
    var obj = typeof raw === 'object' ? raw : JSON.parse(String(raw));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (e) {
    return {};
  }
}

function sanitizeBumbuMap_(rawMap, label) {
  var result = {};
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return result;
  Object.keys(rawMap).forEach(function(sku) {
    var cleanSku = safeId_(sku, 'sku_code');
    result[cleanSku] = whole_(rawMap[sku], label + ' ' + cleanSku);
  });
  return result;
}

function calculateBonus_(cups) {
  var c = Math.max(0, Math.floor(Number(cups) || 0));
  if (c <= 50) return 0;
  return Math.min(50000, (c - 50) * 1000);
}

function openShift_(p) {
  var s = p.shift || p;
  var id = safeId_(s.shift_id, 'shift_id');
  var branchId = safeId_(s.branch_id, 'branch_id');
  var branch = authorizedSession_(p, branchId);
  var date = String(s.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Tanggal shift tidak valid.');
  var today = Utilities.formatDate(new Date(), database_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  if (date !== today) throw new Error('Shift baru hanya dapat dibuka untuk tanggal hari ini.');
  var bumbuBawa = sanitizeBumbuMap_(s.bumbu_bawa, 'bumbu_bawa');
  var bumbuKeys = Object.keys(bumbuBawa);
  var totalBumbuBawa = bumbuKeys.reduce(function(sum, k) { return sum + bumbuBawa[k]; }, 0);
  if (bumbuKeys.length > 0 && totalBumbuBawa < 1) {
    throw new Error('Total stok bumbu bawa awal minimal 1 bungkus.');
  }
  var bawa = s.cup_bawa !== undefined && s.cup_bawa !== null && s.cup_bawa !== ''
    ? whole_(s.cup_bawa, 'cup_bawa')
    : totalBumbuBawa;
  if (bawa < 1) throw new Error('Cup Bawa minimal 1.');
  if (bumbuKeys.length > 0 && bawa < totalBumbuBawa) {
    throw new Error('Cup Bawa tidak boleh kurang dari total bungkus bumbu yang dibawa.');
  }
  var modal = money_(s.modal_awal, 'modal_awal');
  if (modal <= 0) throw new Error('Modal awal kas wajib diisi dan harus lebih dari Rp0.');
  var shifts = database_().getSheetByName('Rekap_Shift');
  var found = shiftRow_(shifts, id);
  if (found) {
    var existing = shifts.getRange(found,2,1,28).getValues()[0];
    if (dateStr_(existing[0]) !== date || String(existing[1]) !== branchId || Number(existing[3]) !== bawa || Number(existing[9]) !== modal) {
      throw new Error('Data pembukaan shift berbeda dari yang tersimpan.');
    }
    return {ok:true, shift_id:id, opened:true, closed:String(existing[22]) === 'CLOSED', bumbu_bawa:parseJsonMap_(existing[24])};
  }
  if (shifts.getLastRow() > 1) {
    var openRows = shifts.getRange(2,1,shifts.getLastRow()-1,24).getValues();
    openRows.forEach(function(r, idx) {
      if (dateStr_(r[1]) === date && String(r[2]) === branchId && String(r[23]) === 'OPEN') {
        shifts.getRange(idx + 2, 24).setValue('CLOSED');
      }
    });
  }
  var nextRow = shifts.getLastRow() + 1;
  shifts.getRange(nextRow, 2).setNumberFormat('@');
  shifts.getRange(nextRow, 1, 1, 29).setValues([[
    id, date, branchId, safeText_(s.cashier_name,'cashier_name',80),
    bawa, '', '', '', '', '',
    modal, 0, 0, 0, 0, 0, 0, 0, '', 0, '',
    branch.wage, branch.rent, 'OPEN', new Date(),
    bumbuKeys.length ? JSON.stringify(bumbuBawa) : '', '',
    0, branch.wage
  ]]);
  setShiftFormulas_(shifts, nextRow);
  return {ok:true, shift_id:id, opened:true, closed:false, bumbu_bawa:bumbuBawa};
}

function shiftTotals_(id) {
  var sheet = database_().getSheetByName('Log_Transaksi');
  var rows = sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,12).getValues() : [];
  var totals = {cups:0, cash:0, qris:0, revenue:0, by_sku:{}};
  rows.forEach(function(row) {
    if (String(row[4]) !== id) return;
    var amount = Number(row[8]) || 0;
    totals.cups += Number(row[7]) || 0;
    totals.revenue += amount;
    if (String(row[10]).toUpperCase() === 'QRIS') totals.qris += amount;
    else totals.cash += amount;
    try {
      var items = JSON.parse(String(row[11] || '[]'));
      if (Array.isArray(items)) {
        items.forEach(function(it) {
          if (it && it.sku_code) {
            totals.by_sku[it.sku_code] = (totals.by_sku[it.sku_code] || 0) + (Number(it.qty) || 0);
          }
        });
      }
    } catch (e) {}
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
    var pairs = shifts.getRange(2,2,shifts.getLastRow()-1,23).getValues();
    for (var i = pairs.length - 1; i >= 0; i--) {
      if (dateStr_(pairs[i][0]) === String(p.date) && String(pairs[i][1]) === branchId) {
        row = i + 2;
        if (String(pairs[i][22]) === 'OPEN') break;
      }
    }
  }
  if (!row) return {ok:true, found:false};
  var data = shifts.getRange(row,1,1,29).getValues()[0];
  if (String(data[2]) !== branchId) throw new Error('Shift bukan milik cabang ini.');
  var totals = shiftTotals_(String(data[0]));
  var wage = Number(data[21]) || 0;
  var bonus = calculateBonus_(totals.cups);
  return {
    ok:true,
    found:true,
    shift_id:String(data[0]),
    closed:String(data[23]) === 'CLOSED',
    cup_bawa:Number(data[4]),
    modal_awal:Number(data[10]),
    daily_wage:wage,
    daily_rent:Number(data[22]) || 0,
    bonus_penjualan:bonus,
    total_gaji:wage + bonus,
    bumbu_bawa:parseJsonMap_(data[25]),
    bumbu_sisa:parseJsonMap_(data[26]),
    totals:totals
  };
}

function createTransactions_(p) {
  var items = Array.isArray(p.transactions) ? p.transactions : [p.transaction || p];
  if (!items.length || items.length > 100) throw new Error('Batch harus berisi 1-100 transaksi.');
  var sheet = database_().getSheetByName('Log_Transaksi');
  var known = idSet_(sheet);
  var pending = {};
  var rows = [];
  var batchSkuCounts = {};
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
    var shift = shiftSheet.getRange(shiftRow,1,1,27).getValues()[0];
    if (String(shift[2]) !== branchId || String(shift[23]) !== 'OPEN') throw new Error('Shift tidak aktif.');
    var bumbuBawa = parseJsonMap_(shift[25]);
    var currentTotals = shiftTotals_(shiftId);
    var alreadyBySku = currentTotals.by_sku || {};
    if (!batchSkuCounts[shiftId]) batchSkuCounts[shiftId] = {};
    var cartItems = t.items;
    if (!Array.isArray(cartItems) || !cartItems.length || cartItems.length > 100) throw new Error('Keranjang transaksi kosong atau terlalu besar.');
    var hpp = 0, total = 0, cups = 0, seen = {}, snapshots = [], summaryParts = [];
    cartItems.forEach(function(item) {
      var sku = safeId_(item.sku_code, 'sku_code');
      if (seen[sku]) throw new Error('SKU ganda dalam transaksi.');
      seen[sku] = true;
      var n = whole_(item.qty, 'qty');
      if (n < 1 || !b.menus[sku]) throw new Error('Menu tidak aktif atau jumlah tidak valid: ' + sku);
      if (bumbuBawa[sku] !== undefined) {
        var soldSku = (alreadyBySku[sku] || 0) + (batchSkuCounts[shiftId][sku] || 0);
        if (soldSku + n > Number(bumbuBawa[sku])) {
          throw new Error('Stok bumbu ' + b.menus[sku].name + ' melebihi stok bawa (' + bumbuBawa[sku] + ' bungkus).');
        }
      }
      var amount = n * b.menus[sku].price;
      var itemHpp = n * b.menus[sku].hpp;
      total += amount;
      cups += n;
      hpp += itemHpp;
      summaryParts.push(n + 'x ' + b.menus[sku].name);
      snapshots.push({
        sku_code:sku,
        menu_name:b.menus[sku].name,
        qty:n,
        sell_price:b.menus[sku].price,
        hpp_cost:b.menus[sku].hpp,
        amount:amount,
        hpp_total:itemHpp
      });
    });
    var already = currentTotals.cups;
    var inBatch = rows.filter(function(x) { return x[4] === shiftId; }).reduce(function(sum,x) { return sum + Number(x[7]); },0);
    if (already + inBatch + cups > Number(shift[4])) throw new Error('Jumlah cup melebihi Cup Bawa.');
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(hpp)) throw new Error('Nominal transaksi terlalu besar.');
    if (t.total_amount !== undefined && money_(t.total_amount, 'total_amount') !== total) throw new Error('Total transaksi tidak cocok dengan harga menu.');
    var method = String(t.payment_method || '').toUpperCase();
    if (method !== 'TUNAI' && method !== 'QRIS') throw new Error('payment_method harus TUNAI atau QRIS.');
    var time = t.timestamp ? new Date(t.timestamp) : new Date();
    if (isNaN(time.getTime())) throw new Error('timestamp tidak valid.');
    var saleDate = dateStr_(shift[1]);
    snapshots.forEach(function(sn) {
      batchSkuCounts[shiftId][sn.sku_code] = (batchSkuCounts[shiftId][sn.sku_code] || 0) + sn.qty;
    });
    rows.push([
      id, time, saleDate, branchId, shiftId,
      safeText_(t.cashier_name,'cashier_name',80),
      summaryParts.join(', '),
      cups, total, hpp, method,
      JSON.stringify(snapshots)
    ]);
  });
  if (rows.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 3, rows.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, 1, rows.length, 12).setValues(rows);
  }
  return {ok:true, inserted:rows.length, duplicate_ids:duplicates};
}

function closeShiftV2_(p) {
  var s = p.shift || p;
  var id = safeId_(s.shift_id, 'shift_id');
  var branchId = safeId_(s.branch_id, 'branch_id');
  authorizedSession_(p, branchId);
  var ss = database_(), shifts = ss.getSheetByName('Rekap_Shift');
  var row = shiftRow_(shifts, id);
  if (!row) throw new Error('Shift belum dibuka.');
  var values = shifts.getRange(row,1,1,29).getValues()[0];
  var shiftDate = dateStr_(values[1]);
  if (String(values[2]) !== branchId) throw new Error('Shift bukan milik cabang ini.');
  var storedBumbuBawa = parseJsonMap_(values[25]);
  var inputBumbuBawa = sanitizeBumbuMap_(s.bumbu_bawa, 'bumbu_bawa');
  var bumbuBawa = Object.keys(storedBumbuBawa).length ? storedBumbuBawa : inputBumbuBawa;
  var bumbuSisa = sanitizeBumbuMap_(s.bumbu_sisa, 'bumbu_sisa');
  Object.keys(bumbuSisa).forEach(function(sku) {
    if (bumbuBawa[sku] !== undefined && bumbuSisa[sku] > Number(bumbuBawa[sku])) {
      throw new Error('Sisa bumbu ' + sku + ' melebihi stok bawa awal (' + bumbuBawa[sku] + ').');
    }
  });
  if (String(values[23]) === 'CLOSED') {
    refreshMenuReport_(ss,id,shiftDate,branchId,bumbuBawa,parseJsonMap_(values[26] || s.bumbu_sisa));
    return {ok:true, duplicate:true, shift_id:id, report_row:ensureReport_(ss,shiftDate,branchId)};
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
  var modal = Number(values[10]) || 0;
  if (op > modal + totals.cash) throw new Error('Operasional melebihi total uang tunai di laci (Modal Awal + Penjualan Tunai).');
  var physical = money_(s.tunai_fisik_laci,'tunai_fisik_laci');
  var mode = String(s.cash_count_mode || 'FULL_DRAWER');
  if (mode !== 'FULL_DRAWER') throw new Error('Kas fisik harus mencakup seluruh isi laci termasuk modal awal.');
  shifts.getRange(row,6,1,2).setValues([[sisa,reject]]);
  shifts.getRange(row,8).setValue(bawa-sisa-reject);
  shifts.getRange(row,12,1,2).setValues([[totals.cash,totals.qris]]);
  shifts.getRange(row,14,1,8).setValues([[lampu,kebersihan,penitipan,galon,other,names.join('; '),op,physical]]);
  shifts.getRange(row,24).setValue('CLOSED');
  if (Object.keys(bumbuBawa).length || Object.keys(bumbuSisa).length) {
    shifts.getRange(row,26,1,2).setValues([[
      Object.keys(bumbuBawa).length ? JSON.stringify(bumbuBawa) : String(values[25] || ''),
      Object.keys(bumbuSisa).length ? JSON.stringify(bumbuSisa) : ''
    ]]);
  }
  var bonus = calculateBonus_(totals.cups);
  var wage = Number(values[21]) || 0;
  shifts.getRange(row,28,1,2).setValues([[bonus, wage + bonus]]);
  setShiftFormulas_(shifts,row);
  refreshMenuReport_(ss,id,shiftDate,branchId,bumbuBawa,bumbuSisa);
  return {ok:true, shift_id:id, totals:totals, bonus_penjualan:bonus, total_gaji:wage + bonus, report_row:ensureReport_(ss,shiftDate,branchId)};
}

function refreshMenuReport_(ss,shiftId,date,branchId,bumbuBawa,bumbuSisa) {
  var report = ss.getSheetByName('Laporan_Menu');
  var log = ss.getSheetByName('Log_Transaksi');
  if (!report) throw new Error('Jalankan setupDatabase() untuk membuat Laporan_Menu.');
  var headers = TABLES.Laporan_Menu;
  if (report.getLastRow() >= 1 && report.getRange(1, 1, 1, headers.length).getValues &&
      report.getRange(1, 1, 1, headers.length).getValues()[0].join('|') !== headers.join('|')) {
    report.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  if (report.getLastRow() > 1) {
    var ids = report.getRange(2,3,report.getLastRow()-1,1).getValues();
    if (ids.some(function(x) { return String(x[0]) === shiftId; })) return;
  }
  var rows = log.getLastRow() > 1 ? log.getRange(2,1,log.getLastRow()-1,12).getValues() : [];
  var totals = {};
  rows.forEach(function(row) {
    if (String(row[4]) !== shiftId) return;
    var items = JSON.parse(String(row[11] || '[]'));
    items.forEach(function(item) {
      var sku = item.sku_code;
      if (!totals[sku]) totals[sku] = {name:item.menu_name,qty:0,revenue:0,hpp:0};
      totals[sku].qty += Number(item.qty);
      totals[sku].revenue += Number(item.amount);
      totals[sku].hpp += Number(item.hpp_total);
    });
  });
  var menuCatalog = {};
  try {
    var branchCfg = configMap_()[branchId];
    if (branchCfg && branchCfg.menus) menuCatalog = branchCfg.menus;
  } catch (e) {}
  var bMap = bumbuBawa || {};
  var sMap = bumbuSisa || {};
  var allSkus = {};
  Object.keys(menuCatalog).forEach(function(k) { allSkus[k] = true; });
  Object.keys(bMap).forEach(function(k) { allSkus[k] = true; });
  Object.keys(sMap).forEach(function(k) { allSkus[k] = true; });
  Object.keys(totals).forEach(function(k) { allSkus[k] = true; });

  var result = Object.keys(allSkus).map(function(sku) {
    var sold = totals[sku] || {name:(menuCatalog[sku] ? menuCatalog[sku].name : sku), qty:0, revenue:0, hpp:0};
    var bawaQty = bMap[sku] !== undefined ? Number(bMap[sku]) : sold.qty;
    var sisaQty = sMap[sku] !== undefined ? Number(sMap[sku]) : 0;
    var fisikTerpakai = bawaQty - sisaQty;
    var selisihBumbu = fisikTerpakai - sold.qty;
    return [
      date, branchId, shiftId, sku, sold.name,
      bawaQty, sisaQty, fisikTerpakai, sold.qty, selisihBumbu,
      sold.revenue, sold.hpp, sold.revenue - sold.hpp
    ];
  });
  if (result.length) {
    var startRow = report.getLastRow() + 1;
    report.getRange(startRow, 1, result.length, 1).setNumberFormat('@');
    report.getRange(startRow, 1, result.length, 13).setValues(result);
  }
}

function setShiftFormulas_(shifts,row) {
  var sep = formulaSeparator_(shifts.getParent());
  shifts.getRange(row,9).setFormula('=SUMIFS(Log_Transaksi!$H$2:$H'+sep+'Log_Transaksi!$E$2:$E'+sep+'A'+row+')');
  shifts.getRange(row,10).setFormula('=IF(H'+row+'=""'+sep+'""'+sep+'H'+row+'-I'+row+')');
  shifts.getRange(row,28).setFormula('=IF(I'+row+'<=50'+sep+'0'+sep+'MIN(50000'+sep+'(I'+row+'-50)*1000))');
  shifts.getRange(row,29).setFormula('=V'+row+'+AB'+row);
}

function repairFormulas() {
  var ss = database_();
  var report = ss.getSheetByName('Laporan_Admin');
  var shifts = ss.getSheetByName('Rekap_Shift');
  if (!report || !shifts) throw new Error('Jalankan setupDatabase() terlebih dahulu.');
  var last = Math.max(2, report.getLastRow());
  var probe = report.getRange('C2');
  var sep = '';
  [';', ','].some(function(candidate) {
    probe.setFormula('=IF(1=1'+candidate+'1'+candidate+'0)');
    SpreadsheetApp.flush();
    if (probe.getValue() === 1) { sep = candidate; return true; }
    return false;
  });
  if (!sep) throw new Error('Tidak bisa menentukan pemisah rumus; locale=' + ss.getSpreadsheetLocale() + '.');
  PropertiesService.getScriptProperties().setProperty('FORMULA_SEPARATOR', sep);
  var formulas = [];
  for (var r = 2; r <= last; r++) formulas.push(reportFormulas_(r, sep));
  report.getRange(2, 3, formulas.length, 16).setFormulas(formulas);
  for (var row = 2; row <= shifts.getLastRow(); row++) setShiftFormulas_(shifts, row);
  SpreadsheetApp.flush();
  if (report.getRange('C2').getDisplayValue() === '#ERROR!') {
    throw new Error('Rumus C2 masih gagal diparse. locale=' + ss.getSpreadsheetLocale() +
      ', separator=' + sep + ', formula=' + report.getRange('C2').getFormula());
  }
  return 'Rumus Laporan_Admin dan Rekap_Shift diperbarui untuk locale ' + ss.getSpreadsheetLocale() + '.';
}

function formulaSeparator_(ss) {
  var saved = PropertiesService.getScriptProperties().getProperty('FORMULA_SEPARATOR');
  if (saved === ';' || saved === ',') return saved;
  return /^id(?:_|$)/i.test(String(ss.getSpreadsheetLocale())) ? ';' : ',';
}

function ensureReport_(ss,date,branchId) {
  var report = ss.getSheetByName('Laporan_Admin');
  var last = report.getLastRow();
  if (last > 1) {
    var pairs = report.getRange(2,1,last-1,2).getValues();
    var found = pairs.findIndex(function(x) { return dateStr_(x[0]) === date && String(x[1]) === branchId; });
    if (found >= 0) return found + 2;
  }
  var row = report.getRange('A2').isBlank() ? 2 : last + 1;
  report.getRange(row, 1).setNumberFormat('@');
  report.getRange(row, 1, 1, 2).setValues([[date,branchId]]);
  var sep = formulaSeparator_(ss);
  report.getRange(row, 3, 1, 16).setFormulas([reportFormulas_(row, sep)]);
  return row;
}

function reportFormulas_(r) {
  var sep = arguments.length > 1 ? arguments[1] : formulaSeparator_(database_());
  var guard = 'OR($A'+r+'=""'+sep+'$B'+r+'="")';
  function sh(col) { return 'SUMIFS(Rekap_Shift!$'+col+'$2:$'+col+sep+'Rekap_Shift!$B$2:$B'+sep+'$A'+r+sep+'Rekap_Shift!$C$2:$C'+sep+'$B'+r+')'; }
  function tx(col) { return 'SUMIFS(Log_Transaksi!$'+col+'$2:$'+col+sep+'Log_Transaksi!$C$2:$C'+sep+'$A'+r+sep+'Log_Transaksi!$D$2:$D'+sep+'$B'+r+')'; }
  function f(body) { return '=IF('+guard+sep+'""'+sep+body+')'; }
  return [
    f(sh('K')),
    f(sh('L')),
    f(sh('M')),
    f(tx('I')),
    f(sh('T')),
    f('D'+r+'-G'+r),
    f('H'+r+'+E'+r),
    f(sh('AC')),
    f('I'+r+'-J'+r),
    f(sh('W')),
    f(tx('J')),
    f('K'+r+'-L'+r+'-M'+r),
    f('C'+r+'+H'+r),
    f(sh('U')),
    f('P'+r+'-O'+r),
    f('IF(AND(Q'+r+'=0'+sep+sh('J')+'=0'+sep+'COUNTIFS(Laporan_Menu!$A$2:$A'+sep+'$A'+r+sep+'Laporan_Menu!$B$2:$B'+sep+'$B'+r+sep+'Laporan_Menu!$J$2:$J'+sep+'"<>0")=0)'+sep+'"SESUAI"'+sep+'"SELISIH")')
  ];
}

function configMap_() {
  var ss = database_();
  var branchesSheet = ss.getSheetByName('Master_Cabang');
  var menusSheet = ss.getSheetByName('Master_Menu');
  if (!branchesSheet || !menusSheet) {
    throw new Error('Tab Master_Cabang / Master_Menu belum ada. Jalankan setupDatabase() di Apps Script terlebih dahulu.');
  }
  var menuRows = menusSheet.getLastRow() > 1 ? menusSheet.getRange(2, 1, menusSheet.getLastRow() - 1, 5).getValues() : [];
  var activeMenus = {};
  menuRows.forEach(function(m) {
    if (!m[0] || !String(m[0]).trim() || !isActiveCell_(m[4])) return;
    var sku = safeId_(m[0], 'sku_code');
    var name = safeText_(m[1] || m[0], 'menu_name', 80);
    var price = cleanMoney_(m[2], 'sell_price');
    var hpp = cleanMoney_(m[3] || 0, 'hpp_cost');
    if (price <= 0) throw new Error('sell_price harus lebih besar dari 0 untuk ' + sku);
    if (activeMenus[sku]) throw new Error('SKU ganda di Master_Menu: ' + sku);
    activeMenus[sku] = {name:name, price:price, hpp:hpp};
  });

  var branchRows = branchesSheet.getLastRow() > 1 ? branchesSheet.getRange(2, 1, branchesSheet.getLastRow() - 1, 5).getValues() : [];
  var map = {};
  branchRows.forEach(function(b) {
    if (!b[0] || !String(b[0]).trim() || !isActiveCell_(b[4])) return;
    var id = safeId_(b[0], 'branch_id');
    var name = safeText_(b[1] || b[0], 'branch_name', 80);
    var wage = cleanMoney_(b[2] || 0, 'daily_wage');
    var rent = cleanMoney_(b[3] || 0, 'daily_rent');
    if (map[id]) throw new Error('branch_id ganda di Master_Cabang: ' + id);
    map[id] = {name:name, wage:wage, rent:rent, menus:activeMenus};
  });
  return map;
}

function cashiersMap_() {
  var sh = database_().getSheetByName('Master_Kasir');
  if (!sh) throw new Error('Tab Master_Kasir belum ada. Jalankan setupDatabase() di Apps Script terlebih dahulu.');
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2,1,last-1,4).getValues() : [];
  var displayRows = last > 1 ? sh.getRange(2,1,last-1,4).getDisplayValues() : [];
  var byUsername = {}, byName = {};
  rows.forEach(function(x, i) {
    if (!x[0] || !String(x[0]).trim() || !isActiveCell_(x[3])) return;
    var username = safeId_(x[0], 'username');
    var name = safeText_(x[1] || x[0], 'cashier_name', 80);
    var rawPin = (displayRows[i] && displayRows[i][2]) ? String(displayRows[i][2]).trim() : String(x[2]).trim();
    var pin = rawPin.replace(/^'+/, '');
    if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN kasir ' + username + ' harus 4-8 digit angka.');
    var record = {username:username, name:name, pin:pin};
    byUsername[username.toLowerCase()] = record;
    byName[name.toLowerCase()] = record;
  });
  return {byUsername:byUsername, byName:byName};
}

function isActiveCell_(v) {
  if (v === false) return false;
  var s = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  if (s === 'FALSE' || s === '0' || s === 'NO' || s === 'TIDAK' || s === 'NONAKTIF') return false;
  return true;
}

function cleanMoney_(v, label) {
  if (typeof v === 'number') return money_(Math.round(v), label);
  var digits = String(v === undefined || v === null ? '' : v).replace(/[^0-9]/g, '');
  return money_(digits ? Number(digits) : 0, label);
}

function dateStr_(v) {
  if (v && typeof v.getTime === 'function' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, database_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var parsed = new Date(s);
  if (s && !isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, database_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return s;
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
function safeId_(v,label) {
  var s = String(v || '').trim();
  if (!/^[A-Za-z0-9_.\- ]{1,80}$/.test(s)) throw new Error(label + ' tidak valid.');
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
