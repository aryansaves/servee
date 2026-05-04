import type { HTTPReq, HTTPRes } from "./types";
import fs from 'fs'
import path from 'path'
import { readerFromMemory } from "./server";
export function handleStaticServing(req : HTTPReq, rootDir : string) : HTTPRes | null{
  const uri = req.uri.toString('latin1')
  if (uri.includes('..')) {
    return null
  }
  let filepath = path.join(rootDir, uri === '/' ? 'index.html' : uri);
  
  if (!fs.existsSync(filepath) || fs.statSync(filepath).isDirectory()) {
          return null; 
  }
  
  const data = fs.readFileSync(filepath)
  const ext = path.extname(filepath)
  const contentType = lookupContentType(ext)
  return {
    code: 200,
    headers: [Buffer.from(`Content-Type: ${contentType}`)],
    body : readerFromMemory(data)
  }
}

function lookupContentType(ext : string) {
  switch (ext) {
    case '.html':
      return 'text/html'
    case '.css':
      return 'text/css'
    case '.js':
      return 'application/javascript'
    case '.json':
      return 'application/json'
    case '.png':
      return 'image/png'
    case '.jpg':
      return 'image/jpeg'
    case '.txt':
      return 'text/plain'
    default: 
      return 'application/octet-stream'
  }
}