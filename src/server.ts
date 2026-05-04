import { type BodyReader, type HTTPReq, type HTTPRes, type TCPconn, type Dynbuf } from "./types"
import { router } from "./handler"
import { metrics } from "./metrics"
import * as net from 'net'
import { bufPop, bufPush } from "./buffer"

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
    const reqBody = readerFromReq(conn, buf, msg)
    const res =  router(msg, reqBody)
    metrics.recordRequest(msg.method, res.body.length >= 0 ? res.body.length : 0)
    await writeHTTPResp(conn, res)
    if (msg.version === "1.0") {
      return
    }
    while (true) {
      const chunk = await reqBody.read()
      if (chunk.length === 0) break; 
    }
  }
}
// main server loop starts with storing the HTTP req (method, uri, headers, version) in a variable (msg)
// checks if the message received if not : asynchronously calls for soRead() and bufPush() that pushes data into buffer 
// gets requests body from readerFromReq, then call for router to check uri and return matching HTTPRes
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

function readerFromReq(conn: TCPconn, buf: Dynbuf, req: HTTPReq): BodyReader {
  // gets Content-Length and passes it to readerfromConnLength as remain
  // also checks for Transfer-Encoding
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
    return readerfromConnLength(conn, buf, bodyLen)
  } else if (chunked) {
    throw new HTTPError(501, "Chunked Encoding")
  }
  else {
    throw new HTTPError(501, "read to EOF")
  }
}

async function writeHTTPResp(conn: TCPconn, res : HTTPRes) : Promise<void> {

  if (res.body.length < 0) {
    throw new Error('TODO : chunked encoding')
  }
  if (fieldGet(res.headers, 'Content-Length')) {
    throw new Error("Content-Length is already set")
  }
  await soWrite(conn, encodeHTTPResp(res))
  
  while (true) {
    const data = await res.body.read()
    if (data.length === 0) break;
    await soWrite(conn, data)
  }
}

async function newConn(socket : net.Socket) {
  const conn = soInit(socket)
  try {
    await serveClient(conn)
  } catch (exc) {
    if (exc instanceof HTTPError) {
      console.error('HTTP error:', exc)
    
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
      console.error('Unexpected exception', exc)
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

function readerfromConnLength(conn : TCPconn, buf : Dynbuf, remain : number) : BodyReader {
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

