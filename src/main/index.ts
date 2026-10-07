import { app, shell, BrowserWindow, ipcMain, desktopCapturer, session } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { mouse, keyboard, Key, Point, Button, screen } from '@nut-tree-fork/nut-js'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Handle getDisplayMedia() requests from the renderer
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // Pick the primary/first screen automatically
      if (sources && sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' })
      } else {
        console.error('No screen sources found')
      }
    }).catch(err => {
      console.error('Error getting sources:', err)
    })
  })

  // Remote Control IPC
  ipcMain.on('mouse-move', async (_, { x, y }) => {
    try {
      const width = await screen.width()
      const height = await screen.height()
      // x and y are percentages (0.0 to 1.0)
      const targetX = Math.max(0, Math.min(width, Math.round(x * width)))
      const targetY = Math.max(0, Math.min(height, Math.round(y * height)))
      await mouse.setPosition(new Point(targetX, targetY))
    } catch (e) {
      console.error('Mouse move error:', e)
    }
  })

  ipcMain.on('mouse-click', async (_, button) => {
    try {
      if (button === 'left') await mouse.click(Button.LEFT)
      if (button === 'right') await mouse.click(Button.RIGHT)
    } catch (e) {
      console.error('Mouse click error:', e)
    }
  })

  ipcMain.on('scroll', async (_, { deltaX, deltaY }) => {
    try {
      if (deltaY > 0) await mouse.scrollDown(Math.abs(deltaY))
      else if (deltaY < 0) await mouse.scrollUp(Math.abs(deltaY))
      
      if (deltaX > 0) await mouse.scrollRight(Math.abs(deltaX))
      else if (deltaX < 0) await mouse.scrollLeft(Math.abs(deltaX))
    } catch (e) {
      console.error('Scroll error:', e)
    }
  })

  // Simple key map for basic keys (nut.js Key enum mapping)
  const mapKey = (code: string): any => {
    const map: Record<string, any> = {
      'Enter': Key.Enter, 'Escape': Key.Escape, 'Backspace': Key.Backspace, 'Tab': Key.Tab, 'Space': Key.Space,
      'ArrowUp': Key.Up, 'ArrowDown': Key.Down, 'ArrowLeft': Key.Left, 'ArrowRight': Key.Right,
      'ShiftLeft': Key.LeftShift, 'ShiftRight': Key.RightShift, 'ControlLeft': Key.LeftControl, 'ControlRight': Key.RightControl,
      'AltLeft': Key.LeftAlt, 'AltRight': Key.RightAlt, 'MetaLeft': Key.LeftSuper, 'MetaRight': Key.RightSuper
    };
    if (map[code]) return map[code];
    // Map KeyA -> Key.A, Digit1 -> Key.Num1
    if (code.startsWith('Key')) return Key[code.replace('Key', '') as keyof typeof Key];
    if (code.startsWith('Digit')) return Key[`Num${code.replace('Digit', '')}` as keyof typeof Key];
    return null;
  };

  ipcMain.on('keyboard', async (_, { type, code }) => {
    try {
      const k = mapKey(code);
      if (!k) return;
      if (type === 'keydown') await keyboard.pressKey(k);
      else if (type === 'keyup') await keyboard.releaseKey(k);
    } catch (e) {
      console.error('Keyboard error:', e)
    }
  })


  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // --- NATIVE PYTHON OVERLAY ---
  let overlayProcess: ChildProcess | null = null
  let isOverlayStarting = false

  const overlayScript = is.dev
    ? join(app.getAppPath(), 'resources/overlay.py')
    : join(process.resourcesPath, 'overlay')

  console.log('[overlay] script path:', overlayScript)

  ipcMain.on('create-widget', () => {
    console.log('[overlay] create-widget called, overlayProcess:', !!overlayProcess, 'isOverlayStarting:', isOverlayStarting)
    if (overlayProcess || isOverlayStarting) return
    isOverlayStarting = true

    console.log('[overlay] spawning', overlayScript)
    if (is.dev) {
      overlayProcess = spawn('python3', [overlayScript], { stdio: ['pipe', 'pipe', 'pipe'] })
    } else {
      overlayProcess = spawn(overlayScript, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    }
    console.log('[overlay] spawned pid:', overlayProcess.pid)
    isOverlayStarting = false

    const fs = require('fs')
    const logFile = fs.createWriteStream('/tmp/overlay.log', { flags: 'a' })
    
    // Read actions from Python (stdout) → send to renderer
    overlayProcess.stdout?.on('data', (data: Buffer) => {
      logFile.write(`[OUT] ${data.toString()}`)
      const lines = data.toString().trim().split('\n')
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          const hostWin = BrowserWindow.getAllWindows()[0]
          hostWin?.webContents.send('widget-action', msg)
        } catch {}
      }
    })

    overlayProcess.stderr?.on('data', (d: Buffer) => {
      logFile.write(`[ERR] ${d.toString()}`)
      console.error('[overlay.py stderr]', d.toString())
    })

    overlayProcess.on('close', (code) => {
      logFile.write(`[EXIT] ${code}\n`)
      console.log('[overlay] process closed with code:', code)
      overlayProcess = null
      isOverlayStarting = false
    })
  })

  ipcMain.on('close-widget', () => {
    if (overlayProcess) {
      overlayProcess.stdin?.write(JSON.stringify({ type: 'quit' }) + '\n')
      overlayProcess.kill()
      overlayProcess = null
    }
  })

  ipcMain.on('widget-action', (_, action) => {
    // Also handle via main window forwarding (widget actions from React widget fallback)
    BrowserWindow.getAllWindows()[0]?.webContents.send('widget-action', action)
  })

  // Forward state updates from host renderer → Python overlay stdin
  ipcMain.on('widget-state-update', (_, state) => {
    if (overlayProcess?.stdin) {
      const msg = JSON.stringify({ type: 'state', ...state })
      overlayProcess.stdin.write(msg + '\n')
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
