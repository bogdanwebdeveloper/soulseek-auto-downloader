const express = require('express');
const path = require('path');
const fs = require('fs');
const { connect, search, downloadFile } = require('../core/soulseek');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory download queue
let downloadQueue = [];
let slskClient = null;

// Batch queue processing state
let batchSearchQueue = [];
let isProcessingBatch = false;

// Connect to Soulseek on server startup
async function initSoulseek() {
  try {
    slskClient = await connect();
  } catch (error) {
    console.error('[Server] Failed to connect to Soulseek on startup. Will retry on demand.', error);
  }
}
initSoulseek();

// Sequential Batch Queue Processor
async function processNextBatchItem() {
  if (batchSearchQueue.length === 0 || isProcessingBatch) {
    return;
  }

  isProcessingBatch = true;
  const batchItem = batchSearchQueue.shift();
  const { query, flacOnly, minSizeMB, queueItemId } = batchItem;

  const queueItem = downloadQueue.find(item => item.id === queueItemId);
  if (!queueItem) {
    isProcessingBatch = false;
    setTimeout(processNextBatchItem, 1000);
    return;
  }

  queueItem.status = 'Searching';
  console.log(`[Batch] Searching for: "${query}"...`);

  try {
    // 1. Connect
    const client = await connect();
    
    // 2. Search (with default safety filter enabled)
    const results = await search(client, query, {
      flacOnly,
      minSizeMB,
      timeoutMs: 8000,
      enableSafetyFilter: true
    });

    if (results.length === 0) {
      queueItem.status = 'Failed';
      queueItem.filename = `[Failed] ${query}`;
      queueItem.error = 'No matching results found. If this is a censored artist, search for the song name only without the artist name.';
      console.log(`[Batch] No results for: "${query}"`);
    } else {
      // Pick the best candidate (slots: true, high speed)
      const best = results[0];
      const filename = path.basename(best.file.replace(/\\/g, '/'));
      
      queueItem.filename = filename;
      queueItem.user = best.user;
      queueItem.size = best.size;
      queueItem.sizeMB = (best.size / (1024 * 1024)).toFixed(2);
      queueItem.status = 'Downloading';
      
      console.log(`[Batch] Found candidate for "${query}": "${filename}" from user "${best.user}". Downloading...`);

      // Start download
      downloadFile(client, best, DOWNLOAD_DIR)
        .then((savedPath) => {
          queueItem.status = 'Completed';
          queueItem.completedAt = new Date().toISOString();
          queueItem.savedPath = savedPath;
          console.log(`[Batch] Download completed: ${filename}`);
        })
        .catch((err) => {
          queueItem.status = 'Failed';
          queueItem.error = err.message;
          console.error(`[Batch] Download failed: ${filename}`, err);
        });
    }
  } catch (error) {
    queueItem.status = 'Failed';
    queueItem.error = error.message;
    console.error(`[Batch] Error processing query "${query}":`, error);
  }

  // Cool down for 5 seconds to be polite to the Soulseek network and avoid throttles
  setTimeout(() => {
    isProcessingBatch = false;
    processNextBatchItem();
  }, 5000);
}

// Middleware to ensure client is connected
async function ensureConnected(req, res, next) {
  if (slskClient) {
    return next();
  }
  try {
    slskClient = await connect();
    next();
  } catch (error) {
    res.status(500).json({ error: 'Soulseek connection is currently unavailable: ' + error.message });
  }
}

// API: Search
app.get('/api/search', ensureConnected, async (req, res) => {
  const query = req.query.q;
  const flacOnly = req.query.flac !== 'false';
  const minSizeMB = parseFloat(req.query.minSize) || 0;
  const enableSafetyFilter = req.query.safety !== 'false';

  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    const results = await search(slskClient, query, {
      flacOnly,
      minSizeMB,
      timeoutMs: 7000,
      enableSafetyFilter
    });
    
    // Map results to a simplified format for the UI
    const mapped = results.map((item, index) => {
      // Find parent directory name to group files by Album
      const normalizedPath = item.file.replace(/\\/g, '/');
      const parts = normalizedPath.split('/');
      const parentFolder = parts.length >= 2 ? parts[parts.length - 2] : 'Unknown Album';
      const artistFolder = parts.length >= 3 ? parts[parts.length - 3] : 'Unknown Artist';

      return {
        id: `${item.user}_${index}_${item.size}`,
        filename: path.basename(normalizedPath),
        fullPath: item.file,
        parentFolder,
        artistFolder,
        user: item.user,
        size: item.size,
        sizeMB: (item.size / (1024 * 1024)).toFixed(2),
        bitrate: item.bitrate,
        speed: item.speed,
        speedKB: item.speed ? (item.speed / 1024).toFixed(1) : '0',
        slots: item.slots,
        rawResult: item
      };
    });

    res.json({ results: mapped });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Start download (supports single track or array of files for album download)
app.post('/api/download', ensureConnected, async (req, res) => {
  const { fileResult, fileResults } = req.body;

  // Handle multiple downloads (Album Mode)
  if (fileResults && Array.isArray(fileResults)) {
    console.log(`[Server] Enqueueing album containing ${fileResults.length} tracks...`);
    const addedItems = [];

    fileResults.forEach(file => {
      const filename = path.basename(file.file.replace(/\\/g, '/'));
      const downloadId = `${file.user}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

      const queueItem = {
        id: downloadId,
        filename,
        user: file.user,
        size: file.size,
        sizeMB: (file.size / (1024 * 1024)).toFixed(2),
        status: 'Downloading',
        addedAt: new Date().toISOString(),
        completedAt: null,
        error: null
      };

      downloadQueue.unshift(queueItem);
      addedItems.push(queueItem);

      // Trigger download
      downloadFile(slskClient, file, DOWNLOAD_DIR)
        .then((savedPath) => {
          queueItem.status = 'Completed';
          queueItem.completedAt = new Date().toISOString();
          queueItem.savedPath = savedPath;
          console.log(`[Server] Download completed: ${filename}`);
        })
        .catch((err) => {
          queueItem.status = 'Failed';
          queueItem.error = err.message;
          console.error(`[Server] Download failed for: ${filename}`, err);
        });
    });

    return res.json({ success: true, count: addedItems.length, items: addedItems });
  }

  // Handle single track download
  if (!fileResult || !fileResult.user || !fileResult.file) {
    return res.status(400).json({ error: 'Invalid file result payload' });
  }

  const filename = path.basename(fileResult.file.replace(/\\/g, '/'));
  const downloadId = `${fileResult.user}_${Date.now()}`;

  const queueItem = {
    id: downloadId,
    filename,
    user: fileResult.user,
    size: fileResult.size,
    sizeMB: (fileResult.size / (1024 * 1024)).toFixed(2),
    status: 'Downloading',
    addedAt: new Date().toISOString(),
    completedAt: null,
    error: null
  };

  downloadQueue.unshift(queueItem);

  downloadFile(slskClient, fileResult, DOWNLOAD_DIR)
    .then((savedPath) => {
      queueItem.status = 'Completed';
      queueItem.completedAt = new Date().toISOString();
      queueItem.savedPath = savedPath;
      console.log(`[Server] Download completed: ${filename}`);
    })
    .catch((err) => {
      queueItem.status = 'Failed';
      queueItem.error = err.message;
      console.error(`[Server] Download failed for: ${filename}`, err);
    });

  res.json({ success: true, item: queueItem });
});

// API: Batch download list
app.post('/api/batch-download', (req, res) => {
  const { queries, flacOnly, minSize } = req.body;

  if (!Array.isArray(queries) || queries.length === 0) {
    return res.status(400).json({ error: 'Queries must be a non-empty array' });
  }

  const flac = flacOnly !== false;
  const minSizeMB = parseFloat(minSize) || 0;
  const addedItems = [];

  queries.forEach(query => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const queueItemId = `batch_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    
    const queueItem = {
      id: queueItemId,
      filename: `[Queued] ${trimmed}`,
      user: '-',
      size: 0,
      sizeMB: '-',
      status: 'Pending',
      addedAt: new Date().toISOString(),
      completedAt: null,
      error: null
    };

    downloadQueue.unshift(queueItem);
    addedItems.push(queueItem);

    batchSearchQueue.push({
      query: trimmed,
      flacOnly: flac,
      minSizeMB,
      queueItemId
    });
  });

  processNextBatchItem();

  res.json({ success: true, count: addedItems.length, items: addedItems });
});

// API: Get download queue status
app.get('/api/downloads', (req, res) => {
  res.json({ queue: downloadQueue });
});

// API: Download summary session report as a .txt file
app.get('/api/batch-report/download', (req, res) => {
  let report = "SOULSEEK AUTO-DOWNLOADER SESSION REPORT\n";
  report += `Generated on: ${new Date().toISOString()}\n`;
  report += `Total Downloads Tracked: ${downloadQueue.length}\n`;
  report += "=".repeat(60) + "\n\n";

  downloadQueue.forEach((item, index) => {
    report += `${index + 1}. File: ${item.filename}\n`;
    report += `   User: ${item.user} | Size: ${item.sizeMB} MB | Status: ${item.status}\n`;
    if (item.completedAt) report += `   Completed At: ${item.completedAt}\n`;
    if (item.error) report += `   Error: ${item.error}\n`;
    if (item.savedPath) report += `   Saved Path: ${item.savedPath}\n`;
    report += "-".repeat(60) + "\n";
  });

  res.setHeader('Content-disposition', 'attachment; filename=soulseek-session-report.txt');
  res.setHeader('Content-type', 'text/plain');
  res.send(report);
});

// Serve frontend SPA index.html for all other routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Server] Web UI running at http://localhost:${PORT}`);
  console.log(`[Server] Downloads will save to: ${DOWNLOAD_DIR}`);
});
