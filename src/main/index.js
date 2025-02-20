import { app, shell, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
const { protocol } = require('electron')
const { net } = require('electron')
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
const path = require("path");
const fs = require("fs");
import { version } from '/package.json';
const { autoUpdater } = require("electron-updater")

const userDataPath = app.getPath("userData");

// Read&Set version.txt
if (!fs.existsSync(path.join(userDataPath, "version.txt"))) {
  fs.writeFileSync(path.join(userDataPath, "version.txt"), "{}");
}

let ifUpdated = false
if(fs.readFileSync(path.join(userDataPath, "version.txt"), "utf-8") !== version){
  ifUpdated = true;
  fs.writeFileSync(path.join(userDataPath, "version.txt"), version)
}

if (!fs.existsSync(path.join(userDataPath, "currentnotebook.txt"))) {
  fs.writeFileSync(path.join(userDataPath, "currentnotebook.txt"), "");
}

if (!fs.existsSync(path.join(userDataPath, "folders.json"))) {
  fs.writeFileSync(path.join(userDataPath, "folders.json"), "[]");
}

if (!fs.existsSync(path.join(userDataPath, "preferences.json"))) {
  fs.writeFileSync(path.join(userDataPath, "preferences.json"), "{}");
}

// Create the notebooks folder if it doesn't exist
if (!fs.existsSync(path.join(userDataPath, "notebooks/"))) {
  fs.mkdirSync(path.join(userDataPath, "notebooks/"));
}

// Register media protocol
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true
    }
  }
]);

let folders = JSON.parse(fs.readFileSync(path.join(userDataPath, "folders.json"), {encoding: "utf-8",}));
let preferences = JSON.parse(fs.readFileSync(path.join(userDataPath, "preferences.json"), {encoding: "utf-8",}));

function savePreferences(){
  fs.writeFileSync(
    path.join(userDataPath, "preferences.json"),
    JSON.stringify(preferences),
    {
      encoding: "utf-8",
    },
  );
}

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: true,
    autoHideMenuBar: true,
    'icon': __dirname + '/../../resources/icon64x64.png',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js')
    }
  })

  const handleUrlOpen = (e, url)=>{
    if( url.match(/^http/)){
      e.preventDefault()
      shell.openExternal(url)
    }
  }
  mainWindow.webContents.on('will-navigate', handleUrlOpen);
  mainWindow.webContents.on('new-window', handleUrlOpen);

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
  electronApp.setAppUserModelId('com.ideanoteapp.v2')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Handle media protocol
  protocol.handle('media', (req) => { 
    const pathToMedia = new URL(req.url.replace(/%20/g, ' ')).pathname;
    return net.fetch(`file://${pathToMedia}`);
  });

  // i18n
  const lang = app.getLocale()
  try{
    var i18n = require(`../../locales/${lang}.json`)
  }catch{
    var i18n = require(`../../locales/en-US.json`)
  }

  autoUpdater.checkForUpdatesAndNotify()

  const menu = Menu.buildFromTemplate([
    {
      label: i18n.contextmenu.cut,
      role: 'cut',
    }, {
      label: i18n.contextmenu.copy,
      role: 'copy',
    }, {
      label: i18n.contextmenu.paste,
      role: 'paste',
    }
  ]);

  createWindow()

  // IPC
  ipcMain.handle("getLocales", (event) => {
    return i18n
  });
  
  ipcMain.handle("getIfUpdated", (event) => {
    return ifUpdated
  });

  ipcMain.handle("listNotebooks", (event) => {
    const dir = path.join(userDataPath, "notebooks/")

    let files = fs.readdirSync(dir);
    let fileList = [];

    files.forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fileList.push(filePath);
      }
    });

    return fileList.concat(folders);
  });

  ipcMain.handle("getCurrentNotebook", (event) => {
    return fs.readFileSync(path.join(userDataPath, "currentnotebook.txt"), {
      encoding: "utf-8",
    });
  });

  ipcMain.handle("setCurrentNotebook", (event, notebook) => {
    fs.writeFileSync(path.join(userDataPath, "currentnotebook.txt"), notebook, {
      encoding: "utf-8",
    });
  });
  
  
  ipcMain.handle("addNotebook", async (event) => {
    let res

    await dialog
      .showOpenDialog({
        properties: ["openDirectory"],
        title: i18n.newnotebook_dialog
      })
      .then((result) => {
        if(result.filePaths[0]){
          folders.push(result.filePaths[0]);
          fs.writeFileSync(
            path.join(userDataPath, "folders.json"),
            JSON.stringify(folders),
            {
              encoding: "utf-8",
            },
          );

          res = result.filePaths[0]
        }
      });

    return res
  });

  ipcMain.handle("createNotebook", (event, path_) => {
    fs.mkdirSync(path_)
    folders.push(path_);
    fs.writeFileSync(
      path.join(userDataPath, "folders.json"),
      JSON.stringify(folders),
      {
        encoding: "utf-8",
      }
    );
  })

  ipcMain.handle("removeNotebook", (even, currentNotebook) => {
    folders = folders.filter(item => item !== currentNotebook);

    fs.writeFileSync(
      path.join(userDataPath, "folders.json"),
      JSON.stringify(folders),
      {
        encoding: "utf-8",
      },
    );
  });

  ipcMain.handle("listFolders", (event, currentNotebook) => {
    // Check for path existence
    if (!fs.existsSync(currentNotebook)){
      return
    }
    
    // Check if there are any special paths
    if (currentNotebook.includes("../")){
      return
    }
    if (currentNotebook.includes("..\\")){
      return
    }

    try {
      const dir = currentNotebook
      
      let files = fs.readdirSync(dir);
      let fileList = [];
  
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          fileList.push(filePath);
        }
      });
  
      return fileList;
    } catch (error) {
      console.error("Error reading directory:", error);
      return [];
    }
  });

  ipcMain.handle("listFiles", (event, dir) => {
    // Check for path existence
    if (!fs.existsSync(dir)){
      return
    }
    
    // Check if there are any special paths
    if (dir.includes("../")){
      return
    }
    if (dir.includes("..\\")){
      return
    }

    try {
      let files = fs.readdirSync(dir);
      let fileList = [];
  
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (!stat.isDirectory()) {
          let noteinfo = "";
          if (
            filePath.replace(/^.*[\\/]/, "").match(/[^.]+$/s)[0] == "md" ||
            filePath.replace(/^.*[\\/]/, "").match(/[^.]+$/s)[0] == "txt"
          ) {
            fileList.push({
              name: filePath,
              info: fs.readFileSync(filePath, { encoding: "utf-8" }),
              mtime: stat.mtime,
            });
          } else {
            fileList.push({ name: filePath, info: "", mtime: stat.mtime });
          }
        }
      });
  
      // Sort Files
      fileList.sort((a, b) => {
        const isAPinned = a.name.includes("#pin");
        const isBPinned = b.name.includes("#pin");
  
        if (isAPinned && !isBPinned) {
          return -1;
        } else if (!isAPinned && isBPinned) {
          return 1;
        } else {
          return b.mtime.getTime() - a.mtime.getTime();
        }
      });

      return fileList

    } catch (error) {
      console.error(error)
      return []
    }

  });

  ipcMain.handle("getFile", (event, path) => {
    // Check for path existence
    if (!fs.existsSync(path)){
      return
    }
    
    // Check if there are any special paths
    if (path.includes("../")){
      return
    }
    if (path.includes("..\\")){
      return
    }

    if(
      path.replace(/^.*[\\/]/, '').match(/[^.]+$/s)[0] === 'png' ||
      path.replace(/^.*[\\/]/, '').match(/[^.]+$/s)[0] === 'jpg' ||
      path.replace(/^.*[\\/]/, '').match(/[^.]+$/s)[0] === 'jpeg' ||
      path.replace(/^.*[\\/]/, '').match(/[^.]+$/s)[0] === 'webp' ||
      path.replace(/^.*[\\/]/, '').match(/[^.]+$/s)[0] === 'gif' ||
      path.replace(/^.*[\\/]/, '').match(/[^.]+$/s)[0] === 'mp4' ||
      path.replace(/^.*[\\/]/, '').match(/[^.]+$/s)[0] === 'mp3' ||
      path.replace(/^.*[\\/]/, '').match(/[^.]+$/s)[0] === 'wav'
    ){
      return fs.readFileSync(path, 'base64')
    }else{
      return fs.readFileSync(path, { encoding: "utf8" })
    }
  });

  ipcMain.handle("saveFile", (event, path, text) => {
    // Check for path existence
    if (!fs.existsSync(path)){
      return
    }
    
    // Check if there are any special paths
    if (path.includes("../")){
      return
    }
    if (path.includes("..\\")){
      return
    }
    
    return fs.writeFileSync(path, text, "utf-8");
  });

  ipcMain.handle("createNote", (event, path) => {
    // Check if there are any special paths
    if (path.includes("../")){
      return
    }
    if (path.includes("..\\")){
      return
    }

    fs.writeFileSync(path, "")
    return
  });

  ipcMain.handle("changeNoteTitle", (event, from, to) => {
    fs.renameSync(from, path.join(path.dirname(from), to));
    return path.join(path.dirname(from), to);
  });

  ipcMain.handle("deleteNote", (event, path) => {
    return fs.rmSync(path);
  });

  ipcMain.handle("getPreferences", (event) => {
    return preferences;
  });

  ipcMain.handle("setPreferences", (event, data) => {
    preferences = JSON.parse(data);
    savePreferences();
  });

  ipcMain.handle("rightClick", (event) => {
    menu.popup()
  });

  ipcMain.handle("upload", async (event, currentFolder, file) => {
    try {
      if(file){
        const sourcePath = file;
        const targetPath = path.join(
          currentFolder,
          sourcePath.replace(/^.*[\\/]/, ""),
        );
        fs.copyFileSync(sourcePath, targetPath);
      }else{
        const filePath = await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [
            {
              name: "",
              extensions: [
                "*"
              ],
            },
          ],
        });
        if (!filePath.canceled) {
          const sourcePath = filePath.filePaths[0];
          const targetPath = path.join(
            currentFolder,
            sourcePath.replace(/^.*[\\/]/, ""),
          );
          fs.copyFileSync(sourcePath, targetPath);
        }
      }
    } catch (error) {
      console.error(error);
    }
  });
  
  ipcMain.handle("openInExternal", (event, path) => {
    shell.openPath(path)
  });

  ipcMain.handle("newFolder", (event, path) => {
    return fs.mkdirSync(path)
  });

  ipcMain.handle("deleteFolder", (event, path) => {
    dialog
      .showMessageBox({
        type: "question",
        buttons: ["OK", "Cancel"],
        title: "Citronote",
        message: i18n.deletefolder_dialog_message,
      })
      .then((result) => {
        if (result.response === 0) {
          fs.rmSync(path, {recursive: true})
        }
      });
  });

  ipcMain.handle("askFolder", async (event) => {
    let res

    await dialog
      .showOpenDialog({
        properties: ["openDirectory"]
      })
      .then((result) => {
        res = result.filePaths[0]
      })

    return res
  });

  ipcMain.handle("reloadNotebooks", (event) => {
    let folders = JSON.parse(fs.readFileSync(path.join(userDataPath, "folders.json"), {encoding: "utf-8",}));
  });

  ipcMain.handle("getVersion", (event) => {
    return version;
  });

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
