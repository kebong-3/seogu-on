/* Only the connection-help page is cached. Never store API responses or location/routes. */
const CACHE='seoon-connection-help-v0160';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('seoon-connection-help-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||event.request.mode!=='navigate'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
});
