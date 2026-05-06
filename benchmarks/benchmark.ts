import { spawn } from 'child_process';

export async function runAutocannon(target: string): Promise<{ rps: number; latency: number }> {
    return new Promise((resolve, reject) => {
        const autocannon = spawn('autocannon', [
            '-c', '100',      // 100 concurrent connections
            '-d', '10',       // 10 seconds duration
            '--json',         // JSON output
            target
        ]);
        
        let output = '';
        autocannon.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        autocannon.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`autocannon exited with code ${code}`));
                return;
            }
            
            try {
                const result = JSON.parse(output);
                resolve({
                    rps: result.requests.average,  // Requests per second
                    latency: result.latency.average  // Average latency ms
                });
            } catch (e) {
                reject(new Error('Failed to parse autocannon output'));
            }
        });
        
        autocannon.on('error', (err) => {
            reject(err);
        });
    });
}