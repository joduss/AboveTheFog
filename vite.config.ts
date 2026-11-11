import {defineConfig} from 'vite';

export default defineConfig({
  // Versioned nationwide terrain packets are ordinary static hosting assets.
  publicDir: 'static',
  plugins: [{name: 'prepared-assets', configureServer(server) {
    server.middlewares.use('/prepared', async (req, res, next) => {
      const {createReadStream} = await import('node:fs');
      const {stat} = await import('node:fs/promises');
      const {resolve, sep} = await import('node:path');
      const root = resolve('public/prepared'), file = resolve(root, '.' + (req.url ?? '').split('?')[0]);
      if (!file.startsWith(root + sep)) {res.statusCode=403;res.end();return;}
      try {const info=await stat(file); if(!info.isFile()) return next(); res.setHeader('Content-Type','application/octet-stream'); createReadStream(file).pipe(res);} catch {next();}
    });
  }, async closeBundle() {
    const {cp, mkdir, readFile} = await import('node:fs/promises');
    await mkdir('dist/prepared',{recursive:true});
    // Native fixtures and full manifests stay local; only delivery assets are shipped.
    const index = JSON.parse(await readFile('src/terrain/prepared-index.json','utf8'));
    for (const area of index.areas) {
      let manifest;
      try {manifest=JSON.parse(await readFile(`public/prepared/${area.id}/manifest.json`,'utf8'));}
      catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT') {console.warn(`Prepared assets absent for ${area.id}; that coverage will show unavailable. Run scripts/prepare_bands.py.`); continue;} throw error;}
      if(manifest.fingerprint!==area.fingerprint) throw Error(`Prepared index/assets differ for ${area.id}; regenerate and rebuild.`);
      for(const format of ['raster','vector']) await cp(`public/prepared/${area.id}/${format}`,`dist/prepared/${area.id}/${format}`,{recursive:true});
    }
  }}],
});
