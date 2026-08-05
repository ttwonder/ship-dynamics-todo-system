import { execFileSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const base=process.env.VITE_BASE_PATH||'/';
const normalizedBase=base.endsWith('/')?base:`${base}/`;
const buildVersion=(()=>{
  const githubSha=process.env.GITHUB_SHA?.trim();
  if(githubSha)return githubSha;
  try{return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}
  catch{return `local-${Date.now().toString(36)}`;}
})();
const versionManifest=`${JSON.stringify({version:buildVersion},null,2)}\n`;
const appVersionPlugin:Plugin={
  name:'ship-dynamics-app-version',
  configureServer(server){
    const manifestPaths=new Set(['/app-version.json',`${normalizedBase}app-version.json`.replace(/\/+/g,'/')]);
    server.middlewares.use((request,response,next)=>{
      if(!manifestPaths.has((request.url||'').split('?')[0]))return next();
      response.statusCode=200;
      response.setHeader('Content-Type','application/json; charset=utf-8');
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.end(versionManifest);
    });
  },
  generateBundle(){
    this.emitFile({type:'asset',fileName:'app-version.json',source:versionManifest});
  },
};

export default defineConfig({
  plugins: [react(),appVersionPlugin],
  base,
  define:{__SHIP_DYNAMICS_BUILD_VERSION__:JSON.stringify(buildVersion)},
});
