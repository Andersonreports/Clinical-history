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
 *
 * For automatic TAT alerts: set a time-based trigger on andersonLabClinicalHistoryAlert()
 */

var ALERT_EMAIL           = "jeevav936@gmail.com";
var ALERT_BEFORE_TAT_DAYS = 15;

// Only include sheet tabs from 2026 onwards
function isRelevantSheet(sheetName) {
  var yearMatch = sheetName.match(/\d{4}/);
  if (!yearMatch) return false;
  return parseInt(yearMatch[0]) >= 2026;
}

function doGet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    var allRecords = [];

    sheets.forEach(function(sheet) {
      var sheetName = sheet.getName();
      if (!isRelevantSheet(sheetName)) return; // Skip pre-2026 sheets

      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow < 2 || lastCol < 1) return;

      var range = sheet.getRange(1, 1, lastRow, lastCol);
      var values = range.getValues();
      if (values.length < 2) return;

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

// Called by the web app when the per-sample Mail button is clicked
function doPost(e) {
  try {
    var payload = {};
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    var andersonId   = payload.andersonId   || 'N/A';
    var sampleName   = payload.sampleName   || 'N/A';
    var client       = payload.client       || 'N/A';
    var testName     = payload.testName     || 'N/A';
    var receivedDate = payload.receivedDate || 'N/A';
    var tatDate      = payload.tatDate      || 'N/A';

    var daysUntilTAT = 'N/A';
    try {
      var parts = tatDate.split(/[-\/]/);
      var tatParsed = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      daysUntilTAT = Math.floor((tatParsed - today) / (1000 * 60 * 60 * 24));
    } catch (ex) {}

    sendAlertEmail(andersonId, sampleName, client, testName, receivedDate, tatDate, daysUntilTAT);

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }
}

// =============================================
// TIME-TRIGGER AUTOMATION — runs on a schedule
// Set trigger: Extensions > Apps Script > Triggers > andersonLabClinicalHistoryAlert
// =============================================
function andersonLabClinicalHistoryAlert() {
  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];

  var colIndex = {};
  headers.forEach(function(h, i) {
    colIndex[h.toString().trim().toLowerCase()] = i;
  });

  Logger.log("=== COLUMN MAP ===");
  Logger.log(JSON.stringify(colIndex));

  var sampleNameCol      = colIndex["sample name"];
  var andersonIdCol      = colIndex["anderson id"];
  var testNameCol        = colIndex["test name"];
  var clientCol          = colIndex["client"];
  var receivedDateCol    = colIndex["received date"];
  var tatCol             = colIndex["tat"];
  var clinicalHistoryCol = colIndex["clinical history writeup"];
  var emailSentCol       = colIndex["email sent"];

  var missing = [];
  if (sampleNameCol      === undefined) missing.push("sample name");
  if (andersonIdCol      === undefined) missing.push("anderson id");
  if (testNameCol        === undefined) missing.push("test name");
  if (clientCol          === undefined) missing.push("client");
  if (receivedDateCol    === undefined) missing.push("received date");
  if (tatCol             === undefined) missing.push("tat");
  if (clinicalHistoryCol === undefined) missing.push("clinical history writeup");
  if (emailSentCol       === undefined) missing.push("email sent");

  if (missing.length > 0) {
    Logger.log("❌ MISSING COLUMNS: " + missing.join(", "));
    return;
  }

  Logger.log("✅ All columns found. Starting row check...");

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    if (!row[andersonIdCol] || row[andersonIdCol].toString().trim() === "") continue;

    var clinicalHistory = row[clinicalHistoryCol] ? row[clinicalHistoryCol].toString().trim() : "";
    var emailSent       = row[emailSentCol]       ? row[emailSentCol].toString().trim()       : "";

    Logger.log("Row " + i + " | ID: " + row[andersonIdCol] +
               " | History: [" + clinicalHistory + "]" +
               " | Email Sent: [" + emailSent + "]");

    if (clinicalHistory !== "") {
      Logger.log("Row " + i + " → Skipped (history already filled)");
      continue;
    }
    if (emailSent !== "") {
      Logger.log("Row " + i + " → Skipped (alert already sent on " + emailSent + ")");
      continue;
    }

    var rawTAT = row[tatCol];
    var tatDate;

    if (rawTAT instanceof Date && !isNaN(rawTAT)) {
      tatDate = new Date(rawTAT);
    } else if (rawTAT && rawTAT.toString().trim() !== "") {
      var tatStr   = rawTAT.toString().trim();
      var tatParts = tatStr.includes("/") ? tatStr.split("/") : tatStr.split("-");
      if (tatParts && tatParts.length === 3) {
        tatDate = new Date(parseInt(tatParts[2]), parseInt(tatParts[1]) - 1, parseInt(tatParts[0]));
      } else {
        Logger.log("Row " + i + " → Unrecognized TAT date format: " + tatStr);
        continue;
      }
    } else {
      Logger.log("Row " + i + " → No TAT date, skipping");
      continue;
    }

    tatDate.setHours(0, 0, 0, 0);
    var daysUntilTAT = Math.floor((tatDate - today) / (1000 * 60 * 60 * 24));

    Logger.log("Row " + i + " → Days until TAT: " + daysUntilTAT);

    if (daysUntilTAT <= ALERT_BEFORE_TAT_DAYS) {
      var sampleName   = row[sampleNameCol] ? row[sampleNameCol].toString().trim() : "N/A";
      var andersonId   = row[andersonIdCol] ? row[andersonIdCol].toString().trim() : "N/A";
      var testName     = row[testNameCol]   ? row[testNameCol].toString().trim()   : "N/A";
      var client       = row[clientCol]     ? row[clientCol].toString().trim()     : "N/A";
      var formattedTAT = Utilities.formatDate(tatDate, Session.getScriptTimeZone(), "dd-MM-yyyy");

      var rawReceived = row[receivedDateCol];
      var formattedReceivedDate = "N/A";
      if (rawReceived instanceof Date && !isNaN(rawReceived)) {
        formattedReceivedDate = Utilities.formatDate(new Date(rawReceived), Session.getScriptTimeZone(), "dd-MM-yyyy");
      }

      sendAlertEmail(andersonId, sampleName, client, testName, formattedReceivedDate, formattedTAT, daysUntilTAT);
      var sentOn = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");
      sheet.getRange(i + 1, emailSentCol + 1).setValue(sentOn);
      Logger.log("✅ Email alert sent for Anderson ID: " + andersonId + " on " + sentOn);

    } else {
      Logger.log("Row " + i + " → TAT is " + daysUntilTAT + " days away, no alert yet");
    }
  }
}

// =============================================
// EMAIL FUNCTION — used by both doPost and the time-trigger
// =============================================
function sendAlertEmail(andersonId, sampleName, client, testName, receivedDate, tatDate, daysUntilTAT) {
  var subject = "Action Required: Clinical History detail Missing for Anderson ID " + andersonId;

  var body = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
      <p>Dear Team,</p>
      <p>
        The following patient's sample with <strong>Anderson ID: ${andersonId}</strong>
        has <strong style="color: red;">no Clinical History detail</strong> recorded in the system.
      </p>
      <table border="1" cellpadding="8" cellspacing="0"
             style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <thead>
          <tr style="background-color: #4472C4; color: white; text-align: left;">
            <th>Anderson ID</th>
            <th>Sample Name</th>
            <th>Client (Clinic/Hospital)</th>
            <th>Test Name</th>
            <th>Received Date</th>
            <th>TAT Date</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background-color: #f9f9f9;">
            <td>${andersonId}</td>
            <td>${sampleName}</td>
            <td>${client}</td>
            <td>${testName}</td>
            <td>${receivedDate}</td>
            <td>${tatDate}</td>
          </tr>
        </tbody>
      </table>
      <p>
        Kindly provide the <strong>Clinical History detail</strong> at the earliest
        to avoid any delay in processing and releasing the report on time.
      </p>
      <p>Thank you for your prompt attention.</p>
      <p style="color: #888; font-size: 12px;">
        — This is an automated reminder from the Anderson Lab Reporting System
      </p>
    </div>
  `;

  GmailApp.sendEmail(ALERT_EMAIL, subject, "", { htmlBody: body });
  Logger.log("📧 Email sent for: " + andersonId);
}
