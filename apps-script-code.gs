// Paste this into Extensions → Apps Script on your Google Sheet
// Then Deploy → New deployment → Web app
// Execute as: Me
// Who has access: Anyone
// Copy the web app URL into the quoting app Settings

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    const data = JSON.parse(e.postData.contents);

    // Handle edit
    if (data.action === 'edit' && data.row && data.row[0]) {
      const lastRow = sheet.getLastRow();
      if (lastRow >= 5) {
        const nums = sheet.getRange(5, 1, lastRow - 4, 1).getValues();
        for (let i = 0; i < nums.length; i++) {
          if (String(nums[i][0]) === String(data.row[0])) {
            sheet.getRange(i + 5, 1, 1, data.row.length).setValues([data.row]);
            break;
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'edited' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Handle delete
    if (data.action === 'delete' && data.ticket) {
      const lastRow = sheet.getLastRow();
      if (lastRow >= 5) {
        const nums = sheet.getRange(5, 1, lastRow - 4, 1).getValues();
        for (let i = nums.length - 1; i >= 0; i--) {
          if (String(nums[i][0]) === String(data.ticket)) {
            sheet.deleteRow(i + 5);
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'deleted' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Setup title and headers if sheet is empty
    if (sheet.getLastRow() === 0) {
      // Title row
      sheet.getRange('A1').setValue('Knight Forestry — Quote Log');
      sheet.getRange('A1').setFontSize(18).setFontWeight('bold').setFontColor('#1a365d');
      sheet.getRange('A1:O1').merge();

      // Blank rows for spacing
      sheet.getRange('A2').setValue('');
      sheet.getRange('A3').setValue('');

      // Header row on row 4
      const headers = [
        'Timestamp', 'Customer Name', 'Phone', 'Address',
        'Source Location', 'Species', 'Truck Config', 'Tonnes', 'Cords',
        'One-way km', 'Trip Time', 'Drive Hours', 'Total Hours', 'Fuel Litres',
        'Total (incl GST)'
      ];
      sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(4, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#1a365d')
        .setFontColor('#ffffff')
        .setHorizontalAlignment('center');

      // Freeze the header row so it stays visible when scrolling
      sheet.setFrozenRows(4);

      // Enable filter on the header row for easy searching/sorting
      sheet.getRange(4, 1, 1, headers.length).createFilter();

      // Auto-resize columns
      sheet.autoResizeColumns(1, headers.length);
    }

    const timestamp = data.timestamp || new Date().toISOString();
    const name = data.customerName || '';
    const phone = data.phone || '';
    const address = data.address || '';

    // Find the next empty row after the header (starts at row 5)
    let nextRow = Math.max(sheet.getLastRow() + 1, 5);

    (data.options || []).forEach(opt => {
      sheet.getRange(nextRow, 1, 1, 15).setValues([[
        timestamp,
        name,
        phone,
        address,
        opt.location || '',
        opt.species || '',
        opt.truck || '',
        opt.tonnes || '',
        opt.cords || '',
        opt.km || '',
        opt.duration || '',
        opt.driveHours || '',
        opt.totalHours || '',
        opt.fuelLitres || '',
        opt.total || ''
      ]]);
      nextRow++;
    });

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
