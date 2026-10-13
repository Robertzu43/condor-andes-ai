import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {MODEL,createDecider,validatePayload,SAFE_ERROR_CODES} from './decisions.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const assets=new Set(['index.html','game.js','sprites.js','favicon.png','og.png','apple-touch-icon.png','ai/index.html','ai/style.css','ai/app.js','ai/controller.js','ai/recorder.js','ai/experiment.js','ai/learning.js','ai/learning-view.js']);
const types={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png'};
export function createServer({apiKey=process.env.OPENAI_API_KEY,mock=false,fetchImpl}={}) {
  const decide=createDecider({apiKey,mock,fetchImpl});let active=false,lastRequest=0;
  return http.createServer(async(req,res)=>{
    const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))};
    const host=req.headers.host;
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host||'')) return send(403,{error:'Invalid host'});
    const origin=`http://${host}`;
    if (req.headers.origin && req.headers.origin!==origin) return send(403,{error:'Invalid origin'});
    if (req.headers['sec-fetch-site']==='cross-site') return send(403,{error:'Cross-site request rejected'});
    let pathname;try{pathname=new URL(req.url,origin).pathname}catch{return send(400,{error:'Invalid URL'})}
    if(req.method==='GET'&&pathname==='/api/status')return send(200,{configured:!!apiKey,model:MODEL,mock});
    if(req.method==='POST'&&pathname==='/api/decision') {
      if(req.headers.origin!==origin)return send(403,{error:'Same-origin browser request required'});
      if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON required'});
      if(active||Date.now()-lastRequest<200)return send(429,{error:'Decision rate limited'});
      const abort=new AbortController();const timeout=setTimeout(()=>{abort.abort();if(!req.complete)req.destroy()},6000);req.on('aborted',()=>abort.abort());res.on('close',()=>{if(!res.writableEnded)abort.abort()});
      active=true;lastRequest=Date.now();
      try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)throw Error('Body too large')}const payload=validatePayload(JSON.parse(body));send(200,await decide(payload,{signal:abort.signal}));}
      catch(e) {if(!res.destroyed)send(400,{error:apiKey||mock?'Decision failed or invalid request':'OpenAI API key not configured',code:SAFE_ERROR_CODES.includes(e.code)?e.code:'invalid-request'})}
      finally{active=false;clearTimeout(timeout)}return;
    }
    if(req.method!=='GET')return send(404,{error:'Not found'});
    const file=pathname==='/'?'ai/index.html':pathname.slice(1);
    if(!assets.has(file))return send(404,{error:'Not found'});
    try{const data=await readFile(resolve(root,file));res.writeHead(200,{'content-type':types[file.split('.').pop()]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'self'"});res.end(data)}catch{send(404,{error:'Not found'})}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const server=createServer({mock:process.argv.includes('--mock')});server.requestTimeout=7000;server.headersTimeout=8000;server.listen(8789,'127.0.0.1',()=>console.log(`Local spectator: http://127.0.0.1:8789 (${process.argv.includes('--mock')?'MOCK — no OpenAI calls': 'OpenAI Decisions; configure local key for real play'})`));
}
