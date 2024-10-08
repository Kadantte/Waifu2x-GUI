import {app, BrowserWindow, dialog, globalShortcut, ipcMain, shell} from "electron"
import Store from "electron-store"
import {autoUpdater} from "electron-updater"
import sharp from "sharp"
import fs from "fs"
import path from "path"
import process from "process"
import waifu2x from "waifu2x"
import imagesMeta from "images-meta"
import "./dev-app-update.yml"
import pack from "./package.json"
import functions from "./structures/functions"

require("@electron/remote/main").initialize()
process.setMaxListeners(0)
let window: Electron.BrowserWindow | null
let ffmpegPath = undefined as any
if (process.platform === "linux") ffmpegPath = path.join(app.getAppPath(), "../../ffmpeg/ffmpeg")
if (process.platform === "darwin") ffmpegPath = path.join(app.getAppPath(), "../../ffmpeg/ffmpeg.app")
if (process.platform === "win32") ffmpegPath = path.join(app.getAppPath(), "../../ffmpeg/ffmpeg.exe")
let modelPath = undefined as any
if (process.platform === "linux") modelPath = path.join(app.getAppPath(), "../../models")
if (process.platform === "darwin") modelPath = path.join(app.getAppPath(), "../../models")
if (process.platform === "win32") modelPath = path.join(app.getAppPath(), "../../models")
let waifu2xPath = path.join(app.getAppPath(), "../app.asar.unpacked/node_modules/waifu2x/waifu2x")
let esrganPath = path.join(app.getAppPath(), "../app.asar.unpacked/node_modules/waifu2x/real-esrgan")
let cuganPath = path.join(app.getAppPath(), "../app.asar.unpacked/node_modules/waifu2x/real-cugan")
let anime4kPath = path.join(app.getAppPath(), "../app.asar.unpacked/node_modules/waifu2x/anime4k")
let webpPath = path.join(app.getAppPath(), "../app.asar.unpacked/node_modules/waifu2x/webp")
let rifePath = path.join(app.getAppPath(), "../app.asar.unpacked/node_modules/rife-fps/rife")
let scriptsPath = path.join(app.getAppPath(), "../app.asar.unpacked/node_modules/waifu2x/scripts")
if (process.platform === "win32") {
  waifu2xPath = path.join(app.getAppPath(), "./node_modules/waifu2x/waifu2x")
  esrganPath = path.join(app.getAppPath(), "./node_modules/waifu2x/real-esrgan")
  cuganPath = path.join(app.getAppPath(), "./node_modules/waifu2x/real-cugan")
  anime4kPath = path.join(app.getAppPath(), "./node_modules/waifu2x/anime4k")
  webpPath = path.join(app.getAppPath(), "./node_modules/waifu2x/webp")
  rifePath = path.join(app.getAppPath(), "./node_modules/rife-fps/rife")
  scriptsPath = path.join(app.getAppPath(), "./node_modules/waifu2x/scripts")
}
if (!fs.existsSync(ffmpegPath)) ffmpegPath = undefined
if (!fs.existsSync(modelPath)) modelPath = path.join(__dirname, "../models")
if (!fs.existsSync(waifu2xPath)) waifu2xPath = path.join(__dirname, "../waifu2x")
if (!fs.existsSync(esrganPath)) esrganPath = path.join(__dirname, "../real-esrgan")
if (!fs.existsSync(cuganPath)) cuganPath = path.join(__dirname, "../real-cugan")
if (!fs.existsSync(anime4kPath)) anime4kPath = path.join(__dirname, "../anime4k")
if (!fs.existsSync(webpPath)) webpPath = path.join(__dirname, "../webp")
if (!fs.existsSync(scriptsPath)) scriptsPath = path.join(__dirname, "../scripts")
if (!fs.existsSync(rifePath)) rifePath = path.join(__dirname, "../rife")
autoUpdater.autoDownload = false
const store = new Store()

const history: Array<{id: number, source: string, dest: string, type: "image" | "gif" | "video"}> = []
const active: Array<{id: number, source: string, dest: string, type: "image" | "gif" | "video", action: null | "stop"}> = []
const queue: Array<{started: boolean, info: any}> = []

ipcMain.handle("update-color", (event, color: string) => {
  window?.webContents.send("update-color", color)
})

ipcMain.handle("preview", (event, image: string, type: string) => {
  window?.webContents.send("preview", image, type)
})

ipcMain.handle("init-settings", () => {
  return store.get("settings", null)
})

ipcMain.handle("store-settings", (event, settings) => {
  const prev = store.get("settings", {}) as object
  store.set("settings", {...prev, ...settings})
})

ipcMain.handle("advanced-settings", () => {
  window?.webContents.send("close-all-dialogs", "settings")
  window?.webContents.send("show-settings-dialog")
})

ipcMain.handle("get-theme", () => {
  return store.get("theme", "light")
})

ipcMain.handle("save-theme", (event, theme: string) => {
  store.set("theme", theme)
})

ipcMain.handle("install-update", async (event) => {
  if (process.platform === "darwin") {
    const update = await autoUpdater.checkForUpdates()
    const url = `${pack.repository.url}/releases/download/v${update.updateInfo.version}/${update.updateInfo.files[0].url}`
    await shell.openExternal(url)
    app.quit()
  } else {
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall()
  }
})

ipcMain.handle("check-for-updates", async (event, startup: boolean) => {
  window?.webContents.send("close-all-dialogs", "version")
  const update = await autoUpdater.checkForUpdates()
  const newVersion = update.updateInfo.version
  if (pack.version === newVersion) {
    if (!startup) window?.webContents.send("show-version-dialog", null)
  } else {
    window?.webContents.send("show-version-dialog", newVersion)
  }
})

ipcMain.handle("open-location", async (event, location: string) => {
  if (!fs.existsSync(location)) return
  if (fs.statSync(location).isDirectory()) {
    shell.openPath(path.normalize(location))
  } else {
    shell.showItemInFolder(path.normalize(location))
  }
})

ipcMain.handle("delete-conversion", async (event, id: number, frames: boolean) => {
  let dest = ""
  let source = ""
  let type = ""
  let index = active.findIndex((a) => a.id === id)
  if (index !== -1) {
    active[index].action = "stop"
    dest = active[index].dest
    source = active[index].source
    type = active[index].type
  } else {
    index = history.findIndex((a) => a.id === id)
    if (index !== -1) {
      dest = history[index].dest
      source = history[index].source
      type = history[index].type
    }
  }
  if (dest) {
    if (type === "image") {
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
    } else {
      if (frames) {
        let frameDest = `${path.dirname(source)}/${path.basename(source, path.extname(source))}Frames`
        if (type === "pdf") frameDest = `${path.dirname(dest)}/${path.basename(dest, path.extname(dest))}`
        const match = dest.match(/_\d+(?=\.)/)?.[0]
        if (match) {
          let newFrameDest = `${path.dirname(source)}/${path.basename(source, path.extname(source))}Frames${match}`
          if (type === "pdf") newFrameDest = `${path.dirname(dest)}/${path.basename(dest, path.extname(dest))}${match}`
          fs.existsSync(newFrameDest) ? functions.removeDirectory(newFrameDest) : (fs.existsSync(frameDest) ? functions.removeDirectory(frameDest) : null)
        } else {
          if (fs.existsSync(frameDest)) functions.removeDirectory(frameDest)
        }
      }
      let counter = 1
      let error = true
      while (error && counter < 20) {
        await functions.timeout(1000)
        try {
          fs.unlinkSync(dest)
          error = false
        } catch {
          // ignore
        }
        counter++
      }
    }
    return true
  }
  return false
})

ipcMain.handle("stop-conversion", async (event, id: number) => {
  const index = active.findIndex((a) => a.id === id)
  if (index !== -1) {
    active[index].action = "stop"
    return true
  }
  return false
})

ipcMain.handle("start-all", () => {
  window?.webContents.send("start-all")
})

ipcMain.handle("clear-all", () => {
  window?.webContents.send("clear-all")
})

const nextQueue = async (info: any) => {
  const index = active.findIndex((a) => a.id === info.id)
  if (index !== -1) active.splice(index, 1)
  const settings = store.get("settings", {}) as any
  let qIndex = queue.findIndex((q) => q.info.id === info.id)
  if (qIndex !== -1) {
    queue.splice(qIndex, 1)
    let concurrent = Number(settings?.queue)
    if (Number.isNaN(concurrent) || concurrent < 1) concurrent = 1
    if (active.length < concurrent) {
      const next = queue.find((q) => !q.started)
      if (next) {
        await upscale(next.info)
      }
    }
  }
}

const upscale = async (info: any) => {
  let qIndex = queue.findIndex((q) => q.info.id === info.id)
  if (qIndex !== -1) queue[qIndex].started = true
  const options = {
    noise: Number(info.noise) as any,
    scale: Number(info.scale),
    mode: info.mode,
    fpsMultiplier: Number(info.fpsMultiplier),
    quality: Number(info.quality),
    speed: Number(info.speed),
    reverse: info.reverse,
    framerate: null as any,
    jpgWebpQuality: Number(info.jpgQuality),
    pngCompression: Number(info.pngCompression),
    threads: Number(info.threads),
    rename: info.rename,
    parallelFrames: Number(info.parallelFrames),
    transparentColor: info.gifTransparency ? "#000000" : undefined,
    pitch: info.pitch,
    sdColorSpace: info.sdColorSpace,
    upscaler: functions.escape(info.upscaler),
    pngFrames: info.pngFrames,
    downscaleHeight: info.pdfDownscale ? Number(info.pdfDownscale) : undefined,
    pythonDownscale: info.pythonDownscale ? Number(info.pythonDownscale) : undefined,
    ffmpegPath,
    waifu2xPath,
    esrganPath,
    cuganPath,
    anime4kPath,
    scriptsPath,
    rifePath,
    webpPath
  }
  if (process.platform !== "win32") {
    info.source = info.source.replace("file://", "")
  }
  info.source = functions.escape(info.source)
  let overwrite = false
  if (info.dest.startsWith("{source}")) {
    if (!options.rename) overwrite = true
    info.dest = info.dest.replace("{source}", path.dirname(info.source))
  }
  let dest = waifu2x.parseDest(info.source, info.dest, options)
  const duplicate = active.find((a) => a.dest === dest)
  if (!overwrite && (fs.existsSync(dest) || duplicate)) dest = functions.newDest(dest, active)
  dest = dest.replace(/\\/g, "/")
  const action = (percent?: number) => {
    const index = active.findIndex((e) => e.id === info.id)
    if (index !== -1) {
      const action = active[index].action
      if (action === "stop") return true
    }
    if (percent !== undefined) window?.webContents.send("conversion-progress", {id: info.id, percent})
  }
  const progress = (current: number, total: number) => {
    const index = active.findIndex((e) => e.id === info.id)
    let frame = null
    if (index !== -1) {
      const action = active[index].action
      let frameDest = `${path.dirname(dest)}/${path.basename(info.source, path.extname(info.source))}Frames`
      if (info.type === "pdf") frameDest = `${path.dirname(dest)}/${path.basename(dest, path.extname(dest))}`
      if (fs.existsSync(frameDest)) {
        let frameArray = fs.readdirSync(frameDest).map((f) => `${frameDest}/${f}`).filter((f) => path.extname(f).toLowerCase() === ".png" 
        || path.extname(f).toLowerCase() === ".jpg" || path.extname(f).toLowerCase() === ".jpeg")
        frameArray = frameArray.sort(new Intl.Collator(undefined, {numeric: true, sensitivity: "base"}).compare)
        frame = frameArray[current]
      }
      if (action === "stop") return true
    }
    window?.webContents.send("conversion-progress", {id: info.id, current, total, frame})
  }
  const interlopProgress = (percent: number) => {
    const index = active.findIndex((e) => e.id === info.id)
    if (index !== -1) {
      const action = active[index].action
      if (action === "stop") return true
    }
    window?.webContents.send("interpolation-progress", {id: info.id, percent})
  }
  history.push({id: info.id, source: info.source, dest, type: info.type})
  active.push({id: info.id, source: info.source, dest, type: info.type, action: null})
  window?.webContents.send("conversion-started", {id: info.id})
  let output = ""
  let outputImage = ""
  try {
    if (info.type === "image") {
      let meta = []
      try {
        const buffer = fs.readFileSync(info.source)
        let inMime = "image/jpeg"
        if (path.extname(info.source) === ".png") inMime = "image/png"
        meta = imagesMeta.readMeta(buffer, inMime)
        for (let i = 0; i < meta.length; i++) {
          if (typeof meta[i].value !== "string") meta[i].value = ""
          meta[i].value = meta[i].value.replaceAll("UNICODE", "").replaceAll(/\u0000/g, "")
        }
      } catch {}
      let avif = false
      let jxl = false
      let sourceExt = path.extname(info.source)
      if (path.extname(info.source) === ".avif" || path.extname(info.source) === ".jxl") {
        if (path.extname(info.source) === ".avif") avif = true
        if (path.extname(info.source) === ".jxl") jxl = true
        const buffer = await sharp(fs.readFileSync(info.source), {limitInputPixels: false}).png().toBuffer()
        const newDest = dest.replace(path.extname(dest), ".png")
        fs.writeFileSync(newDest, buffer)
        info.source = newDest
        dest = newDest
      }
      output = await waifu2x.upscaleImage(info.source, dest, options, action)
      if (avif || jxl) {
        let buffer = sharp(fs.readFileSync(dest), {limitInputPixels: false})
        if (avif) buffer = buffer.avif({quality: options.jpgWebpQuality})
        if (jxl) buffer = buffer.jxl({quality: options.jpgWebpQuality})
        const newDest = dest.replace(path.extname(dest), sourceExt)
        fs.renameSync(dest, newDest)
        fs.writeFileSync(newDest, await buffer.toBuffer())
        output = newDest
      }
      if (info.compress) {
        const inputBuffer = fs.readFileSync(output)
        const outputBuffer = await sharp(inputBuffer, {limitInputPixels: false}).jpeg({optimiseScans: true, trellisQuantisation: true, quality: options.jpgWebpQuality}).toBuffer()
        fs.writeFileSync(output, outputBuffer)
        const renamePath = path.join(path.dirname(output), `${path.basename(output, path.extname(output))}.jpg`)
        fs.renameSync(output, renamePath)
        output = renamePath
      }
      if (meta?.length) {
        let outMime = "image/jpeg"
        if (path.extname(output) === ".png") outMime = "image/png"
        let metaBuffer = imagesMeta.writeMeta(fs.readFileSync(output), outMime, meta, "buffer")
        fs.writeFileSync(output, metaBuffer)
      }
    } else if (info.type === "gif") {
      output = await waifu2x.upscaleGIF(info.source, dest, options, progress)
    } else if (info.type === "animated webp") {
      output = await waifu2x.upscaleAnimatedWebp(info.source, dest, options, progress)
    } else if (info.type === "video") {
      output = await waifu2x.upscaleVideo(info.source, dest, options, progress, interlopProgress)
    } else if (info.type === "pdf") {
      output = await waifu2x.upscalePDF(info.source, dest, options, progress)
      const dimensions = await waifu2x.pdfDimensions(output, {downscaleHeight: undefined})
      outputImage = dimensions.image
    }
  } catch (error) {
      window?.webContents.send("debug", error)
      console.log(error)
      output = dest
  }
  window?.webContents.send("conversion-finished", {id: info.id, output, outputImage})
  nextQueue(info)
}

ipcMain.handle("upscale", async (event, info: any, startAll: boolean) => {
  const qIndex = queue.findIndex((q) => q.info.id === info.id)
  if (qIndex === -1) queue.push({info, started: false})
  if (startAll) {
    const settings = store.get("settings", {}) as any
    let concurrent = Number(settings?.queue)
    if (Number.isNaN(concurrent) || concurrent < 1) concurrent = 1
    if (active.length < concurrent) {
      await upscale(info)
    }
  } else {
    await upscale(info)
  }
})

ipcMain.handle("update-concurrency", async (event, concurrent) => {
  if (Number.isNaN(concurrent) || concurrent < 1) concurrent = 1
  let counter = active.length
  while (counter < concurrent) {
    const next = queue.find((q) => !q.started)
    if (next) {
      counter++
      await upscale(next.info)
    } else {
      break
    }
  }
})


ipcMain.handle("move-queue", async (event, id: number) => {
  const settings = store.get("settings", {}) as any
  let concurrent = Number(settings?.queue)
  if (Number.isNaN(concurrent) || concurrent < 1) concurrent = 1
  if (id) {
    let qIndex = queue.findIndex((q) => q.info.id === id)
    if (qIndex !== -1) queue.splice(qIndex, 1)
  }
  if (active.length < concurrent) {
    const next = queue.find((q) => !q.started)
    if (next) {
      await upscale(next.info)
    }
  }
})

ipcMain.handle("get-dimensions", async (event, path: string, type: string, options?: any) => {
  if (type === "video") {
    const dimensions = await waifu2x.parseResolution(path, ffmpegPath)
    const framerate = await waifu2x.parseFramerate(path, ffmpegPath)
    return {width: dimensions.width, height: dimensions.height, framerate}
  } else if (type === "pdf") {
    const dimensions = await waifu2x.pdfDimensions(path, {downscaleHeight: undefined})
    return {width: dimensions.width, height: dimensions.height, image: dimensions.image}
  } else {
    const dimensions = await sharp(fs.readFileSync(path), {limitInputPixels: false}).metadata()
    return {width: dimensions.width, height: dimensions.height}
  }
})

ipcMain.handle("get-python-models", (event) => {
  return fs.readdirSync(modelPath).filter((f: string) => f !== ".DS_Store").map((f: string) => path.join(modelPath, f))
})

ipcMain.handle("add-files", (event, files: string[], identifers: number[]) => {
  window?.webContents.send("add-files", files, identifers)
})

ipcMain.handle("add-file-id", (event, file: string, pos: number, id: number) => {
    window?.webContents.send("add-file-id", file, pos, id)
})

ipcMain.handle("add-file", (event, file: string, pos: number) => {
    window?.webContents.send("add-file", file, pos)
})

ipcMain.handle("select-files", async () => {
  if (!window) return
  const files = await dialog.showOpenDialog(window, {
    filters: [
      {name: "All Files", extensions: ["*"]},
      {name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "avif", "jxl", "tiff"]},
      {name: "Animations", extensions: ["gif", "webp"]},
      {name: "Videos", extensions: ["mp4", "ogv", "webm", "avi", "mov", "mkv", "flv"]},
      {name: "PDF", extensions: ["pdf"]},
    ],
    properties: ["multiSelections", "openFile"]
  })
  return files.filePaths
})

ipcMain.handle("get-downloads-folder", async (event, force: boolean) => {
  if (store.has("downloads") && !force) {
    return store.get("downloads")
  } else {
    const downloads = app.getPath("downloads")
    store.set("downloads", downloads)
    return downloads
  }
})

ipcMain.handle("select-directory", async (event, dir: string) => {
  if (!window) return
  if (dir === undefined) {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"]
    })
    dir = result.filePaths[0]
  }
  if (dir) {
    store.set("downloads", dir)
    return dir
  }
})

const singleLock = app.requestSingleInstanceLock()

if (!singleLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.on("ready", () => {
    window = new BrowserWindow({width: 800, height: 600, minWidth: 720, minHeight: 450, frame: false, backgroundColor: "#5ea8da", center: true, roundedCorners: false, webPreferences: {nodeIntegration: true, contextIsolation: false}})
    window.loadFile(path.join(__dirname, "index.html"))
    window.removeMenu()
    if (process.platform !== "win32") {
      if (ffmpegPath) fs.chmodSync(ffmpegPath, "777")
      waifu2x.chmod777(waifu2xPath, webpPath, esrganPath, cuganPath, anime4kPath, rifePath)
    }
    require("@electron/remote/main").enable(window.webContents)
    window.on("closed", () => {
      window = null
    })
    globalShortcut.register("Control+Shift+I", () => {
      window?.webContents.toggleDevTools()
    })
  })
}