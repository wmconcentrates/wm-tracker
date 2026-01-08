/**
 * Gmail to Google Drive - COA Auto-Saver
 *
 * This script automatically saves COA PDF attachments from AgriScience Labs
 * to a Google Drive folder for processing by WM Tracker.
 *
 * Setup:
 * 1. Create a folder in Google Drive called "COAs"
 * 2. Copy this script to script.google.com
 * 3. Run setup() once to create the trigger
 * 4. Authorize when prompted
 */

// Configuration - update these as needed
const CONFIG = {
  // Search for emails from the lab
  searchQuery: 'from:agrisciencelabs.com has:attachment filename:pdf -label:coa-processed',

  // Alternative: search by subject if needed
  // searchQuery: 'subject:"COA" OR subject:"Certificate of Analysis" has:attachment filename:pdf -label:coa-processed',

  // Google Drive folder name for COAs
  driveFolderName: 'COAs',

  // Label to mark processed emails (created automatically)
  processedLabel: 'coa-processed'
};

/**
 * Main function - finds new COA emails and saves attachments to Drive
 */
function saveCOAsToDrive() {
  console.log('Starting COA auto-save...');

  // Get or create the Drive folder
  const folder = getOrCreateFolder(CONFIG.driveFolderName);

  // Get or create the Gmail label
  const label = getOrCreateLabel(CONFIG.processedLabel);

  // Search for unprocessed emails
  const threads = GmailApp.search(CONFIG.searchQuery, 0, 50);
  console.log(`Found ${threads.length} email threads to process`);

  let savedCount = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();

    for (const message of messages) {
      const attachments = message.getAttachments();

      for (const attachment of attachments) {
        const fileName = attachment.getName();

        // Only process PDFs
        if (fileName.toLowerCase().endsWith('.pdf')) {
          // Check if file already exists in folder
          const existingFiles = folder.getFilesByName(fileName);

          if (!existingFiles.hasNext()) {
            // Save to Drive
            const blob = attachment.copyBlob();
            const file = folder.createFile(blob);

            console.log(`Saved: ${fileName}`);
            savedCount++;

            // Add metadata for tracking
            file.setDescription(JSON.stringify({
              source: 'gmail-auto-import',
              emailDate: message.getDate().toISOString(),
              emailFrom: message.getFrom(),
              emailSubject: message.getSubject(),
              importedAt: new Date().toISOString()
            }));
          } else {
            console.log(`Skipped (already exists): ${fileName}`);
          }
        }
      }
    }

    // Mark thread as processed
    thread.addLabel(label);
  }

  console.log(`Done! Saved ${savedCount} new COA files to Drive.`);
  return savedCount;
}

/**
 * Get or create a Drive folder
 */
function getOrCreateFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);

  if (folders.hasNext()) {
    return folders.next();
  }

  console.log(`Creating folder: ${folderName}`);
  return DriveApp.createFolder(folderName);
}

/**
 * Get or create a Gmail label
 */
function getOrCreateLabel(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    console.log(`Creating label: ${labelName}`);
    label = GmailApp.createLabel(labelName);
  }

  return label;
}

/**
 * One-time setup - creates a trigger to run automatically every 15 minutes
 */
function setup() {
  // Remove any existing triggers for this function
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'saveCOAsToDrive') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Create new trigger - runs every 15 minutes
  ScriptApp.newTrigger('saveCOAsToDrive')
    .timeBased()
    .everyMinutes(15)
    .create();

  console.log('Setup complete! Script will run every 15 minutes.');
  console.log('Running first sync now...');

  // Run immediately
  saveCOAsToDrive();
}

/**
 * Manual run - for testing
 */
function testRun() {
  saveCOAsToDrive();
}

/**
 * Remove all triggers - run this to stop automatic syncing
 */
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
  console.log('All triggers removed. Auto-sync stopped.');
}
