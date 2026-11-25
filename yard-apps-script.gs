// Yard Inventory Apps Script
// Paste into a NEW Google Sheet → Extensions → Apps Script
// Deploy as Web app: Execute as Me, Who has access: Anyone
// Copy the /exec URL into Yard Inventory → Settings

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  setupSheet(sheet);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 12).getValues() : [];
  const data = rows.filter(r => r[0]).map(r => ({
    timestamp: r[0], yard: r[1], species: r[2], type: r[3],
    tonnes: r[4], cords: r[5], pricePerTonne: r[6], pricePerCord: r[7],
    ticket: r[8], notes: r[9], source: r[10], unit: r[11]
  }));
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', rows: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    setupSheet(sheet);
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'add') {
      const row = [
        data.timestamp || new Date().toISOString(),
        data.yard || '', data.species || '', data.type || 'In',
        data.tonnes || 0, data.cords || 0,
        data.pricePerTonne || 0, data.pricePerCord || 0,
        data.ticket || '', data.notes || '',
        data.source || '', data.unit || ''
      ];
      sheet.appendRow(row);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function setupSheet(sheet) {
  if (sheet.getLastRow() === 0) {
    const headers = ['Timestamp', 'Yard', 'Species', 'Type', 'Tonnes', 'Cords', 'Price/Tonne', 'Price/Cord', 'Ticket', 'Notes', 'Source', 'Unit'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#166534')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).createFilter();
    sheet.autoResizeColumns(1, headers.length);
  }
}
