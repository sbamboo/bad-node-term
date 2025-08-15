import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'node-pty';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';
import { promisify } from 'util';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const platform = os.platform();

// File system state
let fileServerCurrDir = process.cwd();

function commandExists(cmd) {
  return new Promise((resolve) => {
    // Use 'where' on Windows, 'which' elsewhere
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const ps = spawn(checker, [cmd]);

    ps.on('error', () => resolve(false));
    ps.on('close', (code) => resolve(code === 0));
  });
}

async function commandsExistAsync(commands) {
  for (const cmd of commands) {
    const exists = await commandExists(cmd);
    if (!exists) {
      return false;
    }
  }
  return true;
}

function commandsExist(commands) {
  return commands.every(commandExists);
}

// File system helper functions
const getFileInfo = async (filePath) => {
  try {
    const stats = await promisify(fs.stat)(filePath);
    const isDirectory = stats.isDirectory();

    let mime = 'unknown';
    let isBinary = false;

    if (!isDirectory) {
      const ext = path.extname(filePath).toLowerCase();
      // Basic MIME type mapping
      const mimeTypes = {
        '.txt': 'text/plain',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.html': 'text/html',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
      };
      mime = mimeTypes[ext] || 'application/octet-stream';

      // Check if file is binary by reading a small sample
      try {
        const buffer = await promisify(fs.readFile)(filePath, {
          start: 0,
          end: 1023,
        });
        isBinary = !isTextFile(buffer);
      } catch (error) {
        console.error('Error checking if file is binary:', error);
        isBinary = false;
      }
    }

    return {
      name: path.basename(filePath),
      type: isDirectory ? 'folder' : 'file',
      mime: mime,
      size: isDirectory ? 0 : Math.round(stats.size / 1024), // Size in KB
      isBinary: isBinary,
    };
  } catch (error) {
    console.error('Error getting file info:', error);
    return null;
  }
};

const getFileContent = async (filePath) => {
  try {
    const stats = await promisify(fs.stat)(filePath);
    if (stats.isDirectory()) {
      throw new Error('Cannot read content of a directory');
    }

    // Check if file is text or binary
    const buffer = await promisify(fs.readFile)(filePath);
    const isText = isTextFile(buffer);

    if (isText) {
      // Text mode - return UTF-8 content
      const content = buffer.toString('utf8');
      return {
        mode: 'text',
        content: content,
        size: buffer.length,
      };
    } else {
      // Binary mode - return hex representation
      const hexContent = buffer.toString('hex').toUpperCase();
      return {
        mode: 'binary',
        content: hexContent,
        size: buffer.length,
      };
    }
  } catch (error) {
    console.error('Error reading file content:', error);
    throw error;
  }
};

const getFileContentChunked = async (
  filePath,
  mode,
  pageSize,
  byteOffset = 0,
  asPage = 0,
) => {
  try {
    const stats = await promisify(fs.stat)(filePath);
    if (stats.isDirectory()) {
      throw new Error('Cannot read content of a directory');
    }

    const fileSize = stats.size;
    const isText = mode === 'text';

    // Calculate page boundaries
    const pageStart = asPage * pageSize;
    const actualStart = Math.max(0, Math.min(byteOffset, fileSize - 1));
    const actualEnd = Math.min(actualStart + pageSize, fileSize);

    // Read the specific chunk
    const buffer = await promisify(fs.readFile)(filePath, {
      start: actualStart,
      end: actualEnd - 1,
    });

    let content;
    if (isText) {
      // Text mode - return UTF-8 content
      content = buffer.toString('utf8');
    } else {
      // Binary mode - return hex representation
      content = buffer.toString('hex').toUpperCase();
    }

    return {
      mode: mode,
      content: content,
      size: buffer.length,
      page: asPage,
      offset: actualStart,
      eof: actualEnd >= fileSize,
      sof: actualStart === 0,
      totalSize: fileSize,
    };
  } catch (error) {
    console.error('Error reading file chunk:', error);
    throw error;
  }
};

const getFileContentInitial = async (filePath, mode, pageSize) => {
  try {
    const stats = await promisify(fs.stat)(filePath);
    if (stats.isDirectory()) {
      throw new Error('Cannot read content of a directory');
    }

    const fileSize = stats.size;
    const isText = mode === 'text';

    // If file is smaller than 3 pages, send it all
    if (fileSize <= pageSize * 3) {
      const buffer = await promisify(fs.readFile)(filePath);
      let content;

      if (isText) {
        content = buffer.toString('utf8');
      } else {
        const hexContent = buffer.toString('hex').toUpperCase();
        content = hexContent.match(/.{1,2}/g).join(' ');
      }

      return {
        mode: mode,
        eof: true,
        sof: true,
        pages: [
          {
            page: 0,
            text: content,
            offset: 0,
          },
        ],
        totalSize: fileSize,
      };
    } else {
      // Send first 3 pages
      const pages = [];
      for (let i = 0; i < 3; i++) {
        const start = i * pageSize;
        const end = Math.min(start + pageSize, fileSize);

        const buffer = await promisify(fs.readFile)(filePath, {
          start,
          end: end - 1,
        });
        let content;

        if (isText) {
          content = buffer.toString('utf8');
        } else {
          const hexContent = buffer.toString('hex').toUpperCase();
          content = hexContent.match(/.{1,2}/g).join(' ');
        }

        pages.push({
          page: i,
          text: content,
          offset: start,
        });
      }

      return {
        mode: mode,
        eof: false,
        sof: true,
        pages: pages,
        totalSize: fileSize,
      };
    }
  } catch (error) {
    console.error('Error reading initial file content:', error);
    throw error;
  }
};

const isTextFile = (buffer) => {
  // Check if buffer contains mostly printable ASCII characters
  // This is a simple heuristic - more sophisticated detection could be added
  const sampleSize = Math.min(buffer.length, 1024); // Check first 1KB
  let printableCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    // Check if byte is printable ASCII (32-126) or common whitespace (9, 10, 13)
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      printableCount++;
    }
  }

  // If more than 80% of bytes are printable, consider it text
  return printableCount / sampleSize > 0.8;
};

const getDirectoryContents = async (dirPath) => {
  try {
    const files = await promisify(fs.readdir)(dirPath);
    const fileInfos = [];

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const fileInfo = await getFileInfo(fullPath);
      if (fileInfo) {
        fileInfos.push(fileInfo);
      }
    }

    // Sort: folders first, then files, both alphabetically
    fileInfos.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return fileInfos;
  } catch (error) {
    console.error('Error reading directory:', error);
    return [];
  }
};

const formatPathForDisplay = (filePath) => {
  try {
    // Replace home directory with ~ for cleaner display
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir && filePath.startsWith(homeDir)) {
      const relativePath = filePath.slice(homeDir.length);
      // Ensure we don't end up with empty string or just /
      if (relativePath === '' || relativePath === '/') {
        return '~';
      }
      return '~' + relativePath;
    }

    // On Windows, keep drive letter format but normalize separators
    if (platform === 'win32' && filePath.includes(':\\')) {
      return filePath.replace(/\\/g, '/');
    }

    return filePath;
  } catch (error) {
    console.error('Error formatting path:', error);
    return filePath;
  }
};

// System information collection functions
const getSystemInfo = async () => {
  try {
    const { exec } = await import('child_process');
    const execAsync = promisify(exec);

    // Basic system info
    const hostname = os.hostname();
    const arch = os.arch(); // 'x64', 'arm64' etc.
    const nodeVersion = process.version;
    const currentUser = os.userInfo().username || 'Unknown';

    // OS version info
    let osVersion = 'Unknown';
    let systemUptimeSeconds = process.uptime(); // Fallback to Node.js process uptime if system uptime fails

    try {
      if (platform === 'linux') {
        osVersion = 'Linux Distribution Unknown';
        if (commandExists("cat")) {
          const { stdout: osRelease } = await execAsync('cat /etc/os-release');
          const prettyNameMatch = osRelease.match(/PRETTY_NAME="([^"]+)"/);
          osVersion = prettyNameMatch ? prettyNameMatch[1] : 'Linux Distribution Unknown';
        }
      } else if (platform === 'darwin') {
        osVersion = 'macOS';
        if (commandExists("sw_vers")) {
          const { stdout: productVersion } = await execAsync('sw_vers -productVersion');
          osVersion = `macOS ${productVersion.trim()}`;
        }
      } else if (platform === 'win32') {
        osVersion = `Windows ${os.release()}`; // Fallback if systeminfo parsing fails
        if (commandExists("systeminfo")) {
          // Use 'ver' for simple Windows OS version, or 'systeminfo' for more details.
          // Opting for 'systeminfo' as it provides a better 'OS Name'.
          const { stdout: systemInfoOutput } = await execAsync('systeminfo');
  
          const osNameMatch = systemInfoOutput.match(/OS Name:\s*(.*)/i);
          if (osNameMatch && osNameMatch[1]) {
            osVersion = osNameMatch[1].trim();
          }
        }
      }
    } catch (error) {
      console.error('Error getting OS version or uptime:', error);
    }

    // CPU info
    let cpuModel = 'Unknown';
    let cpuCores = os.cpus().length; // Logical cores
    try {
      const cpus = os.cpus();
      if (cpus.length > 0) {
        cpuModel = cpus[0].model; // This is directly from Node's os module
      }
    } catch (error) {
      console.error('Error getting CPU info (os.cpus()):', error);
    }

    // GPU info
    let gpuModel = 'None detected';
    if (platform === 'linux') {
      if (commandsExists(["lspci","grep","head","cut","xargs"])) {
        try {
          const { stdout } = await execAsync(
            'lspci | grep -i vga | head -1 | cut -d":" -f3 | xargs',
          );
          if (stdout.trim()) {
            gpuModel = stdout.trim();
          }
        } catch (error) {
          console.error('Error getting GPU info (Linux):', error);
        }
      }
    } else if (platform === 'darwin') {
      if (commandsExists(["system_profiler","grep","head","cut","xargs"])) {
        try {
          const { stdout } = await execAsync(
            'system_profiler SPDisplaysDataType | grep "Chipset Model" | head -1 | cut -d":" -f2 | xargs',
          );
          if (stdout.trim()) {
            gpuModel = stdout.trim();
          }
        } catch (error) {
          console.error('Error getting GPU info (macOS):', error);
        }
      }
    }
    //TODO: Windows GPU detection

    // Memory usage (using native os module - no change)
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePercent = ((usedMem / totalMem) * 100).toFixed(1);

    // CPU usage (using native os module - no change)
    const cpus = os.cpus();
    let cpuUsagePercent = 0;
    if (cpus.length > 0) {
      const cpu = cpus[0];
      const total = Object.values(cpu.times).reduce((a, b) => a + b);
      const idle = cpu.times.idle;
      cpuUsagePercent = (((total - idle) / total) * 100).toFixed(1);
    }

    // Storage info (adapted for Windows without wmic)
    let storageInfo = { total: 0, used: 0, free: 0, usagePercent: 0 };
    try {
      if (platform === 'linux' || platform === 'darwin') {
        if (commandsExists(["df","tail","awk"])) {
          const { stdout } = await execAsync(
            'df -k / | tail -1 | awk \'{print $2, $3, $4}\'',
          ); // -k for KB units
          const [totalKb, usedKb, freeKb] = stdout
            .trim()
            .split(' ')
            .map(Number);
          storageInfo = {
            total: Math.round(totalKb / (1024 * 1024)), // Convert to GB
            used: Math.round(usedKb / (1024 * 1024)),
            free: Math.round(freeKb / (1024 * 1024)),
            usagePercent: totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0,
          };
        }
      } else if (platform === 'win32') {
        // Without wmic, we can't get all logical disk info easily.
        // We can get the info for the drive of the current working directory.
        // Node.js v18.15.0+ has fs.statfs which is ideal, but for broader compatibility,
        // we'll try to parse 'fsutil volume diskfree <driveletter>:'
        // Or simply calculate from total/free mem if that's acceptable for "storage".
        // Let's use `fs.statfs` if available, otherwise fallback.

        // Get the root of the current drive
        const driveRoot = path.parse(process.cwd()).root;

        // Using fs.statfs (Node.js 18.15.0+):
        if (typeof fs.statfs === 'function') {
          const stats = await promisify(fs.statfs)(driveRoot);
          const blockSize = stats.bsize; // block size in bytes
          const totalBlocks = stats.blocks;
          const freeBlocks = stats.bfree;
          const availableBlocks = stats.bavail; // free blocks available to non-privileged user

          const totalBytes = totalBlocks * blockSize;
          const freeBytes = availableBlocks * blockSize; // Use available for user
          const usedBytes = totalBytes - freeBytes;

          storageInfo = {
            total: Math.round(totalBytes / (1024 * 1024 * 1024)), // GB
            used: Math.round(usedBytes / (1024 * 1024 * 1024)), // GB
            free: Math.round(freeBytes / (1024 * 1024 * 1024)), // GB
            usagePercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
          };
        } else {
          // Fallback for older Node.js versions or if fs.statfs fails:
          // Try to parse 'fsutil volume diskfree C:' (requires admin on some systems, might not work)
          // Or a less accurate representation
          console.warn(
            "fs.statfs not available or failed. Providing limited storage info for Windows.",
          );
          storageInfo.total = Math.round(os.totalmem() / (1024 * 1024 * 1024)); // Total RAM as placeholder
          storageInfo.free = Math.round(os.freemem() / (1024 * 1024 * 1024)); // Free RAM as placeholder
          storageInfo.used = storageInfo.total - storageInfo.free;
          storageInfo.usagePercent =
            storageInfo.total > 0
              ? Math.round((storageInfo.used / storageInfo.total) * 100)
              : 0;
        }
      }
    } catch (error) {
      console.error('Error getting storage info:', error);
    }

    // Process count (no change - tasklist is fine)
    let processCount = 0;
    try {
      if (platform === 'linux' || platform === 'darwin') {
        if (commandsExists(["ps","wc"])) {
          const { stdout } = await execAsync('ps aux | wc -l');
          processCount = parseInt(stdout.trim()) - 1; // Subtract header line
        }
      } else if (platform === 'win32') {
        if (commandExists(["tasklist"])) {
          const { stdout } = await execAsync('tasklist /nh /fo csv');
          processCount = stdout.trim().split('\n').filter(Boolean).length;
        }
      }
    } catch (error) {
      console.error('Error getting process count:', error);
    }

    // Network usage (basic placeholder - remains the same)
    let networkInfo = { rx: 0, tx: 0 }; // Requires more advanced methods or third-party modules

    return {
      nexusVersion: '1.0.0',
      nexusBranch: 'main',
      nexusCommit: 'unknown',
      nodeVersion: nodeVersion,
      hostOS: osVersion, // Now more specific for Windows
      hostPlatform: platform, // 'win32', 'darwin', 'linux'
      hostArch: arch, // 'x64', 'arm64' etc.
      hostname: hostname,
      cpuModel: cpuModel,
      cpuCores: cpuCores,
      cpuUsage: cpuUsagePercent,
      gpuModel: gpuModel, // Will be "None detected" on Windows
      memoryTotal: Math.round(totalMem / (1024 * 1024 * 1024)), // GB
      memoryUsed: Math.round(usedMem / (1024 * 1024 * 1024)),
      memoryUsage: memUsagePercent,
      storageTotal: storageInfo.total,
      storageUsed: storageInfo.used,
      storageFree: storageInfo.free,
      storageUsage: storageInfo.usagePercent,
      processCount: processCount,
      currentUser: currentUser,
      serverUptime: systemUptimeSeconds, // Now system uptime, not just Node.js process uptime
      networkRx: networkInfo.rx,
      networkTx: networkInfo.tx,
    };
  } catch (error) {
    console.error('Error collecting system info:', error);
    return {
      error: 'Failed to collect system information',
    };
  }
};

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve assets from root directory
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('New terminal connection established');

  var shell;
  if (platform === 'win32') {
    if (commandExists(["powershell"])) {
      shell = 'powershell.exe';
    } else {
      shell = 'cmd.exe'
    }
  } else {
    shell = process.env.SHELL || 'bash'
  }
  // Spawn a new shell process
  const ptyProcess = spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  // Send initial welcome message
  const welcomeMessage = `\r\n\x1b[1;32mWelcome to Web Terminal!\x1b[0m\r\n`;
  ws.send(welcomeMessage + '\r\n');

  // Handle data from terminal process
  ptyProcess.onData((data) => {
    ws.send(data);
  });

  // Handle data from WebSocket (user input)
  ws.on('message', async (message) => {
    try {
      // Try to parse as JSON first (for resize messages and file system operations)
      const parsed = JSON.parse(message.toString());

      if (parsed.type === 'resize') {
        ptyProcess.resize(parsed.cols, parsed.rows);
        return;
      }

      if (parsed.type === 'file_system') {
        if (parsed.action === 'get_contents') {
          // Send current directory contents
          const contents = await getDirectoryContents(fileServerCurrDir);
          ws.send(
            JSON.stringify({
              type: 'file_system',
              action: 'contents',
              path: formatPathForDisplay(fileServerCurrDir),
              contents: contents,
            }),
          );
          return;
        }

        if (parsed.action === 'change_directory') {
          console.log('Change directory request:', parsed.path);
          console.log('Current directory:', fileServerCurrDir);

          if (parsed.path === '..') {
            // Go up one directory
            const parentDir = path.dirname(fileServerCurrDir);
            if (parentDir !== fileServerCurrDir) {
              fileServerCurrDir = parentDir;
            }
          } else {
            // Check if path is absolute or relative
            let newPath;
            if (
              parsed.path.startsWith('/') ||
              parsed.path.startsWith('~') ||
              (platform === 'win32' && /^[A-Za-z]:[\\/]/.test(parsed.path))
            ) {
              // Absolute path - resolve it directly
              if (parsed.path.startsWith('~')) {
                // Handle home directory expansion
                const homeDir = process.env.HOME || process.env.USERPROFILE;
                if (!homeDir) {
                  console.error('Home directory not found');
                  return;
                }
                newPath = path.join(homeDir, parsed.path.slice(1));
                console.log('Expanding ~ path:', parsed.path, 'to:', newPath);
              } else {
                newPath = path.resolve(parsed.path);
                console.log('Resolving absolute path:', parsed.path, 'to:', newPath);
              }
            } else {
              // Relative path - join with current directory
              newPath = path.join(fileServerCurrDir, parsed.path);
              console.log(
                'Joining relative path:',
                parsed.path,
                'with:',
                fileServerCurrDir,
                'result:',
                newPath,
              );
            }

            try {
              const stats = await promisify(fs.stat)(newPath);
              if (stats.isDirectory()) {
                fileServerCurrDir = newPath;
                console.log('Successfully changed to directory:', newPath);
              } else {
                console.log('Path is not a directory:', newPath);
              }
            } catch (error) {
              console.error('Error changing directory:', error);
              // Send error message back to frontend
              ws.send(
                JSON.stringify({
                  type: 'file_system',
                  action: 'error',
                  message: `Failed to change directory: ${error.message}`,
                }),
              );
              return;
            }
          }

          // Send new directory contents
          const contents = await getDirectoryContents(fileServerCurrDir);
          ws.send(
            JSON.stringify({
              type: 'file_system',
              action: 'contents',
              path: formatPathForDisplay(fileServerCurrDir),
              contents: contents,
            }),
          );
          return;
        }

        if (parsed.action === 'get_file_content') {
          console.log(
            'File content request:',
            parsed.filename,
            parsed.mode,
            parsed.pagesize,
          );
          try {
            const filePath = path.join(fileServerCurrDir, parsed.filename);
            const fileContent = await getFileContentInitial(
              filePath,
              parsed.mode,
              parsed.pagesize,
            );
            ws.send(
              JSON.stringify({
                type: 'file_system',
                action: 'file_content',
                filename: parsed.filename,
                ...fileContent,
              }),
            );
          } catch (error) {
            console.error('Error reading file content:', error);
            ws.send(
              JSON.stringify({
                type: 'file_system',
                action: 'error',
                message: `Failed to read file: ${error.message}`,
              }),
            );
          }
          return;
        }

        if (parsed.action === 'get_file_chunk') {
          console.log(
            'File chunk request:',
            parsed.filepath,
            parsed.mode,
            parsed.pagesize,
            parsed.byteoffset,
            parsed.aspage,
          );
          try {
            const filePath = path.join(fileServerCurrDir, parsed.filepath);
            const fileChunk = await getFileContentChunked(
              filePath,
              parsed.mode,
              parsed.pagesize,
              parsed.byteoffset,
              parsed.aspage,
            );
            ws.send(
              JSON.stringify({
                type: 'file_system',
                action: 'file_content',
                filename: parsed.filepath,
                ...fileChunk,
              }),
            );
          } catch (error) {
            console.error('Error reading file chunk:', error);
            ws.send(
              JSON.stringify({
                type: 'file_system',
                action: 'error',
                message: `Failed to read file chunk: ${error.message}`,
              }),
            );
          }
          return;
        }
      }

      if (parsed.type === 'system_info') {
        if (parsed.action === 'get_info') {
          // Send system information
          const systemInfo = await getSystemInfo();
          ws.send(
            JSON.stringify({
              type: 'system_info',
              action: 'info',
              data: systemInfo,
            }),
          );
          return;
        }
      }
    } catch (e) {
      // Not JSON, treat as regular terminal input
      const data = message.toString();
      ptyProcess.write(data);
    }
  });

  // Handle connection close
  ws.on('close', () => {
    console.log('Terminal connection closed');
    ptyProcess.kill();
  });

  // Handle terminal process exit
  ptyProcess.onExit(() => {
    ws.close();
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Web Terminal server running on http://localhost:${PORT}`);
});