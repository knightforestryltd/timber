// Load Sheet Apps Script
// Deploy as Web app: Execute as Me, Who has access: Anyone.
// The "Trip Log" spreadsheet is created automatically the first time a load is booked.
// (Opening the app or loading settings before that does NOT create it.)

function getSheet(createIfMissing) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('sheetId');
  if (id) {
    try { return SpreadsheetApp.openById(id).getSheets()[0]; } catch (e) { /* deleted or no access: fall through */ }
  }
  if (!createIfMissing) return null;
  const ss = SpreadsheetApp.create('Trip Log');
  props.setProperty('sheetId', ss.getId());
  const sheet = ss.getSheets()[0];
  setupSheet(sheet);
  return sheet;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.settings === '1') {
    const saved = PropertiesService.getScriptProperties().getProperty('companySettings') || '{}';
    return ContentService.createTextOutput(saved).setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getSheet(false);
  if (!sheet || sheet.getLastRow() < 5) return json({ status: 'ok', rows: [] });
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(5, 1, lastRow - 4, Math.min(20, sheet.getMaxColumns())).getValues();
  const rows = data.filter(r => r[1]).map(r => ({
    timestamp: r[0], customerName: r[1], phone: r[2], address: r[3],
    location: r[4], species: r[5], truck: r[6], tonnes: r[7], cords: r[8],
    km: r[9], duration: r[10], driveHours: r[11], totalHours: r[12],
    fuelLitres: r[13], total: r[14],
    status: r[15] || 'Pending', loadId: r[16] || '', netTonnes: r[17] || '', invoiceData: r[18] || '', notes: r[19] || ''
  }));
  return json({ status: 'ok', rows: rows });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const isBooking = !data.action;                 // a booking has no action field
    const sheet = getSheet(isBooking);              // created here on the very first booking

    if (data.action === 'saveSettings') {
      PropertiesService.getScriptProperties().setProperty('companySettings', JSON.stringify(data.settings || {}));
      return ContentService.createTextOutput(JSON.stringify({ status: 'saved' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'updateStatus') {
      const found = sheet ? updateStatus(sheet, data) : false;
      return ContentService.createTextOutput(JSON.stringify({ status: found ? 'ok' : 'notfound' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'saveInvoice') {
      const found = sheet ? saveInvoice(sheet, data) : false;
      return ContentService.createTextOutput(JSON.stringify({ status: found ? 'ok' : 'notfound' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'sendInvoice') {
      const to = data.to || Session.getEffectiveUser().getEmail();
      const subject = data.subject || 'Invoice';
      const body = data.body || 'See attached invoice.';
      const options = { to: to, subject: subject, body: body };
      if (data.pdfBase64) {
        options.attachments = [Utilities.newBlob(Utilities.base64Decode(data.pdfBase64), 'application/pdf', data.filename || 'package.pdf')];
      } else if (data.html) {
        options.attachments = [Utilities.newBlob(data.html, 'text/html', (data.filename || 'package') + '.html')];
      }
      MailApp.sendEmail(options);
      return json({ status: 'sent', attached: !!(options.attachments && options.attachments.length && data.pdfBase64), version: 2 });
    }

    const timestamp = data.timestamp || new Date().toISOString();
    const name = data.customerName || '';
    const phone = data.phone || '';
    const address = data.address || '';
    let nextRow = Math.max(sheet.getLastRow() + 1, 5);
    const notes = String(data.notes || '').slice(0, 1000);
    ensureNotesHeader_(sheet);

    (data.options || []).forEach(opt => {
      sheet.getRange(nextRow, 1, 1, 20).setValues([[
        timestamp, name, phone, address,
        opt.location || '', opt.species || '', opt.truck || '',
        opt.tonnes || '', opt.cords || '', opt.km || '',
        opt.duration || '', opt.driveHours || '', opt.totalHours || '',
        opt.fuelLitres || '', opt.total || '',
        'Pending', '', '', '', notes
      ]]);
      nextRow++;
    });

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', notesSaved: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Finds the sheet row for a load. Priority: Load ID, then customer+timestamp(+option), then customer only.
function findRow(sheet, q) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 5) return -1;
  const n = lastRow - 4;
  const vals = sheet.getRange(5, 1, n, 17).getValues();   // A..Q
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  const sameTime = (a, b) => {
    if (!a || !b) return false;
    if (norm(a) === norm(b)) return true;
    const ta = new Date(a).getTime(), tb = new Date(b).getTime();
    return !isNaN(ta) && !isNaN(tb) && Math.abs(ta - tb) < 1000;
  };
  // 1) Load ID (col Q)
  if (q.loadId) {
    for (let i = 0; i < n; i++) if (norm(vals[i][16]) === norm(q.loadId)) return i + 5;
  }
  // 2) customer + timestamp, narrowed by location/species/truck when given
  const name = norm(q.customerName);
  if (name) {
    let cands = [];
    for (let i = 0; i < n; i++) {
      if (norm(vals[i][1]) !== name) continue;
      if (q.timestamp && !sameTime(vals[i][0], q.timestamp)) continue;
      cands.push(i);
    }
    const narrow = (idx, col, val) => { if (!val) return idx; const f = idx.filter(i => norm(vals[i][col]) === norm(val)); return f.length ? f : idx; };
    cands = narrow(cands, 4, q.location);
    cands = narrow(cands, 5, q.species);
    cands = narrow(cands, 6, q.truck);
    // prefer a row that is not Paid and has no Load ID yet
    const open = cands.filter(i => norm(vals[i][15]) !== 'paid' && !norm(vals[i][16]));
    if (open.length) return open[0] + 5;
    const notPaid = cands.filter(i => norm(vals[i][15]) !== 'paid');
    if (notPaid.length) return notPaid[0] + 5;
    if (cands.length) return cands[0] + 5;
  }
  return -1;
}

function updateStatus(sheet, q) {
  const row = findRow(sheet, q);
  if (row < 0) return false;
  if (q.status) sheet.getRange(row, 16).setValue(q.status);
  if (q.loadId) sheet.getRange(row, 17).setValue(q.loadId);
  if (q.netTonnes) sheet.getRange(row, 18).setValue(q.netTonnes);
  if (q.invoiceData) sheet.getRange(row, 19).setValue(typeof q.invoiceData === 'string' ? q.invoiceData : JSON.stringify(q.invoiceData));
  return true;
}

function saveInvoice(sheet, q) {
  const row = findRow(sheet, q);
  if (row < 0) return false;
  sheet.getRange(row, 19).setValue(typeof q.invoiceData === 'string' ? q.invoiceData : JSON.stringify(q.invoiceData));
  return true;
}

// Adds the "Notes" heading in column T the first time a booking with the new script arrives.
function ensureNotesHeader_(sheet) {
  try {
    if (sheet.getMaxColumns() < 20) sheet.insertColumnsAfter(sheet.getMaxColumns(), 20 - sheet.getMaxColumns());
    const c = sheet.getRange(4, 20);
    if (!c.getValue()) {
      c.setValue('Notes').setFontWeight('bold').setBackground('#166534').setFontColor('#ffffff').setHorizontalAlignment('center');
    }
  } catch (e) {}
}

function setupSheet(sheet) {
  sheet.getRange('A1').setValue('Trip Log');
  sheet.getRange('A1').setFontSize(18).setFontWeight('bold').setFontColor('#166534');
  sheet.getRange('A1:S1').merge();
  const headers = [
    'Timestamp', 'Customer Name', 'Phone', 'Address',
    'Source Location', 'Species', 'Truck Config', 'Tonnes', 'Cords',
    'One-way km', 'Trip Time', 'Drive Hours', 'Total Hours', 'Fuel Litres',
    'Total (incl GST)', 'Status', 'Load ID', 'Net Tonnes', 'Invoice Data'
  ];
  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(4, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#166534')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(4);
  sheet.getRange(4, 1, 1, headers.length).createFilter();
  sheet.autoResizeColumns(1, headers.length);
}
