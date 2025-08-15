class SciFiTerminal {
    constructor() {
        this.terminal = null;
        this.websocket = null;
        this.fitAddon = null;
        this.isConnected = false;
        this.hasPlayedFirstPrompt = false;
        this.startTime = Date.now();
        this.isGridView = false;

        // Initialize file viewer state
        this.currentFileInfo = {
            filename: null,
            mode: null,
            pageSize: null,
            totalSize: null,
            loadedPages: new Map(),
            eof: false,
            sof: false
        };

        this.currentDirectoryContents = [];

        this.initStartupSequence();
    }

    // Audio helper functions
    playSound(path) {
        try {
            const audio = new Audio(path);
            audio.volume = 0.3;
            audio.play().catch(() => {
                // Silently fail if audio file doesn't exist or can't play
            });
        } catch (error) {
            // Silently fail if audio file doesn't exist
        }
    }

    // Startup sequence
    initStartupSequence() {
        const enterBtn = document.getElementById('enter-btn');
        enterBtn.addEventListener('click', () => {
            this.playSound('sfx/launch.wav');
            this.startAnimationSequence();
        });
    }

    async startAnimationSequence() {
        const startupScreen = document.getElementById('startup-screen');
        const mainInterface = document.getElementById('main-interface');

        // Hide startup screen
        startupScreen.style.display = 'none';

        // Show dot
        const dot = document.createElement('div');
        dot.className = 'startup-dot';
        document.body.appendChild(dot);

        await this.sleep(500);
        this.playSound('sfx/uianim.wav');

        // Animate dot to line
        dot.style.transition = 'all 1s ease';
        dot.style.width = '200px';
        dot.style.height = '2px';
        dot.style.borderRadius = '0';

        await this.sleep(1000);
        this.playSound('sfx/uianim.wav');

        // Animate line to square
        dot.style.width = '400px';
        dot.style.height = '300px';
        dot.style.background = 'transparent';
        dot.style.border = '2px solid #00ff41';
        dot.style.borderRadius = '8px';

        await this.sleep(1000);
        this.playSound('sfx/uianim.wav');

        // Calculate terminal position and dimensions
        const terminalContainer =
            document.getElementById('terminal-container');
        const terminalRect = terminalContainer.getBoundingClientRect();

        // Scale UP square to match terminal dimensions (2/3 width, full height, top-left aligned)
        dot.style.transition = 'all 1.5s ease';
        dot.style.position = 'fixed';
        dot.style.width = `${terminalRect.width}px`;
        dot.style.height = `${terminalRect.height}px`;
        dot.style.left = `${terminalRect.left}px`;
        dot.style.top = `${terminalRect.top}px`;
        // The square will scale UP from 400x300 to terminal dimensions

        await this.sleep(1500);
        this.playSound('sfx/uianim.wav');

        // Remove animation element and show main interface
        dot.remove();
        mainInterface.classList.remove('hidden');

        // Initialize terminal
        this.setupTerminal();
        this.connectWebSocket();
        this.setupEventListeners();

        // Animate in sidebar and file explorer
        await this.sleep(500);
        this.showInfoPanel();

        await this.sleep(300);
        this.showFileExplorer();

        // Start info updates
        this.startInfoUpdates();

        // Request initial file system contents
        this.requestFileSystemContents();

        // Request initial system information
        this.requestSystemInfo();

        // Setup file explorer controls
        this.setupFileExplorerControls();
    }

    async showInfoPanel() {
        const infoPanel = document.getElementById('info-panel');
        infoPanel.classList.remove('hidden');
        infoPanel.style.transform = 'translateX(100%)';
        infoPanel.style.transition = 'transform 0.8s ease';

        await this.sleep(50);
        infoPanel.style.transform = 'translateX(0)';

        // Animate in text content
        setTimeout(() => {
            const infoValues = infoPanel.querySelectorAll('.info-value');
            infoValues.forEach((value, index) => {
                setTimeout(() => {
                    value.classList.add('text-appear');
                    this.playSound('sfx/appear.wav');
                }, index * 100);
            });
        }, 800);
    }

    async showFileExplorer() {
        const fileExplorer = document.getElementById('file-explorer');
        fileExplorer.classList.remove('hidden');
        fileExplorer.style.transform = 'translateY(100%)';
        fileExplorer.style.transition = 'transform 0.8s ease';

        await this.sleep(50);
        fileExplorer.style.transform = 'translateY(0)';
    }

    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    setupTerminal() {
        // Initialize xterm.js terminal with sci-fi theme
        this.terminal = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            fontSize: 14,
            fontFamily: '"Courier New", "Monaco", "Menlo", monospace',
            theme: {
                background: 'transparent',
                foreground: '#00ff41',
                cursor: '#00ff41',
                cursorAccent: '#000000',
                selection: 'rgba(0, 255, 65, 0.3)',
                black: '#000000',
                red: '#ff0040',
                green: '#00ff41',
                yellow: '#ffff00',
                blue: '#0080ff',
                magenta: '#ff00ff',
                cyan: '#00ffff',
                white: '#ffffff',
                brightBlack: '#404040',
                brightRed: '#ff4080',
                brightGreen: '#80ff80',
                brightYellow: '#ffff80',
                brightBlue: '#80c0ff',
                brightMagenta: '#ff80ff',
                brightCyan: '#80ffff',
                brightWhite: '#ffffff'
            },
            allowTransparency: true,
            convertEol: true,
            scrollback: 1000,
            tabStopWidth: 4
        });

        // Add fit addon for responsive terminal
        this.fitAddon = new FitAddon.FitAddon();
        this.terminal.loadAddon(this.fitAddon);

        // Add web links addon
        this.terminal.loadAddon(new WebLinksAddon.WebLinksAddon());

        // Open terminal in the container
        this.terminal.open(document.getElementById('terminal'));

        // Initial fit
        this.fitAddon.fit();

        // Show connecting message
        this.terminal.write(
            '\r\n\x1b[1;32m> NEXUS TERMINAL INITIALIZING...\x1b[0m\r\n'
        );
        this.terminal.write(
            '\x1b[1;36m> ESTABLISHING SECURE CONNECTION...\x1b[0m\r\n'
        );
    }

    connectWebSocket() {
        const protocol =
            window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        this.websocket = new WebSocket(wsUrl);

        this.websocket.onopen = () => {
            this.isConnected = true;
            this.updateConnectionStatus('ONLINE');
            console.log('WebSocket connection established');

            // Clear loading message and send terminal size
            this.terminal.clear();
            this.terminal.write('\x1b[1;32m> CONNECTION ESTABLISHED\x1b[0m\r\n');
            this.terminal.write('\x1b[1;36m> NEXUS TERMINAL READY\x1b[0m\r\n\r\n');
            this.sendTerminalSize();
        };

        this.websocket.onmessage = (event) => {
            try {
                // Try to parse as JSON for file system messages
                const parsed = JSON.parse(event.data);
                console.log('Received WebSocket message:', parsed);

                if (parsed.type === 'file_system') {
                    this.handleFileSystemMessage(parsed);
                    return;
                }
                if (parsed.type === 'system_info') {
                    this.handleSystemInfoMessage(parsed);
                    return;
                }

                // Unknown message type, log it
                console.log('Unknown message type:', parsed.type);
            } catch (e) {
                console.log('Error parsing JSON:', e);
                console.log('Raw message data:', event.data);

                // Not JSON, treat as terminal output
                this.terminal.write(event.data);

                // Play sound on first prompt
                if (
                    !this.hasPlayedFirstPrompt &&
                    (event.data.includes('$') || event.data.includes('>'))
                ) {
                    this.hasPlayedFirstPrompt = true;
                    this.playSound('sfx/appear.wav');
                }
            }
        };

        this.websocket.onclose = () => {
            this.isConnected = false;
            this.updateConnectionStatus('OFFLINE');
            console.log('WebSocket connection closed');

            // Show disconnection message
            this.terminal.write('\r\n\x1b[1;31m> CONNECTION TERMINATED\x1b[0m\r\n');
            this.terminal.write('\x1b[1;33m> REFRESH TO RECONNECT\x1b[0m\r\n');
        };

        this.websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateConnectionStatus('ERROR');
            this.terminal.write('\r\n\x1b[1;31m> CONNECTION ERROR\x1b[0m\r\n');
        };
    }

    setupEventListeners() {
        // Handle terminal input
        this.terminal.onData((data) => {
            if (this.isConnected && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(data);
                // Play key sound for each keystroke
                this.playSound('sfx/key.wav');
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.fitAddon.fit();
            this.sendTerminalSize();
            // Update page size for file viewer
            this.updatePageSize();
        });

        // Handle terminal resize
        this.terminal.onResize((size) => {
            this.sendTerminalSize();
        });

        // Handle keyboard shortcuts
        document.addEventListener('keydown', (event) => {
            // Ctrl+L to clear terminal
            if (event.ctrlKey && event.key === 'l') {
                event.preventDefault();
                this.terminal.clear();
            }

            // Escape key to close file viewer popup
            if (event.key === 'Escape') {
                this.closeFileViewer();
            }
        });

        // Setup file viewer popup close button
        const closeButton = document.getElementById('popup-close');
        if (closeButton) {
            closeButton.addEventListener('click', () => this.closeFileViewer());
        }

        // Setup click outside popup to clear highlights
        document.addEventListener('click', (event) => {
            const popup = document.getElementById('file-viewer-popup');
            if (
                popup &&
                !popup.contains(event.target) &&
                !popup.classList.contains('hidden')
            ) {
                this.clearAllHighlights();
            }
        });

        // Setup scroll event handling for virtual scrolling
        this.setupVirtualScrolling();
    }

    setupVirtualScrolling() {
        // Monitor scroll events in text and binary content areas
        const textContent = document.getElementById('text-content');
        const binaryContent = document.getElementById('binary-content');

        if (textContent) {
            textContent.addEventListener('scroll', (event) => {
                this.handleContentScroll(event, 'text');
            });
        }

        if (binaryContent) {
            binaryContent.addEventListener('scroll', (event) => {
                this.handleContentScroll(event, 'binary');
            });
        }
    }

    handleContentScroll(event, mode) {
        // Safety check for currentFileInfo
        if (!this.currentFileInfo || !this.currentFileInfo.filename) {
            return;
        }

        const element = event.target;
        const scrollTop = element.scrollTop;
        const scrollHeight = element.scrollHeight;
        const clientHeight = element.clientHeight;

        // Check if we're near the bottom or top
        const nearBottom = scrollTop + clientHeight >= scrollHeight - 100;
        const nearTop = scrollTop <= 100;

        if (nearBottom && !this.currentFileInfo.eof) {
            // Request next page
            const lastPage = Math.max(
                ...Array.from(this.currentFileInfo.loadedPages.keys())
            );
            const nextPage = lastPage + 1;
            const byteOffset = nextPage * this.currentFileInfo.pageSize;
            this.requestFileChunk(byteOffset, nextPage);
        } else if (nearTop && !this.currentFileInfo.sof) {
            // Request previous page
            const firstPage = Math.min(
                ...Array.from(this.currentFileInfo.loadedPages.keys())
            );
            const prevPage = firstPage - 1;
            if (prevPage >= 0) {
                const byteOffset = prevPage * this.currentFileInfo.pageSize;
                this.requestFileChunk(byteOffset, prevPage);
            }
        }
    }

    updatePageSize() {
        if (this.currentFileInfo && this.currentFileInfo.filename) {
            const newPageSize = this.calculatePageSize(
                this.currentFileInfo.mode === 'binary'
            );
            if (newPageSize !== this.currentFileInfo.pageSize) {
                this.currentFileInfo.pageSize = newPageSize;
                console.log('Page size updated to:', newPageSize);
                // Re-request chunks if page size changes and content is loaded
                if (this.currentFileInfo.loadedPages.size > 0) {
                    this.currentFileInfo.loadedPages.clear(); // Clear old pages
                    this.currentFileInfo.eof = false; // Reset EOF/SOF
                    this.currentFileInfo.sof = false;
                    this.requestFileChunk(0, 0); // Request first page again
                }
            }
        }
    }

    sendTerminalSize() {
        if (this.isConnected && this.websocket.readyState === WebSocket.OPEN) {
            const size = {
                type: 'resize',
                cols: this.terminal.cols,
                rows: this.terminal.rows
            };

            try {
                this.websocket.send(JSON.stringify(size));
            } catch (error) {
                console.warn('Failed to send terminal size:', error);
            }
        }
    }

    updateConnectionStatus(status) {
        const statusElement = document.getElementById('connection-status');
        statusElement.textContent = status;

        // Update status styling based on connection
        if (status === 'ONLINE') {
            statusElement.style.color = '#00ff41';
        } else if (status === 'OFFLINE') {
            statusElement.style.color = '#ff0040';
        } else {
            statusElement.style.color = '#ffff00';
        }
    }

    startInfoUpdates() {
        // Update frontend uptime every second
        setInterval(() => {
            const uptime = Date.now() - this.startTime;
            const hours = Math.floor(uptime / 3600000);
            const minutes = Math.floor((uptime % 3600000) / 60000);
            const seconds = Math.floor((uptime % 60000) / 1000);

            const uptimeElement = document.getElementById('uptime-info');
            if (uptimeElement) {
                uptimeElement.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);

        // Update system info every 5 seconds
        setInterval(() => {
            this.requestSystemInfo();
        }, 5000);
    }

    requestFileSystemContents() {
        if (this.isConnected && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(
                JSON.stringify({
                    type: 'file_system',
                    action: 'get_contents'
                })
            );
            // Play sound effect for initial load
            this.playSound('sfx/appear.wav');
        }
    }

    requestSystemInfo() {
        if (this.isConnected && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(
                JSON.stringify({
                    type: 'system_info',
                    action: 'get_info'
                })
            );
        }
    }

    handleFileSystemMessage(message) {
        console.log('Handling file system message:', message.action);

        if (message.type === 'file_system' && message.action === 'contents') {
            console.log('Received file system message with path:', message.path);
            this.populateFileExplorer(message.contents, message.path);
            // Update the path input field with current directory
            this.updatePathInput(message.path);
            // Play sound effect for directory change
            this.playSound('sfx/appear.wav');
        } else if (
            message.type === 'file_system' &&
            message.action === 'file_content'
        ) {
            console.log('Received file content:', message.filename, message.mode);

            if (message.pages) {
                // Handle chunked content with pages
                console.log(
                    'Handling chunked file content with pages:',
                    message.pages.length
                );
                this.handleChunkedFileContent(message);
            } else {
                // Handle single content (legacy or small files)
                console.log('Handling single file content');
                this.showFileViewerLegacy(
                    message.filename,
                    message.mode,
                    message.content,
                    message.size
                );
            }
        } else if (
            message.type === 'file_system' &&
            message.action === 'error'
        ) {
            console.error('File system error:', message.message);
            // You could display this error to the user if needed
        } else {
            console.log('Unknown file system action:', message.action);
        }
    }

    handleSystemInfoMessage(message) {
        if (message.type === 'system_info' && message.action === 'info') {
            console.log('Received system info:', message.data);
            this.updateSystemInfo(message.data);
            // Play sound effect for info update
            this.playSound('sfx/appear.wav');
        }
    }

    updateSystemInfo(data) {
        if (data.error) {
            //console.error('System info error:', data.error);
            return;
        }

        // Update all system info fields
        this.updateInfoField('nexus-version', `${data.nexusVersion} (${data.nexusBranch})`);
        this.updateInfoField('node-version', data.nodeVersion);
        this.updateInfoField('host-os', data.hostOS);
        this.updateInfoField('host-platform', data.hostPlatform);
        this.updateInfoField('hostname', data.hostname);
        this.updateInfoField('cpu-model', data.cpuModel);
        this.updateInfoField('cpu-cores', data.cpuCores);
        this.updateInfoField('gpu-model', data.gpuModel);
        this.updateInfoField('current-user', data.currentUser);
        this.updateInfoField('process-count', data.processCount);
        this.updateInfoField(
            'memory-usage',
            `${data.memoryUsed}GB / ${data.memoryTotal}GB (${data.memoryUsage}%)`
        );
        this.updateInfoField(
            'storage-usage',
            `${data.storageUsed}MB / ${data.storageTotal}MB (${data.storageUsage}%)`
        );
        this.updateInfoField('cpu-usage', `${data.cpuUsage}%`);

        // Update server uptime
        const serverUptime = data.serverUptime;
        const hours = Math.floor(serverUptime / 3600);
        const minutes = Math.floor((serverUptime % 3600) / 60);
        const seconds = Math.floor(serverUptime % 60);
        this.updateInfoField(
            'server-uptime',
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        );
    }

    updateInfoField(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    openFile(filename) {
        if (this.isConnected && this.websocket.readyState === WebSocket.OPEN) {
            console.log('Opening file:', filename);

            // Get file info to determine mode
            const fileItem = this.getFileItemByName(filename);
            if (!fileItem) {
                console.error('File not found:', filename);
                return;
            }

            // Calculate page size based on viewport
            const pageSize = this.calculatePageSize(fileItem.isBinary);
            const mode = fileItem.isBinary ? 'binary' : 'text';

            // Update current file info
            this.currentFileInfo.filename = filename;
            this.currentFileInfo.mode = mode;
            this.currentFileInfo.pageSize = pageSize;
            this.currentFileInfo.loadedPages.clear();
            this.currentFileInfo.eof = false;
            this.currentFileInfo.sof = false;

            // Show loading popup immediately
            this.showFileViewer(filename, 'loading', fileItem.size);

            // Request file content
            this.websocket.send(
                JSON.stringify({
                    type: 'file_system',
                    action: 'get_file_content',
                    filename: filename,
                    mode: mode,
                    pagesize: pageSize
                })
            );
        }
    }

    getFileItemByName(filename) {
        // Try to get file info from the current directory listing
        if (this.currentDirectoryContents) {
            const fileItem = this.currentDirectoryContents.find(
                (item) => item.name === filename
            );
            if (fileItem) {
                return {
                    name: fileItem.name,
                    size: fileItem.size * 1024, // Convert KB to bytes
                    isBinary: fileItem.isBinary || false
                };
            }
        }

        // Fallback: assume text files for common extensions
        const textExtensions = ['.txt', '.js', '.json', '.html', '.css', '.md', '.log'];
        const ext = filename.split('.').pop().toLowerCase();
        return {
            name: filename,
            size: 0, // Will be updated when we get the response
            isBinary: !textExtensions.includes('.' + ext)
        };
    }

    calculatePageSize(isBinary) {
        const popup = document.getElementById('file-viewer-popup');
        if (!popup) return 8192; // Default fallback

        // Get the specific content area for calculating size
        const contentArea = isBinary
            ? document.getElementById('binary-content')
            : document.getElementById('text-content');

        if (!contentArea) return 8192; // Fallback if content areas not found

        const contentRect = contentArea.getBoundingClientRect();
        const contentHeight = contentRect.height;
        const contentWidth = contentRect.width;

        if (contentHeight <= 0 || contentWidth <= 0) {
            return 8192; // Fallback if dimensions are zero
        }

        // Get font metrics
        const testElement = document.createElement('span');
        testElement.style.fontFamily = 'Courier New, Monaco, Menlo, monospace';
        testElement.style.fontSize = '12px'; // Match CSS font size
        testElement.style.fontWeight = 'normal';
        testElement.style.visibility = 'hidden';
        testElement.style.position = 'absolute';
        testElement.textContent = 'W'; // Use 'W' for width measurement
        document.body.appendChild(testElement);

        const charWidth = testElement.offsetWidth;
        const charHeight = testElement.offsetHeight;
        document.body.removeChild(testElement);

        if (charWidth === 0 || charHeight === 0) {
            return 8192; // Fallback if font metrics are zero
        }

        // Calculate page size
        const charsPerLine = Math.floor(contentWidth / charWidth);
        const numberOfLines = Math.floor(contentHeight / charHeight);
        let pageSize = charsPerLine * numberOfLines;

        // For binary mode, adjust for hex representation (2 chars per byte + space)
        if (isBinary) {
            // A byte takes up 2 hex chars + 1 space = 3 chars in total for hex representation.
            // Plus an additional space for grouping every X bytes (e.g., 4 bytes)
            // The ASCII part also consumes space
            // Let's simplify and consider typical hex viewer layout:
            // "00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F   . . . . . . . . . . . . . . . ."
            // A common width for a line in hex viewers is 16 bytes.
            // So, calculate based on 16 bytes per line.
            const bytesPerBinaryLine = 16;
            pageSize = bytesPerBinaryLine * numberOfLines;
            return Math.max(pageSize, 256); // Minimum 256 bytes for binary
        }

        return Math.max(pageSize, 256); // Minimum 256 bytes for text
    }

    // New unified showFileViewer
    showFileViewer(filename, mode, size) {
        const popup = document.getElementById('file-viewer-popup');
        const filenameElement = document.getElementById('popup-filename');
        const loadingContent = document.getElementById('loading-content');
        const textContent = document.getElementById('text-content');
        const binaryContent = document.getElementById('binary-content');

        // Update filename and size
        filenameElement.textContent = `${filename} (${this.formatFileSize(size)})`;

        // Hide all content types initially
        loadingContent.classList.add('hidden');
        textContent.classList.add('hidden');
        binaryContent.classList.add('hidden');

        if (mode === 'loading') {
            // Show loading spinner
            loadingContent.classList.remove('hidden');
            // Clear previous content from actual display areas to avoid flicker
            document.getElementById('text-display').textContent = '';
            document.getElementById('hex-data').innerHTML = '';
            document.getElementById('ascii-data').innerHTML = '';
        } else if (mode === 'text') {
            // Only show the container; content is filled by displayChunkedTextContent
            textContent.classList.remove('hidden');
        } else if (mode === 'binary') {
            // Only show the container; content is filled by displayChunkedBinaryContent
            binaryContent.classList.remove('hidden');
        }

        // Show popup
        popup.classList.remove('hidden');

        // Play sound effect (only once when popup appears)
        if (mode === 'loading') {
            this.playSound('sfx/appear.wav');
        }
    }

    // Legacy handler for single content messages (keep for backward compatibility if needed)
    showFileViewerLegacy(filename, mode, content, size) {
        const popup = document.getElementById('file-viewer-popup');
        const filenameElement = document.getElementById('popup-filename');
        const loadingContent = document.getElementById('loading-content');
        const textContent = document.getElementById('text-content');
        const binaryContent = document.getElementById('binary-content');
        const textDisplay = document.getElementById('text-display');
        const hexData = document.getElementById('hex-data');
        const asciiData = document.getElementById('ascii-data');

        filenameElement.textContent = `${filename} (${this.formatFileSize(size)})`;

        loadingContent.classList.add('hidden');
        textContent.classList.add('hidden');
        binaryContent.classList.add('hidden');

        if (mode === 'loading') {
            loadingContent.classList.remove('hidden');
        } else if (mode === 'text') {
            textDisplay.textContent = content;
            textContent.classList.remove('hidden');
        } else if (mode === 'binary') {
            this.displayHexViewer(content, hexData, asciiData);
            binaryContent.classList.remove('hidden');
        }

        popup.classList.remove('hidden');
        this.playSound('sfx/appear.wav');
    }

    displayHexViewer(hexContent, hexElement, asciiElement) {
        // Clear previous content
        hexElement.innerHTML = '';
        asciiElement.innerHTML = '';

        // Split hex content into bytes
        const hexBytes = hexContent.split(' ').filter(Boolean); // Filter out empty strings
        const bytesPerLine = 16; // Standard hex viewer line length

        for (
            let lineIndex = 0;
            lineIndex < Math.ceil(hexBytes.length / bytesPerLine);
            lineIndex++
        ) {
            const lineStart = lineIndex * bytesPerLine;
            const lineEnd = Math.min(lineStart + bytesPerLine, hexBytes.length);

            // Create hex line
            const hexLine = document.createElement('div');
            hexLine.className = 'hex-line';
            hexLine.style.display = 'flex';
            hexLine.style.flexWrap = 'nowrap'; // Prevent wrapping within a line
            hexLine.style.whiteSpace = 'pre'; // Preserve spaces

            // Create ASCII line
            const asciiLine = document.createElement('div');
            asciiLine.className = 'ascii-line';
            asciiLine.style.display = 'flex';
            asciiLine.style.flexWrap = 'nowrap';
            asciiLine.style.whiteSpace = 'pre';

            // Process bytes in this line
            for (let i = lineStart; i < lineEnd; i++) {
                const hex = hexBytes[i];
                const byte = parseInt(hex, 16);

                // Create hex byte element
                const hexByte = document.createElement('span');
                hexByte.className = 'hex-byte';
                hexByte.textContent = hex.padStart(2, '0'); // Ensure 2 chars
                hexByte.dataset.byteIndex = i;
                hexByte.dataset.lineIndex = lineIndex;
                hexByte.dataset.positionInLine = i - lineStart;

                // Create ASCII character element
                const asciiChar = document.createElement('span');
                asciiChar.className = 'ascii-char';
                asciiChar.dataset.byteIndex = i;
                asciiChar.dataset.lineIndex = lineIndex;
                asciiChar.dataset.positionInLine = i - lineStart;

                // Set ASCII content
                if (byte >= 32 && byte <= 126) {
                    // Printable ASCII
                    asciiChar.textContent = String.fromCharCode(byte);
                } else {
                    // Non-printable, use dot or specific symbols
                    asciiChar.textContent = '.';
                }

                // Add click event for highlighting
                hexByte.addEventListener('click', () =>
                    this.highlightBytePair(i, lineIndex, i - lineStart)
                );
                asciiChar.addEventListener('click', () =>
                    this.highlightBytePair(i, lineIndex, i - lineStart)
                );

                // Add to lines
                hexLine.appendChild(hexByte);
                // Add a space after each byte in hex view for readability
                if ((i - lineStart + 1) % 1 === 0 && i !== lineEnd - 1) {
                    const space = document.createElement('span');
                    space.textContent = ' ';
                    hexLine.appendChild(space);
                }

                asciiLine.appendChild(asciiChar);
            }

            // Fill empty spaces if line is shorter than bytesPerLine
            for (let i = lineEnd; i < lineStart + bytesPerLine; i++) {
                const hexByte = document.createElement('span');
                hexByte.className = 'hex-byte empty';
                hexByte.textContent = '  '; // Two spaces for alignment
                hexLine.appendChild(hexByte);
                if ((i - lineStart + 1) % 1 === 0) {
                    const space = document.createElement('span');
                    space.textContent = ' ';
                    hexLine.appendChild(space);
                }
                const asciiChar = document.createElement('span');
                asciiChar.className = 'ascii-char empty';
                asciiChar.textContent = ' ';
                asciiLine.appendChild(asciiChar);
            }

            // Add lines to containers
            hexElement.appendChild(hexLine);
            asciiElement.appendChild(asciiLine);
        }

        // Store reference to elements for highlighting
        this.hexElement = hexElement;
        this.asciiElement = asciiElement;
    }

    highlightBytePair(byteIndex, lineIndex, positionInLine) {
        // Clear previous highlights
        this.clearAllHighlights();

        // Find the hex byte and ASCII char elements
        // This is more robust than direct querySelectorAll for performance
        const hexByte = this.hexElement.children[lineIndex].children[positionInLine * 2]; // *2 because of space elements
        const asciiChar = this.asciiElement.children[lineIndex].children[positionInLine];


        if (hexByte && asciiChar) {
            // Add selected class to both elements
            hexByte.classList.add('selected');
            asciiChar.classList.add('selected');

            // Create selection highlight box
            this.createSelectionHighlight(hexByte, asciiChar);
        }
    }

    clearAllHighlights() {
        // Remove selected class from all elements
        const selectedHex = this.hexElement.querySelectorAll('.hex-byte.selected');
        const selectedAscii = this.asciiElement.querySelectorAll(
            '.ascii-char.selected'
        );

        selectedHex.forEach((el) => el.classList.remove('selected'));
        selectedAscii.forEach((el) => el.classList.remove('selected'));

        // Remove any existing selection highlights
        const highlights = document.querySelectorAll('.selection-highlight');
        highlights.forEach((el) => el.remove());
    }

    createSelectionHighlight(hexByte, asciiChar) {
        // Get positions of both elements
        const hexRect = hexByte.getBoundingClientRect();
        const asciiRect = asciiChar.getBoundingClientRect();
        const popupRect = document
            .getElementById('file-viewer-popup')
            .getBoundingClientRect();

        // Create highlight element
        const highlight = document.createElement('div');
        highlight.className = 'selection-highlight';

        // Position highlight to cover both elements
        const left = Math.min(hexRect.left, asciiRect.left) - popupRect.left;
        const top = hexRect.top - popupRect.top;
        const width =
            Math.max(hexRect.right, asciiRect.right) - popupRect.left - left;
        const height = Math.max(hexRect.height, asciiChar.height);

        highlight.style.left = `${left}px`;
        highlight.style.top = `${top}px`;
        highlight.style.width = `${width}px`;
        highlight.style.height = `${height}px`;

        // Add to popup
        document.getElementById('file-viewer-popup').appendChild(highlight);

        // Auto-remove highlight after a delay
        setTimeout(() => {
            if (highlight.parentNode) {
                highlight.remove();
            }
        }, 2000);
    }

    handleChunkedFileContent(message) {
        try {
            console.log('Handling chunked file content for:', message.filename);

            // Update current file info
            this.currentFileInfo.filename = message.filename;
            this.currentFileInfo.totalSize = message.totalSize;
            this.currentFileInfo.eof = message.eof;
            this.currentFileInfo.sof = message.sof;

            // Set mode and pageSize if not already set or if it changed (e.g., from an updatePageSize call)
            if (
                !this.currentFileInfo.mode ||
                this.currentFileInfo.mode !== message.mode
            ) {
                this.currentFileInfo.mode = message.mode;
                console.log('Set mode to:', message.mode);
            }
            // Recalculate pageSize here to ensure it's accurate based on current view/popup size
            // This is crucial if the window was resized while the viewer was open.
            const newCalculatedPageSize = this.calculatePageSize(
                message.mode === 'binary'
            );
            if (
                !this.currentFileInfo.pageSize ||
                this.currentFileInfo.pageSize !== newCalculatedPageSize
            ) {
                this.currentFileInfo.pageSize = newCalculatedPageSize;
                console.log('Set/Updated page size to:', this.currentFileInfo.pageSize);
            }

            // Store loaded pages
            if (message.pages) {
                console.log('Storing', message.pages.length, 'pages');
                message.pages.forEach((page) => {
                    this.currentFileInfo.loadedPages.set(page.page, page);
                    console.log('Stored page', page.page, 'with offset', page.offset);
                });
            }

            // First, update the popup to show the correct content type (not loading)
            this.showFileViewer(
                message.filename,
                message.mode,
                message.totalSize
            ); // Call the unified viewer

            // Then, display content based on mode
            if (message.mode === 'text') {
                console.log('Displaying text content');
                this.displayChunkedTextContent(); // No message needed, it reads from currentFileInfo
            } else if (message.mode === 'binary') {
                console.log('Displaying binary content');
                this.displayChunkedBinaryContent(); // No message needed
            }
        } catch (error) {
            console.error('Error in handleChunkedFileContent:', error);
            console.error('Message:', message);
            console.error('Current file info:', this.currentFileInfo);
        }
    }

    displayChunkedTextContent() {
        if (!this.currentFileInfo || !this.currentFileInfo.loadedPages) {
            console.error('currentFileInfo not properly initialized for text content');
            return;
        }

        let fullContent = '';

        // Combine all loaded pages
        const sortedPages = Array.from(this.currentFileInfo.loadedPages.values())
            .sort((a, b) => a.page - b.page);

        sortedPages.forEach((page) => {
            fullContent += page.text;
        });

        const textDisplayElement = document.getElementById('text-display');
        if (textDisplayElement) {
            textDisplayElement.textContent = fullContent;
            console.log('Text content updated:', fullContent.substring(0, 100) + '...'); // Log a preview
            // Ensure the parent container is visible if it wasn't already (though showFileViewer should handle this)
            document.getElementById('text-content').classList.remove('hidden');
        } else {
            console.error('text-display element not found!');
        }
    }

    displayChunkedBinaryContent() {
        if (!this.currentFileInfo || !this.currentFileInfo.loadedPages) {
            console.error(
                'currentFileInfo not properly initialized for binary content'
            );
            return;
        }

        const hexData = document.getElementById('hex-data');
        const asciiData = document.getElementById('ascii-data');

        if (!hexData || !asciiData) {
            console.error('Hex or ASCII data elements not found!');
            return;
        }

        // Combine all loaded pages
        const sortedPages = Array.from(this.currentFileInfo.loadedPages.values())
            .sort((a, b) => a.page - b.page);

        let fullHexContent = '';
        sortedPages.forEach((page) => {
            // Ensure spaces between hex values when combining
            fullHexContent += page.text + ' ';
        });

        // Ensure the parent container is visible
        document.getElementById('binary-content').classList.remove('hidden');

        // Pass the trim()med content to displayHexViewer
        this.displayHexViewer(fullHexContent.trim(), hexData, asciiData);
    }

    requestFileChunk(byteOffset, asPage) {
        if (
            !this.currentFileInfo ||
            !this.currentFileInfo.filename ||
            !this.isConnected
        )
            return;

        this.websocket.send(
            JSON.stringify({
                type: 'file_system',
                action: 'get_file_chunk',
                filepath: this.currentFileInfo.filename,
                mode: this.currentFileInfo.mode,
                pagesize: this.currentFileInfo.pageSize,
                byteoffset: byteOffset,
                aspage: asPage
            })
        );
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024)
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    closeFileViewer() {
        const popup = document.getElementById('file-viewer-popup');
        if (popup) {
            popup.classList.add('hidden');

            // Clear current file info
            this.currentFileInfo = {
                filename: null,
                mode: null,
                pageSize: null,
                totalSize: null,
                loadedPages: new Map(),
                eof: false,
                sof: false
            };

            // Play sound effect
            this.playSound('sfx/appear.wav');
        }
    }

    populateFileExplorer(contents = [], currentPath = '') {
        const explorerContent = document.getElementById('explorer-content');
        console.log('Populating file explorer with:', contents);

        // Store current directory contents for file info lookup
        this.currentDirectoryContents = contents;

        // Clear existing content
        explorerContent.innerHTML = '';

        // Add ".." entry at the top if not at root
        if (currentPath && currentPath !== '/') {
            const parentItem = document.createElement('div');
            parentItem.className = 'folder-item parent-item';

            if (this.isGridView) {
                parentItem.innerHTML = `
                    <img src="assets/fxfolder.svg" alt="parent" class="folder-icon" onerror="this.style.display='none'">
                    <span class="file-name">..</span>
                `;
            } else {
                parentItem.innerHTML = `
                    <img src="assets/fxfolder.svg" alt="parent" class="folder-icon" onerror="this.style.display='none'">
                    <span class="file-name">..</span>
                `;
            }

            parentItem.addEventListener('click', () => this.changeDirectory('..'));
            parentItem.classList.add('text-appear');
            explorerContent.appendChild(parentItem);
            this.playSound('sfx/appear.wav');
        }

        // Add file and folder items
        contents.forEach((item, index) => {
            setTimeout(() => {
                const itemElement = document.createElement('div');
                itemElement.className =
                    item.type === 'folder' ? 'folder-item' : 'file-item';

                const iconSrc =
                    item.type === 'folder'
                        ? 'assets/fxfolder.svg'
                        : 'assets/fxfile.svg';
                console.log(`Creating ${item.type} item with icon: ${iconSrc}`);

                // Create different HTML for list vs grid view
                if (this.isGridView) {
                    itemElement.innerHTML = `
                        <img src="${iconSrc}" alt="${item.type}" class="${item.type === 'folder' ? 'folder-icon' : 'file-icon'}" onerror="this.style.display='none'" onload="console.log('Icon loaded:', this.src)">
                        <span class="file-name">${item.name}</span>
                        ${item.type === 'file' ? `<span class="file-info">${item.size}KB</span>` : ''}
                    `;
                } else {
                    itemElement.innerHTML = `
                        <img src="${iconSrc}" alt="${item.type}" class="${item.type === 'folder' ? 'folder-icon' : 'file-icon'}" onerror="this.style.display='none'" onload="console.log('Icon loaded:', this.src)">
                        <span class="file-name">${item.name}</span>
                        <span class="file-info">${item.type === 'folder' ? '' : `${item.size}KB`}</span>
                    `;
                }

                // Add click handler for folders
                if (item.type === 'folder') {
                    itemElement.addEventListener('click', () =>
                        this.changeDirectory(item.name)
                    );
                } else {
                    // Add double-click handler for files
                    itemElement.addEventListener('dblclick', () =>
                        this.openFile(item.name)
                    );
                }

                itemElement.classList.add('text-appear');
                explorerContent.appendChild(itemElement);
                this.playSound('sfx/appear.wav');
            }, index * 150);
        });
    }

    changeDirectory(path) {
        if (this.isConnected && this.websocket.readyState === WebSocket.OPEN) {
            console.log('Changing directory to:', path);
            this.websocket.send(
                JSON.stringify({
                    type: 'file_system',
                    action: 'change_directory',
                    path: path
                })
            );
        }
    }

    setupFileExplorerControls() {
        const pathInput = document.getElementById('path-input');
        const viewToggle = document.getElementById('view-toggle');

        // Path input handler
        pathInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                const path = pathInput.value.trim();
                if (path) {
                    this.navigateToPath(path);
                    pathInput.value = '';
                }
            }
        });

        // View toggle handler
        viewToggle.addEventListener('click', () => {
            this.toggleView();
        });
    }

    navigateToPath(path) {
        if (this.isConnected && this.websocket.readyState === WebSocket.OPEN) {
            console.log('Navigating to path:', path);
            this.websocket.send(
                JSON.stringify({
                    type: 'file_system',
                    action: 'change_directory',
                    path: path
                })
            );
        }
    }

    toggleView() {
        this.isGridView = !this.isGridView;
        const explorerContent = document.getElementById('explorer-content');

        if (this.isGridView) {
            explorerContent.classList.add('grid-view');
        } else {
            explorerContent.classList.remove('grid-view');
        }

        // Play sound effect
        this.playSound('sfx/appear.wav');

        // Re-render current content with new view
        this.refreshCurrentView();
    }

    refreshCurrentView() {
        // Re-request current directory contents to refresh the view
        this.requestFileSystemContents();
    }

    updatePathInput(currentPath) {
        const pathInput = document.getElementById('path-input');
        if (pathInput) {
            // Set the current path in the input field
            // Ensure we preserve the tilde if it exists
            pathInput.value = currentPath || '';
            console.log('Updated path input to:', currentPath);
        }
    }

    // Public methods for external control
    focus() {
        this.terminal.focus();
    }

    clear() {
        this.terminal.clear();
    }

    write(data) {
        this.terminal.write(data);
    }
}

// Initialize terminal when page loads
document.addEventListener('DOMContentLoaded', () => {
    const sciFiTerminal = new SciFiTerminal();

    // Make terminal globally accessible for debugging
    window.sciFiTerminal = sciFiTerminal;
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (
        !document.hidden &&
        window.sciFiTerminal &&
        window.sciFiTerminal.terminal
    ) {
        window.sciFiTerminal.focus();
    }
});

// Handle fullscreen changes
document.addEventListener('fullscreenchange', () => {
    setTimeout(() => {
        if (window.sciFiTerminal && window.sciFiTerminal.fitAddon) {
            window.sciFiTerminal.fitAddon.fit();
            window.sciFiTerminal.sendTerminalSize();
        }
    }, 100);
});