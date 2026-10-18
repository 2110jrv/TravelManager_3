import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
if(process.cwd().toLowerCase()!=='c:\\codex\\travelmanager_3')throw Error('PROJECT_PATH');
// Google rejects Chromium automation login. Launch native Chrome without
// automation switches, using an isolated profile inside the project.
const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  `--user-data-dir=${resolve('.av2-private/google-browser-native')}`,
  '--remote-debugging-port=9224','--remote-debugging-address=127.0.0.1',
  'http://127.0.0.1:5004/v2/#settings'
],{detached:true,stdio:'ignore',windowsHide:false});
browser.on('error',()=>{console.error('Native Chrome unavailable. Open the preview in your normal browser.');process.exitCode=1;});
browser.unref();
