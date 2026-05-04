import { readerFromMemory } from "./server"
import { type HTTPRes, type HTTPReq, type BodyReader } from "./types"
import { metrics } from "./metrics"
import { handleStaticServing } from "./static"

 function handleRoot(): HTTPRes {
  const html =  `<!DOCTYPE html>
  <html>
  <head><title>HTTP Server From Scratch</title></head>
  <body>
      <h1>HTTP Server From Scratch</h1>
      <p>A pedagogical HTTP/1.1 implementation with zero dependencies.</p>
      
      <h2>Available Endpoints</h2>
      <ul>
          <li><code>GET /</code> — This page</li>
          <li><code>GET /stats</code> — Server metrics (JSON)</li>
          <li><code>GET /health</code> — Health check</li>
          <li><code>POST /echo</code> — Echo request body</li>
      </ul>
  </body>
  </html>`
  return {
    code: 200,
    headers: [Buffer.from('Content-Type : text/html')],
    body: readerFromMemory(Buffer.from(html))
  }
}
function handleStats(): HTTPRes {
  const stats = metrics.getStats()
  const jsonstats = JSON.stringify(stats) 
  return {
    code: 200,
    headers: [Buffer.from('Content-Type : application/json')],
    body : readerFromMemory(Buffer.from(jsonstats))
  }
}
function handleHealth(): HTTPRes {
  return {
    code: 200,
    headers: [Buffer.from('Content-Type : text/plain')],
    body : readerFromMemory(Buffer.from('OK'))
  }
}
function handleEcho(body: BodyReader): HTTPRes {
  return {
    code: 200,
    headers: [Buffer.from('Content-Type: text/plain')],
    body : body
  }
}
function handle404(): HTTPRes {
  return {
    code: 404,
    headers: [Buffer.from('Content-Type: text/plain')],
    body : readerFromMemory(Buffer.from("Not Found"))
  }
}

export function router(req: HTTPReq, body: BodyReader) : HTTPRes {
  const uri = req.uri.toString('latin1')
  switch (uri) {
    case '/':
      return handleRoot()
    case '/stats':
      return handleStats()
    case '/health':
      return handleHealth()
    case '/echo':
      return handleEcho(body)
  }
  const staticRes = handleStaticServing(req, './public');
  if (staticRes) return staticRes;
  
  return handle404();
}