'use strict';
// Shared E2E plumbing: static server for the site + Playwright routes that send the Google script to the GAS mock.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { createRuntime } = require('./gasmock');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.apk': 'application/vnd.android.package-archive' };
function serve(dir, port) {
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      const f = path.join(dir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      fs.readFile(f, (e, b) => { if (e) { rsp.writeHead(404); rsp.end('not found'); return; } rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); rsp.end(b); });
    }).listen(port, '127.0.0.1', () => res(s));
  });
}

// A stand-in for the Google Maps JS API: just enough for the pages to draw, geocode and pick places.
const FAKE_MAPS = `(function(){
  function LatLng(a,b){ if (a && typeof a==='object'){ b=a.lng; a=a.lat; } this._a=+a; this._b=+b; } LatLng.prototype.lat=function(){return this._a}; LatLng.prototype.lng=function(){return this._b}; LatLng.prototype.toJSON=function(){return {lat:this._a,lng:this._b}};
  function Obj(){ this.l={}; } Obj.prototype.setMap=function(){}; Obj.prototype.addListener=function(e,f){ this.l[e]=f; return {remove:function(){}} }; Obj.prototype.setOptions=function(){}; Obj.prototype.setPosition=function(){}; Obj.prototype.getPosition=function(){return new LatLng(53.5,-113.5)}; Obj.prototype.setPath=function(){}; Obj.prototype.setIcon=function(){}; Obj.prototype.setLabel=function(){};
  function Map(el){ Obj.call(this); this.el=el; } Map.prototype=Object.create(Obj.prototype); ['setCenter','setZoom','fitBounds','setMapTypeId','panTo','panToBounds','setTilt'].forEach(function(k){ Map.prototype[k]=function(){}; }); Map.prototype.getZoom=function(){return 8}; Map.prototype.getCenter=function(){return new LatLng(53.5,-113.5)};
  function Bounds(){ } Bounds.prototype.extend=function(){return this}; Bounds.prototype.isEmpty=function(){return false}; Bounds.prototype.getCenter=function(){return new LatLng(53.5,-113.5)};
  function Geocoder(){} Geocoder.prototype.geocode=function(q,cb){ var r=[{formatted_address:(q.address||'Testville, AB'),geometry:{location:new LatLng(53.45,-113.45)},address_components:[{long_name:'Testville',short_name:'Testville',types:['locality']}]}]; if(cb) setTimeout(function(){cb(r,'OK')},0); return Promise.resolve({results:r}); };
  function Auto(input){ Obj.call(this); this.input=input; } Auto.prototype=Object.create(Obj.prototype); Auto.prototype.getPlace=function(){ return {formatted_address:this.input&&this.input.value, geometry:{location:new LatLng(53.45,-113.45)}} }; Auto.prototype.setFields=function(){}; Auto.prototype.setBounds=function(){}; Auto.prototype.setComponentRestrictions=function(){};
  window.google={maps:{Map:Map,Marker:Obj,Polyline:Obj,Circle:Obj,InfoWindow:Obj,LatLng:LatLng,LatLngBounds:Bounds,Geocoder:Geocoder,event:{addListener:function(){},clearInstanceListeners:function(){}},MapTypeId:{ROADMAP:'roadmap',HYBRID:'hybrid'},SymbolPath:{CIRCLE:0},places:{Autocomplete:Auto},geometry:{encoding:{decodePath:function(){return []}}}}};
})();`;
async function setup(opts) {
  const rt = opts.rt || createRuntime({ script: opts.script });
  const browser = await chromium.launch();
  const log = { requests: [], external: [], consoleErrors: [], pageErrors: [], dialogs: [] };
  async function newContext(ctxOpts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', geolocation: { latitude: 53.55, longitude: -113.49 }, permissions: ['geolocation'] }, ctxOpts || {}));
    await ctx.route(/^https:\/\/script\.google(usercontent)?\.com\//, async (route) => {
      const req = route.request(), u = new URL(req.url()), params = Object.fromEntries(u.searchParams.entries());
      let out, body = req.postData();
      const sid = (/\/macros\/s\/([^/]+)\/exec/.exec(u.pathname) || [])[1], target = (opts.byId && opts.byId[sid]) || rt;   // each script link can be its own company
      try { out = req.method() === 'POST' ? target.post(params, body || '') : target.get(params); }
      catch (e) { out = { status: 'mock-crash', message: String(e && e.stack || e) }; }
      log.requests.push({ method: req.method(), svc: params.svc || '', action: (() => { try { return JSON.parse(body || '{}').action; } catch (e) { return '?'; } })() || params.action || '', status: out && out.status, page: (route.request().frame() && route.request().frame().url().split('/').pop()) || '' });
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out) });
    });
    await ctx.route(/^https:\/\/(routes|maps)\.googleapis\.com\//, async (route) => {
      const u = route.request().url(); log.external.push(u.split('?')[0]);
      if (/computeRouteMatrix/.test(u)) { let n = 1, m = 1; try { const b = JSON.parse(route.request().postData() || '{}'); n = (b.origins || []).length || 1; m = (b.destinations || []).length || 1; } catch (e) {}
        const arr = []; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) arr.push({ originIndex: i, destinationIndex: j, distanceMeters: 55000 + 1000 * (i + j), duration: (2400 + 60 * (i + j)) + 's', condition: 'ROUTE_EXISTS' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(arr) }); }
      if (/computeRoutes/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ routes: [{ distanceMeters: 55000, duration: '2400s', polyline: { encodedPolyline: '' }, legs: [{ distanceMeters: 55000, duration: '2400s' }] }] }) });
      if (/geocode/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK', results: [{ formatted_address: 'Testville, AB', geometry: { location: { lat: 53.5, lng: -113.5 } }, address_components: [{ long_name: 'Testville', types: ['locality'] }] }] }) });
      if (/maps\/api\/js/.test(u)) { const cb = new URL(u).searchParams.get('callback'); return route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_MAPS + (cb ? ';setTimeout(function(){ window[' + JSON.stringify(cb) + '] && window[' + JSON.stringify(cb) + '](); }, 0);' : '') }); }
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await ctx.route(/^https:\/\/(tile\.openstreetmap\.org|cdnjs\.cloudflare\.com|www\.google\.com|maps\.google\.com|drive\.google\.com)\//, r => { log.external.push(r.request().url().split('?')[0]); return r.fulfill({ status: 200, body: '' }); });
    return ctx;
  }
  function watch(page, label) {
    page.on('console', m => { if (m.type() === 'error') log.consoleErrors.push(label + ': ' + m.text().slice(0, 300)); });
    page.on('pageerror', e => log.pageErrors.push(label + ': ' + String(e.message || e).slice(0, 300)));
    page.on('dialog', d => { log.dialogs.push(label + ': [' + d.type() + '] ' + d.message().slice(0, 200)); (page.__dialog ? page.__dialog(d) : d.type() === 'prompt' ? d.accept(page.__prompt || '') : d.accept()).catch(() => {}); });
  }
  return { rt, browser, log, newContext, watch };
}
module.exports = { serve, setup };
