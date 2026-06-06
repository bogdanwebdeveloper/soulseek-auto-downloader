const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'node_modules', 'slsk-client', 'lib', 'slsk-client.js');

if (!fs.existsSync(targetPath)) {
  console.log('[Patch-Slsk] slsk-client is not installed yet or path is incorrect. Skipping patch.');
  process.exit(0);
}

let code = fs.readFileSync(targetPath, 'utf8');

// Check if already patched
if (code.includes('peer ${obj.file.user} not in active peers list. requesting peer address...')) {
  console.log('[Patch-Slsk] slsk-client is already patched.');
  process.exit(0);
}

const originalCheck = `    if (!peers[obj.file.user]) {
      return cb(new Error('User not exist'))
    }`;

const patchedCheck = `    if (!peers[obj.file.user]) {
      debug(\`peer \${obj.file.user} not in active peers list. requesting peer address...\`)
      server.getPeerAddress(obj.file.user)
      
      let checkInterval
      let timeoutTimer
      
      const cleanUp = () => {
        clearInterval(checkInterval)
        clearTimeout(timeoutTimer)
      }
      
      checkInterval = setInterval(() => {
        if (peers[obj.file.user]) {
          cleanUp()
          debug(\`peer \${obj.file.user} connected. resuming download...\`)
          let token = crypto.randomBytes(4).toString('hex')
          stack.downloadTokens[token] = {
            user: obj.file.user,
            file: obj.file.file,
            size: obj.file.size
          }
          stack.download[obj.file.user + '_' + obj.file.file] = {
            cb,
            path: obj.path,
            stream
          }
          peers[obj.file.user].transferRequest(obj.file.file, token)
        }
      }, 200)
      
      timeoutTimer = setTimeout(() => {
        cleanUp()
        cb(new Error('User not exist (timeout connecting to peer)'))
      }, 15000)
      
      return
    }`;

if (!code.includes(originalCheck)) {
  console.error('[Patch-Slsk] Error: Target check code not found in slsk-client.js. The library code structure might have changed.');
  process.exit(1);
}

code = code.replace(originalCheck, patchedCheck);
fs.writeFileSync(targetPath, code, 'utf8');
console.log('[Patch-Slsk] Successfully patched slsk-client.js to handle inactive/dropped peer connections automatically!');
