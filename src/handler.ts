import { readerFromMemory } from "./server"
import { type HTTPRes, type HTTPReq, type BodyReader } from "./types"
import { metrics } from "./metrics"
import { handleServing } from "./static"
import { runAutocannon } from "../benchmarks/benchmark"
import { spawn } from "child_process"

function handleRoot(): HTTPRes {
  const html =  `<!DOCTYPE html>
  <html>
  <head><title>HTTP Server From Scratch</title></head>
  <body>
      <h1>HTTP Server From Scratch</h1>
      <p>A HTTP/1.1 implementation with zero dependencies.</p>
      
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
    headers: [Buffer.from('Content-Type: text/html')],
    body: readerFromMemory(Buffer.from(html))
  }
}
function handleStats(): HTTPRes {
  const stats = metrics.getStats()
  const jsonstats = JSON.stringify(stats, null, 2) 
  return {
    code: 200,
    headers: [Buffer.from('Content-Type: application/json')],
    body : readerFromMemory(Buffer.from(jsonstats))
  }
}
function handleHealth(): HTTPRes {
  return {
    code: 200,
    headers: [Buffer.from('Content-Type: text/plain')],
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

async function handleBenchmark(): Promise<HTTPRes> {
    // Start Express server
    const express = spawn('node', ['benchmarks/express-server.js'], {
        cwd: process.cwd()
    });
    
    // Wait for Express to be ready
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    let yourResult: { rps: number; latency: number };
    let expressResult: { rps: number; latency: number };
    
    try {
        // Benchmark your server
        yourResult = await runAutocannon('http://127.0.0.1:1234/');
        
        // Benchmark Express
        expressResult = await runAutocannon('http://127.0.0.1:1235/');
    } finally {
        // Always kill Express
        express.kill();
    }
    
    const comparison = {
        yourServer: {
            rps: yourResult.rps,
            latency: `${yourResult.latency}ms`
        },
        express: {
            rps: expressResult.rps,
            latency: `${expressResult.latency}ms`
        },
        relative: {
            rps: `${((yourResult.rps / expressResult.rps) * 100).toFixed(1)}%`,
            winner: yourResult.rps > expressResult.rps ? 'yourServer' : 'express'
        }
    };
    
    const json = JSON.stringify(comparison, null, 2);
    
    return {
        code: 200,
        headers: [Buffer.from('Content-Type: application/json')],
        body: readerFromMemory(Buffer.from(json))
    };
}

export async function router(req: HTTPReq, body: BodyReader) : Promise <HTTPRes> {
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
    case '/benchmark':
      return await handleBenchmark();
  }
  const staticRes = handleServing(req, './public');
  if (staticRes) return staticRes;
  
  return handle404();
}