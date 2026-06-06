# Soulseek Auto-Downloader

A modern standalone utility that automatically searches and downloads tracks from the Soulseek P2P network, filtering by lossless FLAC format and downloading from the fastest available users with open slots. Features both a CLI interface and a gorgeous Glassmorphic Web UI.

---

## 🌟 Features

1.  **Dual Interface:** Run it as a lightweight terminal command-line tool (CLI) or as a local dashboard (Web UI).
2.  **Smart Filtering & Sorting:** Automatically prioritizes results with free upload slots, then sorts by speed and file size to guarantee the fastest lossless download.
3.  **Auto-Folder Organization:** Reconstructs the directory hierarchy from Soulseek paths and organizes downloads cleanly on your disk under `DOWNLOAD_DIR/Artist/Album/Track.flac`.
4.  **Censored Artist Bypass:** Includes documentation and UI notices to help you bypass Soulseek's server-side censorship of major pop artists (e.g. Michael Jackson, The Weeknd) by searching song/album names directly.
5.  **Safety Word Filters:** Excludes covers, live versions, tributes, and karaoke tracks automatically (customizable).
6.  **Sequential Batch Downloader:** Paste a list of songs or upload a `.txt` file. The server processes them sequentially with a polite 5-second cooldown between searches to prevent Soulseek server IP bans.
7.  **Summary Session Report:** Downloads a `.txt` report showing successes, failures, file sizes, and save paths for the active session.
8.  **iTunes Search Autocomplete:** Suggestions pop up as you type in the Web UI, resolving spelling mistakes automatically.
9.  **Album Grouping Mode:** Toggle "Group by Album" to group search results into cards representing whole folders. Download entire albums in one click!
10. **Web Notifications:** Displays native OS desktop notifications when background downloads finish or fail.

---

## 🚀 Installation & Setup

1.  **Clone or copy the project folder:**
    Ensure you are inside the project directory:
    ```bash
    cd soulseek-auto
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure environment variables (`.env`):**
    Open the `.env` file and set your credentials (if left blank, a unique random username will be auto-generated and registered on connection) and your music directory:
    ```env
    SLSK_USERNAME=
    SLSK_PASSWORD=
    DOWNLOAD_DIR=/home/baiceanub/Muzică
    PORT=3000
    ```

---

## 💻 CLI Usage (Terminal)

The command-line interface lets you search and download directly from your shell.

### 1. Search tracks (`search`)
Displays the top 10 results sorted by free slots and speed:
```bash
npm run cli -- search "Daft Punk - Get Lucky"
```
**Options:**
*   `--no-flac`: Allow MP3 files (by default, only FLAC is shown).
*   `--min-size <MB>`: Minimum file size in megabytes (e.g. `--min-size 15`).
*   `--timeout <ms>`: Wait time for collecting results (default: 7000ms).
*   `--no-safety`: Disable safety filter for covers, tribute, and live recordings.

### 2. Automatic Download (`download`)
Search and automatically download the best available candidate. If the first download fails (connection timeout or peer goes offline), it automatically retries with the next best candidates:
```bash
npm run cli -- download "Daft Punk - Get Lucky"
```
**Options:**
*   `--output <dir>`: Custom output folder (overrides the `.env` default).

---

## 🌐 Web UI Usage (Dashboard)

Start the local web server:
```bash
npm start
```
Open your web browser and navigate to: **[http://localhost:3000](http://localhost:3000)**.

---

## 💡 Bypassing Soulseek Censorship

The official Soulseek server (`server.slsknet.org`) filters out search queries containing major copyrighted artist names (e.g. "Michael Jackson", "The Weeknd"), returning 0 raw results.

**How to bypass this:**
*   **Search for the song name directly** instead of the artist name (e.g. search `thriller flac` or `starboy flac` instead of `the weeknd starboy`).
*   Because the files shared by peers still contain the artist name, they will show up in the results and be downloaded and organized correctly under `/The Weeknd/Starboy/`.
