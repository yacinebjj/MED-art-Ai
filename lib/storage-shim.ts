/**
 * Web Storage safety net, run before the app's own code (inline script in
 * app/layout.tsx, ahead of hydration).
 *
 * localStorage / sessionStorage are not always usable, and the app reads them
 * in dozens of places (theme, language, Pomodoro, caches, drafts…):
 *   - some in-app browsers (Android WebViews embedded by other apps) leave DOM
 *     storage switched off: `window.localStorage` is null;
 *   - "block all cookies / site data" (Chrome, Edge, Firefox, Safari) makes
 *     merely reading `window.localStorage` throw a SecurityError;
 *   - a full quota makes every setItem throw QuotaExceededError.
 * One unguarded read in a provider of the root layout was enough to replace
 * the whole app with "L'application n'a pas pu démarrer", on every page.
 *
 * So, before any of that code runs:
 *   - storage that is missing or throws is replaced by an in-memory Storage
 *     for this page (the app works; choices simply aren't remembered);
 *   - setItem swallows quota errors: a write that doesn't fit is skipped
 *     instead of crashing the screen that asked for it. Nothing in the app
 *     relies on that error (a cache that can't be written is just not cached).
 * Working storage is left untouched.
 *
 * Plain ES5 on purpose: it is injected as-is, not compiled for old browsers.
 */
export const STORAGE_SHIM_SCRIPT = `(function(){try{
var w=window,has=Object.prototype.hasOwnProperty;
function memoryStorage(){var P={
getItem:function(k){k=String(k);return has.call(this,k)?String(this[k]):null},
setItem:function(k,v){this[String(k)]=String(v)},
removeItem:function(k){delete this[String(k)]},
clear:function(){for(var k in this){if(has.call(this,k))delete this[k]}},
key:function(i){var a=Object.keys(this);return i>=0&&i<a.length?a[i]:null}};
Object.defineProperty(P,'length',{get:function(){return Object.keys(this).length}});
return Object.create(P);}
function broken(n){try{var s=w[n];if(!s||typeof s.getItem!=='function')return true;s.getItem('medart:storage-probe');return false}catch(e){return true}}
var names=['localStorage','sessionStorage'];
for(var i=0;i<names.length;i++){if(broken(names[i])){try{Object.defineProperty(w,names[i],{configurable:true,enumerable:true,writable:false,value:memoryStorage()})}catch(e){}}}
var SP=w.Storage&&w.Storage.prototype,set=SP&&SP.setItem;
if(set&&!set.__medartSafe){var safe=function(k,v){try{return set.call(this,k,v)}catch(e){
if(e&&(e.name==='QuotaExceededError'||e.name==='NS_ERROR_DOM_QUOTA_REACHED'||e.code===22||e.code===1014)){try{console.warn('[storage] full, skipped',k)}catch(x){}return}
throw e}};safe.__medartSafe=true;SP.setItem=safe}
}catch(e){}})();`;
