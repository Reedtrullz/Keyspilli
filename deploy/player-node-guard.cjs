const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dns = require('node:dns');
const cp = require('node:child_process');
const denied = () => Object.assign(new Error('PLAYER_GUARD_DENIED'), { code: 'EPERM' });
const filePath = value => value instanceof URL ? require('node:url').fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;
function privatePath(value) {
  const p = filePath(value);
  return typeof p === 'string' && ['/sentinels', '/root', '/home'].some(root => path.resolve(p) === root || path.resolve(p).startsWith(root + '/'));
}
function connectionAllowed(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (options.path) return typeof options.path === 'string' && path.resolve(options.path).startsWith('/tmp/');
  return Number(options.port) === 3000 && ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(options.host ?? 'localhost');
}
module.exports = { privatePath, connectionAllowed };
if (process.env.PLAYER_EXECUTABLES) {
  const allowed = new Set(process.env.PLAYER_EXECUTABLES.split(':'));
  for (const object of [fs, fs.promises]) for (const name of ['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'open', 'openSync', 'createReadStream', 'createWriteStream', 'appendFile', 'appendFileSync']) {
    if (typeof object[name] !== 'function') continue;
    const original = object[name]; object[name] = function (p, ...args) { if (privatePath(p)) throw denied(); return Reflect.apply(original, this, [p, ...args]); };
  }
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) { if (!connectionAllowed(args)) throw denied(); return Reflect.apply(connect, this, args); };
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) { if (!connectionAllowed(args)) throw denied(); return Reflect.apply(listen, this, args); };
  for (const object of [dns, dns.promises]) for (const name of Object.keys(object)) if (name === 'lookup' || name.startsWith('resolve') || name === 'reverse') {
    const original = object[name]; if (typeof original !== 'function') continue;
    object[name] = function (host, ...args) { if (name !== 'lookup' || !['localhost', '127.0.0.1', '::1'].includes(host)) throw denied(); return Reflect.apply(original, this, [host, ...args]); };
  }
  require('node:dgram').createSocket = () => { throw denied(); };
  function childOptions(options) {
    if (options?.shell) throw denied();
    return { ...options, env: { ...process.env, ...options?.env, NODE_OPTIONS: process.env.NODE_OPTIONS, PLAYER_EXECUTABLES: process.env.PLAYER_EXECUTABLES } };
  }
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const original = cp[name]; cp[name] = function (file, args, options, callback) {
      if (!allowed.has(fs.realpathSync(file))) throw denied();
      if (!Array.isArray(args)) { callback = options; options = args; args = []; }
      if (typeof options === 'function') { callback = options; options = undefined; }
      return Reflect.apply(original, this, [file, args, childOptions(options), ...(callback ? [callback] : [])]);
    };
  }
  cp.exec = cp.execSync = () => { throw denied(); };
  const fork = cp.fork; cp.fork = function (file, args, options) {
    if (!Array.isArray(args)) { options = args; args = []; }
    return fork(file, args, { ...childOptions(options), execPath: process.execPath });
  };
  require('node:module').syncBuiltinESMExports();
}
