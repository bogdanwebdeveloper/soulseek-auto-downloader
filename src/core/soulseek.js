const slsk = require('slsk-client');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let clientInstance = null;
let isConnecting = false;
let connectionPromise = null;

// Default safety list of keywords to avoid covers, karaoke, live, tributes
const DEFAULT_EXCLUDE_KEYWORDS = ['tribute', 'cover', 'karaoke', 'live'];

/**
 * Connect to the Soulseek network using credentials from the environment.
 * If credentials are not set, a unique random account is registered.
 */
function connect() {
  if (clientInstance) {
    return Promise.resolve(clientInstance);
  }
  if (isConnecting) {
    return connectionPromise;
  }

  isConnecting = true;
  connectionPromise = new Promise((resolve, reject) => {
    let username = process.env.SLSK_USERNAME;
    let password = process.env.SLSK_PASSWORD;

    if (!username || !password) {
      username = 'slsk_auto_' + Math.floor(Math.random() * 1000000);
      password = 'pass_' + Math.floor(Math.random() * 1000000);
      console.log(`[Soulseek] No credentials in .env. Auto-registering unique account: ${username}`);
    } else {
      console.log(`[Soulseek] Connecting as user: ${username}`);
    }

    slsk.connect(
      {
        user: username,
        pass: password
      },
      (err, client) => {
        isConnecting = false;
        if (err) {
          console.error('[Soulseek] Connection failed:', err);
          reject(err);
          return;
        }
        console.log('[Soulseek] Connected successfully to server.slsknet.org');
        clientInstance = client;
        resolve(client);
      }
    );
  });

  return connectionPromise;
}

/**
 * Sanitize directory and file names for filesystem compatibility.
 */
function sanitizeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * Search the Soulseek network for a given query, apply safety filters, and return sorted results.
 * 
 * @param {Object} client - The Soulseek client instance.
 * @param {string} query - The search query.
 * @param {Object} options - Search options:
 * @param {boolean} options.flacOnly - Only include FLAC files.
 * @param {number} options.minSizeMB - Minimum file size in MB.
 * @param {number} options.timeoutMs - Search timeout (default 7000ms).
 * @param {boolean} options.enableSafetyFilter - Filter out covers/live/tributes (default true).
 */
function search(client, query, options = {}) {
  const flacOnly = options.flacOnly !== false;
  const minSizeMB = options.minSizeMB || 0;
  const timeoutMs = options.timeoutMs || 7000;
  const enableSafetyFilter = options.enableSafetyFilter !== false;

  return new Promise((resolve, reject) => {
    console.log(`[Soulseek] Searching for "${query}" (timeout: ${timeoutMs}ms, flacOnly: ${flacOnly}, safetyFilter: ${enableSafetyFilter})...`);
    
    client.search(
      {
        req: query,
        timeout: timeoutMs
      },
      (err, results) => {
        if (err) {
          reject(err);
          return;
        }

        console.log(`[Soulseek] Found ${results.length} raw search results. Filtering...`);

        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
        
        let filtered = results.filter(item => {
          const filePathLower = item.file.toLowerCase();
          const fileNameLower = path.basename(filePathLower);
          
          // 1. Verify extension
          const ext = path.extname(filePathLower);
          if (flacOnly && ext !== '.flac') {
            return false;
          }
          if (!flacOnly && ext !== '.flac' && ext !== '.mp3') {
            return false;
          }

          // 2. Verify size
          const sizeMB = item.size / (1024 * 1024);
          if (minSizeMB > 0 && sizeMB < minSizeMB) {
            return false;
          }

          // 3. Safety filters (exclude covers, tributes, karaoke, live)
          if (enableSafetyFilter) {
            const hasExcludeKeyword = DEFAULT_EXCLUDE_KEYWORDS.some(kw => {
              // Ensure we match whole words or parts to avoid false positives
              return fileNameLower.includes(kw);
            });
            if (hasExcludeKeyword) {
              return false;
            }
          }

          // 4. Verify search terms match (relaxed if it's a broad search, but kept for precision)
          // Since the user might be searching for a censored artist by song name (e.g. query "thriller"),
          // we match any of the queryTerms, but prioritize files containing all terms.
          const matchesAnyTerm = queryTerms.length === 0 || queryTerms.some(term => filePathLower.includes(term));
          if (!matchesAnyTerm) {
            return false;
          }

          return true;
        });

        // Sort results:
        // Priority 1: Free slots first (slots: true)
        // Priority 2: Higher upload speed (speed)
        // Priority 3: Larger file size (size)
        filtered.sort((a, b) => {
          // Free slots first
          if (a.slots && !b.slots) return -1;
          if (!a.slots && b.slots) return 1;

          // Speed (descending)
          const speedA = a.speed || 0;
          const speedB = b.speed || 0;
          if (speedA !== speedB) {
            return speedB - speedA;
          }

          // Size (descending)
          return b.size - a.size;
        });

        console.log(`[Soulseek] Filtered to ${filtered.length} matching candidates.`);
        resolve(filtered);
      }
    );
  });
}

/**
 * Reconstruct target filepath based on Soulseek path hierarchy to auto-organize into Artist/Album/Track structure.
 */
function getOrganizedPath(soulseekPath, outputDir) {
  // Normalize path separators to forward slash
  const normalized = soulseekPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(p => p.trim().length > 0);
  
  if (parts.length >= 3) {
    // Extract last 3 parts: Artist, Album, TrackFilename
    const artist = sanitizeName(parts[parts.length - 3]);
    const album = sanitizeName(parts[parts.length - 2]);
    const track = sanitizeName(parts[parts.length - 1]);
    
    return path.join(outputDir, artist, album, track);
  } else if (parts.length === 2) {
    // Artist, TrackFilename
    const artist = sanitizeName(parts[parts.length - 2]);
    const track = sanitizeName(parts[parts.length - 1]);
    
    return path.join(outputDir, artist, track);
  }
  
  // Directly under output directory
  return path.join(outputDir, sanitizeName(parts[parts.length - 1] || 'download.flac'));
}

/**
 * Download a file from Soulseek, auto-organizing it into directories.
 * 
 * @param {Object} client - The Soulseek client instance.
 * @param {Object} fileResult - The file object from search results.
 * @param {string} outputDir - Parent output directory.
 * @returns {Promise<string>} - Resolves with the saved file path.
 */
function downloadFile(client, fileResult, outputDir) {
  return new Promise((resolve, reject) => {
    const targetPath = getOrganizedPath(fileResult.file, outputDir);
    const targetFolder = path.dirname(targetPath);

    // Create subfolders if they don't exist
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    console.log(`[Soulseek] Starting download: "${path.basename(targetPath)}" from user "${fileResult.user}"`);
    console.log(`[Soulseek] Target path: ${targetPath}`);

    client.download(
      {
        file: fileResult,
        path: targetPath
      },
      (err, downloadResult) => {
        if (err) {
          console.error(`[Soulseek] Download failed:`, err);
          reject(err);
          return;
        }

        // Verify if file exists and matches size
        if (!fs.existsSync(targetPath)) {
          reject(new Error(`File was not created at: ${targetPath}`));
          return;
        }

        const stats = fs.statSync(targetPath);
        if (stats.size < fileResult.size * 0.95) {
          reject(new Error(`File size mismatch (Expected ${fileResult.size}, got ${stats.size}). File might be corrupt.`));
          return;
        }

        console.log(`[Soulseek] Download completed: ${targetPath}`);
        resolve(targetPath);
      }
    );
  });
}

module.exports = {
  connect,
  search,
  downloadFile,
  getOrganizedPath
};
