// Tickets Sheet Apps Script
// Paste into Extensions → Apps Script on a NEW Google Sheet (separate from quotes)
// Deploy → New deployment → Web app
// Execute as: Me
// Who has access: Anyone
// Copy the web app URL into Tickets → Settings

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return ContentService.createTextOutput(JSON.stringify({ rows: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  // Return rows that have a ticket number
  const rows = data.filter(r => r[0]);
  return ContentService.createTextOutput(JSON.stringify({ rows: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    const data = JSON.parse(e.postData.contents);

    // Setup headers if empty
    if (sheet.getLastRow() === 0) {
      const headers = [
        'Ticket', 'Product', 'Customer', 'Source',
        'Tare', 'Gross', 'Net', 'Purchase', 'Sale', 'Time', 'Notes'
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#166534')
        .setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    // Delete
    if (data.action === 'delete' && data.ticket) {
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        const nums = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = nums.length - 1; i >= 0; i--) {
          if (String(nums[i][0]) === String(data.ticket)) {
            sheet.deleteRow(i + 2);
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'deleted' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Edit (found by the number the ticket had when the edit started) or save.
    // A save whose ticket number already exists updates that row, so a resent save never makes a duplicate.
    if ((data.action === 'edit' || data.action === 'save') && data.row && data.row[0]) {
      const lastRow = sheet.getLastRow();
      const find = key => {
        if (lastRow < 2 || !key) return -1;
        const nums = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < nums.length; i++) if (String(nums[i][0]) === String(key)) return i + 2;
        return -1;
      };
      let at = find(data.action === 'edit' ? (data.original || data.row[0]) : data.row[0]);
      if (at < 0 && data.action === 'edit') at = find(data.row[0]);
      if (at > 0) {
        sheet.getRange(at, 1, 1, data.row.length).setValues([data.row]);
        return ContentService.createTextOutput(JSON.stringify({ status: 'edited' })).setMimeType(ContentService.MimeType.JSON);
      }
      sheet.appendRow(data.row);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'unknown' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
