const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { connect, search, downloadFile, getOrganizedPath } = require('../core/soulseek');
require('dotenv').config();

program
  .name('slsk-auto')
  .description('Automated Soulseek Search and Downloader CLI')
  .version('1.0.0');

// Search command
program
  .command('search')
  .description('Search Soulseek for a track and display sorted results')
  .argument('<query>', 'Search query (e.g. "Daft Punk - Get Lucky")')
  .option('--no-flac', 'Allow MP3 files (searches for FLAC only by default)')
  .option('--min-size <MB>', 'Minimum file size in megabytes', parseFloat, 0)
  .option('--timeout <ms>', 'Search timeout in milliseconds', parseInt, 7000)
  .option('--no-safety', 'Disable cover/tribute/live filter')
  .action(async (query, options) => {
    try {
      const client = await connect();
      const flacOnly = options.flac !== false;
      const enableSafetyFilter = options.safety !== false;
      
      const results = await search(client, query, {
        flacOnly,
        minSizeMB: options.minSize,
        timeoutMs: options.timeout,
        enableSafetyFilter
      });

      if (results.length === 0) {
        console.log('\n❌ No matching results found.');
        process.exit(0);
      }

      console.log(`\n🔍 Found ${results.length} matching results (sorted by slots and speed):\n`);
      
      results.slice(0, 10).forEach((item, index) => {
        const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
        const speedKB = (item.speed / 1024).toFixed(1);
        const ext = path.extname(item.file).toUpperCase().substring(1);
        const slotsStr = item.slots ? '✅ Free Slot' : '⏳ Queued';
        
        console.log(`${index + 1}. [${ext}] ${path.basename(item.file.replace(/\\/g, '/'))}`);
        console.log(`   User: ${item.user} | Size: ${sizeMB} MB | Speed: ${speedKB} KB/s | Status: ${slotsStr}`);
        console.log(`   Full path: ${item.file}`);
        console.log('-'.repeat(60));
      });

      if (results.length > 10) {
        console.log(`... and ${results.length - 10} more results.`);
      }
      
      process.exit(0);
    } catch (error) {
      console.error('Error during search:', error);
      process.exit(1);
    }
  });

// Download command
program
  .command('download')
  .description('Search and automatically download the best matching track')
  .argument('<query>', 'Search query')
  .option('--no-flac', 'Allow MP3 files')
  .option('--min-size <MB>', 'Minimum file size in megabytes', parseFloat, 0)
  .option('--timeout <ms>', 'Search timeout in milliseconds', parseInt, 7000)
  .option('--no-safety', 'Disable cover/tribute/live filter')
  .option('--output <dir>', 'Output directory (defaults to DOWNLOAD_DIR in .env)')
  .action(async (query, options) => {
    try {
      const client = await connect();
      const flacOnly = options.flac !== false;
      const enableSafetyFilter = options.safety !== false;
      const outputDir = options.output || process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads');

      console.log(`Output Directory: ${outputDir}`);

      const results = await search(client, query, {
        flacOnly,
        minSizeMB: options.minSize,
        timeoutMs: options.timeout,
        enableSafetyFilter
      });

      if (results.length === 0) {
        console.log('\n❌ No matching results found.');
        process.exit(0);
      }

      console.log(`\n🔍 Found ${results.length} candidate(s). Starting automatic download sequence...`);

      let downloadedPath = null;
      const maxRetries = Math.min(results.length, 3); // try up to 3 best candidates

      for (let i = 0; i < maxRetries; i++) {
        const candidate = results[i];
        const fileName = path.basename(candidate.file.replace(/\\/g, '/'));
        const sizeMB = (candidate.size / (1024 * 1024)).toFixed(2);
        
        console.log(`\n[Attempt ${i + 1}/${maxRetries}] Trying candidate:`);
        console.log(`   File: ${fileName}`);
        console.log(`   User: ${candidate.user} | Size: ${sizeMB} MB | Speed: ${(candidate.speed / 1024).toFixed(1)} KB/s`);
        
        if (!candidate.slots) {
          console.log(`   ⚠️ Warning: User has no free slots. Download might be queued.`);
        }

        try {
          downloadedPath = await downloadFile(client, candidate, outputDir);
          break; // Success
        } catch (downloadError) {
          console.error(`   ❌ Failed to download from ${candidate.user}: ${downloadError.message}`);
          if (i < maxRetries - 1) {
            console.log('   🔄 Retrying with the next best candidate...');
          }
        }
      }

      if (downloadedPath) {
        console.log(`\n🎉 Success! Track downloaded and verified.`);
        console.log(`Saved at: ${downloadedPath}\n`);
        process.exit(0);
      } else {
        console.log('\n❌ Failed to download track after trying top candidates.');
        process.exit(1);
      }
    } catch (error) {
      console.error('Error during download process:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);
