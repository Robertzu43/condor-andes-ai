export function createRecorder({canvas,Recorder=globalThis.MediaRecorder,urls=globalThis.URL,onError=()=>{}}) {
  let media,stream,chunks=[],result=null,completion=null,failure=null,disposed=false;
  const release=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null};
  const clear=()=>{if(result?.url)urls.revokeObjectURL(result.url);result=null};
  function start(){
    if(media?.state==='recording')throw Error('A recording is already active');
    if(!Recorder || !canvas.captureStream)throw Error('Video recording is not supported in this browser. Use a current Chrome browser, or export the JSON log.');
    const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(m=>Recorder.isTypeSupported(m));
    if(!mime)throw Error('No supported recording format. Try Chrome or export the JSON log.');
    clear();chunks=[];failure=null;disposed=false;
    try{stream=canvas.captureStream(30);media=new Recorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});
      completion=new Promise(resolve=>{media.onstop=()=>{release();if(!failure&&!disposed){const blob=new Blob(chunks,{type:media.mimeType||mime});if(blob.size)result={blob,url:urls.createObjectURL(blob),extension:mime.includes('mp4')?'mp4':'webm'};else failure=Error('The browser returned an empty recording.');}resolve(result)}});
      media.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
      media.onerror=e=>{failure=e.error||Error('Recording failed');onError(failure);if(media.state!=='inactive')media.stop();else release()};
      media.start(250);
    }catch(e){release();media=null;throw e}
  }
  async function stop(){if(!completion)return result;if(media.state!=='inactive')media.stop();await completion;if(failure)throw failure;return result}
  function dispose(){disposed=true;if(media?.state!=='inactive')media?.stop();release();clear()}
  return {start,stop,dispose,get active(){return media?.state==='recording'},get result(){return result}};
}
