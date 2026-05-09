const metrics = {
  requestsTotal: 0,
  requestsByMethod: {} as Record<string, number>,
  bytesRead: 0,
  bytesWritten: 0,
  startTime: Date.now(),
  
  recordRequest(method: string, bytesIn: number, bytesOut: number) {
    this.requestsTotal++;
    this.requestsByMethod[method] = (this.requestsByMethod[method] || 0) + 1;
    this.bytesRead += bytesIn; 
    this.bytesWritten += bytesOut;
  },
  
  getStats() {
    const uptime = Date.now() - this.startTime;
    return {
      uptimeMs: uptime,
      uptimeSec: Math.floor(uptime / 1000),
      requestsTotal: this.requestsTotal,
      requestsByMethod: this.requestsByMethod,
      requestsPerSecond: (this.requestsTotal / (uptime / 1000)).toFixed(2),
      bytesWritten: this.bytesWritten,
      bytesRead : this.bytesRead
    };
  }
}

export {metrics}