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
 *
 * The nightly trigger and the tracker's manual "Send Reminder" button track
 * their sends in separate columns ("Auto Alert Sent" vs "Email Sent") so the
 * app's Sent badge only ever reflects a deliberate manual click. After
 * pasting this updated script, run resetEmailSentColumn() ONCE from the
 * function dropdown to clear out any "Email Sent" values that were actually
 * written by the old overnight trigger before this split existed.
 */

var ALERT_EMAIL           = "jeevav936@gmail.com";
var ALERT_BEFORE_TAT_DAYS = 10;

// Only include sheet tabs from 2026 onwards
function isRelevantSheet(sheetName) {
  var yearMatch = sheetName.match(/\d{4}/);
  if (!yearMatch) return false;
  return parseInt(yearMatch[0]) >= 2026;
}

// Finds the row for andersonId across all relevant month tabs and stamps
// today's date into its "Email Sent" column, so every user who syncs sees it.
function markEmailSentInSheet(andersonId) {
  if (!andersonId) return null;
  var target = andersonId.toString().trim().toLowerCase();
  var sentOn = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    if (!isRelevantSheet(sheet.getName())) continue;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;

    var values   = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers  = values[0].map(function (h) { return h.toString().trim().toLowerCase(); });
    var idCol    = headers.indexOf("anderson id");
    var sentCol  = headers.indexOf("email sent");
    if (idCol === -1 || sentCol === -1) continue;

    for (var r = 1; r < values.length; r++) {
      var cellId = values[r][idCol] ? values[r][idCol].toString().trim().toLowerCase() : "";
      if (cellId === target) {
        sheet.getRange(r + 1, sentCol + 1).setValue(sentOn);
        return sentOn;
      }
    }
  }
  return null; // no matching row found in any sheet
}

function doGet(e) {
  // Handle email send action from the tracker
  if (e && e.parameter && e.parameter.action === 'sendReminder') {
    try {
      var p = e.parameter;
      var daysUntilTAT = 'N/A';
      try {
        var parts = (p.tatDate || '').split(/[-\/]/);
        var tatParsed = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        daysUntilTAT = Math.floor((tatParsed - today) / (1000 * 60 * 60 * 24));
      } catch (ex) {}
      sendAlertEmail(p.andersonId, p.sampleName, p.client, p.testName, p.receivedDate, p.tatDate, daysUntilTAT);
      var sentOn = markEmailSentInSheet(p.andersonId);
      return ContentService.createTextOutput(JSON.stringify({ success: true, sentOn: sentOn }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Default: fetch sheet data
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
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ "error": e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
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
    var sentOn = markEmailSentInSheet(andersonId);

    return ContentService.createTextOutput(JSON.stringify({ success: true, sentOn: sentOn }))
      .setMimeType(ContentService.MimeType.JSON)
;

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
;
  }
}

// Run this once manually to grant Gmail permission before the trigger runs
function authorizeGmail() {
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), "Anderson Lab Script — Authorization Test", "Gmail permission granted successfully.");
  Logger.log("✅ Gmail authorization complete.");
}

// Run this ONCE after deploying the Auto Alert Sent split, to wipe out
// "Email Sent" values that were actually written by the old overnight
// trigger (before it had its own column) rather than a real manual click.
// Safe to run anytime — it only clears the column, it never sends mail.
function resetEmailSentColumn() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var cleared = 0;

  sheets.forEach(function (sheet) {
    if (!isRelevantSheet(sheet.getName())) return;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return h.toString().trim().toLowerCase(); });
    var emailSentCol = headers.indexOf("email sent");
    if (emailSentCol === -1) return;

    var range = sheet.getRange(2, emailSentCol + 1, lastRow - 1, 1);
    var values = range.getValues();
    var hadValue = values.some(function (r) { return r[0] !== "" && r[0] !== null; });
    if (hadValue) {
      range.clearContent();
      cleared += values.filter(function (r) { return r[0] !== "" && r[0] !== null; }).length;
    }
  });

  Logger.log("🧹 Cleared " + cleared + " stale 'Email Sent' value(s) across all sheets.");
}

// Calculates TAT date from received date based on test name (mirrors frontend logic)
function calculateTATDateFromReceived(receivedVal, testName) {
  var date;
  if (receivedVal instanceof Date && !isNaN(receivedVal)) {
    date = new Date(receivedVal);
  } else if (receivedVal && receivedVal.toString().trim() !== "") {
    var str   = receivedVal.toString().trim();
    var parts = str.includes("/") ? str.split("/") : str.split("-");
    if (parts.length === 3) {
      date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
  }
  if (!date || isNaN(date.getTime())) return null;

  var name = (testName || "").toString().toUpperCase();
  var daysToAdd = 28;
  if (name.includes("FEMALE INFERTILITY") || name.includes("MALE INFERTILITY")) daysToAdd = 15;
  else if (name.includes("AF") || name.includes("AMNIOTIC")) daysToAdd = 20;

  date.setDate(date.getDate() + daysToAdd);
  return date;
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
  var clinicalHistoryCol = colIndex["clinical history writeup"];
  var remarksCol         = colIndex["remark"];

  // Tracks the automatic nightly alert separately from the manual
  // "Send Reminder" button's "Email Sent" column, so the tracker UI's
  // Sent badge only ever reflects a deliberate manual click.
  var autoAlertSentCol = colIndex["auto alert sent"];

  // TAT column is optional — calculated from received date if absent
  var tatCol = colIndex["tat"];

  var missing = [];
  if (sampleNameCol      === undefined) missing.push("sample name");
  if (andersonIdCol      === undefined) missing.push("anderson id");
  if (testNameCol        === undefined) missing.push("test name");
  if (clientCol          === undefined) missing.push("client");
  if (receivedDateCol    === undefined) missing.push("received date");
  if (clinicalHistoryCol === undefined) missing.push("clinical history writeup");
  if (remarksCol         === undefined) missing.push("remark");

  if (missing.length > 0) {
    Logger.log("❌ MISSING COLUMNS: " + missing.join(", "));
    return;
  }

  // Auto-create the "Auto Alert Sent" column on first run if it's not there yet
  if (autoAlertSentCol === undefined) {
    var newColPos = sheet.getLastColumn() + 1;
    sheet.getRange(1, newColPos).setValue("Auto Alert Sent");
    autoAlertSentCol = newColPos - 1;
    Logger.log("➕ Added missing 'Auto Alert Sent' column at position " + newColPos);
  }

  Logger.log("✅ All columns found. TAT column: " + (tatCol !== undefined ? "present" : "absent — will calculate from received date"));

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    if (!row[andersonIdCol] || row[andersonIdCol].toString().trim() === "") continue;

    var clinicalHistory = row[clinicalHistoryCol] ? row[clinicalHistoryCol].toString().trim() : "";
    var remarks         = row[remarksCol]         ? row[remarksCol].toString().trim()         : "";
    var autoAlertSent   = row[autoAlertSentCol]   ? row[autoAlertSentCol].toString().trim()   : "";

    Logger.log("Row " + i + " | ID: " + row[andersonIdCol] +
               " | History: [" + clinicalHistory + "]" +
               " | Remarks: [" + remarks + "]" +
               " | Auto Alert Sent: [" + autoAlertSent + "]");

    if (clinicalHistory !== "" || remarks !== "" ||
        clinicalHistory.toLowerCase().includes("written by internal team") ||
        remarks.toLowerCase().includes("written by internal team")) {
      Logger.log("Row " + i + " → Skipped (history filled or written by internal team)");
      continue;
    }
    if (autoAlertSent !== "")  { Logger.log("Row " + i + " → Skipped (auto alert already sent on " + autoAlertSent + ")"); continue; }

    // Resolve TAT date: from sheet column if present, otherwise calculate
    var tatDate;
    if (tatCol !== undefined && row[tatCol]) {
      var rawTAT = row[tatCol];
      if (rawTAT instanceof Date && !isNaN(rawTAT)) {
        tatDate = new Date(rawTAT);
      } else {
        var tatStr   = rawTAT.toString().trim();
        var tatParts = tatStr.includes("/") ? tatStr.split("/") : tatStr.split("-");
        if (tatParts.length === 3) {
          tatDate = new Date(parseInt(tatParts[2]), parseInt(tatParts[1]) - 1, parseInt(tatParts[0]));
        }
      }
    } else {
      var testNameVal = row[testNameCol] ? row[testNameCol].toString() : "";
      tatDate = calculateTATDateFromReceived(row[receivedDateCol], testNameVal);
    }

    if (!tatDate || isNaN(tatDate.getTime())) {
      Logger.log("Row " + i + " → Could not determine TAT date, skipping");
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
      sheet.getRange(i + 1, autoAlertSentCol + 1).setValue(sentOn);
      Logger.log("✅ Auto alert sent for " + andersonId + " on " + sentOn);
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
