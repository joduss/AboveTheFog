import {defineConfig} from 'vite';

export default defineConfig(({mode}) => ({
  // Versioned nationwide terrain packets are ordinary static hosting assets.
  publicDir: mode==='comparison' ? false : 'static',
  build: {outDir:mode==='comparison' ? 'dist-comparison' : 'dist'},
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
    if (mode!=='comparison') return;
    const {cp, readFile} = await import('node:fs/promises');
    const {areas} = JSON.parse(await readFile('src/terrain/prepared-index.json','utf8'));
    for (const {id} of areas) for (const format of ['raster','vector']) {
      const path = `prepared/${id}/${format}`;
      try {await cp('public/'+path,'dist-comparison/'+path,{recursive:true});}
      catch (error) {if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
    }
  }}],
}));
