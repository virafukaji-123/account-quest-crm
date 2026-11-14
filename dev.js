// Run the same app on your laptop: AQ_TOKEN=... node dev.js  →  http://localhost:3000
const http = require("http"), fs = require("fs"), path = require("path");
const routes = { "/api/state": require("./api/state"), "/api/refresh": require("./api/refresh"), "/api/note": require("./api/note"), "/api/usage": require("./api/usage"), "/api/client": require("./api/client"), "/api/status": require("./api/status") };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
  res.status = (c) => { res.statusCode = c; return res; };
  if (routes[url.pathname]) {
    let b = ""; for await (const c of req) b += c; try { req.body = b ? JSON.parse(b) : {}; } catch { req.body = {}; }
    try { return await routes[url.pathname](req, res); } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  const f = path.join(__dirname, "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (f.startsWith(path.join(__dirname, "public")) && fs.existsSync(f)) { res.setHeader("content-type", f.endsWith(".html") ? "text/html" : "text/plain"); return fs.createReadStream(f).pipe(res); }
  res.statusCode = 404; res.end("not found");
}).listen(process.env.PORT || 3000, () => console.log("Account Quest CRM on http://localhost:" + (process.env.PORT || 3000)));
