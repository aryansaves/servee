import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'net';
import { spawn } from 'child_process';

describe('HTTP Server', () => {
    let server: ReturnType<typeof spawn>;
    let port = 12345; // Use different port to avoid conflict

    beforeAll(async () => {
        // Start server on test port
        server = spawn('bun', ['src/server.ts'], {
            env: { ...process.env, PORT: String(port) }
        });
        
        // Wait for server to start
        await new Promise(r => setTimeout(r, 1000));
    });

    afterAll(() => {
        server.kill();
    });

    it('responds to GET /', async () => {
        const response = await fetch(`http://localhost:${port}/`);
        const text = await response.text();
        
        expect(response.status).toBe(200);
        expect(text).toContain('HTTP Server');
    });

    it('returns stats', async () => {
        const response = await fetch(`http://localhost:${port}/stats`);
        const json  : any = await response.json();
        
        expect(response.status).toBe(200);
        expect(json.requestsTotal).toBeDefined();
        expect(json.uptimeMs).toBeGreaterThan(0);
    });

    it('echoes POST body', async () => {
        const body = 'hello world';
        const response = await fetch(`http://localhost:${port}/echo`, {
            method: 'POST',
            body
        });
        const text = await response.text();
        
        expect(response.status).toBe(200);
        expect(text).toBe(body);
    });

    it('returns 404 for unknown routes', async () => {
        const response = await fetch(`http://localhost:${port}/notfound`);
        
        expect(response.status).toBe(404);
    });
});