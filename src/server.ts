import { type BodyReader, type HTTPReq, type HTTPRes, type TCPconn, type Dynbuf } from "./types"
import { router } from "./handler"
import { metrics } from "./metrics"
import * as net from 'net'
import { bufPop, bufPush } from "./buffer"
import fs from "fs"
const DEBUG = process.env.DEBUG === 'true';

function log(...args: any[]): void {
    if (!DEBUG) return;
    
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${timestamp}]`, ...args);
}

class HTTPError extends Error{
  code: number;
  
  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = "HTTPError"
  }
}

export function readerFromMemory(data: Buffer): BodyReader{
  let done = false
  return {
    length: data.length,
    read : async () : Promise<Buffer> => {
      if (done) {
        return Buffer.from('')
      } else {
        done = true
        return data
      }
    }
  }
}
// bodyreader is how we interpret the req/res body type
// containing the length and a 'promise' that can be customizably used for any function
// mainly to maintain the idea that data is read or not
// if read return eof else return the data

export function readerFromFilesStream(filepath : string) : BodyReader {
  const fileSize = fs.statSync(filepath).size;
  const stream = fs.createReadStream(filepath)
  
  let waitingResolve : ((chunk : Buffer) => void) | null = null
  let currentChunk : Buffer | null = null
  let ended = false
  
  stream.on('data', (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (waitingResolve) {
      waitingResolve(data)
      waitingResolve = null
      stream.pause()
    } else {
      currentChunk = data
      stream.pause()
    }
  })
  stream.on('end', () => {
    ended = true
    if (waitingResolve) {
      waitingResolve(Buffer.from(''))
      waitingResolve = null
    }
  })
  stream.pause()
  
  return {
    length: fileSize,
    read: async (): Promise<Buffer> => {
      if (currentChunk) {
        const data = currentChunk
        currentChunk = null
        stream.resume()
        return data
      }
      if (ended) {
        return Buffer.from('')
      }
      return new Promise((resolve) => {
        waitingResolve = resolve
        stream.resume()
      })
    }
  }
}

async function serveClient(conn : TCPconn)  {
  const buf : Dynbuf = {data : Buffer.alloc(0), length : 0}

  while (true) {
    const msg: HTTPReq | null = cutMessage(buf) 
    if (!msg) {
      const data = await soRead(conn)
      bufPush(buf, data)
      
      if (data.length === 0) {
        if (buf.length === 0) {
          return
        }
      throw new HTTPError(400, "Unexpected EOF") 
      }
    continue 
    }
    const reqBody =  readerFromReq(conn, buf, msg)
    const res = await router(msg, reqBody)
    log(`${msg.method} ${msg.uri.toString()} → ${res.code} ${res.body.length >= 0 ? res.body.length + 'B' : 'chunked'}`);
    await writeHTTPResp(conn, res)
    if (msg.version === "1.0") {
      return
    }
    let requestBodySize = 0;
    while (true) {
      const chunk = await reqBody.read()
      if (chunk.length === 0) break; 
      requestBodySize += chunk.length;
    }
    metrics.recordRequest(msg.method, requestBodySize, res.body.length >= 0 ? res.body.length : 0)
  }
}
// main server loop starts with storing the HTTP req (method, uri, headers, version) in a variable (msg)
// checks if the message received if not : asynchronously calls for soRead() and bufPush() that pushes data into buffer 
// gets requests body from readerFromReq(), then call for router to check uri and return matching HTTPRes
// pass the response to writeHTTPResp() to send, last loop is for draining, drains the leftover and ensures safety for the next requests

const kMaxHeaderLength = 1024 * 8
function cutMessage(buf: Dynbuf): HTTPReq | null{
  const idx = buf.data.subarray(0, buf.length).indexOf('\r\n\r\n')
  
  if (idx < 0) {
    if (buf.length >= kMaxHeaderLength) {
      throw new HTTPError(413, "header is too large")
    }
    return null
  }
  const headerlen = idx + 4
  const msg = parseHTTPReq(buf.data.subarray(0, headerlen))
  bufPop(buf, headerlen)
  return msg
}
// entire purpose of cutmessage is to return the HTTPReq (request - the body) which it gets from parseHTTPReq() apart from 
// that it cuts the HTTPReq (the whole request including the body) and seperates the body, gets the HTTPReq (request - the body) 
// from parseHTTPReq() and clears the buffer after passing it in parseHTTPReq()

async function soRead(conn : TCPconn) : Promise<Buffer>{
  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err)
    }
    if (conn.ended) {
      resolve(Buffer.from(''))
      return
    }
    if (conn.reader) {
      reject(new Error('another reader exists'));  
    }
    conn.reader = {resolve, reject}
  })
}
// soRead is written to make serverloop wait for the data to arrive as it is called when no data in the buffer
// meanwhile checks for errors and all
 
function readerFromReq(conn: TCPconn, buf: Dynbuf, req: HTTPReq): BodyReader {
  const method = req.method
  let BodyAllowed = true
  if (method === 'GET' || method === 'HEAD') {
    BodyAllowed = false
  }
  let bodyLen : number = -1
  const contentlenheader = fieldGet(req.headers, "Content-Length") 
  if (contentlenheader) {
    bodyLen = parseInt(contentlenheader.toString('latin1'), 10)
    if (isNaN(bodyLen)) {
      throw new HTTPError(400, "bad Content-Length")
    }
  } 
  const transferEncoding = fieldGet(req.headers, "Transfer-Encoding")
  let chunked : boolean = false
  if (transferEncoding && transferEncoding.toString('latin1') === "chunked") {
      chunked = true
  }
  if (!BodyAllowed) {
    if (bodyLen > 0 || chunked) {
      throw new HTTPError(400, "HTTP Body not allowed")
    }
    bodyLen = 0
  }
  if (bodyLen >= 0) {
    return readerFromConnLength(conn, buf, bodyLen)
  } else if (chunked) {
    throw new HTTPError(501, "Chunked Encoding")
  }
  else {
    throw new HTTPError(501, "read to EOF")
  }
}
// almost does the same as cutMessage(), takes the request checks for method and of transfer encoding
// checks for Content-Length header if present gets body length
// call for readerFromConnLength() that returns request in a promise eventually will be used in the echo route

async function writeHTTPResp(conn: TCPconn, res : HTTPRes) : Promise<void> {
  await soWrite(conn, encodeHTTPResp(res)) // for status code and headers
  
  while (true) {
      const chunk = await res.body.read();
      if (chunk.length === 0) break;
      await soWrite(conn, chunk);
  }
}
// writes the response to socket 2 times here, first for status code and headers 
// second time for body, the OS packages both into a TCP segment underneath on both ends

async function newConn(socket : net.Socket) {
  const conn = soInit(socket)
  log(`Client connected from ${socket.remoteAddress}:${socket.remotePort}`);
  try {
    await serveClient(conn)
    log('Client disconnected cleanly');
  } catch (exc) {
    if (exc instanceof HTTPError) {
      log(`HTTP Error ${exc.code}: ${exc.message}`);
    
      const errorResp = {
        code: exc.code,
        headers: [],
        body: readerFromMemory(Buffer.from(exc.message + "\n"))
      }
      
      try {
        await writeHTTPResp(conn, errorResp)
      } catch {
        
      }
    } else {
      log('Unexpected error:', exc);
    }
  }
    finally {
      socket.destroy()
    }
} 

function fieldGet(headers: Buffer[], key: string): Buffer | null {
  // search headers
  const keylower = key.toLowerCase()
  for (const header of headers) {
    const idx = header.indexOf(':'.charCodeAt(0))
    if (idx < 0) continue;  
    const headerName = header.subarray(0, idx).toString('latin1').toLowerCase()
    if (headerName === keylower) {
      let value = header.subarray(idx + 1)
      if (value.length > 0 && value[0] === ' '.charCodeAt(0)) {
        value = value.subarray(1)
      }
      return value
    }
  } return null
}

function readerFromConnLength(conn : TCPconn, buf : Dynbuf, remain : number) : BodyReader {
  const totalLength = remain
  
  return {
    length: totalLength,
    read : async () : Promise <Buffer> => {
      if (remain === 0) {
        return Buffer.from('')
      }  
      if (buf.length === 0) {
        const data = await soRead(conn)
        bufPush(buf, data)
        if (data.length === 0) {
          throw new Error('Unexpected EOF from HTTP body');
        }
      }
      const consume = Math.min(buf.length, remain)
      remain -= consume
      
      const data = Buffer.from(buf.data.subarray(0, consume))
      bufPop(buf, consume)
      
      return data
    }
  }
}

function parseHTTPReq(data: Buffer): HTTPReq {
  // Whole Request Parsing
  const lines: Buffer[] = splitLines(data)
  if (lines.length < 2) {
      throw new HTTPError(400, 'bad request');
  }
  const lastLine = lines[lines.length - 1];
  if (!lastLine || lastLine.length !== 0) {
      throw new HTTPError(400, 'bad request');
  }

  const [method, uri, version] = parseRequestLine(lines[0]!)
  
  const headers: Buffer[] = []
  for (let i = 1; i < lines.length - 1; i++) {
    if (lines[i]!.length === 0) break;
    const line = lines[i]!
    const h = Buffer.from(line)
    if (!validateHeader(h)) {
      throw new HTTPError(400, 'bad request field');
    } headers.push(h)
  }
  return {
         method: method,
         uri: uri,
         version: version,
         headers: headers
     };
}

async function soWrite(conn: TCPconn, data: Buffer): Promise<void>{
  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err)
      return
    }
    try {
      conn.socket.write(data, (err) => {
        if (err) reject(err)
        else resolve()
      })
    }
    catch (err) {
      reject(err)
    }
  })
}

function encodeHTTPResp(res: HTTPRes): Buffer {
  // create response for the request
  const statusText = getStatustext(res.code)
  let lines = [`HTTP/1.1 ${res.code} ${statusText}`]
  
    if(res.body.length >= 0){
    lines.push(`Content-Length: ${res.body.length}`)
    }
  for (const h of res.headers) {
    lines.push(h.toString('latin1'))
  }
  lines.push('')
  lines.push('')
  
  return Buffer.from(lines.join('\r\n'))
}

function getStatustext(code: number): string {
  switch (code){
    case 200:
      return 'OK'
    case 400:
      return 'Bad Request'
    case 404:
      return 'Not Found'
    case 413:
      return 'Payload Too Large'
    case 501:
      return 'Not Implemented'
    default: return 'Unknown'; 
  }
}

function soInit(socket: net.Socket) : TCPconn{
  const conn : TCPconn = {
    socket: socket,
    err: null,
    ended: false,
    reader : null
  }
  socket.on('data', (data: Buffer) => {
    if (conn.reader) {
      conn.reader.resolve(data)
      conn.reader = null
    }
  })
    socket.on('end', () => {
      conn.ended = true
      if (conn.reader) {
        conn.reader.resolve(Buffer.from(''))
        conn.reader = null
      }
    })
  socket.on('error', (err: Error) => {
    conn.err = err
    if (conn.reader) {
      conn.reader.reject(err)
      conn.reader = null
    }
  })
  return conn
}

export function splitLines(data: Buffer): Buffer[] {
  const content = data.toString('latin1');
  if (!content) return [];

  return content
    .split('\r\n')
    .filter((line, index, array) => {
      // Exclude the last element if it is an empty string resulting from a trailing \r\n
      return !(index === array.length - 1 && line === '');
    })
    .map(s => Buffer.from(s));
}

export function parseRequestLine(line: Buffer): [string, Buffer, string] {
  // method, uri, version parsing
  const idxm = line.indexOf(' '.charCodeAt(0))
  const idxu = line.indexOf(' '.charCodeAt(0), idxm + 1)
  const idxv = line.indexOf(' '.charCodeAt(0), idxu + 1)
  if (idxm < 0) {
    throw new HTTPError(400, 'bad request line');
  }
  if (idxu < 0) {
    throw new HTTPError(400, 'bad request line');
  }
  if (idxv !== -1) {
    throw new HTTPError(400, 'bad request line');
  }
  const method = line.subarray(0, idxm).toString('latin1')
  const uri = line.subarray(idxm + 1, idxu)
  const version = line.subarray(idxu + 1).toString('latin1')
  
  if (version !== "HTTP/1.0" && version !== "HTTP/1.1") {
    throw new HTTPError(400, 'bad request line');
  }
  
  return [method, uri, version]
}

export function validateHeader(header : Buffer) : Boolean {
  const idx = header.indexOf(':'.charCodeAt(0));
  if (idx <= 0) return false;  // No colon or empty name
  
  // Check for CR or LF anywhere (injection attack)
  if (header.includes('\r'.charCodeAt(0))) return false;
  if (header.includes('\n'.charCodeAt(0))) return false;
  
  return true;
}

const server = net.createServer({
  noDelay : true,
})
server.on('connection', (socket: net.Socket) => {
  newConn(socket)
})
const PORT = parseInt(process.env.PORT || '1234')
server.listen(PORT, '127.0.0.1', () => {
  log(`Server listening on http://127.0.0.1:${PORT}`);
      console.log(`Server ready: http://127.0.0.1:${PORT}`);
})