/**
 * Device tier, decided before first paint (inline script in app/layout.tsx).
 *
 * On low-end hardware — Save-Data, ≤ 4 GB of RAM, ≤ 4 CPU threads (Apple devices excepted:
 * Safari caps the reported count), or a GPU that only renders in software — the page gets
 * <html data-perf="lite">, and app/globals.css then:
 *   - swaps every backdrop blur for the flat tints touch screens already use (a blur over moving
 *     content is recomputed every frame: without a real GPU, scrolling the dashboard fell to
 *     ~20 fps with it and holds 60 fps without it);
 *   - holds the purely decorative loops still (avatar halo, install glow, floating icons…).
 * Nothing else changes. The GPU check runs once, when the page is idle, and its verdict is
 * remembered on the device ("medart-perf" in localStorage).
 */
export const PERF_TIER_SCRIPT = `(function(){try{
var d=document.documentElement,n=navigator,K='medart-perf',v=null;
try{v=localStorage.getItem(K)}catch(e){}
if(v!=='lite'&&v!=='full'){var m=n.deviceMemory,c=n.hardwareConcurrency||8,s=n.connection&&n.connection.saveData,apple=/iPhone|iPad|iPod|Macintosh/.test(n.userAgent);
v=(s||(m&&m<=4)||(c<=4&&!apple))?'lite':'probe';}
if(v==='lite'){d.setAttribute('data-perf','lite');return;}
if(v!=='probe')return;
var probe=function(){var lite=false;try{var gl=document.createElement('canvas').getContext('webgl',{failIfMajorPerformanceCaveat:true});
if(!gl){lite=true}else{var x=gl.getExtension('WEBGL_debug_renderer_info'),r=String(x?gl.getParameter(x.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER));
if(/swiftshader|llvmpipe|softpipe|basic render|software/i.test(r))lite=true;var l=gl.getExtension('WEBGL_lose_context');if(l)l.loseContext();}}catch(e){}
try{localStorage.setItem(K,lite?'lite':'full')}catch(e){}
if(lite)d.setAttribute('data-perf','lite');};
if('requestIdleCallback'in window)requestIdleCallback(probe,{timeout:5000});else setTimeout(probe,2500);
}catch(e){}})();`;
