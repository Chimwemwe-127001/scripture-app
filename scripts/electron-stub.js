/**
 * electron-stub.js: lets main-process modules load under plain Node.
 *
 * bibleDb, settings and logger require('electron') for app paths. Scripts
 * that test those modules require this file first, and it answers
 * require('electron') with a minimal fake `app` that writes to a temp folder.
 */

const Module = require('module')
const path = require('path')
const os = require('os')

const TMP_USERDATA = path.join(os.tmpdir(), 'scripture-app-scripts')

const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false,
        getPath: () => TMP_USERDATA,
        getVersion: () => '0.0.0-script',
      },
    }
  }
  return originalLoad.call(this, request, ...rest)
}
