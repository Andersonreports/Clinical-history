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
      var range = sheet.getDataRange();
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
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ "error": e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
