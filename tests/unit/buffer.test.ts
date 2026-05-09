import { describe, it, expect } from 'vitest';
import { bufPush, bufPop } from '../../src/buffer';
import type { Dynbuf } from '../../src/types';

describe('bufPush', () => {
    it('appends data to empty buffer', () => {
        const buf: Dynbuf = { data: Buffer.alloc(0), length: 0 };
        bufPush(buf, Buffer.from('hello'));
        
        expect(buf.length).toBe(5);
        expect(buf.data.subarray(0, buf.length).toString()).toBe('hello');
    });

    it('appends to existing data', () => {
        const buf: Dynbuf = { data: Buffer.from('hello'), length: 5 };
        bufPush(buf, Buffer.from(' world'));
        
        expect(buf.length).toBe(11);
        expect(buf.data.subarray(0, 11).toString()).toBe('hello world');
    });
});

describe('bufPop', () => {
    it('removes bytes from front', () => {
        const buf: Dynbuf = { data: Buffer.from('hello world'), length: 11 };
        bufPop(buf, 6);
        
        expect(buf.length).toBe(5);
        expect(buf.data.subarray(0, 5).toString()).toBe('world');
    });

    it('handles popping all bytes', () => {
        const buf: Dynbuf = { data: Buffer.from('hi'), length: 2 };
        bufPop(buf, 2);
        
        expect(buf.length).toBe(0);
    });
});