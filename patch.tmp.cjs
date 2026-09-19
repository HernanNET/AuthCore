const fs = require('node:fs');
const path = 'D:/DiskC/Projects/python/AuthCore/dist/server/wrangler.json';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.compatibility_flags = ['nodejs_compat'];
config.kv_namespaces = [{ binding: 'SESSION', id: '8776b774744e4d1ba4f6ac8307a02872' }];
fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
console.log('patched: flags=' + JSON.stringify(config.compatibility_flags) + ' kv=' + config.kv_namespaces[0].id);
