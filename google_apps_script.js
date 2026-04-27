/**
 * Clinical History Sync Script
 * 
 * Instructions:
 * 1. Open your Google Sheet.
 * 2. Go to Extensions > Apps Script.
 * 3. Delete any existing code and paste this script.
 * 4. Click 'Save' (ClinicalSync).
 * 5. Click 'Deploy' > 'New Deployment'.
 * 6. Select 'Web App'.
 * 7. Set 'Execute as' to 'Me'.
 * 8. Set 'Who has access' to 'Anyone' (Required for the tracker to fetch data).
 * 9. Click 'Deploy' and copy the 'Web App URL'.
 */

function doGet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    var allRecords = [];

    sheets.forEach(function(sheet) {
      var sheetName = sheet.getName();
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow < 2 || lastCol < 1) return; // Skip empty sheets

      var range = sheet.getRange(1, 1, lastRow, lastCol);
      var values = range.getValues();

      if (values.length < 2) return; // Skip empty sheets

      var headers = values[0].map(function(h) { 
        return h.toString().trim(); 
      });

      for (var i = 1; i < values.length; i++) {
        var row = values[i];
        var record = { "Month": sheetName };
        
        var hasData = false;
        headers.forEach(function(header, index) {
          var val = row[index];
          if (val !== "" && val !== null && val !== undefined) {
            hasData = true;
          }
          record[header] = val;
        });

        if (hasData) {
          allRecords.push(record);
        }
      }
    });

    return ContentService.createTextOutput(JSON.stringify(allRecords))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ "error": e.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }
}

function doPost(e) {
  try {
    var payload = {};
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    var recipient = payload.recipient || 'clinical@yourdomain.com';
    var subject = payload.subject || 'Clinical History Request - TAT due in 10 days';
    var requestNote = payload.requestNote || 'Please provide clinical history details for the following samples.';
    var records = Array.isArray(payload.records) ? payload.records : [];

    var bodyLines = [];
    bodyLines.push(requestNote);
    bodyLines.push('');
    bodyLines.push('Records needing clinical history details:');
    bodyLines.push('');

    if (records.length === 0) {
      bodyLines.push('No records provided.');
    } else {
      records.forEach(function(record) {
        var display = [record.sampleName || 'N/A', record.andersonId || 'N/A', record.testName || 'N/A', record.receivedDate || 'N/A', record.tatDate || 'N/A'];
        bodyLines.push('• ' + display.join(' | '));
      });
    }

    bodyLines.push('');
    bodyLines.push('Please share the clinical history details at the earliest.');
    bodyLines.push('');
    bodyLines.push('Thank you,');
    bodyLines.push('Clinical History Tracker');

    GmailApp.sendEmail(recipient, subject, bodyLines.join('\n'));

    return ContentService.createTextOutput(JSON.stringify({ success: true, sentTo: recipient }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }
}
